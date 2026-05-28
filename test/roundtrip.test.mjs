// test/roundtrip.test.mjs
//
// Binding-contract §2.4.1 fixture test for the catalog supply chain:
//
//   1. Generate the catalog from the real skills/ tree.
//   2. Verify each entry's sha256 == an independent recomputation of the
//      canonical skill-dir hash (the "sync -> verify hash" leg sia performs).
//   3. Tamper with a materialised copy of a skill and assert the hash CHANGES
//      (the "tamper -> refuse" leg: sia refuses to activate a hash mismatch).
//   4. Determinism: regenerating yields byte-identical output (idempotency).
//   5. The canonical hash matches a hand-rolled reference implementation of the
//      exact documented algorithm, proving the shipped lib has no deviation.
//
// Run: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, cpSync, writeFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSkillHash, listSkillFiles } from "../tools/lib/hash-skill.mjs";
import {
  generate,
  serialize,
  generateManifest,
  serializeManifest,
} from "../tools/gen-catalog.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// Pin the only nondeterministic field so generate() output is reproducible.
const GEN_OPTS = {
  out: join(REPO_ROOT, "catalog.json"),
  channel: "stable",
  ref: null,
  commit: "",
  generatedAt: "1970-01-01T00:00:00.000Z",
  stdout: false,
};

test("catalog generates with no validation errors", () => {
  const { catalog, issues } = generate(GEN_OPTS);
  const errors = issues.filter((i) => i.level === "error");
  assert.equal(errors.length, 0, `validation errors: ${JSON.stringify(errors, null, 2)}`);
  assert.equal(catalog.schemaVersion, 2);
  assert.equal(catalog.repo, "scogo-ai/sia-skills");
  assert.ok(catalog.skills.length >= 3, "expected at least the 3 example skills");
});

test("schemaVersion 2 fields exist and are well-formed on every entry", () => {
  const { catalog } = generate(GEN_OPTS);
  for (const entry of catalog.skills) {
    // summary: non-empty string (falls back to the full description if needed).
    assert.equal(typeof entry.summary, "string", `summary type for ${entry.name}`);
    assert.ok(entry.summary.length > 0, `summary empty for ${entry.name}`);
    // triggers: string[] with at least one entry, no empties.
    assert.ok(Array.isArray(entry.triggers), `triggers array for ${entry.name}`);
    assert.ok(entry.triggers.length > 0, `triggers empty for ${entry.name}`);
    assert.ok(
      entry.triggers.every((t) => typeof t === "string" && t.length > 0),
      `triggers must be non-empty strings for ${entry.name}`,
    );
    // keywords: string[] (may be empty), lowercased, none duplicating a tag.
    assert.ok(Array.isArray(entry.keywords), `keywords array for ${entry.name}`);
    const tagSet = new Set(entry.tags.map((t) => t.toLowerCase()));
    for (const k of entry.keywords) {
      assert.equal(typeof k, "string", `keyword type for ${entry.name}`);
      assert.equal(k, k.toLowerCase(), `keyword must be lowercase for ${entry.name}: ${k}`);
      assert.ok(!tagSet.has(k), `keyword "${k}" duplicates a tag for ${entry.name}`);
    }
    // keywords deterministic order = sorted ascending.
    const sorted = [...entry.keywords].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    assert.deepEqual(entry.keywords, sorted, `keywords not sorted for ${entry.name}`);
    // mutates: boolean.
    assert.equal(typeof entry.mutates, "boolean", `mutates type for ${entry.name}`);
    // updatedAt: ISO-8601-ish string.
    assert.equal(typeof entry.updatedAt, "string", `updatedAt type for ${entry.name}`);
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(entry.updatedAt), `updatedAt not ISO for ${entry.name}`);
  }
});

test("summary strips the templated trigger prefix", () => {
  const { catalog } = generate(GEN_OPTS);
  const re = /^use when an operator needs /i;
  let stripped = 0;
  for (const entry of catalog.skills) {
    if (re.test(entry.description) && !re.test(entry.summary)) stripped++;
    // summary must never re-introduce the leading boilerplate prefix.
    assert.ok(
      !/^use when an operator needs [^.]*\.\s/i.test(entry.summary),
      `summary still carries the boilerplate prefix for ${entry.name}`,
    );
  }
  assert.ok(stripped > 0, "expected at least one description prefix to be stripped");
});

test("manifest matches a fresh regeneration (byte-identical) and is sorted", () => {
  const { catalog } = generate(GEN_OPTS);
  const a = serializeManifest(generateManifest(catalog));
  const b = serializeManifest(generateManifest(generate(GEN_OPTS).catalog));
  assert.equal(a, b, "manifest generation is not deterministic");

  const manifest = generateManifest(catalog);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.repo, "scogo-ai/sia-skills");
  assert.equal(manifest.skills.length, catalog.skills.length);
  // sorted by name + carries exactly the diff fields.
  const names = manifest.skills.map((s) => s.name);
  assert.deepEqual(names, [...names].sort((x, y) => x.localeCompare(y)), "manifest not sorted by name");
  for (const m of manifest.skills) {
    assert.equal(typeof m.name, "string");
    assert.equal(typeof m.sha256, "string");
    assert.equal(typeof m.updatedAt, "string");
    // sha256 + updatedAt must agree with the catalog entry.
    const entry = catalog.skills.find((s) => s.name === m.name);
    assert.equal(m.sha256, entry.sha256, `manifest sha256 mismatch for ${m.name}`);
    assert.equal(m.updatedAt, entry.updatedAt, `manifest updatedAt mismatch for ${m.name}`);
  }
});

test("every entry sha256 == independent canonical recomputation", () => {
  const { catalog } = generate(GEN_OPTS);
  for (const entry of catalog.skills) {
    const dir = join(REPO_ROOT, entry.path);
    const recomputed = canonicalSkillHash(dir);
    assert.equal(entry.sha256, recomputed, `sha256 mismatch for ${entry.name} at ${entry.path}`);
    // files[] must equal the canonical sorted listing.
    assert.deepEqual(entry.files, listSkillFiles(dir), `files[] mismatch for ${entry.name}`);
  }
});

test("tampering a materialised skill changes the hash (refuse-on-mismatch)", () => {
  const { catalog } = generate(GEN_OPTS);
  const target = catalog.skills[0];
  const srcDir = join(REPO_ROOT, target.path);
  const before = canonicalSkillHash(srcDir);
  assert.equal(target.sha256, before);

  // Materialise (what `sia skill add` does) into a temp dir, then tamper.
  const tmp = mkdtempSync(join(tmpdir(), "sia-skills-roundtrip-"));
  const dst = join(tmp, "skill");
  cpSync(srcDir, dst, { recursive: true });

  // 5a. A faithful copy hashes identically.
  assert.equal(canonicalSkillHash(dst), before, "faithful copy must hash identically");

  // 5b. Appending a byte to SKILL.md flips the hash -> sia would refuse.
  const md = join(dst, "SKILL.md");
  writeFileSync(md, `${readFileSync(md, "utf8")}\n<!-- tampered -->\n`);
  const after = canonicalSkillHash(dst);
  assert.notEqual(after, before, "hash must change after tamper");
});

test("adding a file changes the hash and the files list", () => {
  const { catalog } = generate(GEN_OPTS);
  const target = catalog.skills[0];
  const srcDir = join(REPO_ROOT, target.path);

  const tmp = mkdtempSync(join(tmpdir(), "sia-skills-addfile-"));
  const dst = join(tmp, "skill");
  cpSync(srcDir, dst, { recursive: true });

  const before = canonicalSkillHash(dst);
  writeFileSync(join(dst, "INJECTED.txt"), "surprise\n");
  assert.notEqual(canonicalSkillHash(dst), before, "adding a file must change the hash");
  assert.ok(listSkillFiles(dst).includes("INJECTED.txt"));
});

test("generation is idempotent (byte-identical on re-run)", () => {
  const a = serialize(generate(GEN_OPTS).catalog);
  const b = serialize(generate(GEN_OPTS).catalog);
  assert.equal(a, b);
});

test(".git segments are excluded from hashing and listing", () => {
  const tmp = mkdtempSync(join(tmpdir(), "sia-skills-gitexcl-"));
  const dst = join(tmp, "skill");
  const srcDir = join(REPO_ROOT, "skills/_meta/docx");
  cpSync(srcDir, dst, { recursive: true });
  const baseline = canonicalSkillHash(dst);

  // Drop a fake .git dir + file inside the skill; it must not affect anything.
  const gitDir = join(dst, ".git");
  cpSync(srcDir, gitDir, { recursive: true }); // arbitrary content under .git/
  writeFileSync(join(dst, ".git", "HEAD"), "ref: refs/heads/x\n");

  assert.equal(canonicalSkillHash(dst), baseline, ".git content must be excluded from the hash");
  assert.ok(
    !listSkillFiles(dst).some((f) => f.split("/").includes(".git")),
    ".git paths must be excluded from files[]",
  );
});

test("shipped canonicalSkillHash == hand-rolled reference of the documented algorithm", () => {
  // Independent re-implementation of the EXACT spec, byte for byte, to prove the
  // shipped lib has no hidden deviation.
  const referenceHash = (dir) => {
    const NL = Buffer.from([0x0a]);
    const files = [];
    const walk = (d) => {
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        if (ent.name === ".git") continue;
        const full = join(d, ent.name);
        if (ent.isSymbolicLink()) continue;
        if (ent.isDirectory()) walk(full);
        else if (ent.isFile()) files.push(full);
      }
    };
    walk(dir);
    const rels = files
      .map((f) => relative(dir, f).split(sep).join("/"))
      .sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
    const h = createHash("sha256");
    for (const rel of rels) {
      h.update(Buffer.from(rel, "utf8"));
      h.update(NL);
      h.update(readFileSync(join(dir, rel)));
      h.update(NL);
    }
    return h.digest("hex");
  };

  const { catalog } = generate(GEN_OPTS);
  for (const entry of catalog.skills) {
    const dir = join(REPO_ROOT, entry.path);
    assert.equal(canonicalSkillHash(dir), referenceHash(dir), `reference mismatch for ${entry.name}`);
  }
});

// Sanity: the committed catalog.json on disk matches a fresh generation with the
// same pinned timestamp (mirrors the CI drift gate, but timestamp-normalised).
test("committed catalog.json matches a regeneration (timestamp-normalised)", () => {
  let committedRaw;
  try {
    committedRaw = readFileSync(join(REPO_ROOT, "catalog.json"), "utf8");
  } catch {
    // catalog.json not yet written (first-run); skip rather than fail.
    return;
  }
  const committed = JSON.parse(committedRaw);
  const fresh = generate({ ...GEN_OPTS, generatedAt: committed.generatedAt, commit: committed.commit }).catalog;
  assert.equal(serialize(fresh), committedRaw, "committed catalog.json is stale vs. the tree");
  void statSync; // keep import used if the early-return path is taken
});

// Sanity: the committed manifest.json matches a fresh regeneration off the
// committed catalog's pinned timestamp/commit (mirrors the CI manifest drift gate).
test("committed manifest.json matches a regeneration (timestamp-normalised)", () => {
  let committedManifestRaw;
  try {
    committedManifestRaw = readFileSync(join(REPO_ROOT, "manifest.json"), "utf8");
  } catch {
    return; // manifest not yet written (first-run); skip rather than fail.
  }
  let committedCatalogRaw;
  try {
    committedCatalogRaw = readFileSync(join(REPO_ROOT, "catalog.json"), "utf8");
  } catch {
    return;
  }
  const committedCatalog = JSON.parse(committedCatalogRaw);
  const fresh = generate({
    ...GEN_OPTS,
    generatedAt: committedCatalog.generatedAt,
    commit: committedCatalog.commit,
  }).catalog;
  assert.equal(
    serializeManifest(generateManifest(fresh)),
    committedManifestRaw,
    "committed manifest.json is stale vs. the tree",
  );
});
