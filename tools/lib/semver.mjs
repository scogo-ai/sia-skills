// tools/lib/semver.mjs
//
// Parse + validate `compatibility` constraint strings (design §3.4).
//
// A compatibility string is a comma-joined list of constraints, each of the
// form <product-axis><op><version>. Multiple constraints on the same axis form
// an AND-range; multiple axes mean all must hold.
//
//   fortios>=7.2,<7.6              -> { fortios: [">=7.2", "<7.6"] }  (range)
//   ontap>=9.10                    -> { ontap:   [">=9.10"] }
//   panos>=10.2,<11.2              -> { panos:   [">=10.2", "<11.2"] }
//   fortios>=7.2,<7.6,fortimanager>=7.2
//                                  -> { fortios: [...], fortimanager: [">=7.2"] }
//
// A bare constraint with no axis prefix (e.g. ">=7.2" right after "fortios>=7.2,")
// is attributed to the MOST RECENTLY NAMED axis — that is how a single axis gets
// a two-sided range without repeating its name.
//
// Operators: >= > <= < = ~   (~ = compatible-within-minor, a v2 nicety).

const OPS = [">=", "<=", "~", ">", "<", "="]; // longest-first so ">=" wins over ">"

/**
 * @typedef {Object} Constraint
 * @property {string} axis
 * @property {string} op
 * @property {string} version
 */

/**
 * Parse a compatibility string into a list of constraints. Throws on a token
 * that cannot be parsed (no operator, empty axis with no prior axis, bad
 * version). Returns [] for an empty/whitespace string.
 *
 * @param {string} input
 * @returns {Constraint[]}
 */
export function parseCompatibility(input) {
  const s = String(input ?? "").trim();
  if (s === "") return [];

  /** @type {Constraint[]} */
  const out = [];
  let lastAxis = null;

  for (const rawTok of s.split(",")) {
    const tok = rawTok.trim();
    if (tok === "") throw new Error(`empty constraint token in "${input}"`);

    // Find the operator.
    let op = null;
    let opIdx = -1;
    for (const candidate of OPS) {
      const idx = tok.indexOf(candidate);
      if (idx !== -1) {
        op = candidate;
        opIdx = idx;
        break;
      }
    }
    if (op === null) {
      throw new Error(`constraint "${tok}" has no operator (>=,>,<=,<,=,~)`);
    }

    let axis = tok.slice(0, opIdx).trim();
    const version = tok.slice(opIdx + op.length).trim();

    if (axis === "") {
      // Bare constraint -> attach to the previously named axis (range form).
      if (lastAxis === null) {
        throw new Error(`constraint "${tok}" has no axis and no preceding axis`);
      }
      axis = lastAxis;
    } else {
      lastAxis = axis;
    }

    if (!/^[a-z0-9][a-z0-9-]*$/.test(axis)) {
      throw new Error(`invalid product axis "${axis}" in "${input}"`);
    }
    if (!isValidVersion(version)) {
      throw new Error(`invalid version "${version}" for axis "${axis}"`);
    }

    out.push({ axis, op, version });
  }

  return out;
}

/**
 * A lenient dotted-numeric version: 7, 7.2, 9.10, 11.2.0, optional pre-release
 * suffix (-rc1). Product versions here are not strict semver (e.g. ONTAP 9.10),
 * so we only require a leading numeric component.
 *
 * @param {string} v
 * @returns {boolean}
 */
export function isValidVersion(v) {
  return /^\d+(\.\d+)*([.-][0-9A-Za-z-]+)?$/.test(v);
}

/**
 * Return the distinct product axes referenced by a compatibility string.
 * @param {string} input
 * @returns {string[]}
 */
export function compatibilityAxes(input) {
  return [...new Set(parseCompatibility(input).map((c) => c.axis))];
}

/**
 * Validate a semver-ish `version` field (design §3.6). Accepts MAJOR.MINOR.PATCH
 * with an optional pre-release/build suffix. Returns true/false (no throw).
 *
 * @param {string} v
 * @returns {boolean}
 */
export function isSemver(v) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(String(v ?? ""));
}
