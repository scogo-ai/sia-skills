// tools/lib/frontmatter.mjs
//
// Tolerant SKILL.md YAML-frontmatter parser. Intentionally dependency-free and
// lenient, mirroring sia-core's `parseSkillSuperset` (packages/sia-core/src/
// skills/frontmatter.ts): unknown keys are ignored, malformed values skipped,
// it never throws.
//
// It extends sia's superset parser with the three fields sia gets from
// pi-agent-core's base Skill parser but which the CATALOG generator must read
// directly from the file: `name`, `description`, and `tags`. (sia itself never
// needs to parse `tags` from frontmatter — they live in the catalog — so they
// are not in sia's superset parser. The catalog generator is where tags are
// authored-into / verified, hence we read them here.)
//
// Supported shapes:
//   name: scogo:netapp-reporting
//   description: "Use when ... ."            (quoted or bare; bare runs to EOL)
//   tags: [a, b, c]                          (inline list)
//   tags:                                    (block list)
//     - a
//     - b
//   compatibility: "ontap>=9.10"
//   paths: ["**/x/**"]  | block list
//   allowed-tools: [a, b] | allowedTools: [a, b] | block list
//   when_to_use: "..."   | when_to_use: [a, b] | block list   (catalog v2 triggers)
//   triggers: [a, b]     | block list                         (catalog v2 triggers; alias of when_to_use)
//   mutates: true        | mutates: false                     (catalog v2 governance flag)
//   metadata:
//     version: 1.0.0
//   version: 1.0.0                           (top-level also accepted)
//   disable-model-invocation: true

/**
 * @typedef {Object} Frontmatter
 * @property {string} [name]
 * @property {string} [description]
 * @property {string[]} [tags]
 * @property {string} [compatibility]
 * @property {string} [version]
 * @property {string[]} [paths]
 * @property {string[]} [allowedTools]
 * @property {boolean} [disableModelInvocation]
 * @property {string} [license]
 * @property {string[]} [whenToUse]   normalised to string[]; from `when_to_use` (catalog v2)
 * @property {string[]} [triggers]    normalised to string[]; from `triggers` (catalog v2)
 * @property {boolean} [mutates]      from `mutates` (catalog v2 governance flag)
 * @property {boolean} [mutatesPresent]  true iff `mutates:` was a parseable boolean in the file
 */

/**
 * Parse the leading `---` … `---` YAML frontmatter block of a SKILL.md.
 * Returns `{}` when absent/empty. Never throws.
 *
 * @param {string} fileText
 * @returns {Frontmatter}
 */
export function parseFrontmatter(fileText) {
  try {
    return _parse(fileText);
  } catch {
    return {};
  }
}

/**
 * @param {string} text
 * @returns {Frontmatter}
 */
function _parse(text) {
  const block = extractFrontmatterBlock(text);
  if (block === null) return {};

  const lines = block.split("\n");
  /** @type {Frontmatter} */
  const result = {};

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Top-level key: no leading whitespace, contains ':'
    if (/^\S/.test(line) && line.includes(":")) {
      const colonIdx = line.indexOf(":");
      const key = line.slice(0, colonIdx).trim();
      const rest = line.slice(colonIdx + 1);

      switch (key) {
        case "name": {
          const v = parseScalar(rest);
          if (v !== null) result.name = v;
          i++;
          continue;
        }
        case "description": {
          const v = parseScalar(rest);
          if (v !== null) result.description = v;
          i++;
          continue;
        }
        case "compatibility": {
          const v = parseScalar(rest);
          if (v !== null) result.compatibility = v;
          i++;
          continue;
        }
        case "license": {
          const v = parseScalar(rest);
          if (v !== null) result.license = v;
          i++;
          continue;
        }
        case "class": {
          const v = parseScalar(rest);
          if (v === "process" || v === "domain") result.class = v;
          i++;
          continue;
        }
        case "version": {
          const v = parseScalar(rest);
          if (v !== null) result.version = v;
          i++;
          continue;
        }
        case "tags": {
          const list = parseListValue(rest, lines, i);
          if (list !== null) {
            result.tags = list.values;
            i += list.consumed;
          } else {
            i++;
          }
          continue;
        }
        case "paths": {
          const list = parseListValue(rest, lines, i);
          if (list !== null) {
            result.paths = list.values;
            i += list.consumed;
          } else {
            i++;
          }
          continue;
        }
        case "allowed-tools":
        case "allowedTools": {
          const list = parseListValue(rest, lines, i);
          if (list !== null) {
            result.allowedTools = list.values;
            i += list.consumed;
          } else {
            i++;
          }
          continue;
        }
        case "when_to_use":
        case "when-to-use": {
          // Accept a scalar ("...") OR an inline/block list. Normalise to string[].
          const list = parseListValue(rest, lines, i);
          if (list !== null) {
            result.whenToUse = list.values;
            i += list.consumed;
          } else {
            const v = parseScalar(rest);
            if (v !== null) result.whenToUse = [v];
            i++;
          }
          continue;
        }
        case "triggers": {
          // Same shape rules as when_to_use; both feed the catalog `triggers` field.
          const list = parseListValue(rest, lines, i);
          if (list !== null) {
            result.triggers = list.values;
            i += list.consumed;
          } else {
            const v = parseScalar(rest);
            if (v !== null) result.triggers = [v];
            i++;
          }
          continue;
        }
        case "mutates": {
          const v = parseBool(rest);
          if (v !== null) {
            result.mutates = v;
            result.mutatesPresent = true;
          }
          i++;
          continue;
        }
        case "disable-model-invocation": {
          const v = parseBool(rest);
          if (v !== null) result.disableModelInvocation = v;
          i++;
          continue;
        }
        case "metadata": {
          // Consume indented children; lift a nested `version:`.
          i++;
          while (i < lines.length) {
            const child = lines[i];
            if (child.length > 0 && !/^\s/.test(child)) break; // dedent ends block
            const t = child.trim();
            if (t.startsWith("version:")) {
              const v = parseScalar(t.slice("version:".length));
              if (v !== null && result.version === undefined) result.version = v;
            }
            i++;
          }
          continue;
        }
        default: {
          i++;
          continue;
        }
      }
    }

    i++;
  }

  return result;
}

/**
 * Extract the text between the opening and closing `---` delimiters.
 * @param {string} text
 * @returns {string | null}
 */
function extractFrontmatterBlock(text) {
  if (!text.startsWith("---")) return null;
  const afterOpen = text.slice(3);
  const firstNewline = afterOpen.indexOf("\n");
  if (firstNewline === -1) return null;
  const remaining = afterOpen.slice(firstNewline + 1);
  const closeMatch = remaining.match(/^---\s*(?:\r?\n|$)/m);
  if (!closeMatch || closeMatch.index === undefined) return null;
  return remaining.slice(0, closeMatch.index);
}

/**
 * Parse an inline `[a, b]` or block (`\n  - a\n  - b`) list.
 * @param {string} rest
 * @param {string[]} lines
 * @param {number} lineIdx
 * @returns {{ values: string[], consumed: number } | null}
 */
function parseListValue(rest, lines, lineIdx) {
  const trimmed = rest.trim();

  if (trimmed.startsWith("[")) {
    const close = trimmed.indexOf("]");
    if (close === -1) return null;
    const inner = trimmed.slice(1, close);
    const values = inner
      .split(",")
      .map((p) => stripQuotes(p.trim()))
      .filter((v) => v.length > 0);
    return { values, consumed: 1 };
  }

  if (trimmed === "" || trimmed === "|" || trimmed === ">") {
    /** @type {string[]} */
    const values = [];
    let consumed = 1;
    let j = lineIdx + 1;
    while (j < lines.length) {
      const child = lines[j];
      const m = child.match(/^\s*-\s+(.*)/);
      if (m) {
        const v = stripQuotes(m[1].trim());
        if (v.length > 0) values.push(v);
        consumed++;
        j++;
      } else {
        break;
      }
    }
    if (values.length === 0) return null;
    return { values, consumed };
  }

  return null;
}

/** @param {string} rest @returns {string | null} */
function parseScalar(rest) {
  const v = stripQuotes(rest.trim());
  return v.length > 0 ? v : null;
}

/** @param {string} rest @returns {boolean | null} */
function parseBool(rest) {
  const v = rest.trim().toLowerCase();
  if (v === "true" || v === "yes") return true;
  if (v === "false" || v === "no") return false;
  return null;
}

/** @param {string} v @returns {string} */
function stripQuotes(v) {
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}
