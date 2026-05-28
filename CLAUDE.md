# CLAUDE.md

## Repository Defaults

This repo is the canonical Sia CLI curated skill source. Keep the runtime contract intact:

- Do not hand-edit `catalog.json` or `index.json`; regenerate them from the tree.
- Use paths of the form `skills/<domain>/<oem-or-technology>/<action>/SKILL.md`, `skills/<domain>/_generic/<action>/SKILL.md`, or `skills/_meta/<action>/SKILL.md`.
- Use flat names: `scogo:<oem-or-domain>-<action>`. Never use slashes in skill names.
- Keep `description` trigger-oriented and third person: start with "Use when an operator needs ...".
- Set `author: scogo-ai`. Do not add `nist_csf` blocks or per-skill `LICENSE` files.
- Add new OEM/tool/product slugs to `vendors.yaml` before using them in a path or compatibility string.
- Put long material in `references/`, helpers in `scripts/`, and templates in `assets/`.

Before declaring the repo ready, run:

```sh
node tools/validate-skill.mjs skills
node tools/gen-catalog.mjs --channel stable --commit "" --generated-at "$(node -e 'process.stdout.write(require("./catalog.json").generatedAt)')" --out catalog.json
node tools/gen-index.mjs --generated-at "$(node -e 'process.stdout.write(require("./index.json").generatedAt)')" --out index.json
node --test "test/**/*.test.mjs"
```
