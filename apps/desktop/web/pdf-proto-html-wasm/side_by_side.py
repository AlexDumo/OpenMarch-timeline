"""Side-by-side page renders: baseline | engine outputs (page N), as one PNG.

usage: side_by_side.py <out.png> <page index from 0> <label=pdf>...
"""
import sys

import fitz

out, page = sys.argv[1], int(sys.argv[2])
items = [a.split("=", 1) for a in sys.argv[3:]]
W, H, GAP, TOP = 612, 792, 16, 28
doc = fitz.open()
sheet = doc.new_page(width=len(items) * (W + GAP) - GAP, height=H + TOP)
for i, (label, path) in enumerate(items):
    x = i * (W + GAP)
    src = fitz.open(path)
    sheet.insert_text((x + 4, 18), label, fontsize=14)
    r = fitz.Rect(x, TOP, x + W, TOP + H)
    sheet.draw_rect(r, color=(0.6, 0.6, 0.6), width=0.5)
    sheet.show_pdf_page(r, src, page)
sheet.get_pixmap(dpi=110).save(out)
print(out)
