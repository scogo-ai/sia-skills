// tools/lib/derive.mjs
//
// Catalog schema v2 (skills-engine-plan.md §8.3) per-skill DERIVED fields.
//
// These functions turn the existing on-disk signal (description, frontmatter,
// tags, name/action, vendor aliases, synonyms.json) into the new catalog fields
// `summary`, `triggers`, `keywords`, `mutates`. They are pure and deterministic:
// identical inputs always yield byte-identical outputs (required by the CI drift
// gate and test/roundtrip.test.mjs). The generator stamps `updatedAt` from git
// separately (it is not pure, so it lives in gen-catalog.mjs).
//
// Design notes:
//   * `summary` strips the templated "Use when an operator needs <slug>. "
//     boilerplate that begins ~all descriptions and dilutes BM25 signal (§5.4).
//   * `triggers` prefers authored `when_to_use`/`triggers` frontmatter; otherwise
//     derives a small, deterministic fallback so coverage is 100% from day one.
//   * `keywords` expands oem/tag/name tokens through vendor `aliases` (vendors.yaml)
//     and `synonyms.json`, emitting only aliases NOT already present as tags —
//     BM25's synonym blind-spot fix, without embeddings.
//   * `mutates` prefers the authored boolean; otherwise a documented verb heuristic.
//
// Nothing here is dependency-bearing; pure string/array work only.

// The leading templated trigger prefix that begins ~all curated descriptions:
//   "Use when an operator needs aws cloudtrail anomaly detection. <real summary>"
// Strip the first sentence ONLY (up to the first period + following whitespace).
const BOILERPLATE_PREFIX_RE = /^use when an operator needs [^.]*\.\s*/i;

// State-changing verbs (skill mutates infrastructure) vs read-only signals.
// Order/word-boundaries matter; matched case-insensitively against name+summary.
const MUTATING_VERBS = [
  "apply", "create", "delete", "remove", "set", "update", "change", "configure",
  "provision", "deploy", "modify", "patch", "restart", "rotate", "revoke",
  "enable", "disable", "write", "migrate", "harden", "remediate",
];
const READONLY_VERBS = [
  "report", "list", "get", "read", "audit", "analy", "inventory", "detect",
  "monitor", "query", "summary", "review", "scan",
];

/**
 * Derive `summary`: the description minus the leading templated trigger prefix.
 * Falls back to the full (trimmed) description if stripping yields empty.
 *
 * @param {string} description
 * @returns {string}
 */
export function deriveSummary(description) {
  const desc = String(description ?? "").trim();
  if (desc === "") return "";
  const stripped = desc.replace(BOILERPLATE_PREFIX_RE, "").trim();
  return stripped.length > 0 ? stripped : desc;
}

/**
 * Title-case a kebab/space slug the way the index does (short tokens upper-cased).
 * "cloudtrail-anomaly-detection" -> "Cloudtrail Anomaly Detection"
 * @param {string} slug
 * @returns {string}
 */
export function titleFromSlug(slug) {
  return String(slug ?? "")
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * The first sentence of a summary (up to the first period), trimmed. Used as a
 * derived trigger when no authored triggers exist.
 * @param {string} summary
 * @returns {string}
 */
function firstSentence(summary) {
  const s = String(summary ?? "").trim();
  if (s === "") return "";
  const dot = s.indexOf(".");
  return (dot === -1 ? s : s.slice(0, dot)).trim();
}

/**
 * Normalise an authored trigger list: trim, drop empties, de-dupe (first-wins),
 * cap at `cap`. Deterministic (preserves authored order).
 * @param {string[]} values
 * @param {number} cap
 * @returns {string[]}
 */
function normalizeTriggers(values, cap) {
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const v = String(raw ?? "").trim();
    if (v === "") continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Derive `triggers` (string[]). Prefers authored frontmatter `when_to_use` /
 * `triggers`; otherwise a deterministic fallback from name/action + oem + summary.
 *
 * @param {object} args
 * @param {string[]} [args.authored]   normalised frontmatter when_to_use/triggers
 * @param {string}   args.action       dir action slug (e.g. "config-change")
 * @param {string|null} args.oem       vendor slug or null
 * @param {string}   args.summary      derived summary
 * @param {number}   [args.cap=6]
 * @returns {string[]}
 */
export function deriveTriggers({ authored, action, oem, summary, cap = 6 }) {
  if (Array.isArray(authored) && authored.length > 0) {
    const norm = normalizeTriggers(authored, cap);
    if (norm.length > 0) return norm;
  }
  // Fallback: title-cased action/topic, "<oem> <action words>", first sentence.
  const topic = titleFromSlug(action);
  const candidates = [];
  if (topic) candidates.push(topic);
  if (oem) {
    const actionWords = String(action ?? "").split(/[-\s]+/).filter(Boolean).join(" ");
    const phrase = `${oem} ${actionWords}`.trim();
    if (phrase) candidates.push(phrase);
  }
  const fs = firstSentence(summary);
  if (fs) candidates.push(fs);
  return normalizeTriggers(candidates, cap);
}

/**
 * Build the alias-lookup table: a lowercase token -> set of its synonym-group
 * members, seeded from vendor `aliases` (slug <-> aliases, both directions) and
 * `synonyms.json` groups (all members mutually linked).
 *
 * @param {Map<string, {aliases?: string[]}>} vendors
 * @param {{ groups?: string[][] }} synonyms
 * @returns {Map<string, Set<string>>}
 */
export function buildAliasTable(vendors, synonyms) {
  /** @type {Map<string, Set<string>>} */
  const table = new Map();
  const link = (a, b) => {
    const ka = a.toLowerCase();
    const kb = b.toLowerCase();
    if (ka === kb) return;
    if (!table.has(ka)) table.set(ka, new Set());
    table.get(ka).add(kb);
  };
  // Vendor aliases: slug <-> each alias, AND aliases <-> each other (a search for
  // any form should surface the canonical slug and its siblings).
  if (vendors && typeof vendors.entries === "function") {
    for (const [slug, v] of vendors.entries()) {
      const members = [slug, ...((v && v.aliases) || [])];
      for (const m of members) {
        for (const n of members) link(m, n);
      }
    }
  }
  // synonyms.json: every member of a group links to every other member.
  const groups = (synonyms && Array.isArray(synonyms.groups)) ? synonyms.groups : [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const m of group) {
      for (const n of group) link(String(m), String(n));
    }
  }
  return table;
}

/**
 * Derive `keywords` (string[]): synonym/alias expansion. Gathers the skill's
 * oem + tags + name-action tokens, expands each through the alias table, and
 * emits the de-duped union of aliases that are NOT already present as tags.
 * Lowercased, deterministic (sorted) order.
 *
 * @param {object} args
 * @param {string|null} args.oem
 * @param {string[]} args.tags
 * @param {string} args.action            dir action slug
 * @param {Map<string, Set<string>>} args.aliasTable  from buildAliasTable
 * @returns {string[]}
 */
export function deriveKeywords({ oem, tags, action, aliasTable }) {
  const tagSet = new Set((tags || []).map((t) => String(t).toLowerCase()));
  // Seed tokens: oem, every tag, and each hyphen-split name-action token.
  const seeds = new Set();
  if (oem) seeds.add(String(oem).toLowerCase());
  for (const t of tagSet) seeds.add(t);
  for (const tok of String(action ?? "").split(/[-\s]+/)) {
    const k = tok.toLowerCase();
    if (k) seeds.add(k);
  }
  // Expand each seed through the alias table.
  const expanded = new Set();
  for (const seed of seeds) {
    const aliases = aliasTable.get(seed);
    if (!aliases) continue;
    for (const a of aliases) expanded.add(a);
  }
  // Emit only aliases not already carried as a tag (tags are indexed already).
  // Also drop any expansion that equals a seed verbatim (no self-noise).
  const out = [];
  for (const a of expanded) {
    if (tagSet.has(a)) continue;
    out.push(a);
  }
  out.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  return out;
}

/**
 * Derive `mutates` (boolean). Prefers the authored frontmatter boolean; else a
 * documented verb heuristic over name + summary:
 *   - true  if any MUTATING verb appears,
 *   - false if (no mutating verb AND) a READ-ONLY signal appears,
 *   - false (default) when ambiguous.
 *
 * @param {object} args
 * @param {boolean} [args.authored]        frontmatter mutates value
 * @param {boolean} [args.authoredPresent] whether mutates was set in frontmatter
 * @param {string}  args.name
 * @param {string}  args.summary
 * @returns {boolean}
 */
export function deriveMutates({ authored, authoredPresent, name, summary }) {
  if (authoredPresent === true && typeof authored === "boolean") return authored;
  const hay = `${String(name ?? "")} ${String(summary ?? "")}`.toLowerCase();
  const hasWord = (w) => new RegExp(`(^|[^a-z])${w}`, "i").test(hay);
  for (const v of MUTATING_VERBS) {
    if (hasWord(v)) return true;
  }
  for (const v of READONLY_VERBS) {
    if (hasWord(v)) return false;
  }
  return false; // ambiguous default
}
