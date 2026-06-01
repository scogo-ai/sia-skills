#!/usr/bin/env node
/**
 * Bundled generator: JSON spec → branded DOCX.
 *
 * Usage:
 *   node scripts/generate.js <spec.json> <output.docx>
 *
 * The spec is declarative content (headings, paragraphs, tables, callouts).
 * All styling is applied automatically by the Scogo design system. docx-js is
 * loaded from the vendored, gzipped bundle — no node_modules, no npm install.
 */

const fs = require("fs");
const path = require("path");

const { Document, Packer, Paragraph, HeadingLevel, PageBreak, Header, Footer } =
  require("./vendor-docx")();

const { SCOGO, documentStyles, numberingConfig } = require("./design-system");
const {
  brandedHeader,
  pageFooter,
  coverPage,
  sectionHeading,
  dataTable,
  callout,
  tocNode,
  bodyParagraph,
  bulletItem,
  numberedItem,
  spacer,
} = require("./components");

/* ─── spec helpers ─── */

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/**
 * Build context — carries a monotonic list-instance counter so each bullet /
 * numbered block gets its own numbering instance and restarts at 1 instead of
 * continuing the previous list's count.
 */
function makeCtx() {
  let listInstance = 0;
  return { nextListInstance: () => listInstance++ };
}

/* ─── content builders ─── */

function buildParagraph(item) {
  return bodyParagraph(item.text || "", item.style || {});
}

function buildBulletList(item, ctx) {
  const instance = ctx.nextListInstance();
  return (item.items || []).map((txt) => bulletItem(String(txt), "bullets", 0, instance));
}

function buildNumberedList(item, ctx) {
  const instance = ctx.nextListInstance();
  return (item.items || []).map((txt) => numberedItem(String(txt), "numbers", 0, instance));
}

function buildTable(item) {
  const headers = (item.headers || []).map(String);
  const rows = (item.rows || []).map((r) => r.map(String));
  return dataTable(headers, rows, {
    striped: item.striped !== false,
    align: item.align || [],
  });
}

function buildCallout(item) {
  return callout(String(item.text || ""), item.kind || "note");
}

function buildHeading(item) {
  return sectionHeading(String(item.text || ""), item.level || 1);
}

function buildPageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

function buildSpacer(item) {
  return spacer(item.height || SCOGO.spacing.sectionAfter);
}

function buildContentItem(item, ctx) {
  switch (item.type) {
    case "paragraph":
      return [buildParagraph(item)];
    case "bullet":
      return buildBulletList(item, ctx);
    case "numbered":
      return buildNumberedList(item, ctx);
    case "table":
      return [buildTable(item)];
    case "callout":
      return [buildCallout(item)];
    case "heading":
      return [buildHeading(item)];
    case "pageBreak":
      return [buildPageBreak()];
    case "spacer":
      return [buildSpacer(item)];
    default:
      return [bodyParagraph(String(item.text || ""))];
  }
}

/* ─── section builder ─── */

function buildSection(section, ctx) {
  const out = [];
  if (section.heading) {
    out.push(sectionHeading(section.heading, section.level || 1));
  }
  if (Array.isArray(section.content)) {
    for (const item of section.content) {
      out.push(...buildContentItem(item, ctx));
    }
  }
  return out;
}

/* ─── main document builder ─── */

function buildDocument(spec) {
  const pageOpts = {
    width: SCOGO.page.width,
    height: SCOGO.page.height,
    margin: {
      top:    SCOGO.page.margin,
      right:  SCOGO.page.margin,
      bottom: SCOGO.page.margin,
      left:   SCOGO.page.margin,
    },
  };

  const header = spec.header ? brandedHeader(spec.header) : brandedHeader();
  const footer = spec.footer ? pageFooter(spec.footer) : pageFooter();

  const ctx = makeCtx();
  const children = [];
  const showCover = spec.cover !== false;

  // cover page
  if (showCover) {
    children.push(
      ...coverPage({
        title: spec.title || "Untitled Document",
        subtitle: spec.subtitle || "",
        metaLines: spec.meta || [],
      })
    );
    children.push(buildPageBreak());
  }

  // table of contents
  if (spec.toc !== false) {
    children.push(tocNode(spec.tocTitle || "Table of Contents"));
    children.push(buildPageBreak());
  }

  // sections (or a flat content list)
  if (Array.isArray(spec.sections)) {
    for (const section of spec.sections) {
      children.push(...buildSection(section, ctx));
    }
  } else if (Array.isArray(spec.content)) {
    for (const item of spec.content) {
      children.push(...buildContentItem(item, ctx));
    }
  }

  const sectionProps = { page: pageOpts };
  const headers = { default: header };
  const footers = { default: footer };

  // When there is a cover page, suppress the running header/footer on that
  // first page (a title page should be clean) and show them from page 2 on.
  if (showCover) {
    sectionProps.titlePage = true;
    headers.first = new Header({ children: [new Paragraph("")] });
    footers.first = new Footer({ children: [new Paragraph("")] });
  }

  return new Document({
    creator:     spec.creator     || "Scogo AI",
    title:       spec.title       || "Untitled Document",
    subject:     spec.subject     || "",
    description: spec.description  || "",
    // Tell Word to refresh field results (the TOC) on open; without this the
    // table of contents renders blank until the user manually presses F9.
    features:    { updateFields: true },
    styles:      documentStyles(),
    numbering:   numberingConfig(),
    sections: [{
      properties: sectionProps,
      headers,
      footers,
      children,
    }],
  });
}

/* ─── CLI ─── */

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: node generate.js <spec.json> <output.docx>");
    process.exit(1);
  }

  const [specPath, outPath] = args;
  assert(fs.existsSync(specPath), `Spec file not found: ${specPath}`);

  const spec = JSON.parse(fs.readFileSync(specPath, "utf-8"));
  const doc = buildDocument(spec);

  const outDir = path.dirname(outPath);
  if (outDir && !fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  Packer.toBuffer(doc)
    .then((buffer) => {
      fs.writeFileSync(outPath, buffer);
      console.log(`Generated ${outPath}`);
    })
    .catch((err) => {
      console.error("Generation failed:", err.message);
      process.exit(1);
    });
}

main();
