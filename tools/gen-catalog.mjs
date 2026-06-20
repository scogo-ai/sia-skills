#!/usr/bin/env node
// tools/gen-catalog.mjs
//
// Walk skills/, derive a FLAT catalog entry per SKILL.md, and emit catalog.json
// (design §2.4, §4.1, §6.1). The deep on-disk tree (skills/<domain>/<oem>/<action>)
// is flattened: the nesting survives in each entry's `path` + `tags`, never in
// `name` (which is the opaque flat identifier the model types verbatim — §1.1).
//
// Per-skill entry shape (schemaVersion 2):
//   { name, description, tags[], path, files[], sha256, compatibility?, version?,
//     summary, triggers[], keywords[], mutates, updatedAt }
//   The first block (through version) is the unchanged schemaVersion-1 shape; the
//   five new fields are appended after it (skills-engine-plan.md §8.3). Old
//   clients ignore the unknown fields; the engine consumes them for BM25 signal.
//
// Top-level catalog shape:
//   { schemaVersion:2, repo, channel, ref, commit, generatedAt, skills:[...], yanked:[...] }
//
// Determinism / idempotency:
//   * skills[] sorted by name; files[] sorted by UTF-8 byte order; tags de-duped
//     in a stable order (domain, oem, then frontmatter order).
//   * sha256 is the CANONICAL skill-dir hash (tools/lib/hash-skill.mjs) — the
//     exact bytes sia re-hashes before activation. files[] lists the same paths.
//   * `generatedAt` is the only nondeterministic field; pass --generated-at to
//     pin it (the staleness check in CI normalises it — see CI notes below).
//
// Usage:
//   node tools/gen-catalog.mjs                                  # write ./catalog.json (channel=stable, ref=channels.stable)
//   node tools/gen-catalog.mjs --out /tmp/catalog.json          # write elsewhere
//   node tools/gen-catalog.mjs --channel beta                   # use beta ref from channels.json
//   node tools/gen-catalog.mjs --ref v2026.06.0-rc1 --commit <sha>
//   node tools/gen-catalog.mjs --generated-at 1970-01-01T00:00:00.000Z   # pin timestamp (for diff-stability)
//   node tools/gen-catalog.mjs --manifest-out /tmp/manifest.json # write the sibling manifest elsewhere
//   node tools/gen-catalog.mjs --stdout                         # print catalog to stdout, don't write either file

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "./lib/frontmatter.mjs";
import { canonicalSkillHash, listSkillFiles } from "./lib/hash-skill.mjs";
import { loadVendors } from "./lib/vendors.mjs";
import {
  deriveSummary,
  deriveTriggers,
  deriveKeywords,
  deriveMutates,
  buildAliasTable,
} from "./lib/derive.mjs";
import { findSkillDirs, validateSkillDir } from "./validate-skill.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCHEMA_VERSION = 2;
const REPO = "scogo-ai/sia-skills";

const META_DIR = "_meta";
const GENERIC_DIR = "_generic";

/**
 * Parse argv into options.
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const opts = {
    out: join(REPO_ROOT, "catalog.json"),
    manifestOut: join(REPO_ROOT, "manifest.json"),
    channel: "stable",
    ref: null,
    commit: null,
    generatedAt: null,
    stdout: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.out = argv[++i];
    else if (a === "--manifest-out") opts.manifestOut = argv[++i];
    else if (a === "--channel") opts.channel = argv[++i];
    else if (a === "--ref") opts.ref = argv[++i];
    else if (a === "--commit") opts.commit = argv[++i];
    else if (a === "--generated-at") opts.generatedAt = argv[++i];
    else if (a === "--stdout") opts.stdout = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

/** @returns {{ stable?: string, beta?: string }} */
function loadChannels() {
  return JSON.parse(readFileSync(join(REPO_ROOT, "channels.json"), "utf8"));
}

/** @returns {{ yanked: Array<object> }} */
function loadYanked() {
  try {
    const parsed = JSON.parse(readFileSync(join(REPO_ROOT, "yanked.json"), "utf8"));
    return Array.isArray(parsed.yanked) ? parsed : { yanked: [] };
  } catch {
    return { yanked: [] };
  }
}

/**
 * Load the repo-root synonyms.json ({ groups: string[][] }) for keyword
 * expansion. Tolerates absence (returns an empty group set).
 * @returns {{ groups: string[][] }}
 */
function loadSynonyms() {
  try {
    const parsed = JSON.parse(readFileSync(join(REPO_ROOT, "synonyms.json"), "utf8"));
    return Array.isArray(parsed.groups) ? parsed : { groups: [] };
  } catch {
    return { groups: [] };
  }
}

/** Best-effort `git rev-parse HEAD`; "" when unavailable (design requirement). */
function gitHeadCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Best-effort per-skill last-modified time: the committer date of the most
 * recent commit that touched the skill dir, ISO-8601 (`git log -1 --format=%cI`).
 * Returns "" when git is unavailable or the dir has no commit yet (e.g. a brand
 * new, not-yet-committed skill) — the caller then falls back to generatedAt.
 * Deterministic given git state.
 *
 * @param {string} relDir   repo-relative POSIX skill dir (the catalog `path`)
 * @returns {string}
 */
function gitLastModified(relDir) {
  try {
    return execFileSync("git", ["log", "-1", "--format=%cI", "--", relDir], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Decode a repo-relative skill dir into { domain, oem|null, action }.
 * @param {string} relDir e.g. "skills/storage/netapp/reporting"
 */
function decodeTree(relDir) {
  const segs = relDir.split("/");
  const rest = segs.slice(1); // drop "skills"
  if (rest[0] === META_DIR) {
    return { domain: "meta", oem: null, action: rest.slice(1).join("/") };
  }
  const domain = rest[0];
  if (rest[1] === GENERIC_DIR) {
    return { domain, oem: null, action: rest.slice(2).join("/") };
  }
  return { domain, oem: rest[1], action: rest.slice(2).join("/") };
}

/**
 * Build the de-duplicated, stably-ordered tag list: [domain, oem?, ...frontmatter].
 * The domain (and oem when vendored) are SEEDED from the tree even if the author
 * omitted them — but validate-skill.mjs already requires them, so in practice
 * this just guarantees ordering + uniqueness.
 *
 * @param {string} domain
 * @param {string|null} oem
 * @param {string[]} fmTags
 * @returns {string[]}
 */
function buildTags(domain, oem, fmTags) {
  const seen = new Set();
  const out = [];
  const add = (t) => {
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  };
  add(domain);
  if (oem) add(oem);
  for (const t of fmTags || []) add(t);
  return out;
}

/**
 * Generate the catalog object.
 * @param {ReturnType<typeof parseArgs>} opts
 * @returns {{ catalog: object, issues: import("./validate-skill.mjs").Issue[] }}
 */
export function generate(opts) {
  const channels = loadChannels();
  const ref = opts.ref ?? channels[opts.channel] ?? "";
  const commit = opts.commit ?? gitHeadCommit();
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const vendors = loadVendors(join(REPO_ROOT, "vendors.yaml"));
  // Alias table for keyword expansion (catalog v2 §8.3): vendor aliases + synonyms.json.
  const aliasTable = buildAliasTable(vendors, loadSynonyms());

  const skillsRoot = join(REPO_ROOT, "skills");
  const dirs = findSkillDirs(skillsRoot).sort();

  /** @type {object[]} */
  const skills = [];
  /** @type {import("./validate-skill.mjs").Issue[]} */
  const allIssues = [];

  for (const dir of dirs) {
    // Validate first — the generator must not emit an entry for an invalid skill.
    const issues = validateSkillDir(dir, vendors);
    allIssues.push(...issues);
    if (issues.some((i) => i.level === "error")) continue;

    const relDir = relative(REPO_ROOT, dir).split(sep).join("/");
    const { domain, oem, action } = decodeTree(relDir);

    const fm = parseFrontmatter(readFileSync(join(dir, "SKILL.md"), "utf8"));
    const files = listSkillFiles(dir); // sorted, POSIX-relative, .git-excluded
    const sha256 = canonicalSkillHash(dir);
    const tags = buildTags(domain, oem, fm.tags);

    /** @type {Record<string, unknown>} */
    const entry = {
      name: fm.name,
      description: fm.description,
      tags,
      path: relDir,
      files,
      sha256,
    };
    // Optional fields, in the design's documented order: compatibility before version.
    if (fm.compatibility !== undefined) entry.compatibility = fm.compatibility;
    if (fm.version !== undefined) entry.version = fm.version;
    if (fm.class === "process" || fm.class === "domain") entry.class = fm.class;

    // --- schemaVersion 2 derived fields (§8.3), appended after the v1 shape. ---
    // Authored triggers come from `when_to_use` first, then `triggers`.
    const authoredTriggers =
      (Array.isArray(fm.whenToUse) && fm.whenToUse.length > 0 && fm.whenToUse) ||
      (Array.isArray(fm.triggers) && fm.triggers.length > 0 && fm.triggers) ||
      undefined;
    const summary = deriveSummary(fm.description);
    entry.summary = summary;
    entry.triggers = deriveTriggers({ authored: authoredTriggers, action, oem, summary });
    entry.keywords = deriveKeywords({ oem, tags, action, aliasTable });
    entry.mutates = deriveMutates({
      authored: fm.mutates,
      authoredPresent: fm.mutatesPresent === true,
      name: fm.name,
      summary,
    });
    const updatedAt = gitLastModified(relDir);
    entry.updatedAt = updatedAt || generatedAt;

    skills.push(entry);
  }

  // Sort by name; assert uniqueness.
  skills.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const dupes = findDuplicates(skills.map((s) => String(s.name)));
  if (dupes.length > 0) {
    allIssues.push({
      level: "error",
      skillDir: "(catalog)",
      message: `duplicate skill name(s): ${dupes.join(", ")}`,
    });
  }

  const yanked = loadYanked().yanked;

  const catalog = {
    schemaVersion: SCHEMA_VERSION,
    repo: REPO,
    channel: opts.channel,
    ref,
    commit,
    generatedAt,
    skills,
    yanked,
  };

  return { catalog, issues: allIssues };
}

/** @param {string[]} names @returns {string[]} */
function findDuplicates(names) {
  const seen = new Set();
  const dup = new Set();
  for (const n of names) {
    if (seen.has(n)) dup.add(n);
    seen.add(n);
  }
  return [...dup];
}

/**
 * Serialise the catalog deterministically (2-space indent, trailing newline).
 * @param {object} catalog
 * @returns {string}
 */
export function serialize(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

/**
 * Derive the compact manifest from a generated catalog (skills-engine-plan.md
 * §7.3 / §8.3). Shape:
 *   { schemaVersion:2, repo, channel, ref, generatedAt,
 *     skills: [{ name, version, sha256, updatedAt }] }   (sorted by name)
 * Purpose: a cheap incremental-sync diff without downloading the full catalog.
 * Deterministic — derived entirely from the (already-deterministic) catalog.
 *
 * @param {object} catalog  a catalog object from generate()
 * @returns {object}
 */
export function generateManifest(catalog) {
  const skills = catalog.skills
    .map((s) => {
      /** @type {Record<string, unknown>} */
      const m = { name: s.name };
      if (s.version !== undefined) m.version = s.version;
      m.sha256 = s.sha256;
      m.updatedAt = s.updatedAt;
      return m;
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return {
    schemaVersion: SCHEMA_VERSION,
    repo: catalog.repo,
    channel: catalog.channel,
    ref: catalog.ref,
    generatedAt: catalog.generatedAt,
    skills,
  };
}

/**
 * Serialise the manifest deterministically (matches `serialize`).
 * @param {object} manifest
 * @returns {string}
 */
export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const opts = parseArgs(process.argv.slice(2));
  const { catalog, issues } = generate(opts);
  const errors = issues.filter((i) => i.level === "error");
  for (const i of issues) {
    process.stderr.write(`${i.level.toUpperCase()} ${i.skillDir}: ${i.message}\n`);
  }
  if (errors.length > 0) {
    process.stderr.write(`\ngen-catalog: refusing to emit — ${errors.length} validation error(s)\n`);
    process.exit(1);
  }
  const text = serialize(catalog);
  const manifestText = serializeManifest(generateManifest(catalog));
  if (opts.stdout) {
    // --stdout prints only the catalog (back-compat); the manifest is a file artifact.
    process.stdout.write(text);
  } else {
    writeFileSync(opts.out, text);
    writeFileSync(opts.manifestOut, manifestText);
    process.stderr.write(
      `gen-catalog: wrote ${catalog.skills.length} skill(s) -> ${opts.out} (+ manifest -> ${opts.manifestOut})\n`,
    );
  }
}
