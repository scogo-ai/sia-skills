# sia-skills — Scogo's curated skills catalog

This repository is the **curated skill source** for the [Sia CLI](https://github.com/scogo-ai)
(`@scogo/sia`). It holds Scogo-maintained, reviewed agent skills that Sia
operators pull with `sia skill sync` / `search` / `add`, plus the generator and
CI that turn the human-friendly tree into the machine-friendly `catalog.json`
that Sia actually consumes.

> **Two layers, one repo.** Authors work in a **deep tree** for navigation and
> ownership (`skills/<domain>/<oem>/<action>/SKILL.md`). Sia consumes a **flat
> catalog** (`catalog.json`) for discovery and activation. CI is the bridge: it
> walks the tree, validates each `SKILL.md`, computes a deterministic hash, and
> emits the flat catalog. **Never hand-edit `catalog.json`** — it is generated.

See the full design and rationale in the Sia repo:
`packages/sia-core/docs/curated-skills-repo-structure.md`.

---

## Repository layout

```
sia-skills/
├── README.md            # this file
├── CODEOWNERS           # domain-scoped review; supply-chain files locked to platform
├── channels.json        # { "stable": "<tag>", "beta": "<tag>" } — release pointers
├── catalog.json         # GENERATED, committed; CI fails if it drifts from the tree
├── vendors.yaml         # canonical OEM slug registry + product axes (compatibility)
├── yanked.json          # known-bad { name, version, reason, since } — Sia refuses these
├── tools/
│   ├── gen-catalog.mjs      # walk skills/ -> catalog.json (the bridge)
│   ├── validate-skill.mjs   # per-SKILL.md schema + path/name/tag/compat + unsafe-path scan
│   └── lib/
│       ├── hash-skill.mjs   # THE canonical skill-dir hash (shared with Sia's verifier)
│       ├── frontmatter.mjs  # tolerant YAML frontmatter parse (mirrors Sia's parser)
│       ├── semver.mjs       # compatibility-range parse/validate
│       └── vendors.mjs      # vendors.yaml loader
├── test/
│   └── roundtrip.test.mjs   # gen -> verify hash -> tamper -> refuse (the §2.4.1 fixture)
├── .github/workflows/
│   └── catalog.yml          # PR gate: validate + regen + drift-fail + roundtrip test
└── skills/                  # the deep human tree (domain / oem / action)
    ├── _meta/<action>/                     # cross-domain, vendor-neutral
    ├── <domain>/<oem>/<action>/            # vendor-specific
    └── <domain>/_generic/<action>/         # vendor-neutral, single-domain
```

---

## Naming, in one paragraph

A skill's `name` is `scogo:<oem>-<action>` (e.g. `scogo:fortinet-config-change`)
— **flat, kebab-case, no slashes**, because Sia treats the name as an opaque
exact-match identifier the model types verbatim. Cross-domain `_meta` skills drop
the OEM: `scogo:<action>` (e.g. `scogo:incident-triage`). The deep tree position
is **not** in the name — it survives in the catalog entry's `path` (the real
directory) and `tags` (`[domain, oem, action-verb, …]`). The `scogo:` prefix is
**reserved** for this repo + Sia's bundled skills; user/project skills must not
use it (Sia's loader precedence would let a local skill silently shadow a curated
one otherwise).

---

## Adding a skill

1. **Place the folder.**
   - Vendor-specific: `skills/<domain>/<oem>/<action>/SKILL.md`
   - Vendor-neutral, cross-domain: `skills/_meta/<action>/SKILL.md`
   - Vendor-neutral, single-domain: `skills/<domain>/_generic/<action>/SKILL.md`
   - Max **3 levels** under `skills/`. Product specificity goes in
     `compatibility` + the action name, not a 4th directory level.

2. **Pick the name.** `scogo:<oem>-<action>` (or `scogo:<action>` for `_meta`).
   Confirm `<oem>` is registered in `vendors.yaml` and the segment after
   `scogo:` is globally unique (`grep '"name"' catalog.json`).

3. **Write the frontmatter** (only `name` + `description` are required; the rest
   are the Sia `SiaSkill` superset and are lifted into the catalog by CI):

   ```yaml
   ---
   name: scogo:<oem>-<action>
   description: "Use when <trigger>. <What it produces / its guardrails>."
   tags: [<domain>, <oem>, <action-verb>, <optional-qualifiers>]
   compatibility: "<product><op><ver>,..."   # omit for vendor-neutral skills
   metadata:
     version: 1.0.0
   # allowed-tools: [...]      # OPTIONAL — transparency only; never auto-grants
   # paths: ["**/<vendor>/**"] # OPTIONAL — dormant until a matching file is touched
   # license: ...              # OPTIONAL — overrides repo LICENSE for this skill
   ---
   ```

   The **description is all the model sees pre-invoke** — lead with a clear "Use
   when …" trigger. Put long lookup tables in `references/` (progressive
   disclosure) and operator-runnable helpers in `scripts/` (bundled + hashed, but
   **never auto-executed** — shell-in-skill is disabled).

4. **Regenerate + validate locally**, then commit `SKILL.md` **and** the
   regenerated `catalog.json` together (CI fails if they diverge):

   ```sh
   node tools/validate-skill.mjs skills/<domain>/<oem>/<action>
   node tools/gen-catalog.mjs --channel stable --out catalog.json
   node --test "test/**/*.test.mjs"
   ```

   > Tip: the catalog's `generatedAt` is the only nondeterministic field. To keep
   > diffs clean, regenerate with `--generated-at "$(node -e 'process.stdout.write(require("./catalog.json").generatedAt)')"`
   > (reuse the existing timestamp), or let CI normalise it.

5. **PR + review.** Domain `CODEOWNERS` review content; `@scogo-ai/sia-platform`
   review anything under `tools/`, `.github/`, `channels.json`, `vendors.yaml`,
   `yanked.json`, or `catalog.json`.

---

## Channels & release flow

`channels.json` holds two repo-wide pointers (not per-domain):

```json
{ "stable": "v2026.05.1", "beta": "v2026.06.0-rc1" }
```

- **`beta`** — the release-candidate tag; new skills and revisions land here first.
- **`stable`** — promoted, soak-tested tag; what admin-pinned fleets run.

Maturity is expressed by **which skills are promoted to `stable`**, not by minting
per-domain channels. A nascent domain simply has fewer skills in `stable`.

**Promotion** (beta → stable) is a reviewed channel move behind
`@scogo-ai/sia-platform`, with a release note + a rollback pointer. Operators pick
up the change on their next `sia skill sync` (or TTL auto-refresh).

**Yank / rollback.** To pull a bad version, add it to `yanked.json`
(`{ name, version, reason, since }`); Sia refuses activation even if already
cached. To roll back broadly, move the channel back to the prior good tag.

---

## CI flow (`.github/workflows/catalog.yml`)

On every PR/push that touches `skills/`, `tools/`, or the control files:

1. **Validate** every `SKILL.md` — required `name` + `description`, the
   path↔name↔tag↔compatibility consistency rules, and the unsafe-path scan
   (absolute paths, `..`, symlinks, oversized/disallowed files).
2. **Regenerate** `catalog.json` from the tree (env-derived `generatedAt` +
   `commit` normalised against the committed copy).
3. **Fail on drift** — the committed `catalog.json` must match the regeneration
   byte-for-byte.
4. **Roundtrip test** — generate → verify each `sha256` against an independent
   recomputation → tamper a materialised copy → confirm the hash changes (Sia
   refuses a mismatch).

### The canonical skill-dir hash

Each catalog entry's `sha256` is computed by `tools/lib/hash-skill.mjs`. **Sia's
integrity verifier re-implements the identical algorithm** and re-hashes the
materialised skill directory before every activation, so the recipe is a binding
contract on both sides:

```
canonicalSkillHash(dir) -> lowercase hex sha256:
  1. files = every regular file under dir, recursive, EXCLUDING any ".git" segment.
  2. rels  = each file's path relative to dir, POSIX "/"-separated, sorted by
             UTF-8 byte order (Buffer.compare).
  3. h = sha256
  4. for each rel in sorted order:
        h.update(utf8(rel)); h.update(0x0A);
        h.update(<raw bytes of dir/rel>); h.update(0x0A);
  5. return h.digest("hex")
```

No tar is used (tar headers are nondeterministic). The catalog's `files[]` array
lists exactly these sorted relative paths.
