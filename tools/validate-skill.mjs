#!/usr/bin/env node
// tools/validate-skill.mjs
//
// Per-SKILL.md schema + path/name/tag/compatibility consistency validation, plus
// the §2.4.1 unsafe-path scan. Implements design §6.1 steps 3a–3d.
//
// Usage:
//   node tools/validate-skill.mjs skills/                 # validate the whole tree
//   node tools/validate-skill.mjs skills/storage/netapp/reporting   # one skill dir
//
// Exit code 0 = all valid; 1 = one or more violations (printed to stderr).
//
// What it checks per skill (a skill = any directory directly containing a
// SKILL.md):
//   * Required frontmatter: `name`, `description`.
//   * `name` matches /^scogo:[a-z0-9]+(?:-[a-z0-9]+)*$/ and the segment after
//     `scogo:` is `<oem>-<action>` (vendor) or `<action>` (_meta / _generic).
//   * Path↔name: for a vendored skill skills/<domain>/<oem>/<action>, the name's
//     oem segment == <oem> and the trailing action segment(s) == <action>.
//   * Path↔tags: tags include the dir's <domain>, and (vendored) the <oem>.
//   * `<domain>` is in the closed DOMAINS set; `<oem>` is a known vendor slug in
//     vendors.yaml registered under that domain.
//   * `compatibility` (if present): parses, and every product axis is registered
//     for the OEM. Vendor-neutral skills (_meta / _generic) must NOT set it.
//   * Tree depth: vendored skills are exactly skills/<domain>/<oem>/<action>;
//     _meta skills are skills/_meta/<action>; _generic skills are
//     skills/<domain>/_generic/<action>. No deeper.
//   * Unsafe-path scan over the skill dir: no absolute paths, no "..", no
//     symlinks, no files above the size cap, only allowed file types under
//     scripts/ | references/ | assets/.
//   * `version` (if present) is semver-shaped (soft: warn-only here).

import { readdirSync, readFileSync, readlinkSync, realpathSync, statSync, lstatSync } from "node:fs";
import { join, relative, dirname, basename, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "./lib/frontmatter.mjs";
import { parseCompatibility, compatibilityAxes, isSemver } from "./lib/semver.mjs";
import { loadVendors } from "./lib/vendors.mjs";
import { listSkillFiles } from "./lib/hash-skill.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// Closed domain set (design §3.2 Facet 1) — must equal the top-level dirs.
export const DOMAINS = new Set([
  "cloud",
  "containers",
  "database",
  "email",
  "network",
  "security",
  "storage",
  "backup",
  "internal",
  "operating-system",
  "hardware",
  "virtualization",
  "observability",
  "meta",
]);

// Pseudo-OEM markers that mean "no real OEM": the _meta domain dir and the
// per-domain _generic bucket.
const META_DIR = "_meta";
const GENERIC_DIR = "_generic";

// Unsafe-path scan knobs (§2.4.1).
const MAX_FILE_BYTES = 256 * 1024; // 256 KB per file — skills are text, not blobs.
const ALLOWED_BUNDLE_DIRS = new Set([
  "scripts",
  "references",
  "assets",
  "agents",
  "eval-viewer",
  "examples",
  "workflows",
  "troubleshooting",
  "rules",
  "mappings",
  "schemas",
  "themes",
  "cost-forecast",
  "cost-optimization",
  "cost-query",
  "foundry-agent",
  "project",
  "quota",
  "rbac",
  "resource",
]);
// Extensions permitted inside scripts/references/assets bundles.
const ALLOWED_BUNDLE_EXTS = new Set([
  ".md",
  ".txt",
  ".sh",
  ".py",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".tsv",
  ".conf",
  ".cfg",
  ".ini",
  ".tmpl",
  ".xsd",
  ".xml",
  ".html",
  ".js",
  ".cjs",
  ".mjs",
  ".ts",
  ".ps1",
  ".bicep",
  ".gz",
  ".pdf",
]);

const NAME_RE = /^scogo:[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * @typedef {Object} Issue
 * @property {"error"|"warn"} level
 * @property {string} skillDir   repo-relative
 * @property {string} message
 */

/**
 * Find every skill directory (a dir directly containing SKILL.md) under `root`.
 * @param {string} root absolute
 * @returns {string[]} absolute skill dirs
 */
export function findSkillDirs(root) {
  /** @type {string[]} */
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    let hasSkill = false;
    for (const e of entries) {
      if (e.isFile() && e.name === "SKILL.md") hasSkill = true;
    }
    if (hasSkill) out.push(d);
    for (const e of entries) {
      if (e.isDirectory() && e.name !== ".git") walk(join(d, e.name));
    }
  };
  walk(root);
  return out;
}

/**
 * Validate one skill directory. Returns a list of issues (empty = clean).
 *
 * @param {string} skillDir absolute path to a dir containing SKILL.md
 * @param {Map<string, {display:string,domains:string[],products:string[]}>} vendors
 * @returns {Issue[]}
 */
export function validateSkillDir(skillDir, vendors) {
  /** @type {Issue[]} */
  const issues = [];
  // Anchor on the `skills/` path segment within the ABSOLUTE path rather than
  // relative-to-REPO_ROOT, so validation is correct no matter where the tree
  // lives (the real checkout, a CI workspace, a temp materialisation, etc.).
  // relDir is the `skills/...` suffix used for reporting + the catalog `path`.
  const allSegs = skillDir.split(sep);
  const skillsIdx = allSegs.lastIndexOf("skills");
  const relDir =
    skillsIdx === -1 ? allSegs.join("/") : allSegs.slice(skillsIdx).join("/");
  const push = (level, message) => issues.push({ level, skillDir: relDir, message });

  // --- decode the tree position ---------------------------------------------
  // relDir looks like skills/<domain>/<oem>/<action> | skills/_meta/<action>
  //                   | skills/<domain>/_generic/<action>
  if (skillsIdx === -1) {
    push("error", `skill dir is not under a skills/ directory: ${relDir}`);
    return issues; // can't reason further
  }
  const rest = allSegs.slice(skillsIdx + 1); // segments after "skills"

  let domain = null;
  let oem = null; // null = vendor-neutral
  let actionSegs = [];
  let isMeta = false;
  let isGeneric = false;

  if (rest[0] === META_DIR) {
    // skills/_meta/<action...>
    isMeta = true;
    domain = "meta";
    actionSegs = rest.slice(1);
    if (actionSegs.length !== 1) {
      push("error", `_meta skills must be skills/_meta/<action>/ (got depth ${rest.length})`);
    }
  } else {
    domain = rest[0];
    if (rest[1] === GENERIC_DIR) {
      // skills/<domain>/_generic/<action>
      isGeneric = true;
      actionSegs = rest.slice(2);
      if (actionSegs.length !== 1) {
        push("error", `_generic skills must be skills/<domain>/_generic/<action>/ (got depth ${rest.length})`);
      }
    } else {
      // skills/<domain>/<oem>/<action>
      oem = rest[1];
      actionSegs = rest.slice(2);
      if (rest.length !== 3) {
        push("error", `vendored skills must be exactly skills/<domain>/<oem>/<action>/ (3 levels); got ${rest.length}: ${relDir}`);
      }
    }
  }
  const action = actionSegs.join("/");

  // --- domain / oem registry checks -----------------------------------------
  if (!DOMAINS.has(domain)) {
    push("error", `unknown domain "${domain}" (not in the closed domain set)`);
  }
  if (oem !== null) {
    const v = vendors.get(oem);
    if (!v) {
      push("error", `unknown OEM slug "${oem}" (not registered in vendors.yaml)`);
    } else if (!v.domains.includes(domain)) {
      push(
        "error",
        `OEM "${oem}" is not registered under domain "${domain}" in vendors.yaml (registered: ${v.domains.join(", ")})`,
      );
    }
  }

  // --- frontmatter ------------------------------------------------------------
  const skillMd = join(skillDir, "SKILL.md");
  let fm;
  try {
    fm = parseFrontmatter(readUtf8(skillMd));
  } catch (e) {
    push("error", `cannot read SKILL.md: ${String(e && e.message)}`);
    return issues;
  }

  if (!fm.name) push("error", "missing required frontmatter field: name");
  if (!fm.description) push("error", "missing required frontmatter field: description");

  // name shape + path↔name consistency
  if (fm.name) {
    if (!NAME_RE.test(fm.name)) {
      push("error", `name "${fm.name}" must match scogo:<kebab> (lowercase a-z0-9-, single colon)`);
    } else {
      const segment = fm.name.slice("scogo:".length); // <oem>-<action> or <action>
      if (oem !== null) {
        // Expect <oem>-<action>. action may itself contain dashes.
        const expectedPrefix = `${oem}-`;
        if (!segment.startsWith(expectedPrefix)) {
          push("error", `name "${fm.name}" must start with "scogo:${oem}-" to match its directory oem`);
        } else {
          const nameAction = segment.slice(expectedPrefix.length);
          const dirAction = action.replace(/\//g, "-");
          if (nameAction !== dirAction) {
            push(
              "error",
              `name action "${nameAction}" != directory action "${dirAction}" (expected name scogo:${oem}-${dirAction})`,
            );
          }
        }
      } else {
        // _meta / _generic: name is scogo:<action>. For _generic, the design
        // allows scogo:<domain>-<action>; accept either <action> or <domain>-<action>.
        const dirAction = action.replace(/\//g, "-");
        const okMeta = isMeta && segment === dirAction;
        const okGenericPlain = isGeneric && segment === dirAction;
        const okGenericDomain = isGeneric && segment === `${domain}-${dirAction}`;
        if (!(okMeta || okGenericPlain || okGenericDomain)) {
          const want = isMeta
            ? `scogo:${dirAction}`
            : `scogo:${dirAction} or scogo:${domain}-${dirAction}`;
          push("error", `name "${fm.name}" does not match its directory action (expected ${want})`);
        }
      }
    }
  }

  // tags: must include domain (+ oem when vendored)
  const tags = Array.isArray(fm.tags) ? fm.tags : [];
  if (tags.length === 0) {
    push("error", "missing or empty frontmatter field: tags (must include the domain)");
  } else {
    if (!tags.includes(domain)) {
      push("error", `tags must include the domain "${domain}" (tags: ${tags.join(", ")})`);
    }
    if (oem !== null && !tags.includes(oem)) {
      push("error", `tags must include the oem "${oem}" (tags: ${tags.join(", ")})`);
    }
  }

  // compatibility
  if (fm.compatibility !== undefined) {
    if (oem === null) {
      push("error", "vendor-neutral skill (_meta/_generic) must NOT set compatibility (no product axis applies)");
    } else {
      try {
        parseCompatibility(fm.compatibility);
        const axes = compatibilityAxes(fm.compatibility);
        const v = vendors.get(oem);
        const known = new Set(v ? v.products : []);
        for (const ax of axes) {
          if (!known.has(ax)) {
            push(
              "error",
              `compatibility axis "${ax}" is not a registered product for OEM "${oem}" (registered: ${[...known].join(", ") || "none"})`,
            );
          }
        }
      } catch (e) {
        push("error", `invalid compatibility "${fm.compatibility}": ${String(e && e.message)}`);
      }
    }
  }

  // version (soft)
  if (fm.version !== undefined && !isSemver(fm.version)) {
    push("warn", `version "${fm.version}" is not semver (MAJOR.MINOR.PATCH)`);
  }

  // --- catalog v2 OPTIONAL frontmatter (§8.3) --------------------------------
  // when_to_use / triggers: if present, must be a string or a string list.
  // mutates: if present, must be a boolean (true/false). Wrong type = error.
  const fmBlock = extractRawFrontmatter(readUtf8(skillMd));
  for (const key of ["when_to_use", "when-to-use", "triggers"]) {
    const raw = rawFrontmatterValue(fmBlock, key);
    if (raw === null) continue; // key absent
    if (!isStringOrStringListShape(raw)) {
      push("error", `frontmatter "${key}" must be a string or a list of strings`);
    }
  }
  {
    const raw = rawFrontmatterValue(fmBlock, "mutates");
    if (raw !== null) {
      const v = raw.inline.trim().toLowerCase();
      const ok = v === "true" || v === "false" || v === "yes" || v === "no";
      if (!ok) {
        push("error", `frontmatter "mutates" must be a boolean (true/false), got "${raw.inline.trim()}"`);
      }
    }
  }

  // --- unsafe-path scan over the bundle --------------------------------------
  scanUnsafePaths(skillDir, push);

  return issues;
}

/**
 * The §2.4.1 unsafe-path scan, scoped to a single skill directory.
 * @param {string} skillDir absolute
 * @param {(level:"error"|"warn", msg:string)=>void} push
 */
function scanUnsafePaths(skillDir, push) {
  const realRoot = safeRealpath(skillDir);
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === ".git") continue;
      const full = join(d, e.name);
      const rel = relative(skillDir, full).split(sep).join("/");

      // Reject ".." anywhere and absolute components (defensive — readdir won't
      // produce these, but the check documents the invariant).
      if (rel.split("/").some((s) => s === "..") || rel.startsWith("/")) {
        push("error", `unsafe path component in "${rel}"`);
        continue;
      }

      const st = lstatSync(full);
      if (st.isSymbolicLink()) {
        let target = "";
        try {
          target = readlinkSync(full);
        } catch {
          /* ignore */
        }
        // A symlink that escapes the skill dir is a hard reject; even an
        // internal symlink is rejected (skills must be self-contained files).
        const resolved = safeRealpath(full);
        const escapes = realRoot && resolved ? !isInside(realRoot, resolved) : true;
        push(
          "error",
          escapes
            ? `symlink "${rel}" -> "${target}" escapes the skill directory`
            : `symlink "${rel}" -> "${target}" (symlinks are not allowed in skill bundles)`,
        );
        continue;
      }

      if (st.isDirectory()) {
        walk(full);
        continue;
      }

      if (st.isFile()) {
        if (st.size > MAX_FILE_BYTES) {
          push("error", `file "${rel}" is ${st.size} bytes > cap ${MAX_FILE_BYTES}`);
        }
        // File-type policy: SKILL.md at the root is always fine. Files inside a
        // bundle dir must have an allowed extension. Files elsewhere are warned.
        const top = rel.includes("/") ? rel.split("/")[0] : null;
        if (rel === "SKILL.md") {
          // ok
        } else if (!top && extname(rel) === ".pdf") {
          // Some imported authoring skills include a compact showcase PDF at
          // the skill root. It is still size-capped and included in the hash.
        } else if (top && ALLOWED_BUNDLE_DIRS.has(top)) {
          const ext = extname(rel);
          if (!ALLOWED_BUNDLE_EXTS.has(ext)) {
            push("error", `file "${rel}" has disallowed extension "${ext || "(none)"}" for a ${top}/ bundle`);
          }
        } else {
          push("warn", `unexpected file "${rel}" (only SKILL.md + scripts/|references/|assets/ bundles are conventional)`);
        }
      } else {
        push("error", `non-regular file "${rel}" (sockets/FIFOs/devices are not allowed)`);
      }
    }
  };
  walk(skillDir);
}

/** @param {string} p @returns {string|null} */
function safeRealpath(p) {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/** @param {string} root @param {string} child @returns {boolean} */
function isInside(root, child) {
  const rel = relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep + "..") && !/^\.\.($|[/\\])/.test(rel));
}

/** @param {string} p @returns {string} */
function extname(p) {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i <= 0 ? "" : b.slice(i);
}

/** @param {string} p @returns {string} */
function readUtf8(p) {
  return readFileSync(p, "utf8");
}

/**
 * Return the raw text between the opening/closing `---` frontmatter delimiters,
 * or "" when there is no frontmatter. Mirrors frontmatter.mjs's extractor but is
 * kept local so validation can inspect raw shapes the tolerant parser drops.
 * @param {string} text
 * @returns {string}
 */
function extractRawFrontmatter(text) {
  if (!text.startsWith("---")) return "";
  const afterOpen = text.slice(3);
  const firstNewline = afterOpen.indexOf("\n");
  if (firstNewline === -1) return "";
  const remaining = afterOpen.slice(firstNewline + 1);
  const closeMatch = remaining.match(/^---\s*(?:\r?\n|$)/m);
  if (!closeMatch || closeMatch.index === undefined) return "";
  return remaining.slice(0, closeMatch.index);
}

/**
 * Locate a TOP-LEVEL frontmatter key and return its raw inline value plus the
 * indented block lines that follow it (until the next top-level key / EOF).
 * Returns null when the key is absent.
 * @param {string} block  raw frontmatter text
 * @param {string} key
 * @returns {{ inline: string, blockLines: string[] } | null}
 */
function rawFrontmatterValue(block, key) {
  const lines = block.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\S/.test(line) || !line.includes(":")) continue;
    const colon = line.indexOf(":");
    if (line.slice(0, colon).trim() !== key) continue;
    const inline = line.slice(colon + 1);
    const blockLines = [];
    for (let j = i + 1; j < lines.length; j++) {
      const child = lines[j];
      if (child.length > 0 && !/^\s/.test(child)) break; // dedent → next top-level key
      blockLines.push(child);
    }
    return { inline, blockLines };
  }
  return null;
}

/**
 * Decide whether a raw frontmatter value is shaped as a string or a list of
 * strings (vs a mapping / nested object, which is the disallowed shape). Accepts:
 *   - a non-empty inline scalar       (key: some text)
 *   - an inline list                  (key: [a, b])
 *   - a block list of "- item" lines  (key:\n  - a\n  - b)
 * Rejects an empty value with indented "subkey: value" children (a mapping).
 * @param {{ inline: string, blockLines: string[] }} raw
 * @returns {boolean}
 */
function isStringOrStringListShape(raw) {
  const inline = raw.inline.trim();
  if (inline.startsWith("[")) return inline.includes("]"); // inline list
  if (inline !== "" && inline !== "|" && inline !== ">") return true; // scalar (or block scalar)
  // Empty inline → must be a block LIST (only "- item" / blank lines), not a map.
  const meaningful = raw.blockLines.filter((l) => l.trim() !== "");
  if (meaningful.length === 0) return false; // present but empty
  return meaningful.every((l) => /^\s*-\s+/.test(l));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * Validate a path (a tree root or a single skill dir). Returns all issues.
 * @param {string} target absolute or repo-relative
 * @returns {Issue[]}
 */
export function validate(target) {
  const vendors = loadVendors(join(REPO_ROOT, "vendors.yaml"));
  const abs = isAbsolute(target) ? target : join(REPO_ROOT, target);

  let dirs;
  // If the target itself contains a SKILL.md, validate just it; else treat as a tree.
  if (containsSkillMd(abs)) {
    dirs = [abs];
  } else {
    dirs = findSkillDirs(abs);
  }

  /** @type {Issue[]} */
  const all = [];
  for (const d of dirs) all.push(...validateSkillDir(d, vendors));
  return all;
}

function isAbsolute(p) {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}

function containsSkillMd(dir) {
  try {
    return statSync(join(dir, "SKILL.md")).isFile();
  } catch {
    return false;
  }
}

// Run as CLI when invoked directly.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const target = process.argv[2] || "skills";
  const issues = validate(target);
  const errors = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warn");
  for (const w of warns) process.stderr.write(`WARN  ${w.skillDir}: ${w.message}\n`);
  for (const e of errors) process.stderr.write(`ERROR ${e.skillDir}: ${e.message}\n`);
  if (errors.length > 0) {
    process.stderr.write(`\nvalidate-skill: ${errors.length} error(s), ${warns.length} warning(s)\n`);
    process.exit(1);
  }
  process.stdout.write(`validate-skill: OK (${warns.length} warning(s))\n`);
}
