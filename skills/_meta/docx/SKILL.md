---
name: scogo:docx
description: "Use when an operator needs to create, edit, or analyze Microsoft Word (.docx) documents — for example producing a branded, enterprise-grade report, memo, proposal, or status update from a JSON content spec, or reading, redlining, and find-and-replacing in existing Word files. Triggers include any mention of 'Word doc', 'word document', '.docx', a request for a professional document with a cover page, table of contents, headings, styled tables, page numbers, or letterhead, and requests to extract or reorganize content from .docx files or insert and replace images."
tags: [meta, docx]
metadata:
  version: 2.1.0
author: scogo-ai
---
# DOCX creation, editing, and analysis

## Overview

A .docx file is a ZIP archive containing XML files.

**Critical rule:** When creating a new document, always use the bundled generator. Never hand-write OOXML to create a new document.

| Task | Approach |
|------|----------|
| **Create new document** | `node <skill_dir>/scripts/generate.js spec.json out.docx` |
| **Read/analyze content** | `pandoc` or unpack for raw XML |
| **Edit existing document** | Unpack → edit XML → repack |
| **Convert .doc → .docx** | `python scripts/office/soffice.py --headless --convert-to docx document.doc` |
| **Validate & quality gate** | `python3 scripts/quality_check.py out.docx` |

---

## Creating New Documents (Default Path)

### Step 1: Write a content spec (JSON)

Create a JSON file describing your document content. The generator applies the Scogo design system automatically.

```json
{
  "title": "Network Bandwidth Test Report",
  "subtitle": "Q2 2026 Infrastructure Review",
  "meta": ["Date: 2026-05-31", "Prepared by: Network Operations"],
  "header": { "brand": "Scogo AI", "title": "Network Bandwidth Test Report", "confidential": "CONFIDENTIAL" },
  "footer": { "text": "Scogo AI Platform | Internal Use Only" },
  "cover": true,
  "toc": true,
  "sections": [
    {
      "heading": "Executive Summary",
      "level": 1,
      "content": [
        { "type": "paragraph", "text": "This report summarizes..." },
        { "type": "callout", "kind": "success", "text": "Average throughput increased 18%." }
      ]
    },
    {
      "heading": "Results",
      "level": 1,
      "content": [
        { "type": "table", "headers": ["Site", "Throughput", "Status"], "rows": [["US-East-1", "9.2 Gbps", "Pass"]], "align": ["left", "right", "center"] }
      ]
    }
  ]
}
```

**Content item types:**

| Type | Properties | Description |
|------|------------|-------------|
| `paragraph` | `text`, `style` (bold, color, size) | Body text |
| `bullet` | `items` (array of strings) | Bulleted list |
| `numbered` | `items` (array of strings) | Numbered list |
| `table` | `headers`, `rows`, `striped`, `align` | Professional data table |
| `callout` | `text`, `kind` (note/warning/success/danger/info) | Shaded info box |
| `heading` | `text`, `level` (1-6) | Section heading |
| `pageBreak` | — | Force new page |
| `spacer` | `height` (DXA) | Vertical breathing room |

**Table alignment:** `align` array maps each column to `"left"`, `"right"`, or `"center"`. Numeric columns auto-right-align if no align is specified.

### Step 2: Generate the document

```bash
node <skill_dir>/scripts/generate.js spec.json out.docx
```

The generator is bundled with a vendored copy of `docx-js`. No `npm install` is required.

### Step 3: Run the quality gate

```bash
python3 <skill_dir>/scripts/quality_check.py out.docx
```

The quality gate scores the document 0-10 on professional markers (header/footer, color palette, styled tables, spacing, etc.). If the score is below 8, iterate on the spec.

---

## Professional Document Design Guide

### Design System

Every generated document automatically uses the Scogo design system:

| Element | Spec |
|---------|------|
| **Font** | Arial throughout |
| **Body text** | 11pt, slate-900 `#1E293B` |
| **Title** | 28pt, bold, slate-900 |
| **H1** | 16pt, bold, orange `#F97316`, bottom border |
| **H2** | 13pt, bold, slate-900 |
| **H3** | 12pt, bold, slate-900 |
| **Secondary text** | Slate-600 `#475569` |
| **Muted text** | Slate-400 `#94A3B8` |
| **Accent** | Orange `#F97316` |
| **Borders** | Slate-200 `#E2E8F0` |
| **Table header** | Slate-900 `#1E293B` fill, white text |
| **Page size** | US Letter (8.5" x 11", 0.75" margins) |

### Principles

1. **Color:** Use the built-in palette. Never introduce ad-hoc colors.
2. **Hierarchy:** Title → H1 → H2 → H3 → Body. One font, consistent sizes.
3. **Spacing:** More space before headings than after. Consistent paragraph spacing.
4. **Tables:** Always use `type: "table"` with headers. The generator styles the header row automatically.
5. **Header/Footer:** Always include `header` and `footer` in the spec for branded documents.
6. **Callouts:** Use `kind: "warning"` for risks, `kind: "success"` for positive results, `kind: "danger"` for failures.

---

## Advanced: Custom Components (docx-js)

For layouts that don't fit the spec, write a one-off script in the skill's
`scripts/` directory that uses the same design system and component helpers the
generator uses. Load docx-js through the vendored loader (`require("./vendor-docx")()`),
never `require("docx")` — the library is shipped as a gzipped bundle, not in `node_modules`.

```javascript
// scripts/custom-report.js
const { Document, Packer } = require("./vendor-docx")();
const { documentStyles, numberingConfig } = require("./design-system");
const {
  brandedHeader, pageFooter, coverPage, sectionHeading,
  dataTable, callout, spacer, bodyParagraph
} = require("./components");

const doc = new Document({
  features: { updateFields: true },
  styles: documentStyles(),
  numbering: numberingConfig(),
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }
      }
    },
    headers: { default: brandedHeader({ brand: "Scogo AI", title: "Custom Report" }) },
    footers: { default: pageFooter({ text: "Scogo AI Platform | Internal Use Only" }) },
    children: [
      ...coverPage({ title: "Custom Report", subtitle: "Subtitle", metaLines: ["Date: 2026-06-01"] }),
      spacer(),
      sectionHeading("Section One", 1),
      bodyParagraph("Custom body text."),
      dataTable(["A", "B"], [["1", "2"], ["3", "4"]]),
      callout("This is important.", "note"),
    ]
  }]
});

Packer.toBuffer(doc).then(buf => require("fs").writeFileSync("out.docx", buf));
```

Run it from inside the skill's `scripts/` directory:
```bash
node <skill_dir>/scripts/custom-report.js
```

---

## Editing Existing Documents

**Use this path only for editing existing .docx files, never for creating new ones.**

### Step 1: Unpack
```bash
python scripts/office/unpack.py document.docx unpacked/
```

### Step 2: Edit XML

Edit files in `unpacked/word/`. Use the Edit tool directly for string replacement. **Do not write Python scripts.**

**CRITICAL: Use smart quotes for new content.** When adding text with apostrophes or quotes, use XML entities:
```xml
<w:t>Here&#x2019;s a quote: &#x201C;Hello&#x201D;</w:t>
```

| Entity | Character |
|--------|-----------|
| `&#x2018;` | ‘ (left single) |
| `&#x2019;` | ’ (right single / apostrophe) |
| `&#x201C;` | “ (left double) |
| `&#x201D;` | ” (right double) |

**Use "Claude" as the author** for tracked changes and comments, unless the user explicitly requests a different name.

**Adding comments:** Use `comment.py` to handle boilerplate across multiple XML files:
```bash
python scripts/comment.py unpacked/ 0 "Comment text with &amp; and &#x2019;"
python scripts/comment.py unpacked/ 0 "Reply text" --parent 0
```

### Step 3: Pack
```bash
python scripts/office/pack.py unpacked/ output.docx --original document.docx
```

Auto-repair fixes: `durableId` overflow, missing `xml:space="preserve"`.

---

## Reading & Converting

### Text Extraction
```bash
pandoc --track-changes=all document.docx -o output.md
```

### Raw XML Access
```bash
python scripts/office/unpack.py document.docx unpacked/
```

### Convert to PDF / Images
```bash
python scripts/office/soffice.py --headless --convert-to pdf document.docx
pdftoppm -jpeg -r 150 document.pdf page
```

### Accept Tracked Changes
```bash
python scripts/accept_changes.py input.docx output.docx
```

---

## XML Reference (Editing Only)

### Tracked Changes

```xml
<!-- Insertion -->
<w:ins w:id="1" w:author="Claude" w:date="2025-01-01T00:00:00Z">
  <w:r><w:t>inserted text</w:t></w:r>
</w:ins>

<!-- Deletion -->
<w:del w:id="2" w:author="Claude" w:date="2025-01-01T00:00:00Z">
  <w:r><w:delText>deleted text</w:delText></w:r>
</w:del>
```

Inside `<w:del>` use `<w:delText>` instead of `<w:t>`, and `<w:delInstrText>` instead of `<w:instrText>`.

Minimal edits - only mark what changes:
```xml
<w:r><w:t>The term is </w:t></w:r>
<w:del w:id="1" w:author="Claude" w:date="...">
  <w:r><w:delText>30</w:delText></w:r>
</w:del>
<w:ins w:id="2" w:author="Claude" w:date="...">
  <w:r><w:t>60</w:t></w:r>
</w:ins>
<w:r><w:t> days.</w:t></w:r>
```

When deleting an entire paragraph, mark the paragraph mark as deleted too:
```xml
<w:p>
  <w:pPr>
    <w:numPr>...</w:numPr>
    <w:rPr><w:del w:id="1" w:author="Claude" w:date="..."/></w:rPr>
  </w:pPr>
  <w:del w:id="2" w:author="Claude" w:date="...">
    <w:r><w:delText>Entire paragraph...</w:delText></w:r>
  </w:del>
</w:p>
```

### Comments

After running `comment.py`, add markers to document.xml. **`<w:commentRangeStart>` and `<w:commentRangeEnd>` are siblings of `<w:r>`, never inside `<w:r>`.**

```xml
<w:commentRangeStart w:id="0"/>
<w:r><w:t>text</w:t></w:r>
<w:commentRangeEnd w:id="0"/>
<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="0"/></w:r>
```

### Images (Editing Only)

1. Add image file to `word/media/`
2. Add relationship to `word/_rels/document.xml.rels`:
   ```xml
   <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
   ```
3. Add content type to `[Content_Types].xml`:
   ```xml
   <Default Extension="png" ContentType="image/png"/>
   ```
4. Reference in document.xml:
   ```xml
   <w:drawing>
     <wp:inline>
       <a:graphic><a:graphicData uri=".../picture">
         <pic:pic><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill></pic:pic>
       </a:graphicData></a:graphic>
     </wp:inline>
   </w:drawing>
   ```

---

## Dependencies

The generator has **no runtime dependencies and never runs `npm install`.** docx-js
ships as a single self-contained, gzipped build at `scripts/vendor/docx.cjs.gz`
(loaded in memory by `scripts/vendor-docx.js`). There is no `node_modules/` tree.
Only a `node` runtime is required.

For editing workflows (all optional):
- **pandoc**: Text extraction
- **LibreOffice**: PDF conversion via `scripts/office/soffice.py`
- **Poppler**: `pdftoppm` for images
- **defusedxml + lxml** (Python): strict OOXML schema validation via `scripts/office/validate.py`
