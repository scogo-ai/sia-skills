// tools/lib/hash-skill.mjs
//
// THE CANONICAL SKILL-DIR HASH.
//
// This is the single source of truth for `catalog.json`'s `sha256` field and
// for `files[]`. sia's integrity verifier (sia-core) re-implements the IDENTICAL
// algorithm and re-hashes the materialised skill dir before every activation
// (binding contract §2.4 integrity rule 3). ANY deviation here — byte ordering,
// separators, the 0x0A delimiters, the .git exclusion — silently breaks
// verification on the sia side. Do not "improve" this without changing both
// sides in lockstep.
//
// We deliberately do NOT use tar: tar headers (mtime, uid/gid, ordering,
// padding) are nondeterministic across platforms and tar implementations.
// Instead we hash a flat, explicitly-ordered concatenation of (relativePath,
// fileBytes) pairs, each terminated by a single 0x0A byte.
//
// Algorithm (canonicalSkillHash(dir) -> lowercase hex sha256):
//   1. files = every regular file under `dir`, recursive, EXCLUDING any path
//      that contains a ".git" path segment.
//   2. rels  = each file's path relative to `dir`, separators normalised to
//      POSIX "/", sorted by UTF-8 byte order (Buffer.compare on the utf8 bytes).
//   3. h = sha256
//   4. for each rel in sorted order:
//          h.update(Buffer.from(rel, "utf8"))
//          h.update(Buffer.from([0x0A]))
//          h.update(<raw bytes of dir/rel>)
//          h.update(Buffer.from([0x0A]))
//   5. return h.digest("hex")  (lowercase hex)

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const NL = Buffer.from([0x0a]);

/**
 * Recursively collect every regular file under `dir`, excluding any path that
 * contains a ".git" segment. Returns absolute paths.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function collectFiles(dir) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} d */
  const walk = (d) => {
    const entries = readdirSync(d, { withFileTypes: true });
    for (const ent of entries) {
      // Exclude any ".git" path segment (the .git directory, .gitignore is
      // fine — only an exact ".git" segment is excluded, matching the spec's
      // "path containing a .git segment").
      if (ent.name === ".git") continue;
      const full = join(d, ent.name);
      if (ent.isSymbolicLink()) {
        // Symlinks are not regular files; skip. (validate-skill.mjs rejects
        // them outright as an unsafe path — here we simply never hash them.)
        continue;
      }
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile()) {
        out.push(full);
      }
      // Sockets/FIFOs/devices are ignored — not regular files.
    }
  };
  walk(dir);
  return out;
}

/**
 * Convert an absolute file path to its POSIX-separated path relative to `dir`.
 *
 * @param {string} dir   absolute skill dir
 * @param {string} file  absolute file path under dir
 * @returns {string}
 */
function toPosixRel(dir, file) {
  let rel = file.slice(dir.length);
  // Strip a single leading separator left by the slice.
  if (rel.startsWith(sep) || rel.startsWith("/")) rel = rel.slice(1);
  // Normalise Windows separators to POSIX.
  if (sep !== "/") rel = rel.split(sep).join("/");
  return rel;
}

/**
 * Return the canonical sorted list of POSIX-relative file paths under `dir`
 * (the `files[]` array that goes into catalog.json). Sorted by UTF-8 byte
 * order via Buffer.compare. Excludes ".git" segments.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function listSkillFiles(dir) {
  const rels = collectFiles(dir).map((f) => toPosixRel(dir, f));
  rels.sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
  return rels;
}

/**
 * Compute the canonical lowercase-hex sha256 of a skill directory.
 *
 * @param {string} dir  absolute path to the skill directory
 * @returns {string}    lowercase hex sha256
 */
export function canonicalSkillHash(dir) {
  if (!statSync(dir).isDirectory()) {
    throw new Error(`canonicalSkillHash: not a directory: ${dir}`);
  }
  const rels = listSkillFiles(dir);
  const h = createHash("sha256");
  for (const rel of rels) {
    h.update(Buffer.from(rel, "utf8"));
    h.update(NL);
    h.update(readFileSync(join(dir, rel))); // raw bytes, no encoding
    h.update(NL);
  }
  return h.digest("hex");
}
