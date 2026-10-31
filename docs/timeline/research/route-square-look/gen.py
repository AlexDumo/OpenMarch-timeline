"""Mockups for docs/timeline/research/route-square-look: writes option-*.png here.

Run with `uv run --with pillow python gen.py`. Each image is one S -> P route on a field-green
panel and on a white panel, drawn at the app's sizes: a marcher has radius 5 field units, the
start-flag dot a third of that, a route square 4.5 units across, the route 1 screen px.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
SS = 4  # supersampling
UNIT = 3.2  # screen px per field unit
W, H = 380, 230

GREEN = (63, 125, 58)
WHITE = (255, 255, 255)
YARD_ON_GREEN = (225, 238, 222)
YARD_ON_WHITE = (221, 221, 221)
PATH = (128, 128, 128)
DOT = (0, 0, 0)
SELECTION = (13, 110, 253)
MARCHER = (255, 0, 0)
INK = (31, 41, 55)

# Field units. T: where the move it arrived by began; S: the start flag; then set spots to P.
TAIL_FROM = (12, 40)
S = (34, 22)
SET_SPOTS = [S, (62, 18), (84, 42)]  # S is set (a move ends there); 62,18 also holds
P = (100, 52)  # the playhead, partway through the move after 84,42
ROUTE = [S, (62, 18), (84, 42), P]


def px(p):
    return (20 + p[0] * UNIT) * SS, (20 + p[1] * UNIT) * SS


def mix(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def dashed(d, a, b, color, dash=(2, 4), width=1):
    (x0, y0), (x1, y1) = px(a), px(b)
    length = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5
    on, off = dash[0] * SS, dash[1] * SS
    t = 0.0
    while t < length:
        u0, u1 = t / length, min(t + on, length) / length
        d.line(
            [(x0 + (x1 - x0) * u0, y0 + (y1 - y0) * u0), (x0 + (x1 - x0) * u1, y0 + (y1 - y0) * u1)],
            fill=color,
            width=width * SS,
        )
        t += on + off


def square(d, p, outline, fill, size=4.5, rim=0.75):
    x, y = px(p)
    h = size * UNIT * SS / 2
    d.rectangle([x - h, y - h, x + h, y + h], fill=outline)
    i = h - rim * UNIT * SS
    if fill is not None:
        d.rectangle([x - i, y - i, x + i, y + i], fill=fill)


def diamond(d, p, outline, fill, size=5.0, rim=0.75):
    x, y = px(p)
    h = size * UNIT * SS / 2 * 1.2
    d.polygon([(x, y - h), (x + h, y), (x, y + h), (x - h, y)], fill=outline)
    i = h - rim * UNIT * SS * 1.41
    if fill is not None:
        d.polygon([(x, y - i), (x + i, y), (x, y + i), (x - i, y)], fill=fill)


def circle(d, p, r_units, fill, outline=None, width=0):
    x, y = px(p)
    r = r_units * UNIT * SS
    d.ellipse([x - r, y - r, x + r, y + r], fill=fill, outline=outline, width=width)


def panel(option, bg):
    img = Image.new("RGB", (W * SS, H * SS), bg)
    d = ImageDraw.Draw(img)
    yard = YARD_ON_GREEN if bg == GREEN else YARD_ON_WHITE
    for x in range(0, 120, 16):
        d.line([px((x, -6)), px((x, 64))], fill=yard, width=SS)

    style = OPTIONS[option]
    # Behind S: the move it arrived by, dotted and lighter
    dashed(d, TAIL_FROM, S, mix(PATH, bg, 0.5))
    # S -> P route
    for a, b in zip(ROUTE, ROUTE[1:]):
        d.line([px(a), px(b)], fill=PATH, width=SS)
    style["mark"](d, TAIL_FROM, bg, tail=True, current=False)
    for spot in SET_SPOTS:
        style["mark"](d, spot, bg, tail=False, current=False)
    # The start-flag dot over its square
    circle(d, S, 5 / 3, DOT)
    # The selected marcher at P, with its selection ring
    circle(d, P, 5, MARCHER)
    x, y = px(P)
    r = (5 * UNIT + 3) * SS
    d.ellipse([x - r, y - r, x + r, y + r], outline=SELECTION, width=2 * SS)

    font = ImageFont.load_default(size=11 * SS)
    label = INK if bg == WHITE else WHITE
    d.text(px((S[0] - 3, S[1] - 9)), "S", fill=label, font=font)
    d.text(px((P[0] + 7, P[1] - 3)), "P", fill=label, font=font)
    d.text((8 * SS, (H - 18) * SS), "field green" if bg == GREEN else "white", fill=label, font=font)
    return img.resize((W, H), Image.LANCZOS)


def neutral(d, p, bg, tail, current):
    outline = (89, 89, 89)
    if tail:
        outline = (184, 184, 184)
    square(d, p, outline, WHITE)


def diamond_ink(d, p, bg, tail, current):
    ink = mix(INK, bg, 0.55) if tail else INK
    diamond(d, p, WHITE, None)
    diamond(d, p, ink, ink, size=4.2, rim=0)


def selection_blue(d, p, bg, tail, current):
    outline = mix(SELECTION, WHITE, 0.55) if tail else SELECTION
    square(d, p, outline, WHITE)


OPTIONS = {
    "a-neutral-square": {"mark": neutral},
    "b-timeline-diamond": {"mark": diamond_ink},
    "c-selection-square": {"mark": selection_blue},
}


def lum(c):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4

    r, g, b = (ch(v) for v in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


if __name__ == "__main__":
    for name in OPTIONS:
        out = Image.new("RGB", (W * 2, H), WHITE)
        out.paste(panel(name, GREEN), (0, 0))
        out.paste(panel(name, WHITE), (W, 0))
        ImageDraw.Draw(out).line([(W, 0), (W, H)], fill=(200, 200, 200))
        out.save(HERE / f"option-{name}.png", optimize=True)
    for label, c in [
        ("neutral gray #595959", (89, 89, 89)),
        ("ink #1f2937", INK),
        ("selection blue #0d6efd", SELECTION),
        ("path gray #808080", PATH),
    ]:
        print(f"{label}: on white {contrast(c, WHITE):.1f}:1, on green {contrast(c, GREEN):.1f}:1")
