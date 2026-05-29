# sia-skills - Scogo's curated skills catalog

This repository is the canonical source for Scogo-maintained skills consumed by Sia CLI. Operators discover and install these with `sia skill sync`, `sia skill search`, and `sia skill add`.

Authors work in a deep tree for ownership and review. Sia consumes a flat generated catalog for runtime discovery:

```
skills/<domain>/<oem-or-technology>/<action>/SKILL.md
skills/<domain>/_generic/<action>/SKILL.md
skills/_meta/<cross-domain-action>/SKILL.md
```

The generated `catalog.json` is the runtime contract (schema v2). `index.json` is the human/search index with the resolved path, domain, OEM/technology, action topic, tags, version, compatibility, files, and hash for every skill. `manifest.json` is a compact `{ name, version, sha256, updatedAt }` digest the CLI's skills engine uses to diff the catalog cheaply during incremental sync.

## Repository Layout

```
sia-skills/
├── README.md
├── CLAUDE.md
├── CODEOWNERS
├── LICENSE
├── channels.json
├── catalog.json          # generated runtime catalog (schema v2); do not hand-edit
├── index.json            # generated browse/search index; do not hand-edit
├── manifest.json         # generated compact sync digest; do not hand-edit
├── synonyms.json         # non-vendor synonym groups feeding keyword expansion
├── vendors.yaml          # canonical OEM, platform, and technology slugs (+ optional aliases)
├── yanked.json
├── tools/
│   ├── gen-catalog.mjs
│   ├── gen-index.mjs
│   ├── validate-skill.mjs
│   └── lib/
├── test/
└── skills/
    ├── _meta/
    ├── cloud/
    ├── containers/
    ├── database/
    ├── email/
    ├── network/
    ├── operating-system/
    ├── security/
    └── storage/
```

## Skill Metadata Contract

Every `SKILL.md` starts with concise YAML frontmatter:

```yaml
---
name: scogo:<oem-or-domain>-<action>
description: "Use when an operator needs <trigger>. <What the skill does and its guardrail>."
tags: [<domain>, <oem-or-technology>, <topic>, <qualifier>]
when_to_use:            # OPTIONAL (schema v2) — short example operator intents
  - change a firewall policy
  - push a config with preview and rollback
mutates: true           # OPTIONAL (schema v2) — does the skill change state?
metadata:
  version: 1.0.0
author: scogo-ai
---
```

Use `compatibility` only when a skill is tied to an OEM product/version axis declared in `vendors.yaml`. Do not add `nist_csf` metadata. Do not add per-skill `LICENSE` files; the repository-level license covers the catalog unless a future legal review says otherwise.

### Catalog v2 fields

`catalog.json` is `schemaVersion: 2`. Alongside the unchanged v1 fields (`name`, `description`, `tags`, `path`, `files`, `sha256`, `compatibility?`, `version?`), each entry now carries five fields that feed the CLI's BM25 skills engine. The first three are always generator-derived (no `SKILL.md` edits needed); the last two accept an author override in frontmatter and otherwise fall back to a heuristic:

- **`summary`** — the `description` with the leading templated `"Use when an operator needs <slug>. "` sentence stripped. Used for the `# Skills` listing and as the primary indexed text. Falls back to the full description if stripping empties it.
- **`triggers`** — short example operator intents (highest-weight recall signal). Authored via `when_to_use` (or `triggers`) frontmatter; otherwise derived from the action topic, OEM, and the first sentence of the summary.
- **`keywords`** — synonym/alias expansion (e.g. `k8s↔kubernetes`, `pan↔paloalto`) sourced from per-vendor `aliases` in `vendors.yaml` and the repo-root `synonyms.json`. Only aliases not already present as tags are emitted; lowercased, sorted.
- **`mutates`** — boolean: does the skill change state? Governance-relevant for a governed-autonomy product. Authored via `mutates:` frontmatter; otherwise inferred from state-changing verbs (`apply`/`create`/`delete`/`set`/`configure`/`deploy`/…) vs read-only signals (`report`/`list`/`audit`/`analyze`/`scan`/…), defaulting to `false` when ambiguous.
- **`updatedAt`** — ISO-8601 per-skill last-modified time from `git log -1` on the skill directory (falls back to the catalog's `generatedAt`).

### Authoring `when_to_use` and `mutates`

Both are optional, but new skills should set them — they materially improve retrieval and let the harness gate mutating vs read-only skills:

- `when_to_use` (or its alias `triggers`) is a string or a list of strings. Write 2–4 concise operator-phrased intents the way someone would actually ask ("change a firewall rule", "report on capacity"). These become the catalog `triggers`.
- `mutates` is a boolean. Set `true` for any skill that changes infrastructure/config/state; `false` for read-only report/audit/analysis skills. An authored value always wins over the verb heuristic.

## Authoring Rules

- Keep `name` flat, lowercase, and copy-paste safe. Sia invokes skills by exact name; names are not parsed as paths.
- Put the directory structure into `path` and search metadata into `tags`.
- Write the description in third person and include clear trigger words. This is what the model sees before invoking the skill.
- Set `when_to_use` (2–4 example operator intents) and `mutates` (true/false) so the new skill ships with high-signal `triggers` and an accurate state-change flag from day one.
- Keep `SKILL.md` as the high-level workflow. Put long lookup tables in `references/`, reusable examples in `assets/` or `examples/`, operator-runnable helpers in `scripts/`, rule packs in `rules/` with schemas/mappings beside them, and multi-step imported procedures in clearly linked `workflows/` or `troubleshooting/` bundles.
- Keep references one level below `SKILL.md`; avoid chains like `references/a.md` linking to `references/deep/b.md`.
- Scripts are bundled and hashed, but Sia does not auto-execute them. A skill may tell the operator what a helper does, then ask before using it.

These rules follow the Anthropic skill guidance: keep loaded instructions concise, use progressive disclosure, make descriptions specific, and test the skill against realistic requests.

## Maintenance Process

1. Add or edit a skill under the correct domain path. Use `cloud` for hyperscaler/OEM SaaS services, `database` for database engines and hosted database platforms, `email` for email delivery and template platforms, and `_meta` only for cross-domain authoring or document workflows.
2. Register new OEM, product, platform, or tool slugs in `vendors.yaml`.
3. Check the skill against Anthropic's authoring guidance: keep the trigger description specific, keep `SKILL.md` concise, directly link any references/workflows, and test at least one realistic prompt before declaring it ready.
4. Run validation and generation:

```sh
node tools/validate-skill.mjs skills
# gen-catalog writes catalog.json AND the sibling manifest.json:
node tools/gen-catalog.mjs --channel stable --commit "" --generated-at "$(node -e 'process.stdout.write(require("./catalog.json").generatedAt)')" --out catalog.json --manifest-out manifest.json
node tools/gen-index.mjs --generated-at "$(node -e 'process.stdout.write(require("./index.json").generatedAt)')" --out index.json
node --test "test/**/*.test.mjs"
```

5. Commit the skill changes with regenerated `catalog.json`, `index.json`, and `manifest.json`.
6. Let CODEOWNERS route content review by domain and platform review for `tools/`, `.github/`, `channels.json`, `catalog.json`, `index.json`, `manifest.json`, `synonyms.json`, `vendors.yaml`, and `yanked.json`.
7. Release through repo-wide `beta` and `stable` channel pointers in `channels.json`. Use `yanked.json` to block a bad skill version.

## Cutting a release

The Sia CLI's `sia skill sync` fetches `https://raw.githubusercontent.com/scogo-ai/sia-skills/<ref>/catalog.json`, where `<ref>` is the channel's tag from `channels.json` (e.g. `stable` → `v2026.05.1`). So the catalog must exist **at that tag**, and the CLI's `validateCatalog` requires:

- `catalog.commit` is a 40-char hex SHA — the **source-tree commit the catalog describes** (it records provenance; it is not required to equal the tag's own commit), and
- `catalog.ref` equals the resolved channel tag (e.g. `v2026.05.1`), with `channel` set and `schemaVersion: 2`.

A maintainer cuts a release from a clean `main` like this. Set `TAG` to the channel tag you are publishing (it must match the `stable`/`beta` pointer in `channels.json`):

```sh
# 0. clean tree on main, with origin/main at the commit you want to ship
git switch main && git pull && git status   # must be clean

TAG=v2026.05.1
SHA="$(git rev-parse HEAD)"                                  # source-tree commit the catalog records
GEN_AT="$(node -e 'process.stdout.write(new Date().toISOString())')"

# 1. regenerate all three artifacts with the real commit + the release tag ref,
#    sharing one --generated-at so provenance is consistent.
node tools/gen-catalog.mjs --channel stable --ref "$TAG" --commit "$SHA" \
  --generated-at "$GEN_AT" --out catalog.json --manifest-out manifest.json
node tools/gen-index.mjs --generated-at "$GEN_AT" --out index.json

# 2. validate + test (the timestamp-normalised drift tests confirm the committed
#    catalog/manifest match a fresh regeneration).
node tools/validate-skill.mjs skills
node --test "test/**/*.test.mjs"

# 3. commit, tag at the release commit, push main + the tag (nothing else).
git add -A && git commit -m "release: stable $TAG catalog (schema v2)"
git tag "$TAG"
git push origin main "$TAG"
```

> Note: `gen-catalog.mjs` defaults `--ref` to the channel pointer in `channels.json`, so the test suite (which regenerates with `ref` unset) re-derives the same `ref`. The committed catalog's `ref` must therefore equal the channel tag — which is exactly what you pass here.

Pushing the `v*` tag triggers `.github/workflows/release.yml`, which:

1. checks out the tagged commit and regenerates catalog/index/manifest with `--commit "$GITHUB_SHA" --ref "$GITHUB_REF_NAME"` (proving the tree regenerates cleanly at the tag),
2. runs `node tools/validate-skill.mjs skills` and `node --test`,
3. **gates** the release: asserts the *committed* `catalog.json` at the tag is CLI-valid — `commit` matches `/^[0-9a-f]{40}$/i`, `ref` === the tag name, `channel` is set, `schemaVersion` is `2` — and fails the run otherwise. It does **not** regenerate-and-commit back (that would make the catalog try to record its own release commit — a chicken-and-egg), and
4. publishes `catalog.json` + `index.json` + `manifest.json` as immutable assets on the GitHub Release for the tag (via `gh release create --generate-notes`).

The PR/`main` drift gate in `.github/workflows/catalog.yml` is separate and unchanged: it regenerates from the tree on every PR/push and fails on any catalog/manifest/index drift.

To promote a channel (e.g. point `stable` at a new tag), edit `channels.json` behind platform review, then cut the release at that tag as above.
