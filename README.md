# sia-skills - Scogo's curated skills catalog

This repository is the canonical source for Scogo-maintained skills consumed by Sia CLI. Operators discover and install these with `sia skill sync`, `sia skill search`, and `sia skill add`.

Authors work in a deep tree for ownership and review. Sia consumes a flat generated catalog for runtime discovery:

```
skills/<domain>/<oem-or-technology>/<action>/SKILL.md
skills/<domain>/_generic/<action>/SKILL.md
skills/_meta/<cross-domain-action>/SKILL.md
```

The generated `catalog.json` is the runtime contract. `index.json` is the human/search index with the resolved path, domain, OEM/technology, action topic, tags, version, compatibility, files, and hash for every skill.

## Repository Layout

```
sia-skills/
├── README.md
├── CLAUDE.md
├── CODEOWNERS
├── LICENSE
├── channels.json
├── catalog.json          # generated runtime catalog; do not hand-edit
├── index.json            # generated browse/search index; do not hand-edit
├── vendors.yaml          # canonical OEM, platform, and technology slugs
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
metadata:
  version: 1.0.0
author: scogo-ai
---
```

Use `compatibility` only when a skill is tied to an OEM product/version axis declared in `vendors.yaml`. Do not add `nist_csf` metadata. Do not add per-skill `LICENSE` files; the repository-level license covers the catalog unless a future legal review says otherwise.

## Authoring Rules

- Keep `name` flat, lowercase, and copy-paste safe. Sia invokes skills by exact name; names are not parsed as paths.
- Put the directory structure into `path` and search metadata into `tags`.
- Write the description in third person and include clear trigger words. This is what the model sees before invoking the skill.
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
node tools/gen-catalog.mjs --channel stable --commit "" --generated-at "$(node -e 'process.stdout.write(require("./catalog.json").generatedAt)')" --out catalog.json
node tools/gen-index.mjs --generated-at "$(node -e 'process.stdout.write(require("./index.json").generatedAt)')" --out index.json
node --test "test/**/*.test.mjs"
```

5. Commit the skill changes with regenerated `catalog.json` and `index.json`.
6. Let CODEOWNERS route content review by domain and platform review for `tools/`, `.github/`, `channels.json`, `catalog.json`, `index.json`, `vendors.yaml`, and `yanked.json`.
7. Release through repo-wide `beta` and `stable` channel pointers in `channels.json`. Use `yanked.json` to block a bad skill version.
