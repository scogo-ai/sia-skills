/**
 * Professional document components built on docx-js + the Scogo design system.
 *
 * Each function returns docx-js element(s) (Paragraph, Table, etc.).
 */

const {
  Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  Header, Footer, AlignmentType, PageOrientation, LevelFormat,
  ExternalHyperlink, InternalHyperlink, Bookmark, BorderStyle,
  WidthType, ShadingType, VerticalAlign, PageNumber,
  TabStopType, TabStopPosition, TableOfContents, HeadingLevel,
  PageBreak, SectionType,
} = require("./vendor-docx")();

const { SCOGO } = require("./design-system");

/* ─── util ─── */

function dxaFromInches(inches) {
  return Math.round(inches * 1440);
}

function border(color = SCOGO.colors.border, size = 1, style = BorderStyle.SINGLE) {
  return { style, size, color };
}

function allBorders(color, size) {
  const b = border(color, size);
  return { top: b, bottom: b, left: b, right: b };
}

function noBorders() {
  const b = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return { top: b, bottom: b, left: b, right: b };
}

// Table-level borders-off for invisible layout tables. docx-js otherwise emits
// a default single-line <w:tblBorders> grid even when every cell sets none.
function noTableBorders() {
  const b = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b };
}

function makeCell(children, opts = {}) {
  const {
    width,
    shading = null,
    borders = allBorders(SCOGO.colors.border, 1),
    verticalAlign = VerticalAlign.CENTER,
    margins = { top: 80, bottom: 80, left: 120, right: 120 },
    columnSpan = 1,
  } = opts;

  const cellOpts = {
    children,
    borders,
    verticalAlign,
    margins,
    columnSpan,
  };
  if (width !== undefined) {
    cellOpts.width = { size: width, type: WidthType.DXA };
  }
  if (shading) {
    cellOpts.shading = { fill: shading, type: ShadingType.CLEAR };
  }
  return new TableCell(cellOpts);
}

/* ─── layout helpers ─── */

/**
 * A spacer paragraph for vertical breathing room.
 */
function spacer(height = SCOGO.spacing.sectionAfter) {
  return new Paragraph({
    spacing: { after: height },
    children: [new TextRun("")],
  });
}

/**
 * A horizontal rule using paragraph bottom border (preferred over empty tables).
 */
function horizontalRule(color = SCOGO.colors.border) {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color, space: 1 } },
    spacing: { before: SCOGO.spacing.sectionBefore, after: SCOGO.spacing.sectionAfter },
    children: [new TextRun("")],
  });
}

/* ─── header / footer ─── */

/**
 * Branded header: two-column invisible-border table.
 *  Left: brand name (accent) + document title (secondary)
 *  Right: optional confidential label
 */
function brandedHeader({ brand = "Scogo AI", title = "", confidential = "" } = {}) {
  const contentWidth = SCOGO.page.width - SCOGO.page.margin * 2;
  const leftWidth = Math.round(contentWidth * 0.65);
  const rightWidth = contentWidth - leftWidth;

  const leftCell = makeCell([
    new Paragraph({
      children: [
        new TextRun({ text: brand, bold: true, color: SCOGO.colors.accent, size: SCOGO.sizes.small }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: title, color: SCOGO.colors.secondary, size: SCOGO.sizes.caption }),
      ],
    }),
  ], { width: leftWidth, borders: noBorders() });

  const rightParagraphs = [
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({ text: confidential, color: SCOGO.colors.muted, size: SCOGO.sizes.caption, caps: true }),
      ],
    }),
  ];
  const rightCell = makeCell(rightParagraphs, { width: rightWidth, borders: noBorders() });

  return new Header({
    children: [
      new Table({
        width: { size: contentWidth, type: WidthType.DXA },
        columnWidths: [leftWidth, rightWidth],
        borders: noTableBorders(),
        rows: [new TableRow({ children: [leftCell, rightCell] })],
      }),
      // thin rule under header
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: SCOGO.colors.border, space: 1 } },
        children: [new TextRun("")],
      }),
    ],
  });
}

/**
 * Page footer with top border, text snippet and live page number.
 */
function pageFooter({ text = "Scogo AI Platform | Internal Use Only" } = {}) {
  return new Footer({
    children: [
      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: SCOGO.colors.border, space: 1 } },
        spacing: { before: SCOGO.spacing.tight },
        children: [
          new TextRun({ text, color: SCOGO.colors.muted, size: SCOGO.sizes.caption }),
          new TextRun({ text: "  |  Page ", color: SCOGO.colors.muted, size: SCOGO.sizes.caption }),
          new TextRun({ children: [PageNumber.CURRENT], color: SCOGO.colors.muted, size: SCOGO.sizes.caption }),
        ],
      }),
    ],
  });
}

/* ─── cover page ─── */

/**
 * Cover page block: large title, subtitle, metadata lines.
 */
function coverPage({ title, subtitle, metaLines = [] } = {}) {
  const children = [
    spacer(dxaFromInches(2.5)),
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: SCOGO.sizes.title, color: SCOGO.colors.text })],
    }),
  ];
  if (subtitle) {
    children.push(
      new Paragraph({
        spacing: { before: SCOGO.spacing.sectionAfter },
        children: [new TextRun({ text: subtitle, size: SCOGO.sizes.h2, color: SCOGO.colors.secondary })],
      })
    );
  }
  children.push(horizontalRule());
  metaLines.forEach((line) => {
    children.push(
      new Paragraph({
        spacing: { before: SCOGO.spacing.tight },
        children: [new TextRun({ text: line, size: SCOGO.sizes.small, color: SCOGO.colors.muted })],
      })
    );
  });
  children.push(spacer(dxaFromInches(1.0)));
  return children;
}

/* ─── section heading ─── */

/**
 * Accent-branded section heading with bottom border.
 * Uses HeadingLevel so TOC picks it up.
 */
function sectionHeading(text, level = 1) {
  const map = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
    5: HeadingLevel.HEADING_5,
    6: HeadingLevel.HEADING_6,
  };
  return new Paragraph({
    heading: map[level] || HeadingLevel.HEADING_1,
    children: [new TextRun(text)],
  });
}

/* ─── data table ─── */

/**
 * Professional data table.
 *  - Dark header row with white text
 *  - Light borders
 *  - Cell padding
 *  - Optional striped rows
 *  - Optional right-align for numeric-looking cells
 */
function dataTable(headers, rows, { striped = true, align = [] } = {}) {
  const contentWidth = SCOGO.page.width - SCOGO.page.margin * 2;
  const numCols = headers.length;
  const colWidth = Math.floor(contentWidth / numCols);
  const columnWidths = Array(numCols).fill(colWidth);
  const lastColWidth = contentWidth - colWidth * (numCols - 1);
  columnWidths[numCols - 1] = lastColWidth;

  const cellBorders = allBorders(SCOGO.colors.border, 1);

  // header row
  const headerCells = headers.map((h, i) =>
    makeCell(
      [new Paragraph({
        alignment: align[i] === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [new TextRun({ text: h, bold: true, color: SCOGO.colors.headerText, size: SCOGO.sizes.small })],
      })],
      { width: columnWidths[i], shading: SCOGO.colors.headerBg, borders: cellBorders }
    )
  );
  const headerRow = new TableRow({ children: headerCells });

  // body rows
  const bodyRows = rows.map((row, rIdx) => {
    const bg = striped && rIdx % 2 === 1 ? "F8FAFC" : null; // light slate for banded rows
    const cells = row.map((cell, cIdx) => {
      const txt = String(cell ?? "");
      const isNumeric = /^[\d\s,.%$\-]+$/.test(txt.trim());
      const alignRight = align[cIdx] === "right" || (align[cIdx] !== "left" && isNumeric);
      return makeCell(
        [new Paragraph({
          alignment: alignRight ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [new TextRun({ text: txt, size: SCOGO.sizes.small, color: SCOGO.colors.text })],
        })],
        { width: columnWidths[cIdx], shading: bg, borders: cellBorders }
      );
    });
    return new TableRow({ children: cells });
  });

  return new Table({
    width: { size: contentWidth, type: WidthType.DXA },
    columnWidths,
    rows: [headerRow, ...bodyRows],
  });
}

/* ─── callout ─── */

/**
 * Shaded callout box for notes, warnings, success indicators.
 */
function callout(text, kind = "note") {
  const palette = {
    note:  { bg: "EFF6FF", border: "BFDBFE", color: SCOGO.colors.text },         // blue-tinted
    warning: { bg: "FFFBEB", border: "FDE68A", color: "92400E" },               // amber-tinted
    success: { bg: "ECFDF5", border: "A7F3D0", color: "065F46" },               // green-tinted
    danger:  { bg: "FEF2F2", border: "FECACA", color: "991B1B" },               // red-tinted
    info:    { bg: "F0F9FF", border: "BAE6FD", color: "0C4A6E" },               // sky-tinted
  };
  const theme = palette[kind] || palette.note;

  const contentWidth = SCOGO.page.width - SCOGO.page.margin * 2;

  return new Table({
    width: { size: contentWidth, type: WidthType.DXA },
    columnWidths: [contentWidth],
    rows: [
      new TableRow({
        children: [
          makeCell(
            [new Paragraph({
              children: [new TextRun({ text, size: SCOGO.sizes.small, color: theme.color })],
            })],
            {
              width: contentWidth,
              shading: theme.bg,
              borders: allBorders(theme.border, 1),
            }
          ),
        ],
      }),
    ],
  });
}

/* ─── table of contents ─── */

function tocNode(title = "Table of Contents") {
  return new TableOfContents(title, {
    hyperlink: true,
    headingStyleRange: "1-3",
  });
}

/* ─── heading-level helpers for spec-driven generation ─── */

function h1(text) { return sectionHeading(text, 1); }
function h2(text) { return sectionHeading(text, 2); }
function h3(text) { return sectionHeading(text, 3); }
function h4(text) { return sectionHeading(text, 4); }
function h5(text) { return sectionHeading(text, 5); }
function h6(text) { return sectionHeading(text, 6); }

function bodyParagraph(text, opts = {}) {
  const { bold = false, color = SCOGO.colors.text, size = SCOGO.sizes.body } = opts;
  return new Paragraph({
    children: [new TextRun({ text, bold, color, size })],
    spacing: { after: SCOGO.spacing.paraAfter },
  });
}

function bulletItem(text, numberingRef = "bullets", level = 0, instance = 0) {
  return new Paragraph({
    numbering: { reference: numberingRef, level, instance },
    children: [new TextRun({ text, size: SCOGO.sizes.body, color: SCOGO.colors.text })],
  });
}

function numberedItem(text, numberingRef = "numbers", level = 0, instance = 0) {
  return new Paragraph({
    numbering: { reference: numberingRef, level, instance },
    children: [new TextRun({ text, size: SCOGO.sizes.body, color: SCOGO.colors.text })],
  });
}

module.exports = {
  dxaFromInches,
  border,
  allBorders,
  noBorders,
  makeCell,
  spacer,
  horizontalRule,
  brandedHeader,
  pageFooter,
  coverPage,
  sectionHeading,
  dataTable,
  callout,
  tocNode,
  h1,
  h2,
  h3,
  h4,
  h5,
  h6,
  bodyParagraph,
  bulletItem,
  numberedItem,
};
