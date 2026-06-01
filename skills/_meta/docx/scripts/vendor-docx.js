/**
 * Zero-install loader for the vendored docx-js library.
 *
 * The skill ships a single self-contained, gzipped docx build at
 * `vendor/docx.cjs.gz` (docx 9.7.1, all transitive deps inlined — verified to
 * have no external `require()` calls). We gunzip and compile it in memory, so
 * there is no `node_modules` tree to sync, no symlinks, no per-file size-cap
 * violations, and no network/`npm install` at runtime.
 *
 * Usage:
 *   const docx = require("./vendor-docx")();
 *   const { Document, Packer, Paragraph } = docx;
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const Module = require("module");

let cached = null;

function loadDocx() {
  if (cached) return cached;

  const gzPath = path.join(__dirname, "vendor", "docx.cjs.gz");
  const source = zlib.gunzipSync(fs.readFileSync(gzPath)).toString("utf8");

  const filename = path.join(__dirname, "vendor", "docx.cjs");
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(source, filename);

  cached = mod.exports;
  return cached;
}

module.exports = loadDocx;
