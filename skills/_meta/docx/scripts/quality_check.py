#!/usr/bin/env python3
"""
Post-generation quality gate for DOCX files.

Scores the OOXML for professional-quality markers:
  - docDefaults with correct font and color
  - Branded header and footer presence
  - Live PAGE field in footer
  - Consistent color palette (>= 3 distinct brand colors)
  - Styled tables (header row differentiation)
  - Section dividers or explicit spacing
  - Real OPC package (docProps, settings, fontTable)

Usage:
    python quality_check.py <document.docx>
    python quality_check.py <document.docx> --threshold 8

Exit code 0 when score >= threshold, else 1.
"""

import argparse
import sys
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NAMESPACES = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
}

MAX_SCORE = 10


def _iter_elements(root, tag_local):
    """Yield elements matching local tag name across namespaces."""
    for ns in NAMESPACES.values():
        yield from root.iter(f"{{{ns}}}{tag_local}")


def check_doc_defaults(styles_root):
    """Return True if docDefaults sets Arial + a slate-like body color."""
    for dd in _iter_elements(styles_root, "docDefaults"):
        rpr = None
        for child in dd:
            if child.tag.endswith("}rPrDefault"):
                for sub in child:
                    if sub.tag.endswith("}rPr"):
                        rpr = sub
                        break
        if rpr is None:
            continue
        fonts = []
        colors = []
        for el in rpr:
            if el.tag.endswith("}rFonts"):
                fonts = [el.get(f"{{{NAMESPACES['w']}}}ascii", ""), el.get(f"{{{NAMESPACES['w']}}}hAnsi", "")]
            if el.tag.endswith("}color"):
                colors.append(el.get(f"{{{NAMESPACES['w']}}}val", ""))
        if any("Arial" in f for f in fonts) and any(c.upper() in SCOGO_PALETTE for c in colors):
            return True
    return False


def check_paragraph_styles(styles_root):
    """Count heading styles with non-empty formatting."""
    count = 0
    for style in _iter_elements(styles_root, "style"):
        style_id = style.get(f"{{{NAMESPACES['w']}}}styleId", "")
        if style_id.startswith("Heading"):
            for rpr in _iter_elements(style, "rPr"):
                has_fmt = any(
                    child.tag.endswith(("}b", "}sz", "}color", "}rFonts"))
                    for child in rpr
                )
                if has_fmt:
                    count += 1
                    break
    return count


def check_header_footer(sect_root):
    """Return (has_header_ref, has_footer_ref, has_page_field)."""
    has_header = False
    has_footer = False
    has_page = False
    for sectPr in _iter_elements(sect_root, "sectPr"):
        for child in sectPr:
            tag = child.tag.split("}")[-1]
            if tag == "headerReference":
                has_header = True
            elif tag == "footerReference":
                has_footer = True
    # PAGE field in document body (<w:fldChar w:fldCharType="begin"/> ... PAGE)
    for fldChar in _iter_elements(sect_root, "fldChar"):
        fld_type = fldChar.get(f"{{{NAMESPACES['w']}}}fldCharType", "")
        if fld_type == "begin":
            has_page = True
            break
    # Also check footer XML files for PAGE field
    return has_header, has_footer, has_page


def collect_colors(root):
    """Distinct non-default brand colors used in a part: run colors (w:color@val)
    and shading fills (w:shd@fill). Scans the whole part, not just runs, because
    the palette lives across document.xml, styles.xml, and the header/footer."""
    colors = set()
    skip = ("000000", "AUTO", "FFFFFF", "")
    for color_el in _iter_elements(root, "color"):
        val = color_el.get(f"{{{NAMESPACES['w']}}}val", "").upper()
        if val not in skip:
            colors.add(val)
    for shd in _iter_elements(root, "shd"):
        fill = shd.get(f"{{{NAMESPACES['w']}}}fill", "").upper()
        if fill not in skip:
            colors.add(fill)
    return colors


def count_table_header_rows(document_root):
    """Count tables with shaded/differentiated header rows."""
    tables = 0
    styled = 0
    for tbl in _iter_elements(document_root, "tbl"):
        tables += 1
        first_row = None
        for tr in _iter_elements(tbl, "tr"):
            first_row = tr
            break
        if first_row is not None:
            for tc in _iter_elements(first_row, "tc"):
                for shd in _iter_elements(tc, "shd"):
                    fill = shd.get(f"{{{NAMESPACES['w']}}}fill", "")
                    if fill and fill.upper() not in ("AUTO", "", "FFFFFF"):
                        styled += 1
                        break
                break
    return tables, styled


def check_spacing_or_dividers(document_root):
    """Check for non-default paragraph spacing or paragraph borders (dividers)."""
    has_spacing = False
    has_borders = False
    for pPr in _iter_elements(document_root, "pPr"):
        for child in pPr:
            tag = child.tag.split("}")[-1]
            if tag in ("spacing", "ind"):
                has_spacing = True
            elif tag == "pBdr":
                has_borders = True
    return has_spacing, has_borders


def check_opc_completeness(parts):
    """Check for docProps, settings.xml, fontTable.xml."""
    has_docprops = any("docProps" in p for p in parts)
    has_settings = any(p.endswith("settings.xml") for p in parts)
    has_fonttable = any(p.endswith("fontTable.xml") for p in parts)
    return has_docprops, has_settings, has_fonttable


SCOGO_PALETTE = {
    "1E293B", "475569", "94A3B8", "F97316",
    "E2E8F0", "F8FAFC", "0563C1", "FFFFFF",
}


def analyze(docx_path):
    score = 0
    checks = []

    with tempfile.TemporaryDirectory() as tmpdir:
        with zipfile.ZipFile(docx_path, "r") as zf:
            zf.extractall(tmpdir)

        root = Path(tmpdir)
        parts = [str(p.relative_to(root)) for p in root.rglob("*") if p.is_file()]

        # 1. OPC completeness (generator vs hand-written)
        has_docprops, has_settings, has_fonttable = check_opc_completeness(parts)
        if has_docprops and has_settings and has_fonttable:
            score += 2
            checks.append(("✓", "OPC package complete (docProps, settings, fontTable)"))
        else:
            checks.append(("✗", "Incomplete OPC package — likely hand-written XML"))

        # 2. docDefaults
        styles_path = root / "word" / "styles.xml"
        styles_ok = False
        headings_count = 0
        if styles_path.exists():
            styles_tree = ET.parse(styles_path)
            styles_ok = check_doc_defaults(styles_tree.getroot())
            headings_count = check_paragraph_styles(styles_tree.getroot())
        if styles_ok:
            score += 1
            checks.append(("✓", f"docDefaults set (Arial + brand color)"))
        else:
            checks.append(("✗", "docDefaults missing or font/color mismatch"))

        # 3. Heading styles with formatting
        if headings_count >= 4:
            score += 1
            checks.append(("✓", f"Heading styles with real formatting: {headings_count}"))
        else:
            checks.append(("✗", f"Too few styled headings: {headings_count}"))

        # 4. Header/footer + page field
        doc_path = root / "word" / "document.xml"
        has_header = has_footer = has_page = False
        if doc_path.exists():
            doc_tree = ET.parse(doc_path)
            has_header, has_footer, has_page = check_header_footer(doc_tree.getroot())

        # Also scan footer XML explicitly for PAGE field
        footer_has_page = False
        for fpath in (root / "word").glob("footer*.xml"):
            ft = ET.parse(fpath).getroot()
            for fc in _iter_elements(ft, "fldChar"):
                if fc.get(f"{{{NAMESPACES['w']}}}fldCharType", "") == "begin":
                    footer_has_page = True

        if has_header:
            score += 1
            checks.append(("✓", "Header reference present"))
        else:
            checks.append(("✗", "No header reference"))

        if has_footer:
            score += 1
            checks.append(("✓", "Footer reference present"))
        else:
            checks.append(("✗", "No footer reference"))

        if footer_has_page or has_page:
            score += 1
            checks.append(("✓", "Live PAGE field found"))
        else:
            checks.append(("✗", "No live page number field"))

        # 5. Color palette — scan every styled part (document, styles, header,
        # footer), counting both run colors and shading fills.
        all_colors = set()
        color_parts = [doc_path, styles_path]
        color_parts += sorted((root / "word").glob("header*.xml"))
        color_parts += sorted((root / "word").glob("footer*.xml"))
        for part in color_parts:
            if part.exists():
                all_colors |= collect_colors(ET.parse(part).getroot())
        distinct = len(all_colors)
        if distinct >= 3:
            score += 1
            checks.append(("✓", f"Color palette used: {distinct} distinct colors"))
        else:
            checks.append(("✗", f"Too few colors: {distinct}"))

        # 6. Styled tables
        total_tbl, styled_tbl = (0, 0)
        if doc_path.exists():
            total_tbl, styled_tbl = count_table_header_rows(doc_tree.getroot())
        if total_tbl == 0:
            checks.append(("○", "No tables present"))
        elif styled_tbl > 0:
            score += 1
            checks.append(("✓", f"Styled tables: {styled_tbl}/{total_tbl} with header shading"))
        else:
            checks.append(("✗", f"Tables use default styling: {total_tbl}"))

        # 7. Spacing / dividers
        has_spacing, has_borders = (False, False)
        if doc_path.exists():
            has_spacing, has_borders = check_spacing_or_dividers(doc_tree.getroot())
        if has_borders or has_spacing:
            score += 1
            checks.append(("✓", "Section dividers or deliberate spacing detected"))
        else:
            checks.append(("✗", "No section dividers or custom spacing"))

    return score, checks


def main():
    parser = argparse.ArgumentParser(description="DOCX professional-quality gate")
    parser.add_argument("docx", help="Path to .docx file")
    parser.add_argument("--threshold", type=int, default=8, help="Minimum score to pass (default: 8)")
    args = parser.parse_args()

    score, checks = analyze(args.docx)

    print(f"Document Quality Score: {score}/{MAX_SCORE}")
    print()
    for ok, msg in checks:
        print(f"{ok} {msg}")
    print()

    if score >= args.threshold:
        print(f"PASS (score >= threshold {args.threshold})")
        sys.exit(0)
    else:
        print(f"FAIL (score < threshold {args.threshold})")
        sys.exit(1)


if __name__ == "__main__":
    main()
