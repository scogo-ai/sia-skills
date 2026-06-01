/**
 * Scogo professional document design system.
 *
 * Single source of truth for brand tokens and OOXML-ready style objects.
 * Exported helpers return docx-js compatible config blocks.
 */

const SCOGO = {
  font: "Arial",
  colors: {
    text:       "1E293B", // slate-900  body
    secondary:  "475569", // slate-600  subtitles
    muted:      "94A3B8", // slate-400  metadata / footer
    accent:     "F97316", // orange-500 brand
    border:     "E2E8F0", // slate-200  rules / table borders
    headerBg:   "1E293B", // slate-900  table header fill
    headerText: "FFFFFF", // white      table header text
    band:       "F8FAFC", // slate-50   striped table rows
    link:       "0563C1", // blue       hyperlinks
    success:    "10B981", // green      positive indicators
    warning:    "F59E0B", // amber      warnings
    danger:     "EF4444", // red        errors
  },
  sizes: {
    title:    56, // 28pt
    h1:       32, // 16pt
    h2:       26, // 13pt
    h3:       24, // 12pt
    h4:       22, // 11pt (italic emphasis)
    h5:       22, // 11pt (bold)
    h6:       20, // 10pt (bold italic)
    body:     22, // 11pt
    small:    20, // 10pt
    caption:  18, // 9pt
  },
  spacing: {
    sectionBefore: 320, // ~0.22in
    sectionAfter:  120, // ~0.08in
    paraAfter:     120, // ~0.08in
    tight:          60, // ~0.04in
  },
  page: {
    width:  12240, // US Letter 8.5"
    height: 15840, // US Letter 11"
    margin: 1080,  // 0.75" all round
  },
};

/**
 * docDefaults — the document-wide run/paragraph defaults (Arial, slate body
 * color, body size). Maps to <w:docDefaults> in styles.xml.
 */
function docDefaults() {
  return {
    run: {
      font:  SCOGO.font,
      size:  SCOGO.sizes.body,
      color: SCOGO.colors.text,
    },
    paragraph: {
      spacing: { after: SCOGO.spacing.paraAfter },
    },
  };
}

/**
 * Document styles for docx-js.
 *
 * IMPORTANT: built-in styles (Title, Heading1-6, Strong, Hyperlink, …) MUST be
 * overridden through the `default` channel. docx-js always injects its own
 * factory versions of these styleIds; redefining the same ids in
 * `paragraphStyles` produces DUPLICATE <w:style w:styleId="…"> entries, and Word
 * binds to the first (the factory default) — silently dropping the brand
 * styling. The `default` channel replaces the factory style in place.
 */
function documentStyles() {
  const font = SCOGO.font;
  const c = SCOGO.colors;
  const s = SCOGO.sizes;
  const sp = SCOGO.spacing;

  const headingBase = (size, color, extra = {}) => ({
    run: { font, size, bold: true, color, ...extra.run },
    paragraph: {
      spacing: { before: sp.sectionBefore, after: sp.sectionAfter },
      ...extra.paragraph,
    },
  });

  return {
    default: {
      document: docDefaults(),
      title: {
        run: { font, size: s.title, bold: true, color: c.text },
        paragraph: { spacing: { after: sp.sectionAfter } },
      },
      heading1: headingBase(s.h1, c.accent, {
        paragraph: {
          outlineLevel: 0,
          border: { bottom: { style: "single", size: 6, color: c.accent, space: 1 } },
        },
      }),
      heading2: headingBase(s.h2, c.text, { paragraph: { outlineLevel: 1 } }),
      heading3: headingBase(s.h3, c.text, { paragraph: { outlineLevel: 2 } }),
      heading4: headingBase(s.h4, c.secondary, {
        run: { italics: true },
        paragraph: { outlineLevel: 3 },
      }),
      heading5: {
        run: { font, size: s.h5, bold: true, color: c.secondary },
        paragraph: { spacing: { before: sp.tight, after: sp.tight }, outlineLevel: 4 },
      },
      heading6: {
        run: { font, size: s.h6, bold: true, italics: true, color: c.muted },
        paragraph: { spacing: { before: sp.tight, after: sp.tight }, outlineLevel: 5 },
      },
      strong: { run: { bold: true, color: c.text } },
      hyperlink: { run: { color: c.link, underline: { type: "single" } } },
    },
    // No paragraphStyles: every other style is applied inline by the component
    // helpers, which keeps styleIds unique and avoids the duplication trap above.
  };
}

/**
 * Numbering configs. Each list block in the generator gets its own `instance`
 * of these references so multiple numbered lists restart at 1 instead of
 * continuing the previous list's count.
 */
function numberingConfig() {
  const indent = { left: 720, hanging: 360 };
  return {
    config: [
      {
        reference: "bullets",
        levels: [
          { level: 0, format: "bullet", text: "•", alignment: "left", style: { paragraph: { indent } } },
        ],
      },
      {
        reference: "numbers",
        levels: [
          { level: 0, format: "decimal", text: "%1.", alignment: "left", style: { paragraph: { indent } } },
        ],
      },
      {
        reference: "letters",
        levels: [
          { level: 0, format: "lowerLetter", text: "%1)", alignment: "left", style: { paragraph: { indent } } },
        ],
      },
    ],
  };
}

module.exports = {
  SCOGO,
  docDefaults,
  documentStyles,
  numberingConfig,
};
