# cspell:disable
"""Diagrams for docs/timeline/research/holds: writes q*.svg here, plus holds-questions.html (not committed)."""

import html
import pathlib

OUT = pathlib.Path(__file__).parent

# Palette
INK = "#1f2937"
MUTED = "#6b7280"
GRID = "#e5e7eb"
PAGE_FILL = "#f8fafc"
MOVE = "#3b82f6"
MOVE_FILL = "#dbeafe"
HELD = "#059669"
FOLLOW = "#9ca3af"
NEW = "#f59e0b"
BAD = "#dc2626"

X0 = 230  # left of count 0
CW = 18  # px per count


def cx(c):
    return X0 + c * CW


class Svg:
    def __init__(self, w, h):
        self.w, self.h, self.parts = w, h, []

    def add(self, s):
        self.parts.append(s)

    def text(self, x, y, s, size=13, color=INK, anchor="start", weight="normal", italic=False):
        st = ' font-style="italic"' if italic else ""
        self.add(
            f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" text-anchor="{anchor}" '
            f'font-weight="{weight}"{st}>{html.escape(s)}</text>'
        )

    def line(self, x1, y1, x2, y2, color=INK, w=1.5, dash=None, marker=False):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        m = ' marker-end="url(#arrow)"' if marker else ""
        self.add(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{w}"{d}{m}/>')

    def rect(self, x, y, w, h, fill, stroke="none", sw=1, rx=4, dash=None, opacity=1):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.add(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" '
            f'stroke-width="{sw}"{d} opacity="{opacity}"/>'
        )

    def render(self):
        defs = (
            '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" '
            f'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{INK}"/></marker></defs>'
        )
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" '
            f'viewBox="0 0 {self.w} {self.h}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">'
            + defs
            + "".join(self.parts)
            + "</svg>"
        )


# ---- timeline primitives -------------------------------------------------

PAGES = [(0, 8, "Page 2"), (8, 16, "Page 3"), (16, 24, "Page 4"), (24, 32, "Page 5"), (32, 40, "Page 6")]


def page_header(s, y, last=40):
    for a, b, name in PAGES:
        if a >= last:
            break
        s.rect(cx(a) + 1, y, (b - a) * CW - 2, 22, PAGE_FILL, GRID)
        s.text((cx(a) + cx(b)) / 2, y + 15, name, 12, MUTED, "middle")
    for c in range(0, last + 1, 8):
        s.line(cx(c), y + 22, cx(c), s.h - 8, GRID, 1)
    for c in range(0, last + 1, 4):
        s.text(cx(c), y - 4, str(c), 10, MUTED, "middle")


TAGS = {
    "today": ("TODAY", "#475569", "#e2e8f0"),
    "problem": ("PROBLEM", BAD, "#fee2e2"),
    "proposed": ("PROPOSED", HELD, "#d1fae5"),
    "new": ("NEW", "#7c3aed", "#ede9fe"),
}


def row_label(s, y, label, sub=None, tag=None):
    if tag:
        word, fg, bg = TAGS[tag]
        w = 8 * len(word) + 14
        s.rect(10, y - 30, w, 17, bg, fg, 1, 8)
        s.text(10 + w / 2, y - 18, word, 10, fg, "middle", "bold")
    s.text(10, y + 5, label, 13, INK, weight="bold")
    if sub:
        for i, ln in enumerate(sub.split("\n")):
            s.text(10, y + 20 + i * 14, ln, 11, MUTED)


def divider(s, y, label):
    s.line(10, y, s.w - 10, y, "#cbd5e1", 1, dash="4 4")
    s.text(s.w - 12, y - 6, label, 11, MUTED, "end")


def move_clip(s, a, b, y, label="", color=MOVE, fill=MOVE_FILL):
    s.rect(cx(a) + 1, y - 9, (b - a) * CW - 2, 18, fill, color, 1.5)
    if label:
        s.text((cx(a) + cx(b)) / 2, y + 4, label, 11, color, "middle")


def held_bar(s, a, b, y, color=HELD):
    s.rect(cx(a), y - 5, (b - a) * CW, 10, color, rx=5)


def follow_bar(s, a, b, y):
    s.add(
        f'<line x1="{cx(a)}" y1="{y}" x2="{cx(b)}" y2="{y}" stroke="{FOLLOW}" stroke-width="6" '
        'stroke-dasharray="8 6" stroke-linecap="round"/>'
    )


def chain(s, x, y, color=INK):
    s.add(
        f'<g fill="none" stroke="{color}" stroke-width="2.2">'
        f'<rect x="{x-11}" y="{y-5}" width="13" height="9" rx="4.5"/>'
        f'<rect x="{x-2}" y="{y-5}" width="13" height="9" rx="4.5"/></g>'
    )


def diamond(s, c, y, filled=True, color=INK):
    x = cx(c)
    f = color if filled else "white"
    s.add(f'<path d="M{x},{y-8} L{x+8},{y} L{x},{y+8} L{x-8},{y} z" fill="{f}" stroke="{color}" stroke-width="2"/>')


def departure(s, c, y, color=INK):
    x = cx(c)
    s.add(f'<path d="M{x},{y-9} L{x},{y+9}" stroke="{color}" stroke-width="3"/>')


def flag(s, c, y0, y1, label, color):
    s.line(cx(c), y0, cx(c), y1, color, 2.5)
    s.add(f'<path d="M{cx(c)},{y0} l12,5 l-12,5 z" fill="{color}"/>')
    s.text(cx(c) + 14, y0 + 9, label, 11, color, weight="bold")


def note(s, x, y, txt, color=MUTED, size=12, anchor="start", weight="normal"):
    for i, ln in enumerate(txt.split("\n")):
        s.text(x, y + i * (size + 4), ln, size, color, anchor, weight)


# ---- field primitives ----------------------------------------------------


def field_box(s, x, y, w, h, title):
    s.rect(x, y, w, h, "#f0fdf4", "#86efac", 1.5, 8)
    s.text(x + 8, y + 16, title, 12, "#166534", weight="bold")


def dot(s, x, y, label="", solid=True, color=INK, bold=None):
    if solid:
        s.add(f'<circle cx="{x}" cy="{y}" r="8" fill="{color}"/>')
    else:
        s.add(
            f'<circle cx="{x}" cy="{y}" r="8" fill="white" stroke="{color}" stroke-width="2" stroke-dasharray="3 3"/>'
        )
    if label:
        w = "bold" if (bold if bold is not None else solid) else "normal"
        s.text(x, y - 13, label, 12, INK, "middle", w)


def node(s, x, y, color=MOVE):
    s.rect(x - 5, y - 5, 10, 10, "white", color, 2.5, rx=1)


# ---- legend ---------------------------------------------------------------


def legend():
    s = Svg(1100, 150)
    L, R = 20, 560

    def item(x, y, draw, label):
        draw(x, y)
        s.text(x + 70, y + 4, label, 13)

    def clip_at(x, y):
        s.rect(x, y - 9, 56, 18, MOVE_FILL, MOVE, 1.5)

    def held_at(x, y):
        s.rect(x, y - 5, 56, 10, HELD, rx=5)

    def follow_at(x, y):
        s.add(f'<line x1="{x}" y1="{y}" x2="{x+56}" y2="{y}" stroke="{FOLLOW}" stroke-width="6" stroke-dasharray="8 6" stroke-linecap="round"/>')

    def dia_at(x, y):
        s.add(f'<path d="M{x+28},{y-8} l8,8 l-8,8 l-8,-8 z" fill="{INK}"/>')

    def dep_at(x, y):
        s.add(f'<path d="M{x+28},{y-9} L{x+28},{y+9}" stroke="{INK}" stroke-width="3"/>')

    item(L, 30, clip_at, "a move: the marcher walks")
    item(R, 30, dia_at, "keyframe: a coordinate set on this count")
    item(L, 70, held_at, "Held hold (solid bar): deliberate, one piece")
    item(R, 70, follow_at, "Following (dashed bar): unedited, shows the last set")
    item(L, 110, dep_at, "departure: where the next move takes over")
    dot(s, R + 16, 110, "", True)
    dot(s, R + 44, 110, "", False)
    s.text(R + 70, 114, "solid dot = decided · dashed dot = Following", 13)
    return s.render()


# ---- items ----------------------------------------------------------------



def xmark(s, c, y):
    s.add(f'<path d="M{cx(c)-8},{y-8} l16,16 M{cx(c)+8},{y-8} l-16,16" stroke="{BAD}" stroke-width="2.5"/>')


def callout(s, x, y, txt, color=BAD):
    lines = txt.split("\n")
    w = max(len(l) for l in lines) * 6.6 + 16
    h = len(lines) * 16 + 10
    bg = "#fee2e2" if color == BAD else "#d1fae5"
    s.rect(x, y, w, h, bg, color, 1.2, 6)
    for i, ln in enumerate(lines):
        s.text(x + 8, y + 17 + i * 16, ln, 12, color)


def item4():
    s = Svg(1100, 600)
    page_header(s, 26)
    y = 95
    row_label(s, y, "Edit Page 4", "start flag at 18,\nplayhead at 28", tag="today")
    diamond(s, 8, y)
    follow_bar(s, 8, 18, y)
    move_clip(s, 18, 28, y, "new move", MOVE, MOVE_FILL)
    diamond(s, 28, y)
    note(s, cx(28) + 14, y + 4, "Works today: nothing is 'held',\nso any edit just starts a move.", MUTED)
    divider(s, 150, "proposed: with Held holds")
    y = 200
    row_label(s, y, "A Held hold", "B1 and B2", tag="proposed")
    diamond(s, 8, y)
    held_bar(s, 8, 24, y)
    departure(s, 24, y)
    note(s, cx(8) + 6, y - 14, "Held through Pages 3–4", HELD, 12, weight="bold")
    y = 285
    row_label(s, y, "Drag at count 20", "(inside the hold)", tag="proposed")
    diamond(s, 8, y, color=NEW)
    held_bar(s, 8, 24, y, NEW)
    note(s, cx(24) + 12, y + 4, "Moves the WHOLE hold, including where\nit arrives on Page 2. That's why leaving\nearly needs its own gesture:", INK)
    y = 390
    row_label(s, y, "Leave early", "1. drag B1's bar end to 18\n2. drag B1 to X at 28", tag="proposed")
    diamond(s, 8, y)
    held_bar(s, 8, 18, y)
    s.rect(cx(18), y - 5, 6 * CW, 10, "none", HELD, 1.5, 5, dash="3 3")
    move_clip(s, 18, 28, y + 26, "B1 walks to X", NEW, "#fef3c7")
    diamond(s, 28, y + 26, color=NEW)
    note(s, cx(28) + 14, y + 30, "B1 leaves at 18; B2 still holds to 24", MUTED)
    y = 520
    row_label(s, y, "Or, in Expert", "one step", tag="proposed")
    flag(s, 18, y - 30, y + 26, "start flag", HELD)
    flag(s, 28, y - 30, y + 26, "playhead", BAD)
    diamond(s, 8, y)
    held_bar(s, 8, 18, y)
    move_clip(s, 18, 28, y, "", NEW, "#fef3c7")
    note(s, cx(29) + 12, y + 2, "Arrives after the hold → it's leaving it.", INK, 12)
    return s.render()


def route(s, ox, oy, pts, labels=True):
    s.add(
        f'<polyline points="{" ".join(f"{ox+x},{oy+y}" for x, y in pts)}" fill="none" stroke="{MOVE}" stroke-width="2" stroke-dasharray="6 4"/>'
    )
    for (x, y), c in zip(pts, (8, 16, 24)):
        node(s, ox + x, oy + y)
        if labels:
            s.text(ox + x + 10, oy + y + 22, f"set · count {c}", 11, MOVE)


def item9():
    s = Svg(1100, 640)
    # TODAY row: three marchers at count 12 under #332
    row_label(s, 40, "#332 at count 12", None, tag="today")
    field_box(s, 10, 60, 1080, 200, "Field at count 12")
    dot(s, 160, 170, "B1 walking", False)
    dot(s, 420, 170, "B2 held on purpose", False)
    dot(s, 700, 170, "B3 page not set yet", False)
    dot(s, 960, 170, "B4 arrives on 12", True)
    callout(s, 120, 205, "Walking, held and unfinished all look the same (dashed). Only 'arrived exactly now' is solid.")
    # PROPOSED
    row_label(s, 310, "Proposed at count 12", None, tag="proposed")
    field_box(s, 10, 330, 1080, 290, "Field at count 12, B1 selected")
    route(s, 40, 330, [(30, 220), (230, 110), (430, 180)])
    dot(s, 40 + 130, 330 + 165, "B1 walking", True, bold=False)
    dot(s, 640, 450, "B2 held", True, bold=False)
    dot(s, 800, 450, "B3 not set", False)
    dot(s, 960, 450, "B4 arrives", True, bold=True)
    callout(s, 560, 520, "Solid = decided (walking, held or arriving).\nDashed = only 'not set yet'.\nSquares on the selected route = where coordinates are set.\nBold label = set on this exact count.", HELD)
    return s.render()


def item12():
    s = Svg(1100, 620)
    page_header(s, 26)
    y = 95
    row_label(s, y, "Main today", "edit Page 2", tag="today")
    diamond(s, 8, y, color=NEW)
    follow_bar(s, 8, 32, y)
    callout(s, cx(32) + 14, y - 22, "Pages 3–5 changed too. You only\nfind out afterwards, from a toast:\n'Pages 3–5 followed · Only Page 2'.")
    y = 210
    row_label(s, y, "#297 (draft)", "before the edit", tag="today")
    diamond(s, 8, y)
    for a, b, _ in PAGES[1:4]:
        chain(s, (cx(a) + cx(b)) / 2, y)
    note(s, cx(32) + 12, y - 2, "Chains warn first: these\npages follow Page 2.", MUTED)
    y = 300
    row_label(s, y, "#297: click a chain", "on Page 5, then edit", tag="problem")
    diamond(s, 8, y, color=NEW)
    for a, b, _ in PAGES[1:3]:
        chain(s, (cx(a) + cx(b)) / 2, y)
    move_clip(s, 24, 32, y, "kept spot", BAD, "#fee2e2")
    callout(s, cx(32) + 12, y - 22, "Unlinking stores a 'kept' mark,\nthe thing #158 removes.")
    divider(s, 360, "proposed")
    y = 420
    row_label(s, y, "#297, adjusted", "click chain on Page 5", tag="proposed")
    diamond(s, 8, y, color=NEW)
    for a, b, _ in PAGES[1:3]:
        chain(s, (cx(a) + cx(b)) / 2, y)
    move_clip(s, 24, 32, y, "ordinary move", MOVE, MOVE_FILL)
    diamond(s, 32, y)
    note(s, cx(32) + 14, y + 4, "Same result, nothing extra stored:\nthis IS #158's 'only this page'.", MUTED)
    y = 540
    row_label(s, y, "Later, with bars", "", tag="proposed")
    diamond(s, 8, y)
    follow_bar(s, 8, 32, y)
    s.add(f'<circle cx="{cx(24)}" cy="{y}" r="13" fill="white" stroke="{FOLLOW}" stroke-width="2"/>')
    chain(s, cx(24), y)
    note(s, cx(8) + 4, y - 16, "One dashed bar: 'Following Page 2'. The chain lives on the bar.", MUTED)
    return s.render()


def chart(s, x, y, w, h, title, segs, color):
    s.rect(x, y, w, h, "white", GRID, 1, 6)
    s.text(x + 8, y + 16, title, 12, color, weight="bold")
    px = lambda c: x + 30 + (c - 8) / 8 * (w - 50)
    py = lambda p: y + h - 22 - p * (h - 56)
    s.line(px(8), py(0), px(16), py(0), GRID, 1)
    s.line(px(8), py(0), px(8), py(1), GRID, 1)
    s.text(px(8) - 6, py(0) + 4, "A", 11, MUTED, "end")
    s.text(px(8) - 6, py(1) + 4, "B", 11, MUTED, "end")
    for c in (8, 12, 16):
        s.text(px(c), py(0) + 15, str(c), 10, MUTED, "middle")
    pts = " ".join(f"{px(c)},{py(p)}" for c, p in segs)
    s.add(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="3"/>')


def item14():
    s = Svg(1100, 470)
    s.text(10, 22, "Page 3 (counts 8–16): a move A → B, split at 12, then Remove keyframe at 12.", 13, INK)

    def c2(c):
        return cx((c - 8) * 4)

    def clip2(a, b, y, label, color=MOVE, fill=MOVE_FILL):
        s.rect(c2(a) + 1, y - 9, c2(b) - c2(a) - 2, 18, fill, color, 1.5)
        s.text((c2(a) + c2(b)) / 2, y + 4, label, 11, color, "middle")

    def dia(c, y):
        x = c2(c)
        s.add(f'<path d="M{x},{y-8} L{x+8},{y} L{x},{y+8} L{x-8},{y} z" fill="{INK}"/>')

    for c in (8, 12, 16):
        s.text(c2(c), 52, str(c), 11, MUTED, "middle")
    y = 80
    row_label(s, y, "After the split")
    clip2(8, 12, y, "X: A → M")
    clip2(12, 16, y, "Y: M → B")
    dia(12, y)
    dia(16, y)
    y = 135
    row_label(s, y, "Remove keyframe", tag="problem")
    s.rect(c2(8), y - 5, c2(12) - c2(8), 10, FOLLOW, rx=5)
    s.text((c2(8) + c2(12)) / 2, y - 10, "stands still at A", 11, MUTED, "middle")
    clip2(12, 16, y, "Y: A → B in 4 counts (2× speed)", BAD, "#fee2e2")
    dia(16, y)
    y = 190
    row_label(s, y, "Remove keyframe", tag="proposed")
    clip2(8, 16, y, "joined: A → B over 8 counts, even speed (the original move)", HELD, "#d1fae5")
    dia(16, y)
    chart(s, 10, 240, 350, 210, "Before removing: even", [(8, 0), (16, 1)], MOVE)
    chart(s, 375, 240, 350, 210, "TODAY: wait, then 2× speed", [(8, 0), (12, 0), (16, 1)], BAD)
    chart(s, 740, 240, 350, 210, "PROPOSED: even again", [(8, 0), (16, 1)], HELD)
    return s.render()


def item15():
    s = Svg(1100, 560)
    page_header(s, 26)
    y = 95
    row_label(s, y, "Start", "Page 3 follows Page 2", tag="today")
    diamond(s, 8, y)
    follow_bar(s, 8, 16, y)
    diamond(s, 24, y)
    y = 185
    row_label(s, y, "Remove keyframe", "on Page 2", tag="today")
    xmark(s, 8, y)
    follow_bar(s, 0, 8, y)
    move_clip(s, 8, 16, y, "back to old spot", NEW, "#fef3c7")
    diamond(s, 16, y, color=NEW)
    diamond(s, 24, y)
    note(s, cx(24) + 14, y + 4, "Fine: Page 3 stays where it was,\nas a move with a diamond.", MUTED)
    y = 285
    row_label(s, y, "Later: drag Page 2", "back onto that spot", tag="problem")
    diamond(s, 8, y)
    move_clip(s, 8, 16, y, "goes nowhere", BAD, "#fee2e2")
    s.add(f'<path d="M{cx(16)},{y-8} L{cx(16)+8},{y} L{cx(16)},{y+8} L{cx(16)-8},{y} z" fill="none" stroke="{BAD}" stroke-width="2" stroke-dasharray="3 2"/>')
    diamond(s, 24, y)
    callout(s, cx(24) + 14, y - 30, "Page 3's diamond disappears, but the move is\nstill there: edit Page 2 again and Page 3\ndoesn't follow. An invisible pin (#317).")
    divider(s, 345, "proposed (your yes to 13)")
    y = 405
    row_label(s, y, "Same steps", "", tag="proposed")
    diamond(s, 8, y)
    move_clip(s, 8, 16, y, "stays on its spot", MOVE, MOVE_FILL)
    diamond(s, 16, y)
    diamond(s, 24, y)
    note(s, cx(24) + 14, y + 4, "The diamond stays: Page 3 visibly has\nits own spot. Remove it to follow again.", MUTED)
    y = 495
    row_label(s, y, "…Pages follow back", "the other Remove item", tag="today")
    xmark(s, 8, y)
    follow_bar(s, 0, 16, y)
    diamond(s, 24, y)
    note(s, cx(24) + 14, y + 4, "Page 3 jumps back to the earlier spot.\nUnchanged.", MUTED)
    return s.render()


def item16():
    s = Svg(1100, 400)
    page_header(s, 26)
    y = 95
    row_label(s, y, "Start", "Page 3 has its own spot")
    diamond(s, 8, y)
    move_clip(s, 8, 16, y, "Page 3 move")
    diamond(s, 16, y)
    y = 200
    row_label(s, y, "Set to previous page", "(unchanged)", tag="today")
    diamond(s, 8, y)
    follow_bar(s, 8, 16, y)
    note(s, cx(16) + 12, y - 2, "Page 3 becomes unedited (dashed): it follows Page 2.\nEdit Page 2 → Page 3 follows.  Edit Page 3 → it gets its own spot.\nNo hold is made.", MUTED)
    y = 320
    row_label(s, y, "Hold from previous page", "(optional new command)", tag="new")
    diamond(s, 8, y)
    held_bar(s, 8, 16, y)
    note(s, cx(16) + 12, y - 2, "One solid hold over Pages 2–3.\nEdit Page 3 → moves Page 2's spot too.\nSame result as dragging a bar end.", MUTED)
    return s.render()


def item17():
    s = Svg(1100, 400)
    page_header(s, 26)
    y = 95
    row_label(s, y, "Start", "arrives on Page 2", tag="new")
    diamond(s, 8, y)
    held_bar(s, 8, 24, y)
    note(s, cx(8) + 4, y - 14, "Held at A through Page 4", HELD, 12, weight="bold")
    y = 205
    row_label(s, y, "Remove keyframe", "option: keep the hold", tag="problem")
    xmark(s, 8, y)
    held_bar(s, 8, 24, y, BAD)
    callout(s, cx(24) + 12, y - 22, "Solid 'decided' hold, but at Page 1's\nspot, which nobody chose.")
    y = 320
    row_label(s, y, "Remove keyframe", "option: drop the hold", tag="proposed")
    xmark(s, 8, y)
    follow_bar(s, 0, 24, y)
    note(s, cx(24) + 12, y - 2, "Pages 2–4 become unedited (dashed):\nnothing there is decided any more.\nUndo brings the hold back.", MUTED)
    return s.render()


ITEMS = [
    dict(key="legend", title="How to read these", fn=legend),
    dict(
        key="4",
        title="4. Leaving a hold early",
        status="New rule (Held holds don't exist yet)",
        today="Nothing is held on purpose. Any edit inside a stretch of unedited pages just starts a new move there.",
        problem="None today. It's a consequence of the proposal: a drag inside a Held hold moves the whole hold, so leaving early needs a different gesture.",
        proposed="Shorten that marcher's bar to where it leaves, then place it where it goes. In Expert, a start-flag-to-playhead window that ends after the hold does it in one step.",
        facts=[
            "Holds are per marcher: one can leave early while the others stay.",
            "The arrival count decides: arrive inside the hold → you're moving the hold; arrive after it → you're leaving it.",
            "Build note: Basic's point editing must start the move at the hold's end, not its beginning.",
        ],
        fn=item4,
    ),
    dict(
        key="9",
        title="9. Solid dots, but show where coordinates are set",
        status="Changes #332's look",
        today="#332: solid only on the exact count a move ends; dashed everywhere else.",
        problem="Walking, held on purpose and not-set-yet all draw the same dashed dot, so 'unfinished' can't be told from 'in transit'.",
        proposed="Solid whenever the marcher's position is decided (walking, held, arriving); dashed only for 'not set yet'. Show set spots as squares on the selected marchers' route, and keep #332's bold label on the exact count.",
        facts=[
            "The bold/light label already exists in #332.",
            "Route drawing already exists: start flag positions (#337, merged 2026-10-20) draws the path from the start flag.",
            "Loses one #332 behaviour: dots flashing solid as you scrub past their set counts.",
        ],
        fn=item9,
    ),
    dict(
        key="12",
        title="12. #297 follow links",
        status="Draft PR #297; overlaps #158",
        today="Main: edit Page 2 and the later pages that follow it change; a toast tells you afterwards ('Pages 3–5 followed · Only Page 2'). #297: chains on those pages warn you before, and clicking one unlinks that page.",
        problem="#297's unlink stores a 'kept' mark, the exact thing #158 (which you said yes to) removes. And chains plus bars would be two pictures of the same fact.",
        proposed="Merge #297 with unlink writing an ordinary move. That is #158's 'only this page', so no separate arming step. When the bars arrive, the chain moves onto the Following bar.",
        facts=[
            "In #297's simulated-user study, chains beat the toast for knowing in advance (6.75 vs 5.0) and noticing (7.5 vs 5.5).",
            "The toast's one-click undo scored better (8.5 vs 5.75); you chose to fix it before the edit instead.",
            "An earlier study found unlinking from the later page 'backwards'; #297's newer study supports the chains.",
        ],
        fn=item12,
    ),
    dict(
        key="14",
        title="14. Remove keyframe after Split at playhead",
        status="Changes Remove keyframe (#332)",
        today="Removing the split point deletes the first half. The second half keeps its start, so the marcher waits, then rushes.",
        problem="4 counts standing still, then the whole way in 4 counts at double speed. Almost never what someone removing a split meant.",
        proposed="When the next move starts on that exact count, join them back into one move: even speed, the original motion.",
        facts=[
            "Only applies when a move starts on the count you removed, which is almost always because you split there.",
            "Basic already does this: removing a point tick inside a page joins the moves.",
            "Every other Remove is unchanged.",
        ],
        fn=item14,
    ),
    dict(
        key="15",
        title="15. Remove keyframe's move on the next page",
        status="No new decision: settled by your yes to 13",
        today="Remove keyframe on Page 2 writes a move on Page 3 that keeps it where it was.",
        problem="If Page 2 is later dragged back onto that spot, Page 3's move goes nowhere: its diamond disappears, but it still stops Page 3 from following (#317, the 'invisible pin').",
        proposed="Every stored move end keeps its diamond, even when it doesn't move the marcher. Page 3 visibly has its own spot.",
        facts=[
            "Since commit 272f83526 these are ordinary moves (not kept spots), so Move them too can offer them. Consistent with #158.",
            "'Remove keyframe, Pages N–M follow back' is unchanged.",
        ],
        fn=item15,
    ),
    dict(
        key="16",
        title="16. Set to previous page",
        status="Unchanged; one optional new command",
        today="Set to previous page deletes the page's own spot, so it follows the earlier page again (dashed).",
        problem="None. #114 asked whether it should make a hold instead; it shouldn't.",
        proposed="Keep it as it is. Optionally add 'Hold from previous page' as a separate command that makes a Held hold. Dragging a bar end does the same, so the command isn't required.",
        facts=["Set to previous page never makes a hold.", "Held holds can be made by dragging bar ends even without the new command."],
        fn=item16,
    ),
    dict(
        key="17",
        title="17. Removing the keyframe where a Held hold begins",
        status="New rule (Held holds don't exist yet)",
        today="No Held holds today, so nothing to compare.",
        problem="If the hold stayed, it would be a solid 'decided' hold at a spot nobody picked.",
        proposed="The hold goes with the keyframe; the pages become unedited (dashed). Undo restores both.",
        facts=["The hold meant 'stand at this spot'; with the spot gone, so is the reason for the hold."],
        fn=item17,
    ),
]

sections = []
for it in ITEMS:
    svg = it["fn"]()
    key = it["key"]
    (OUT / f"q{key}.svg").write_text(svg)
    body = ""
    if "today" in it:
        body = (
            f'<p class=status>{html.escape(it["status"])}</p>'
            '<div class=cols>'
            f'<div class="box today"><b>Today</b><p>{html.escape(it["today"])}</p></div>'
            f'<div class="box problem"><b>Problem</b><p>{html.escape(it["problem"])}</p></div>'
            f'<div class="box proposed"><b>Proposed</b><p>{html.escape(it["proposed"])}</p></div>'
            "</div>"
        )
    facts = ""
    if it.get("facts"):
        facts = "<div class=facts><b>Key facts</b><ul>" + "".join(f"<li>{html.escape(f)}</li>" for f in it["facts"]) + "</ul></div>"
    sections.append(f'<section id="item-{key}"><h2>{html.escape(it["title"])}</h2>{body}{svg}{facts}</section>')

page = (
    "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>"
    "<title>Holds: the open questions</title>"
    "<style>body{font-family:system-ui,-apple-system,sans-serif;margin:24px;color:#1f2937;max-width:1140px}"
    "section{margin:0 0 28px;padding:16px;border:1px solid #e5e7eb;border-radius:10px;background:#fff}"
    "h2{margin:0 0 4px;font-size:20px}.status{margin:0 0 10px;color:#6b7280;font-size:13px}"
    ".cols{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px}"
    ".box{border-radius:8px;padding:8px 10px;font-size:14px}.box p{margin:4px 0 0}"
    ".today{background:#f1f5f9;border:1px solid #cbd5e1}.problem{background:#fef2f2;border:1px solid #fca5a5}"
    ".proposed{background:#ecfdf5;border:1px solid #6ee7b7}"
    ".facts{margin-top:10px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:8px 12px;font-size:14px}"
    ".facts ul{margin:4px 0 0;padding-left:20px}svg{max-width:100%;height:auto}</style>"
    "<h1>Holds: the open questions, drawn</h1>" + "".join(sections)
)
(OUT / "holds-questions.html").write_text(page)
print("ok")
