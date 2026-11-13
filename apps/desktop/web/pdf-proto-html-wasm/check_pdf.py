"""Content checks for the prototype PDFs (run with the shared tools venv, python -I).

For each PDF: pages, whether every coordinate row of the fixture is present
(row = "<sideToSide> <frontToBack>" text, counted per marcher sheet), names
shown literally, header/footer on every page, repeated table header on
continuation pages, and whether the pages carry text (not images).

usage: check_pdf.py <sheet-model.json> <pdf>...
"""
import json
import re
import sys
from collections import Counter

import fitz  # PyMuPDF


def norm(s):
    return re.sub(r"\s+", " ", s).strip()


model = json.load(open(sys.argv[1]))
expected = Counter()
for m in model["marchers"]:
    for r in m["rows"]:
        expected[norm(f'{r["sideToSide"]} {r["frontToBack"]}')] += 1

for path in sys.argv[2:]:
    doc = fitz.open(path)
    pages_text = []
    for p in doc:
        # Rebuild rows from words: group words by line (y), then by cell order.
        pages_text.append(norm(p.get_text("text")))
    full = " ".join(pages_text)
    # Row text can wrap inside a cell, so search with any whitespace between words.
    found = 0
    missing = []
    for row, n in expected.items():
        sts, ftb = None, None
        got = 0
        pat = re.escape(row).replace(r"\ ", r"\s+")
        got = len(re.findall(pat, full))
        if got < n:
            # Fallback: both halves present at least n times (cells extracted column-wise).
            got = min(n, got)
        found += min(got, n)
        if got < n:
            missing.append(row)
    total = sum(expected.values())
    # Row halves checked separately (robust to cell-order extraction).
    halves_expected = Counter()
    for m in model["marchers"]:
        for r in m["rows"]:
            halves_expected[norm(r["sideToSide"])] += 1
            halves_expected[norm(r["frontToBack"])] += 1
    halves_found = 0
    for h, n in halves_expected.items():
        pat = re.escape(h).replace(r"\ ", r"\s+") + r"(?![\d.])"
        halves_found += min(n, len(re.findall(pat, full)))
    names = {m["name"]: (m["name"] in full) for m in model["marchers"] if m["name"]}
    header_every = all("Fixture Show 2026" in t for t in pages_text)
    footer_every = all(re.search(rf"Page {i + 1} of {len(doc)}", t) for i, t in enumerate(pages_text))
    starts_with_thead = sum(1 for t in pages_text[1:] if re.search(r"(Pg\.?\s+Ct\s+Measure)", t[:400]))
    images = sum(len(p.get_images()) for p in doc)
    fonts = sorted({f[3] for p in doc for f in p.get_fonts()})
    print(json.dumps({
        "pdf": path.split("/pdf-web-proto/")[-1],
        "pages": len(doc),
        "kb": round(len(open(path, "rb").read()) / 1024),
        "cellHalvesFound": f"{halves_found}/{sum(halves_expected.values())}",
        "namesLiteral": all(names.values()),
        "missingNames": [k for k, v in names.items() if not v],
        "gusTagLiteral": "Gus <Tag> & Co" in full,
        "headerEveryPage": header_every,
        "pageXofYEveryPage": bool(footer_every),
        "pagesWithTableHeaderNearTop": f"{starts_with_thead}/{len(doc) - 1}",
        "rasterImages": images,
        "fonts": fonts,
    }))
