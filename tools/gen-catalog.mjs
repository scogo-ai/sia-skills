#!/usr/bin/env node
// tools/gen-catalog.mjs
//
// Walk skills/, derive a FLAT catalog entry per SKILL.md, and emit catalog.json
// (design §2.4, §4.1, §6.1). The deep on-disk tree (skills/<domain>/<oem>/<action>)
// is flattened: the nesting survives in each entry's `path` + `tags`, never in
// `name` (which is the opaque flat identifier the model types verbatim — §1.1).
//
// Per-skill entry shape (schemaVersion 1):
//   { name, description, tags[], path, files[], sha256, compatibility?, version }
//
// Top-level catalog shape:
//   { schemaVersion:1, repo, channel, ref, commit, generatedAt, skills:[...], yanked:[...] }
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
//   node tools/gen-catalog.mjs --stdout                         # print to stdout, don't write

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "./lib/frontmatter.mjs";
import { canonicalSkillHash, listSkillFiles } from "./lib/hash-skill.mjs";
import { loadVendors } from "./lib/vendors.mjs";
import { findSkillDirs, validateSkillDir } from "./validate-skill.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCHEMA_VERSION = 1;
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
    channel: "stable",
    ref: null,
    commit: null,
    generatedAt: null,
    stdout: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.out = argv[++i];
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
    void action; // action is encoded into name/path already; kept for clarity.

    const fm = parseFrontmatter(readFileSync(join(dir, "SKILL.md"), "utf8"));
    const files = listSkillFiles(dir); // sorted, POSIX-relative, .git-excluded
    const sha256 = canonicalSkillHash(dir);

    /** @type {Record<string, unknown>} */
    const entry = {
      name: fm.name,
      description: fm.description,
      tags: buildTags(domain, oem, fm.tags),
      path: relDir,
      files,
      sha256,
    };
    // Optional fields, in the design's documented order: compatibility before version.
    if (fm.compatibility !== undefined) entry.compatibility = fm.compatibility;
    if (fm.version !== undefined) entry.version = fm.version;

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
  if (opts.stdout) {
    process.stdout.write(text);
  } else {
    writeFileSync(opts.out, text);
    process.stderr.write(`gen-catalog: wrote ${catalog.skills.length} skill(s) -> ${opts.out}\n`);
  }
}
