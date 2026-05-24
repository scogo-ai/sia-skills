// tools/lib/vendors.mjs
//
// Minimal, dependency-free loader for vendors.yaml. We avoid pulling a YAML
// library into the supply-chain-critical tooling, so this parser understands
// ONLY the narrow shape vendors.yaml uses:
//
//   <slug>:
//     display: "Name"
//     domains: [a, b]
//     products: [x, y, z]
//
// (top-level mapping of slug -> { display: string, domains: string[],
// products: string[] }). Comments (# …) and blank lines are ignored. Anything
// outside this shape will either be ignored or throw — which is fine, because
// vendors.yaml is platform-team-owned and CI-validated.

import { readFileSync } from "node:fs";

/**
 * @typedef {Object} Vendor
 * @property {string} display
 * @property {string[]} domains
 * @property {string[]} products
 */

/**
 * Load vendors.yaml into a slug -> Vendor map.
 *
 * @param {string} path
 * @returns {Map<string, Vendor>}
 */
export function loadVendors(path) {
  const text = readFileSync(path, "utf8");
  /** @type {Map<string, Vendor>} */
  const vendors = new Map();

  let current = null; // { slug, display, domains, products }

  const lines = text.split("\n");
  for (const raw of lines) {
    const line = stripComment(raw);
    if (line.trim() === "") continue;

    if (/^\S/.test(line)) {
      // Top-level: "<slug>:"
      const m = line.match(/^([A-Za-z0-9][A-Za-z0-9-]*):\s*$/);
      if (!m) {
        throw new Error(`vendors.yaml: unexpected top-level line: ${raw}`);
      }
      if (current) finalize(vendors, current);
      current = { slug: m[1], display: "", domains: [], products: [] };
      continue;
    }

    // Indented child of the current vendor.
    if (!current) continue;
    const t = line.trim();
    const ci = t.indexOf(":");
    if (ci === -1) continue;
    const key = t.slice(0, ci).trim();
    const val = t.slice(ci + 1).trim();

    if (key === "display") {
      current.display = stripQuotes(val);
    } else if (key === "domains") {
      current.domains = parseInlineList(val);
    } else if (key === "products") {
      current.products = parseInlineList(val);
    }
  }
  if (current) finalize(vendors, current);

  return vendors;
}

/**
 * @param {Map<string, Vendor>} vendors
 * @param {{slug:string, display:string, domains:string[], products:string[]}} c
 */
function finalize(vendors, c) {
  vendors.set(c.slug, { display: c.display, domains: c.domains, products: c.products });
}

/** @param {string} raw @returns {string} */
function stripComment(raw) {
  // Strip a `#` comment, but not inside quotes. vendors.yaml never quotes a #,
  // so a simple split on an unquoted # is sufficient.
  let inQ = false;
  let q = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQ) {
      if (ch === q) inQ = false;
    } else if (ch === '"' || ch === "'") {
      inQ = true;
      q = ch;
    } else if (ch === "#") {
      return raw.slice(0, i);
    }
  }
  return raw;
}

/** @param {string} val @returns {string[]} */
function parseInlineList(val) {
  const t = val.trim();
  if (!t.startsWith("[") || !t.endsWith("]")) return [];
  return t
    .slice(1, -1)
    .split(",")
    .map((p) => stripQuotes(p.trim()))
    .filter((v) => v.length > 0);
}

/** @param {string} v @returns {string} */
function stripQuotes(v) {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}
