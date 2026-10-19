#!/usr/bin/env python3
"""Generates docs/sketchpad/design/mockups.html (static, self-contained)."""
import base64, math, random, sys

OUT = "/home/alex/GitHub/OpenMarch-sketch/docs/sketchpad/design/mockups.html"
FS = "/home/alex/GitHub/OpenMarch-t-core/node_modules/@fontsource"
VIRGIL = "/home/alex/GitHub/OpenMarch-sketch/prototypes/sketchpad/node_modules/@excalidraw/excalidraw/dist/prod/fonts/Virgil/Virgil-Regular.woff2"


def b64(p):
    with open(p, "rb") as f:
        return base64.b64encode(f.read()).decode()


FONTS = "".join(
    f"@font-face{{font-family:'{fam}';font-weight:{w};font-style:normal;font-display:block;src:url(data:font/woff2;base64,{b64(p)}) format('woff2');}}\n"
    for fam, w, p in [
        ("DM Sans", 400, f"{FS}/dm-sans/files/dm-sans-latin-400-normal.woff2"),
        ("DM Sans", 500, f"{FS}/dm-sans/files/dm-sans-latin-500-normal.woff2"),
        ("DM Sans", 600, f"{FS}/dm-sans/files/dm-sans-latin-600-normal.woff2"),
        ("DM Mono", 400, f"{FS}/dm-mono/files/dm-mono-latin-400-normal.woff2"),
        ("Virgil", 400, VIRGIL),
    ]
)

FW = 85.333  # field depth in steps (53 1/3 yd at 8-to-5)
HASH_F = 32.0  # college hashes, steps from the front sideline
HASH_B = FW - 32.0

# ----------------------------------------------------------------- geometry


def sy(Y):
    """Field Y (steps from the front sideline) to SVG y (0 = back sideline)."""
    return FW - Y


def f(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def smooth(pts, closed=False):
    """Catmull-Rom through screen points as cubic beziers."""
    if closed:
        p = [pts[-1]] + pts + [pts[0], pts[1]]
    else:
        p = [pts[0]] + pts + [pts[-1]]
    d = [f"M{f(p[1][0])},{f(p[1][1])}"]
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d.append(f"C{f(c1[0])},{f(c1[1])} {f(c2[0])},{f(c2[1])} {f(p2[0])},{f(p2[1])}")
    if closed:
        d.append("Z")
    return "".join(d)


def rough_poly(pts, rng, color, w=0.45, closed=False, r=0.28, passes=2, extra=""):
    """Rough.js-like double stroke along straight segments."""
    seq = pts + [pts[0]] if closed else pts
    out = []
    for _ in range(passes):
        j = lambda: rng.uniform(-r, r)
        x0, y0 = seq[0]
        d = [f"M{f(x0 + j())},{f(y0 + j())}"]
        for (ax, ay), (bx, by) in zip(seq, seq[1:]):
            mx, my = (ax + bx) / 2, (ay + by) / 2
            L = math.hypot(bx - ax, by - ay) or 1
            nx, ny = -(by - ay) / L, (bx - ax) / L
            o = rng.uniform(-r, r) * 1.6
            d.append(f"Q{f(mx + nx * o)},{f(my + ny * o)} {f(bx + j())},{f(by + j())}")
        out.append(
            f'<path d="{"".join(d)}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"{extra}/>'
        )
    return "".join(out)


def rough_ellipse(cx, cy, rx, ry, rng, color, w=0.45, passes=2, n=36):
    out = []
    for k in range(passes):
        a0 = rng.uniform(0, math.tau)
        pts = []
        over = 0.25 if k == 0 else 0.12
        for i in range(n + 1):
            a = a0 + (math.tau * (1 + over)) * i / n
            q = 1 + rng.uniform(-0.025, 0.025)
            pts.append((cx + rx * q * math.cos(a), cy + ry * q * math.sin(a)))
        out.append(
            f'<path d="{smooth(pts)}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="round"/>'
        )
    return "".join(out)


def in_poly(x, y, poly):
    c = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def even_dots(poly, n, seed=3, iters=40):
    """Evenly distributed dots in a polygon (Lloyd relaxation on samples)."""
    rng = random.Random(seed)
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    samples = []
    step = max(0.25, math.sqrt((max(xs) - min(xs)) * (max(ys) - min(ys)) / 2500))
    y = min(ys)
    while y < max(ys):
        x = min(xs)
        while x < max(xs):
            if in_poly(x, y, poly):
                samples.append((x, y))
            x += step
        y += step
    pts = rng.sample(samples, n)
    for _ in range(iters):
        acc = [[0, 0, 0] for _ in pts]
        for sx_, sy_ in samples:
            bi = min(range(n), key=lambda i: (pts[i][0] - sx_) ** 2 + (pts[i][1] - sy_) ** 2)
            a = acc[bi]
            a[0] += sx_
            a[1] += sy_
            a[2] += 1
        pts = [(a[0] / a[2], a[1] / a[2]) if a[2] else p for a, p in zip(acc, pts)]
    return pts


# --------------------------------------------------------------------- field

THEMES = {
    "paper": dict(bg="#ffffff", line="#000000", g4="#aaaaaa", g1="#e4e4e4", num="#888888", ez="#f6f6f8"),
    "cream": dict(bg="#fbf8f1", line="#4a4a55", g4="#c9c4b8", g1="#ebe6db", num="#a39d90", ez="#f4efe4"),
    "turf": dict(bg="#2f6e3e", line="#ffffff", g4="rgba(255,255,255,.28)", g1="rgba(255,255,255,.08)", num="rgba(255,255,255,.85)", ez="#2a6338"),
    "dark": dict(bg="#1d1c24", line="#8d8a98", g4="#3b3945", g1="#2a2932", num="#64616f", ez="#22212a"),
}


def field(theme="paper", grid=True, step_grid=False, numbers=True, hashes=True, lw=1.0):
    t = THEMES[theme]
    o = [f'<rect x="-96" y="0" width="192" height="{f(FW)}" fill="{t["bg"]}"/>']
    if theme == "turf":
        for k in range(12):
            if k % 2:
                o.append(f'<rect x="{-96 + 16 * k}" y="0" width="16" height="{f(FW)}" fill="rgba(0,0,0,.06)"/>')
    o.append(f'<rect x="-96" y="0" width="16" height="{f(FW)}" fill="{t["ez"]}"/>')
    o.append(f'<rect x="80" y="0" width="16" height="{f(FW)}" fill="{t["ez"]}"/>')
    if grid:
        if step_grid:
            for X in range(-96, 97):
                if X % 4:
                    o.append(f'<line x1="{X}" y1="0" x2="{X}" y2="{f(FW)}" stroke="{t["g1"]}" stroke-width="{0.1 * lw}"/>')
            for Y in range(1, 86):
                if Y % 4:
                    o.append(f'<line x1="-96" y1="{f(sy(Y))}" x2="96" y2="{f(sy(Y))}" stroke="{t["g1"]}" stroke-width="{0.1 * lw}"/>')
        for X in range(-96, 97, 4):
            if X % 8 or abs(X) > 80:
                o.append(f'<line x1="{X}" y1="0" x2="{X}" y2="{f(FW)}" stroke="{t["g4"]}" stroke-width="{0.12 * lw}"/>')
        for Y in range(4, 86, 4):
            o.append(f'<line x1="-96" y1="{f(sy(Y))}" x2="96" y2="{f(sy(Y))}" stroke="{t["g4"]}" stroke-width="{0.12 * lw}"/>')
    for X in range(-80, 81, 8):
        sw = 0.42 if abs(X) == 80 else 0.26
        o.append(f'<line x1="{X}" y1="0" x2="{X}" y2="{f(FW)}" stroke="{t["line"]}" stroke-width="{sw * lw}"/>')
    if hashes:
        for k in range(0, 101):
            X = -80 + 1.6 * k
            for Yh in (HASH_F, HASH_B):
                if k % 5 == 0:
                    o.append(f'<line x1="{f(X - 0.9)}" y1="{f(sy(Yh))}" x2="{f(X + 0.9)}" y2="{f(sy(Yh))}" stroke="{t["line"]}" stroke-width="{0.3 * lw}"/>')
                else:
                    o.append(f'<line x1="{f(X)}" y1="{f(sy(Yh) - 0.5)}" x2="{f(X)}" y2="{f(sy(Yh) + 0.5)}" stroke="{t["line"]}" stroke-width="{0.16 * lw}"/>')
            if k % 5:
                o.append(f'<line x1="{f(X)}" y1="0.3" x2="{f(X)}" y2="1.2" stroke="{t["line"]}" stroke-width="{0.16 * lw}"/>')
                o.append(f'<line x1="{f(X)}" y1="{f(FW - 1.2)}" x2="{f(X)}" y2="{f(FW - 0.3)}" stroke="{t["line"]}" stroke-width="{0.16 * lw}"/>')
    o.append(f'<rect x="-96" y="0" width="192" height="{f(FW)}" fill="none" stroke="{t["line"]}" stroke-width="{0.5 * lw}"/>')
    if numbers:
        for yd in range(10, 100, 10):
            n = yd if yd <= 50 else 100 - yd
            X = -80 + 1.6 * yd
            a, b = str(n)[0], "0"
            for Y, rot in ((19.2, 0), (FW - 19.2, 180)):
                cy = sy(Y)
                g = f'<g transform="rotate({rot} {f(X)} {f(cy)})" fill="{t["num"]}" font-family="DM Sans" font-weight="600" font-size="4.4">'
                g += f'<text x="{f(X - 0.7)}" y="{f(cy + 1.6)}" text-anchor="end">{a}</text>'
                g += f'<text x="{f(X + 0.7)}" y="{f(cy + 1.6)}" text-anchor="start">{b}</text>'
                if n != 50:
                    dirx = -1 if yd < 50 else 1
                    tx = X + dirx * 4.6
                    g += f'<path d="M{f(tx)},{f(cy - 0.9)} L{f(tx + dirx * 1.3)},{f(cy)} L{f(tx)},{f(cy + 0.9)}Z"/>'
                g += "</g>"
                o.append(g)
    return "".join(o)


def field_svg(content, theme="paper", vb=(-104, -7, 208, FW + 14), cls="", style="", grid=True, step_grid=False, numbers=True, hashes=True, lw=1.0, defs=""):
    x, y, w, h = vb
    return (
        f'<svg class="{cls}" style="{style}" viewBox="{f(x)} {f(y)} {f(w)} {f(h)}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">'
        f"<defs>{defs}</defs>{field(theme, grid, step_grid, numbers, hashes, lw)}{content}</svg>"
    )


# ------------------------------------------------------------ sketch content

INK = "#1e1e24"
VIOLET = "#7c5cff"
RED = "#e03131"
BLUE = "#1c7ed6"
GREEN = "#2f9e44"
ORANGE = "#f08c00"


def dot(x, y, r=0.42, c=INK):
    return f'<circle cx="{f(x)}" cy="{f(y)}" r="{r}" fill="{c}"/>'


def badge(x, y, text, c=VIOLET, size=2.0):
    w = len(text) * size * 0.56 + 2.0
    return (
        f'<g><rect x="{f(x)}" y="{f(y - size * 0.8)}" width="{f(w)}" height="{f(size * 1.6)}" rx="{f(size * 0.8)}" fill="{c}"/>'
        f'<text x="{f(x + w / 2)}" y="{f(y + size * 0.36)}" text-anchor="middle" font-family="DM Sans" font-weight="600" font-size="{size}" fill="#fff">{text}</text></g>'
    )


def hand(x, y, text, size=2.6, c=INK, anchor="start", rot=0):
    return f'<text x="{f(x)}" y="{f(y)}" font-family="Virgil" font-size="{size}" fill="{c}" text-anchor="{anchor}" transform="rotate({rot} {f(x)} {f(y)})">{text}</text>'


# Block: 16 x 12 steps, right edge on the S1 35, front edge 18 steps from FSL
BLOCK = (-48, 36, -32, 48)  # X1, Y1, X2, Y2


def block_dots():
    X1, Y1, X2, Y2 = BLOCK
    return [(X1 + 1 + 2 * i, Y1 + 1 + 2 * j) for i in range(8) for j in range(6)]


def arc_pts(n=12):
    cx, cy, r = 0.0, 84.0, 40.0  # field coords; arc bows toward the front
    a1, a2 = math.radians(235), math.radians(305)
    return [(cx + r * math.cos(a1 + (a2 - a1) * i / (n - 1)), cy + r * math.sin(a1 + (a2 - a1) * i / (n - 1))) for i in range(n)]


def arc_path_pts(m=30):
    cx, cy, r = 0.0, 84.0, 40.0
    a1, a2 = math.radians(232), math.radians(308)
    return [(cx + r * math.cos(a1 + (a2 - a1) * i / (m - 1)), sy(cy + r * math.sin(a1 + (a2 - a1) * i / (m - 1)))) for i in range(m)]


CIRCLE = (34.0, 42.0, 8.0)


def stagger_dots():
    cx, cy, r = CIRCLE
    out = []
    for j, Y in enumerate(range(int(cy - r), int(cy + r) + 1, 2)):
        off = 1 if j % 2 else 0
        X = cx - r - 2 + off
        while X <= cx + r + 2:
            if (X - cx) ** 2 + (Y - cy) ** 2 <= (r - 0.9) ** 2:
                out.append((X, Y))
            X += 2
    return out


WEDGE = [(52.0, 46.0), (70.0, 54.0), (70.0, 38.0)]  # field coords, point toward S1
DIAMOND = [(40.0, 3.0), (47.0, 9.0), (40.0, 15.0), (33.0, 9.0)]
GUARD = (-18.0, 70.0, 18.0, 82.0)


def sketch(selected=True, overlay=False, guides=True, rng_seed=7, print_look=False):
    p = "P" if print_look else ""
    """The 'Opener arc' sketch, drawn in SVG step units."""
    rng = random.Random(rng_seed)
    ink = INK
    o = []
    hatch = "#9b7bff" if not print_look else "#555"
    # guard area: cross lines
    X1, Y1, X2, Y2 = GUARD
    gpoly = [(X1, sy(Y1)), (X2, sy(Y1)), (X2, sy(Y2)), (X1, sy(Y2))]
    o.append(f'<g clip-path="url(#clipGuard{p})"><rect x="{X1}" y="{f(sy(Y2))}" width="{X2 - X1}" height="{Y2 - Y1}" fill="url(#cross{p})"/></g>')
    if not overlay:
        o.append(rough_poly(gpoly, rng, GREEN if not print_look else ink, closed=True))
        o.append(hand(X1 + 1.2, sy(Y2) + 3.2, "guard flags", 2.4, GREEN if not print_look else ink))
    # wedge: lines
    wp = [(x, sy(y)) for x, y in WEDGE]
    o.append(f'<g clip-path="url(#clipWedge{p})"><rect x="45" y="{f(sy(60))}" width="30" height="25" fill="url(#hatch{p})"/></g>')
    o.append(rough_poly(wp, rng, BLUE if not print_look else ink, closed=True))
    # circle: staggered dots
    cx, cy, r = CIRCLE
    if not overlay:
        o.append(rough_ellipse(cx, sy(cy), r, r, rng, ORANGE if not print_look else ink))
    for x, y in stagger_dots():
        o.append(dot(x, sy(y), 0.42, ORANGE if not print_look else ink))
    # diamond: even dots
    dp = [(x, sy(y)) for x, y in DIAMOND]
    if not overlay:
        o.append(rough_poly(dp, rng, RED if not print_look else ink, closed=True))
    for x, y in even_dots(dp, 14):
        o.append(dot(x, y, 0.42, RED if not print_look else ink))
    # block: dots, 2-step interval
    X1, Y1, X2, Y2 = BLOCK
    bp = [(X1, sy(Y1)), (X2, sy(Y1)), (X2, sy(Y2)), (X1, sy(Y2))]
    if not overlay:
        o.append(rough_poly(bp, rng, ink, closed=True))
    for x, y in block_dots():
        o.append(dot(x, sy(y)))
    # arc: "dots along" 12
    if not overlay:
        o.append(rough_poly(arc_path_pts(), rng, VIOLET if not print_look else ink, r=0.12, w=0.4))
    for x, y in arc_pts():
        o.append(dot(x, sy(y), 0.5, VIOLET if not print_look else ink))
    # arrow: block -> arc
    ap = [(-40, sy(49.6)), (-34, sy(55.2)), (-25.6, sy(53.0))]
    o.append(f'<path d="{smooth(ap)}" fill="none" stroke="{ink}" stroke-width="0.45" stroke-linecap="round"/>')
    ex, ey = ap[-1]
    ang = math.atan2(ey - ap[-2][1], ex - ap[-2][0])
    for da in (2.6, -2.6):
        o.append(f'<line x1="{f(ex)}" y1="{f(ey)}" x2="{f(ex - 2.2 * math.cos(ang + da / 6))}" y2="{f(ey - 2.2 * math.sin(ang + da / 6))}" stroke="{ink}" stroke-width="0.45" stroke-linecap="round"/>')
    if not overlay:
        o.append(hand(-50, sy(60.2), "push to arc, 16 cts", 2.4, ink, rot=-4))
        # freehand: excited loop around the arc's middle + "BIG"
        fr = random.Random(4)
        pts = []
        for i in range(30):
            a = math.radians(-20 + i * 13.5)
            rr = 1 + fr.uniform(-0.05, 0.05)
            pts.append((0 + 8 * rr * math.cos(a), sy(44.2) + 3.4 * rr * math.sin(a)))
        o.append(f'<path d="{smooth(pts)}" fill="none" stroke="{RED if not print_look else ink}" stroke-width="0.5" stroke-linecap="round"/>')
        o.append(hand(8.6, sy(48.6), "BIG!", 3.0, RED if not print_look else ink, rot=-6))
        # mirror note
        o.append(hand(61, sy(58), "mirror of S1 box?", 2.2, BLUE if not print_look else ink, "middle"))
        # sticky note
        if not print_look:
            sx0, sy0 = 70.5, -5.2
            o.append(
                f'<g transform="rotate(-3 {sx0} {sy0})"><rect x="{sx0 + 0.5}" y="{sy0 + 0.6}" width="23" height="18" fill="rgba(0,0,0,.18)" rx="0.6"/>'
                f'<rect x="{sx0}" y="{sy0}" width="23" height="18" fill="#ffe783" rx="0.6"/>'
                f'{hand(sx0 + 1.6, sy0 + 4.2, "m. 24: brass hit,", 2.1, "#5b4a00")}'
                f'{hand(sx0 + 1.6, sy0 + 7.4, "open the arc", 2.1, "#5b4a00")}'
                f'{hand(sx0 + 1.6, sy0 + 10.6, "toward the box.", 2.1, "#5b4a00")}'
                f'{hand(sx0 + 1.6, sy0 + 14.6, "ask Dana re: guard", 1.8, "#8a7300")}</g>'
            )
    if selected and not overlay:
        X1, Y1, X2, Y2 = BLOCK
        x, y, w, h = X1 - 1, sy(Y2) - 1, X2 - X1 + 2, Y2 - Y1 + 2
        o.append(f'<rect x="{x}" y="{f(y)}" width="{w}" height="{h}" fill="none" stroke="{VIOLET}" stroke-width="0.22"/>')
        for hx in (x, x + w / 2, x + w):
            for hy in (y, y + h / 2, y + h):
                if hx == x + w / 2 and hy == y + h / 2:
                    continue
                o.append(f'<rect x="{f(hx - 0.7)}" y="{f(hy - 0.7)}" width="1.4" height="1.4" fill="#fff" stroke="{VIOLET}" stroke-width="0.2" rx="0.25"/>')
        o.append(f'<circle cx="{f(x + w / 2)}" cy="{f(y - 2.6)}" r="0.75" fill="#fff" stroke="{VIOLET}" stroke-width="0.2"/>')
        o.append(badge(x + w + 1.4, y + h - 1.2, "48 dots"))
    if guides and not overlay:
        # snap guide on the S1 35 + label
        o.append(f'<line x1="-32" y1="-3" x2="-32" y2="{f(FW + 3)}" stroke="{VIOLET}" stroke-width="0.2" stroke-dasharray="1 0.7"/>')
        o.append(badge(-31.2, -3.4, "S1 30 yd line", VIOLET, 1.8))
        # measure: front edge of block to front sideline
        mx = -51.5
        o.append(f'<g stroke="{VIOLET}" stroke-width="0.2"><line x1="{mx}" y1="{f(sy(36))}" x2="{mx}" y2="{f(sy(32))}"/>'
                 f'<line x1="{mx - 0.9}" y1="{f(sy(36))}" x2="{mx + 0.9}" y2="{f(sy(36))}"/><line x1="{mx - 0.9}" y1="{f(sy(32))}" x2="{mx + 0.9}" y2="{f(sy(32))}"/></g>')
        o.append(badge(mx - 22.5, sy(34) , "4 steps · front hash", VIOLET, 1.7))
    return "".join(o)


def sketch_defs(print_look=False, overlay=False):
    p = "P" if print_look else ""
    cc = "#2f9e44" if not print_look else "#444"
    X1, Y1, X2, Y2 = GUARD
    wp = " ".join(f"{f(x)},{f(sy(y))}" for x, y in WEDGE)
    return (
        f'<pattern id="hatch{p}" width="1.4" height="1.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1.4" stroke="{BLUE if not print_look else "#444"}" stroke-width="0.22"/></pattern>'
        f'<pattern id="cross{p}" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0,0 V1.6 M0,0 H1.6" stroke="{cc}" stroke-width="0.18" opacity=".8"/></pattern>'
        f'<clipPath id="clipGuard{p}"><rect x="{X1}" y="{f(sy(Y2))}" width="{X2 - X1}" height="{Y2 - Y1}"/></clipPath>'
        f'<clipPath id="clipWedge{p}"><polygon points="{wp}"/></clipPath>'
    )


# --------------------------------------------------------------------- icons

ICONS = {
    "lock": '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    "lockopen": '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.6-1.7"/>',
    "hand": '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6 7-2.6 0-4-1.3-5.4-3.4L3.9 13.8a1.5 1.5 0 0 1 2.4-1.8L8 14"/>',
    "cursor": '<path d="M5 3.5l13 7.2-5.8 1.6-2.6 5.6z"/>',
    "rect": '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
    "diamond": '<path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z"/>',
    "ellipse": '<circle cx="12" cy="12" r="8"/>',
    "arrow": '<path d="M5 19L19 5M10 5h9v9"/>',
    "line": '<path d="M4 18L9 9l6 6 5-9"/>',
    "pen": '<path d="M4 20l1-4L16 5l3 3L8 19z M14 7l3 3"/>',
    "text": '<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6"/>',
    "sticky": '<path d="M4 4h16v10l-6 6H4z M14 20v-6h6"/>',
    "image": '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5 5 4"/>',
    "eraser": '<path d="M8.5 19.5h11M4.5 15l9-9.5a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L12 19.5H8.5z M9 10l5.5 5.5"/>',
    "ruler": '<path d="M3.5 15.5L15.5 3.5l5 5-12 12z M7 12l2 2M10 9l1.5 1.5M13 6l2 2M8.5 13.5"/>',
    "stamps": '<circle cx="6" cy="6" r="1.4"/><circle cx="12" cy="6" r="1.4"/><circle cx="18" cy="6" r="1.4"/><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/><circle cx="6" cy="18" r="1.4"/><circle cx="12" cy="18" r="1.4"/><circle cx="18" cy="18" r="1.4"/>',
    "menu": '<path d="M4 7h16M4 12h16M4 17h16"/>',
    "eye": '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    "eyeoff": '<path d="M4 4l16 16M9.9 6A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.3M6.5 7.6A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-1"/>',
    "export": '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
    "field": '<rect x="3" y="6" width="18" height="12" rx="1"/><path d="M7.5 6v12M12 6v12M16.5 6v12"/>',
    "undo": '<path d="M8 8H15a5 5 0 0 1 0 10h-4M8 8l3.5-3.5M8 8l3.5 3.5"/>',
    "redo": '<path d="M16 8H9a5 5 0 0 0 0 10h4M16 8l-3.5-3.5M16 8l-3.5 3.5"/>',
    "minus": '<path d="M5 12h14"/>',
    "plus": '<path d="M12 5v14M5 12h14"/>',
    "chev": '<path d="M7 10l5 5 5-5"/>',
    "mirror": '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 7L3.5 17H9zM15 7l5.5 10H15z"/>',
    "magnet": '<path d="M6 4h4v8a2 2 0 0 0 4 0V4h4v8a6 6 0 0 1-12 0z M6 8h4M14 8h4"/>',
    "dots3": '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
    "x": '<path d="M6 6l12 12M18 6L6 18"/>',
    "sketches": '<path d="M4 20l1-4L15.5 5.5l3 3L8 19z"/><path d="M13 20h7" />',
    "users": '<circle cx="9" cy="9" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="16.5" cy="8" r="2.4"/><path d="M15.5 13.6A4.6 4.6 0 0 1 21 18"/>',
    "music": '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    "metronome": '<path d="M9 3.5h6l4 17H5z M12 16l5-9"/>',
    "palette": '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.5 0 2-1 1.4-2.2-.7-1.4.2-2.8 1.8-2.8H18a2.5 2.5 0 0 0 2.5-2.5c0-5.5-3.8-9.5-8.5-9.5z"/><circle cx="8" cy="11" r="1"/><circle cx="11" cy="7.5" r="1"/><circle cx="15.5" cy="8.5" r="1"/>',
    "books": '<rect x="4" y="4" width="4.5" height="16" rx="1"/><rect x="9.5" y="4" width="4.5" height="16" rx="1"/><path d="M15.5 5.2l3.8-.9 2.7 15.3-3.8.9z"/>',
    "phone": '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
    "gear": '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    "copy": '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
    "trash": '<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13M10 10.5v6M14 10.5v6"/>',
    "layers": '<path d="M12 4l9 4.5-9 4.5-9-4.5z M3 12.5l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5"/>',
    "group": '<rect x="3.5" y="3.5" width="17" height="17" rx="2" stroke-dasharray="3 2"/><rect x="7" y="7" width="5" height="5"/><rect x="12" y="12" width="5" height="5"/>',
    "play": '<path d="M7 5l12 7-12 7z"/>',
    "skipb": '<path d="M18 5L8 12l10 7zM6 5v14"/>',
    "skipf": '<path d="M6 5l10 7-10 7zM18 5v14"/>',
    "search": '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    "check": '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    "file": '<path d="M6 3.5h8l4.5 4.5v12.5H6z M14 3.5V8h4.5"/>',
    "clip": '<rect x="6" y="4.5" width="12" height="16" rx="2"/><path d="M9.5 4.5V3.5h5v1"/>',
    "warn": '<path d="M12 4l9 16H3z M12 10v4.5M12 17v.5"/>',
    "info": '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.4"/>',
    "folder": '<path d="M3.5 6.5h6l2 2h9v11h-17z"/>',
    "star": '<path d="M12 4l2.4 5 5.5.7-4 3.8 1 5.4L12 16.3 7.1 18.9l1-5.4-4-3.8 5.5-.7z"/>',
}


def icon(name, size=18, sw=1.7, cls="", extra=""):
    filled = name in ("dots3", "stamps", "play", "skipb", "skipf")
    fillattr = 'fill="currentColor" stroke="none"' if filled else 'fill="none" stroke="currentColor"'
    if name in ("skipb", "skipf"):
        fillattr = 'fill="currentColor" stroke="currentColor"'
    return (
        f'<svg class="ic {cls}" width="{size}" height="{size}" viewBox="0 0 24 24" {fillattr} stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"{extra}>{ICONS[name]}</svg>'
    )


# Fill pattern icons for the properties panel
def fill_icon(kind):
    base = '<rect x="3.5" y="3.5" width="17" height="17" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/>'
    inner = ""
    if kind == "none":
        inner = '<path d="M6 18L18 6" stroke="currentColor" stroke-width="1.3" opacity=".55"/>'
    elif kind == "solid":
        inner = '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" opacity=".9"/>'
    elif kind == "lines":
        inner = "".join(f'<path d="M{6 + k * 3} 18 L{min(18, 6 + k * 3 + 12)} {max(6, 18 - 12)}" stroke="currentColor" stroke-width="1.1"/>' for k in range(-3, 4))
        inner = f'<g clip-path="url(#fiClip)">{inner}</g>'
    elif kind == "cross":
        a = "".join(f'<path d="M{k} 18 L{k + 12} 6" stroke="currentColor" stroke-width="1"/>' for k in range(-6, 18, 3))
        b = "".join(f'<path d="M{k} 6 L{k + 12} 18" stroke="currentColor" stroke-width="1"/>' for k in range(-6, 18, 3))
        inner = f'<g clip-path="url(#fiClip)">{a}{b}</g>'
    elif kind == "dots":
        inner = "".join(f'<circle cx="{x}" cy="{y}" r="1.1" fill="currentColor"/>' for x in (8, 12, 16) for y in (8, 12, 16))
    elif kind == "stagger":
        inner = "".join(f'<circle cx="{x}" cy="{y}" r="1.1" fill="currentColor"/>' for x, y in [(7.5, 8), (12, 8), (16.5, 8), (9.75, 12), (14.25, 12), (7.5, 16), (12, 16), (16.5, 16)])
    elif kind == "even":
        inner = "".join(f'<circle cx="{x}" cy="{y}" r="1.1" fill="currentColor"/>' for x, y in [(8.2, 7.8), (14.6, 7.2), (11.4, 11.6), (17, 12.4), (7.2, 13.6), (10.8, 16.8), (16, 17)])
    return f'<svg class="ic" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><defs><clipPath id="fiClip"><rect x="5" y="5" width="14" height="14"/></clipPath></defs>{base}{inner}</svg>'


# --------------------------------------------------------------------- CSS

CSS = FONTS + r"""
:root{
  color-scheme: dark;
  --bg-1: rgb(15,14,19);
  --bg-page: rgb(10,9,13);
  --fg-1: rgba(255,255,255,.035);
  --fg-2: rgba(255,255,255,.06);
  --stroke: rgba(255,255,255,.07);
  --stroke-strong: rgba(255,255,255,.13);
  --text: rgb(208,208,208);
  --text-sub: rgba(208,208,208,.6);
  --text-dis: rgba(208,208,208,.32);
  --accent: rgb(150,126,255);
  --accent-soft: rgba(150,126,255,.16);
  --accent-text: #fff;
  --modal: rgba(21,20,26,.95);
  --modal-shadow: rgba(0,0,0,.5);
  --overlay: rgba(0,0,0,.45);
  --canvas: rgb(22,21,28);
  --red: rgb(227,74,74);
  --yellow: rgb(236,211,71);
  --green: rgb(113,222,86);
  --thumb-bg: rgb(28,27,34);
}
@media (prefers-color-scheme: light){
  :root:not([data-theme="dark"]){
    color-scheme: light;
    --bg-1: rgb(236,235,240);
    --bg-page: rgb(222,221,228);
    --fg-1: rgba(0,0,0,.02);
    --fg-2: rgba(0,0,0,.045);
    --stroke: rgba(0,0,0,.1);
    --stroke-strong: rgba(0,0,0,.16);
    --text: rgb(32,32,32);
    --text-sub: rgba(32,32,32,.6);
    --text-dis: rgba(32,32,32,.3);
    --accent: rgb(100,66,255);
    --accent-soft: rgba(100,66,255,.12);
    --modal: rgba(250,249,251,.96);
    --modal-shadow: rgba(0,0,0,.15);
    --overlay: rgba(255,255,255,.45);
    --canvas: rgb(228,227,233);
    --red: rgb(176,51,51);
    --yellow: rgb(200,170,0);
    --green: rgb(72,158,51);
    --thumb-bg: rgb(244,243,247);
  }
}
:root[data-theme="light"]{
    color-scheme: light;
    --bg-1: rgb(236,235,240);
    --bg-page: rgb(222,221,228);
    --fg-1: rgba(0,0,0,.02);
    --fg-2: rgba(0,0,0,.045);
    --stroke: rgba(0,0,0,.1);
    --stroke-strong: rgba(0,0,0,.16);
    --text: rgb(32,32,32);
    --text-sub: rgba(32,32,32,.6);
    --text-dis: rgba(32,32,32,.3);
    --accent: rgb(100,66,255);
    --accent-soft: rgba(100,66,255,.12);
    --modal: rgba(250,249,251,.96);
    --modal-shadow: rgba(0,0,0,.15);
    --overlay: rgba(255,255,255,.45);
    --canvas: rgb(228,227,233);
    --red: rgb(176,51,51);
    --yellow: rgb(200,170,0);
    --green: rgb(72,158,51);
    --thumb-bg: rgb(244,243,247);
}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--bg-page);color:var(--text);font-family:"DM Sans",ui-sans-serif,system-ui,sans-serif;font-size:14px;line-height:1.35;-webkit-font-smoothing:antialiased}
.mono{font-family:"DM Mono",ui-monospace,monospace}
.page-head{max-width:1340px;margin:0 auto;padding:40px 16px 8px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap}
.page-head h1{font-size:28px;margin:0;font-weight:600;letter-spacing:-.01em}
.page-head p{margin:6px 0 0;color:var(--text-sub);max-width:760px}
.theme-btn{border:1px solid var(--stroke-strong);background:var(--fg-2);color:var(--text);border-radius:6px;padding:7px 12px;font:inherit;cursor:pointer}
.frame-wrap{max-width:1340px;margin:0 auto;padding:28px 16px 12px}
.frame-label{display:flex;gap:10px;align-items:baseline;margin:0 0 12px}
.frame-label b{font-size:16px;font-weight:600}
.frame-label span{color:var(--text-sub)}
.frame-label .tag{font-size:11px;padding:2px 7px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-weight:600}
.scroller{overflow-x:auto}
.frame{width:1300px;height:820px;position:relative;border-radius:12px;overflow:hidden;background:var(--bg-1);border:1px solid var(--stroke-strong);box-shadow:0 30px 80px -30px rgba(0,0,0,.6)}
.notes{max-width:1300px;color:var(--text-sub);font-size:13px;margin:10px 0 0;padding-left:18px}
.notes li{margin:3px 0}
/* window chrome */
.titlebar{height:38px;display:flex;align-items:center;gap:12px;padding:0 12px;border-bottom:1px solid var(--stroke);font-size:13px}
.lights{display:flex;gap:7px}
.lights i{width:12px;height:12px;border-radius:50%;display:block;background:#ff5f57}
.lights i:nth-child(2){background:#febc2e}.lights i:nth-child(3){background:#28c840}
.titlebar .title{position:absolute;left:0;right:0;text-align:center;pointer-events:none;color:var(--text-sub)}
.titlebar .title b{color:var(--text);font-weight:500}
.tb-btns{display:flex;gap:2px;margin-left:8px;color:var(--text-sub)}
.tb-btns span{padding:5px;border-radius:4px;display:flex}
/* generic panel */
.panel{background:var(--modal);border:1px solid var(--stroke);border-radius:6px;box-shadow:0 10px 64px 0 var(--modal-shadow);backdrop-filter:blur(32px)}
.ic{display:block;flex:none}
.btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border-radius:6px;border:1px solid var(--stroke);background:var(--fg-2);color:var(--text);font:inherit;font-size:13px;font-weight:500;white-space:nowrap}
.btn.primary{background:var(--accent);border-color:transparent;color:#fff;box-shadow:inset 0 4px 17px rgba(255,255,255,.12),inset 0 -4px 11px -3px rgba(0,0,0,.22)}
.btn.ghost{background:transparent;border-color:transparent}
.btn.sm{height:26px;padding:0 9px;font-size:12px}
.icbtn{width:32px;height:32px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;color:var(--text);flex:none}
.icbtn.on{background:var(--accent-soft);color:var(--accent)}
.icbtn.sm{width:26px;height:26px}
.sep{width:1px;align-self:stretch;background:var(--stroke-strong);margin:4px 3px}
.kbd{font-family:"DM Mono",monospace;font-size:9px;color:var(--text-dis);position:absolute;right:3px;bottom:1px}
.lbl{font-size:11px;color:var(--text-sub);font-weight:500;margin:0 0 6px;letter-spacing:.01em}
.row{display:flex;gap:4px;align-items:center}
.seg{display:flex;gap:2px;padding:2px;border-radius:6px;background:var(--fg-2);border:1px solid var(--stroke)}
.seg span{flex:1;text-align:center;padding:4px 8px;border-radius:4px;font-size:12px;color:var(--text-sub);display:flex;align-items:center;justify-content:center;gap:5px;white-space:nowrap}
.seg span.on{background:var(--accent-soft);color:var(--accent);font-weight:600}
.sw{width:22px;height:22px;border-radius:5px;border:1px solid var(--stroke-strong);flex:none;position:relative}
.sw.on{outline:2px solid var(--accent);outline-offset:1px}
.sw.none{background:linear-gradient(135deg,transparent 45%,var(--red) 45%,var(--red) 55%,transparent 55%)}
.tg{width:32px;height:30px;border-radius:5px;display:flex;align-items:center;justify-content:center;color:var(--text-sub);background:var(--fg-1);border:1px solid var(--stroke)}
.tg.on{background:var(--accent-soft);color:var(--accent);border-color:transparent}
.input{height:28px;border-radius:6px;border:1px solid var(--stroke);background:var(--fg-2);display:flex;align-items:center;padding:0 8px;font-size:12.5px;gap:6px}
.input .u{color:var(--text-sub);margin-left:auto}
.switch{width:28px;height:16px;border-radius:99px;background:var(--stroke-strong);position:relative;flex:none}
.switch::after{content:"";position:absolute;width:12px;height:12px;border-radius:50%;background:#fff;top:2px;left:2px}
.switch.on{background:var(--accent)}.switch.on::after{left:14px}
.slider{height:4px;border-radius:9px;background:var(--stroke-strong);position:relative;flex:1}
.slider b{position:absolute;left:0;top:0;bottom:0;border-radius:9px;background:var(--accent)}
.slider i{position:absolute;top:50%;width:14px;height:14px;border-radius:50%;background:#fff;transform:translate(-50%,-50%);box-shadow:0 1px 4px rgba(0,0,0,.4)}
.chip{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:99px;font-size:12px;background:var(--fg-2);border:1px solid var(--stroke)}
.dim{color:var(--text-sub)}
.hr{height:1px;background:var(--stroke);margin:10px 0}
/* ---------- frame A: main editor ---------- */
.ed-body{position:absolute;top:38px;left:0;right:0;bottom:0;padding:0 8px 8px;display:flex;flex-direction:column;gap:8px}
.ed-toolbar{height:40px;display:flex;align-items:center;gap:4px;padding:0 6px;border:1px solid var(--stroke);border-radius:6px;background:var(--fg-1)}
.ed-toolbar .tab{padding:5px 10px;border-radius:4px;font-size:13px;color:var(--text-sub)}
.ed-toolbar .tab.on{color:var(--text);background:var(--fg-2)}
.ed-main{flex:1;display:flex;gap:8px;min-height:0}
.ed-center{flex:1;display:flex;flex-direction:column;gap:8px;min-width:0}
.ed-fieldrow{flex:1;display:flex;gap:8px;min-height:0;position:relative}
.sidebar{width:50px;border:1px solid var(--stroke);border-radius:6px;background:var(--fg-1);display:flex;flex-direction:column;justify-content:space-between;align-items:center;padding:14px 0}
.sidebar .grp{display:flex;flex-direction:column;gap:16px;align-items:center;color:var(--text)}
.sidebar .on{color:var(--accent)}
.sidebar .new{position:relative}
.sidebar .new::after{content:"";position:absolute;right:-3px;top:-2px;width:6px;height:6px;border-radius:50%;background:var(--accent)}
.fieldview{flex:1;border-radius:6px;background:var(--canvas);position:relative;overflow:hidden;border:1px solid var(--stroke)}
.fieldview svg.fieldsvg{position:absolute;inset:0;width:100%;height:100%}
.inspector{width:250px;border:1px solid var(--stroke);border-radius:6px;background:var(--fg-1);padding:14px;font-size:13px}
.inspector h4{margin:0 0 2px;font-size:15px;font-weight:600}
.timeline{height:118px;border:1px solid var(--stroke);border-radius:6px;background:var(--fg-1);position:relative;overflow:hidden}
.sk-panel{position:absolute;top:0;left:58px;bottom:0;width:318px;padding:12px;display:flex;flex-direction:column;gap:10px;z-index:4}
.sk-head{display:flex;align-items:center;gap:8px}
.sk-head h3{margin:0;font-size:17px;font-weight:600;flex:1}
.sk-search{display:flex;align-items:center;gap:6px;height:30px;border-radius:6px;border:1px solid var(--stroke);background:var(--fg-2);padding:0 9px;color:var(--text-sub);font-size:12.5px}
.sk-list{display:flex;flex-direction:column;gap:6px;overflow:hidden}
.sk-card{display:flex;gap:10px;padding:7px;border-radius:8px;border:1px solid transparent;align-items:center}
.sk-card.sel{background:var(--accent-soft);border-color:rgba(150,126,255,.35)}
.sk-card:hover{background:var(--fg-2)}
.thumb{width:92px;height:50px;border-radius:5px;overflow:hidden;flex:none;border:1px solid var(--stroke);background:#fff}
.thumb svg{width:100%;height:100%;display:block}
.sk-meta{flex:1;min-width:0}
.sk-meta b{display:block;font-weight:500;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sk-meta span{font-size:11.5px;color:var(--text-sub)}
.ov{margin-top:auto;border-top:1px solid var(--stroke);padding-top:10px;display:flex;flex-direction:column;gap:9px}
.ov-row{display:flex;align-items:center;gap:8px;font-size:12.5px}
.ov-row > .k{width:62px;color:var(--text-sub);flex:none}
.ov-chip{position:absolute;left:12px;bottom:12px;display:flex;align-items:center;gap:8px;padding:5px 6px 5px 10px;font-size:12.5px}
/* ---------- frame B: sketchpad ---------- */
.sp-canvas{position:absolute;top:38px;left:0;right:0;bottom:0;background:var(--canvas);overflow:hidden}
.sp-canvas > svg.fieldsvg{position:absolute;left:0;top:0;width:100%;height:100%}
.float{position:absolute;z-index:3}
.toolbar{display:flex;align-items:center;gap:2px;padding:4px}
.toolbar .icbtn{position:relative;width:36px;height:36px}
.props{width:236px;padding:12px;display:flex;flex-direction:column;gap:12px;font-size:12.5px}
.props .grp{display:flex;flex-direction:column}
.readout{display:flex;align-items:center;gap:10px;padding:6px 11px;font-size:12px}
.hint{font-family:Virgil;color:var(--text-sub)}
/* ---------- dialogs ---------- */
.scrim{position:absolute;inset:0;background:var(--overlay);backdrop-filter:blur(2px);z-index:10}
.dialog{position:absolute;z-index:11;left:50%;top:50%;transform:translate(-50%,-50%);border-radius:12px;padding:22px}
.dialog h2{margin:0;font-size:20px;font-weight:600}
.tpl-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.tpl{border-radius:10px;border:1px solid var(--stroke);padding:6px;background:var(--fg-1)}
.tpl.on{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.tpl .tt{height:96px;border-radius:6px;overflow:hidden;background:#fff;border:1px solid var(--stroke)}
.tpl .tt svg{width:100%;height:100%;display:block}
.tpl b{display:block;font-weight:500;font-size:13px;margin:8px 4px 1px}
.tpl span{display:block;font-size:11.5px;color:var(--text-sub);margin:0 4px 3px}
.tpl.dashed{border-style:dashed;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--text-sub);font-size:12.5px;padding:16px;background:transparent}
.radio{display:flex;align-items:center;gap:8px;font-size:13px;padding:3px 0}
.radio i{width:15px;height:15px;border-radius:50%;border:1.5px solid var(--stroke-strong);display:block;flex:none}
.radio.on i{border:4.5px solid var(--accent)}
.check{display:flex;align-items:center;gap:8px;font-size:13px;padding:3px 0}
.check i{width:15px;height:15px;border-radius:4px;border:1.5px solid var(--stroke-strong);display:flex;align-items:center;justify-content:center;flex:none}
.check.on i{background:var(--accent);border-color:var(--accent);color:#fff}
"""

# ----------------------------------------------------------- frame builders


def titlebar(title_html, editor=False):
    extra = ""
    if editor:
        extra = f'<div class="tb-btns"><span>{icon("file",16)}</span><span>{icon("undo",16)}</span><span>{icon("redo",16)}</span></div>'
    return f'<div class="titlebar"><div class="lights"><i></i><i></i><i></i></div>{extra}<div class="title">{title_html}</div></div>'


def sketch_thumb(variant=0):
    """Small sketch thumbnails for the list."""
    rng = random.Random(10 + variant)
    if variant == 0:
        c = sketch(selected=False, guides=False)
        return field_svg(c, "paper", vb=(-98, -2, 196, FW + 4), grid=False, numbers=False, lw=1.6, defs=sketch_defs())
    if variant == 1:  # ballad wedge
        pts = [(-30, sy(20)), (0, sy(62)), (30, sy(20))]
        c = rough_poly(pts, rng, BLUE, w=0.8, closed=True)
        dts = even_dots(pts, 20, seed=2)
        c += "".join(dot(x, y, 0.8, BLUE) for x, y in dts)
        return field_svg(c, "paper", vb=(-98, -2, 196, FW + 4), grid=False, numbers=False, lw=1.6)
    if variant == 2:  # company front
        c = "".join(dot(-56 + 2 * i, sy(14), 0.8, INK) for i in range(57))
        c += rough_poly([(-58, sy(11)), (58, sy(11))], rng, RED, w=0.8)
        c += rough_poly([(-20, sy(40)), (-8, sy(18))], rng, RED, w=0.8)
        return field_svg(c, "paper", vb=(-98, -2, 196, FW + 4), grid=False, numbers=False, lw=1.6)
    if variant == 3:  # guard areas
        c = ""
        for x in (-64, -8, 48):
            c += f'<rect x="{x}" y="{f(sy(80))}" width="16" height="12" fill="rgba(47,158,68,.25)"/>'
            c += rough_poly([(x, sy(68)), (x + 16, sy(68)), (x + 16, sy(80)), (x, sy(80))], rng, GREEN, w=0.8, closed=True)
        return field_svg(c, "paper", vb=(-98, -2, 196, FW + 4), grid=False, numbers=False, lw=1.6)


def marcher(x, y, label, sel=False):
    s = f'<circle cx="{f(x)}" cy="{f(y)}" r="0.95" fill="#ff0000"/>'
    if sel:
        s += f'<circle cx="{f(x)}" cy="{f(y)}" r="1.6" fill="none" stroke="#2f80ff" stroke-width="0.3"/>'
    s += f'<text x="{f(x)}" y="{f(y - 1.6)}" font-family="DM Sans" font-size="1.45" font-weight="500" text-anchor="middle" fill="#000">{label}</text>'
    return s


def frame_a():
    # field content: overlay sketch at 50% under marchers
    ov = f'<g opacity=".5">{sketch(selected=False, overlay=True, guides=False)}</g>'
    m = ""
    for i, (x, y) in enumerate(arc_pts()):
        m += marcher(x, sy(y), f"T{i + 1}", sel=True)
    # brass still in an old line, waiting to be placed on the block
    for i in range(8):
        m += marcher(-46 + i * 3.0, sy(26), f"B{i + 1}")
    for i in range(6):
        m += marcher(26 + i * 3.0, sy(60), f"M{i + 1}")
    svg = field_svg(ov + m, "paper", vb=(-133, -28.5, 231, 142), cls="fieldsvg", step_grid=False, defs=sketch_defs())
    side = (
        '<div class="sidebar"><div class="grp">'
        f'{icon("users",22)}{icon("music",22)}{icon("field",22)}{icon("metronome",22)}{icon("palette",22)}{icon("books",22)}'
        f'<span class="on new" title="Sketches">{icon("sketches",22)}</span>'
        f'</div><div class="grp">{icon("phone",22)}{icon("gear",22)}</div></div>'
    )
    cards = [
        ("Opener arc", "Edited 4 min ago", 0, True, True),
        ("Ballad wedge idea", "Edited yesterday", 1, False, False),
        ("Closer company front", "Edited Oct 12", 2, False, False),
        ("Guard flag areas", "Edited Oct 9 · Turf", 3, False, False),
    ]
    clist = ""
    for name, when, v, on, sel in cards:
        eye = f'<span class="icbtn sm {"on" if on else ""}" title="Show on field">{icon("eye" if on else "eyeoff",17)}</span>'
        clist += (
            f'<div class="sk-card {"sel" if sel else ""}"><div class="thumb">{sketch_thumb(v)}</div>'
            f'<div class="sk-meta"><b>{name}</b><span>{when}</span></div>{eye}<span class="icbtn sm dim">{icon("dots3",17)}</span></div>'
        )
    panel = (
        '<div class="sk-panel panel">'
        f'<div class="sk-head"><h3>Sketches</h3><span class="btn primary sm">{icon("plus",14,2)}New sketch</span><span class="icbtn sm dim">{icon("x",17)}</span></div>'
        f'<div class="sk-search">{icon("search",15)}Search sketches</div>'
        f'<div class="sk-list">{clist}</div>'
        f'<div class="row dim" style="font-size:12px;gap:6px;padding:2px 4px">{icon("chev",14)}Templates <span class="chip" style="height:18px;font-size:11px;padding:0 6px">3</span></div>'
        '<div class="ov">'
        f'<div class="row" style="justify-content:space-between"><b style="font-size:13px;font-weight:600">Overlay on field</b><span class="chip" style="color:var(--accent);border-color:transparent;background:var(--accent-soft)">{icon("eye",13)}Opener arc</span></div>'
        '<div class="ov-row"><span class="k">Opacity</span><div class="slider"><b style="width:50%"></b><i style="left:50%"></i></div><span class="mono" style="width:34px;text-align:right">50%</span></div>'
        '<div class="ov-row"><span class="k">Position</span><div class="seg" style="flex:1"><span class="on">Below marchers</span><span>Above</span></div></div>'
        '<div class="ov-row"><span class="k">Pages</span><div class="seg" style="flex:1"><span>All</span><span class="on">12 – 16</span><span>Current</span></div></div>'
        '<div class="ov-row"><span class="k">Show</span><span class="row" style="gap:6px"><span class="switch on"></span>Fills</span><span class="row" style="gap:6px;margin-left:10px"><span class="switch"></span>Notes &amp; text</span></div>'
        "</div></div>"
    )
    chip = (
        f'<div class="ov-chip panel" style="left:330px">{icon("sketches",15)}<span>Sketch: <b style="font-weight:500">Opener arc</b></span>'
        '<span class="dim">50% · below · pp. 12–16</span>'
        f'<span class="icbtn sm on">{icon("eye",15)}</span></div>'
    )
    zoom = f'<div class="panel float" style="right:12px;bottom:12px;display:flex;gap:2px;padding:3px"><span class="icbtn sm">{icon("minus",15)}</span><span class="btn ghost sm mono">100%</span><span class="icbtn sm">{icon("plus",15)}</span></div>'
    insp = (
        '<div class="inspector">'
        '<div class="lbl">PAGE</div><h4>12 <span class="dim" style="font-weight:400;font-size:13px">· 16 counts</span></h4>'
        '<div class="dim" style="font-size:12px;margin-bottom:12px">m. 21 – 24 · 144 bpm</div>'
        '<div class="hr"></div>'
        '<div class="lbl">12 MARCHERS SELECTED</div>'
        '<div style="display:flex;flex-direction:column;gap:7px;margin-top:6px">'
        '<div class="row" style="justify-content:space-between"><span class="dim">Section</span><span>Trumpet</span></div>'
        '<div class="row" style="justify-content:space-between"><span class="dim">Form</span><span>Arc, 12</span></div>'
        '<div class="row" style="justify-content:space-between"><span class="dim">Interval</span><span>≈ 3.6 steps</span></div>'
        "</div>"
        '<div class="hr"></div>'
        f'<div class="row" style="gap:8px;padding:9px;border-radius:6px;background:var(--accent-soft);color:var(--text);font-size:12px;align-items:flex-start">'
        f'<span style="color:var(--accent);margin-top:1px">{icon("info",16)}</span><span>Placed on the dots of <b style="font-weight:600">Opener arc</b>. Sketch overlays never change the drill.</span></div>'
        "</div>"
    )
    # timeline
    tl = '<div class="timeline">'
    tl += '<div style="position:absolute;left:10px;top:10px;display:flex;gap:4px;align-items:center">'
    tl += f'<span class="icbtn sm">{icon("skipb",13)}</span><span class="icbtn sm" style="background:var(--fg-2)">{icon("play",13)}</span><span class="icbtn sm">{icon("skipf",13)}</span><span class="mono dim" style="font-size:12px;margin-left:6px">12 · 3/16</span></div>'
    tl += '<svg width="100%" height="118" style="position:absolute;left:0;top:0" viewBox="0 0 1000 118" preserveAspectRatio="xMinYMid meet">'
    x = 150
    pages = [(9, 40), (10, 56), (11, 44), (12, 64), (13, 48), (14, 52), (15, 56), (16, 72), (17, 40)]
    for n, w in pages:
        on = 12 <= n <= 16
        fill = "rgba(150,126,255,.22)" if n == 12 else ("rgba(150,126,255,.08)" if on else "rgba(255,255,255,.04)")
        tl += f'<rect x="{x}" y="46" width="{w * 1.25 - 3}" height="22" rx="3" fill="{fill}" stroke="rgba(255,255,255,.08)"/>'
        tl += f'<text x="{x + 6}" y="61" font-family="DM Sans" font-size="11" fill="rgba(208,208,208,.8)">{n}</text>'
        x += w * 1.25
    rng = random.Random(2)
    for i in range(0, 840, 3):
        h = abs(math.sin(i / 37) * 9 + rng.uniform(-5, 5)) + 2
        tl += f'<rect x="{150 + i}" y="{92 - h / 2}" width="2" height="{h}" fill="rgba(150,126,255,.35)"/>'
    tl += '<line x1="292" y1="34" x2="292" y2="112" stroke="#ecd347" stroke-width="2"/>'
    tl += '<rect x="325" y="30" width="275" height="8" rx="4" fill="rgba(150,126,255,.45)"/>'
    tl += '<text x="327" y="25" font-family="DM Sans" font-size="10.5" fill="rgba(150,126,255,1)">Sketch overlay · pages 12 – 16</text>'
    tl += "</svg></div>"
    # light-mode-safe timeline colors are approximations; fine for mockup
    body = (
        '<div class="ed-body">'
        '<div class="ed-toolbar">'
        '<span class="tab">File</span><span class="tab on">View</span><span class="tab">Select</span><span class="tab">Alignment</span><span class="tab">Collisions</span>'
        '<span class="sep"></span>'
        '<span class="btn ghost sm">Paths</span><span class="btn ghost sm">Previous page</span><span class="btn sm" style="color:var(--accent);background:var(--accent-soft);border-color:transparent">'
        + icon("sketches", 14)
        + 'Sketch overlay</span>'
        '<span style="flex:1"></span><span class="btn ghost sm dim">⌘K</span>'
        "</div>"
        '<div class="ed-main"><div class="ed-center">'
        f'<div class="ed-fieldrow">{side}<div class="fieldview">{svg}{chip}{zoom}</div>{panel}</div>'
        f"{tl}</div>{insp}</div></div>"
    )
    return f'<div class="frame" id="frame-a">{titlebar("<b>Spring Show 2027</b> · spring.dots", editor=True)}{body}</div>'


def toolbar_html():
    tools = [
        ("lockopen", "Q", False), None,
        ("hand", "H", False), ("cursor", "1", False), ("rect", "2", True), ("diamond", "3", False), ("ellipse", "4", False),
        ("arrow", "5", False), ("line", "6", False), ("pen", "7", False), ("text", "8", False), ("image", "9", False),
        ("eraser", "0", False), None, ("sticky", "S", False), ("ruler", "M", False), ("stamps", "F", False),
    ]
    h = ""
    for t in tools:
        if t is None:
            h += '<span class="sep"></span>'
            continue
        n, k, on = t
        h += f'<span class="icbtn {"on" if on else ""}">{icon(n, 19)}<span class="kbd">{k}</span></span>'
    return h


def props_html():
    strokes = ["#1e1e24", "#e03131", "#1c7ed6", "#2f9e44", "#7c5cff"]
    fills = ["none", "#ffc9c9", "#a5d8ff", "#b2f2bb", "#ffec99"]
    s = '<div class="grp"><div class="lbl">Stroke</div><div class="row">'
    s += "".join(f'<span class="sw {"on" if i == 0 else ""}" style="background:{c}"></span>' for i, c in enumerate(strokes))
    s += '<span class="sep"></span><span class="sw" style="background:conic-gradient(#f03e3e,#fab005,#40c057,#228be6,#7950f2,#f03e3e)"></span></div></div>'
    s += '<div class="grp"><div class="lbl">Fill color</div><div class="row">'
    s += "".join(f'<span class="sw {"none" if c == "none" else ""} {"on" if i == 0 else ""}" style="background-color:{c if c != "none" else "transparent"}"></span>' for i, c in enumerate(fills))
    s += "</div></div>"
    s += '<div class="grp"><div class="lbl">Fill pattern</div><div class="row" style="gap:3px">'
    for k in ["none", "solid", "lines", "cross", "dots", "stagger", "even"]:
        s += f'<span class="tg {"on" if k == "dots" else ""}" style="width:28px;height:28px">{fill_icon(k)}</span>'
    s += "</div>"
    s += '<div class="dim" style="font-size:11.5px;margin-top:5px">Dots · on a 2-step interval</div></div>'
    s += (
        '<div class="grp" style="gap:6px"><div class="row" style="gap:6px"><div style="flex:1"><div class="lbl">Interval</div><div class="input"><b style="font-weight:500">2</b><span class="u">steps</span></div></div>'
        '<div style="flex:1"><div class="lbl">Dot size</div><div class="seg"><span>S</span><span class="on">M</span><span>L</span></div></div></div>'
        '<div class="row" style="gap:8px;font-size:12.5px"><span class="switch on"></span>Align dots to step grid</div>'
        f'<div class="row" style="gap:8px;padding:7px 9px;border-radius:6px;background:var(--accent-soft)"><span style="color:var(--accent)">{icon("stamps",15)}</span><b style="font-weight:600">48 dots</b><span class="dim">8 × 6</span></div></div>'
    )
    s += '<div class="grp"><div class="lbl">Stroke width</div><div class="seg"><span class="on">Thin</span><span>Bold</span><span>Extra</span></div></div>'
    s += '<div class="grp"><div class="lbl">Stroke style</div><div class="seg"><span class="on">—</span><span>- -</span><span>···</span><span>Dots along</span></div></div>'
    s += '<div class="grp"><div class="lbl">Sloppiness</div><div class="seg"><span>Clean</span><span class="on">Sketchy</span></div></div>'
    s += '<div class="grp"><div class="lbl">Opacity</div><div class="row" style="gap:8px"><div class="slider"><b style="width:100%"></b><i style="left:100%"></i></div><span class="mono dim" style="width:30px;text-align:right">100</span></div></div>'
    s += (
        '<div class="grp"><div class="lbl">Actions</div><div class="row" style="gap:3px">'
        f'<span class="tg">{icon("copy",16)}</span><span class="tg">{icon("trash",16)}</span><span class="tg">{icon("layers",16)}</span><span class="tg">{icon("group",16)}</span><span class="tg">{icon("lock",16)}</span>'
        f'<span class="tg" style="width:auto;padding:0 8px;gap:5px;font-size:12px;color:var(--text)">{icon("mirror",16)}50</span></div></div>'
    )
    return s


def frame_b(fid="frame-b"):
    c = sketch(selected=True, overlay=False, guides=True)
    svg = field_svg(c, "paper", vb=(-150, -32, 250, 150), cls="fieldsvg", step_grid=True, defs=sketch_defs())
    ui = (
        f'<div class="panel float" style="left:12px;top:12px;display:flex;align-items:center;gap:4px;padding:4px 10px 4px 4px">'
        f'<span class="icbtn">{icon("menu",19)}</span><b style="font-weight:500;font-size:14px">Opener arc</b><span class="dim" style="font-size:12px;margin-left:6px">Saved</span></div>'
        f'<div class="panel float toolbar" style="left:50%;transform:translateX(-50%);top:12px">{toolbar_html()}</div>'
        f'<div class="float" style="right:12px;top:12px;display:flex;gap:6px">'
        f'<span class="panel btn" style="height:38px">{icon("field",17)}Field</span>'
        f'<span class="panel btn" style="height:38px;color:var(--accent)">{icon("eye",17)}On field</span>'
        f'<span class="btn primary" style="height:38px">{icon("export",17)}Export</span></div>'
        f'<div class="panel float props" style="left:12px;top:66px">{props_html()}</div>'
        f'<div class="panel float" style="left:12px;bottom:12px;display:flex;gap:2px;padding:3px;align-items:center">'
        f'<span class="icbtn sm">{icon("minus",15)}</span><span class="btn ghost sm mono">82%</span><span class="icbtn sm">{icon("plus",15)}</span>'
        f'<span class="sep"></span><span class="icbtn sm">{icon("undo",16)}</span><span class="icbtn sm dim">{icon("redo",16)}</span></div>'
        f'<div class="float" style="left:290px;bottom:12px;display:flex;gap:6px">'
        f'<span class="panel btn" style="color:var(--accent)">{icon("magnet",16)}Snap: Yard lines &amp; hashes{icon("chev",14)}</span>'
        f'<span class="panel btn">{icon("mirror",16)}Mirror 50</span></div>'
        f'<div class="panel float readout" style="right:12px;bottom:12px"><span>Block <span class="dim">16 × 12 steps</span></span><span class="sep"></span>'
        f'<span class="mono" style="font-size:11.5px">on S1 30 · 4 behind FH</span><span class="sep"></span><span style="color:var(--accent);font-weight:600">48 dots</span></div>'
    )
    return f'<div class="frame" id="{fid}">{titlebar("<b>Opener arc</b> — Spring Show 2027 · Sketchpad")}<div class="sp-canvas">{svg}{ui}</div></div>'


def tpl_thumb(kind):
    rng = random.Random(5)
    vb = (-98, -2, 196, FW + 4)
    if kind == "blank":
        return field_svg("", "paper", vb=vb, lw=1.5)
    if kind == "grid":
        return field_svg("", "cream", vb=vb, numbers=False, hashes=False, lw=1.5, step_grid=False)
    if kind == "hash":
        return field_svg("", "paper", vb=vb, grid=False, numbers=False, lw=1.5)
    if kind == "opener":
        c = f'<rect x="-94" y="{f(FW - 14)}" width="40" height="12" fill="#fff" stroke="#000" stroke-width=".4"/>'
        c += hand(-92, FW - 9, "Title / Page", 3.0)
        c += hand(-92, FW - 4.5, "Counts:", 3.0)
        c += f'<rect x="66" y="2" width="26" height="20" fill="#ffe783" transform="rotate(-3 66 2)"/>'
        c += hand(68.5, 9, "notes", 3.4, "#5b4a00")
        return field_svg(c, "paper", vb=vb, lw=1.5)
    if kind == "company":
        c = "".join(dot(-64 + 2 * i, sy(14), 0.7) for i in range(65))
        return field_svg(c, "paper", vb=vb, lw=1.5)
    if kind == "box":
        c = ""
        for (x0, y0) in [(-60, 20), (-16, 40), (28, 20)]:
            for i in range(8):
                for j in range(4):
                    c += dot(x0 + i * 2, sy(y0 + j * 2), 0.7)
        return field_svg(c, "turf", vb=vb, lw=1.5)


def frame_c():
    behind = frame_b_inner_dim()
    tpls = [
        ("blank", "Blank", "Your show's field", True),
        ("grid", "Grid paper", "4-step grid, no numbers", False),
        ("hash", "Hash grid", "Yard lines + hashes", False),
        ("opener", "Opener sheet", "Title block + notes", False),
    ]
    mine = [
        ("company", "Company front 64", "Edited Oct 2", ""),
        ("box", "Box drill sheet", "Turf · High school field", "warn"),
    ]
    g1 = "".join(
        f'<div class="tpl {"on" if on else ""}"><div class="tt">{tpl_thumb(k)}</div><b>{n}</b><span>{d}</span></div>' for k, n, d, on in tpls
    )
    g2 = "".join(
        f'<div class="tpl"><div class="tt">{tpl_thumb(k)}</div><b>{n}</b><span>{(icon("warn",12,2,extra=" style=\"display:inline;vertical-align:-2px;color:var(--yellow)\"") + " ") if w else ""}{d}</span></div>'
        for k, n, d, w in mine
    )
    g2 += '<div class="tpl dashed" style="grid-column:span 2">Save any sketch as a template<br>from its ≡ menu or the sidebar.</div>'
    dlg = (
        '<div class="dialog panel" style="width:880px">'
        f'<div class="row" style="justify-content:space-between;margin-bottom:4px"><h2>New sketch</h2><span class="icbtn dim">{icon("x",18)}</span></div>'
        '<div class="dim" style="margin-bottom:16px">Start from a blank field or a template. You can change grid and colors later.</div>'
        '<div class="row" style="gap:12px;margin-bottom:18px">'
        '<div style="flex:1"><div class="lbl">Name</div><div class="input" style="height:34px;font-size:14px;border-color:var(--accent)">Sketch 5<span style="width:1px;height:16px;background:var(--accent);margin-left:-3px"></span></div></div>'
        f'<div style="flex:1"><div class="lbl">Field</div><div class="input" style="height:34px;font-size:13px">{icon("field",16)}College football<span class="u">from your show · Oct 18</span></div></div></div>'
        f'<div class="lbl" style="margin-bottom:8px">START FROM</div><div class="tpl-grid" style="margin-bottom:18px">{g1}</div>'
        f'<div class="row" style="justify-content:space-between;margin-bottom:8px"><div class="lbl" style="margin:0">MY TEMPLATES · LIBRARY</div><span class="dim" style="font-size:12px">Manage…</span></div>'
        f'<div class="tpl-grid" style="margin-bottom:18px">{g2}</div>'
        '<div class="row" style="justify-content:space-between;border-top:1px solid var(--stroke);padding-top:14px">'
        f'<span class="row dim" style="gap:6px;font-size:12px">{icon("info",14)}Tip: Alt-click <b style="font-weight:600;color:var(--text)">New sketch</b> to skip this dialog.</span>'
        '<div class="row" style="gap:8px"><span class="btn">Cancel</span><span class="btn primary">Create sketch<span class="mono" style="opacity:.7;font-size:11px">↵</span></span></div></div>'
        "</div>"
    )
    return f'<div class="frame" id="frame-c">{behind}<div class="scrim"></div>{dlg}</div>'


def frame_b_inner_dim():
    """The main editor behind a dialog (frame A without the sketches panel)."""
    a = frame_a()
    inner = a[a.index(">") + 1 : a.rindex("</div>")]
    return inner


def frame_d():
    # preview: print look on white page
    c = sketch(selected=False, overlay=False, guides=False, print_look=True)
    fsvg = field_svg(c, "paper", vb=(-100, -9, 200, FW + 12), step_grid=False, defs=sketch_defs(print_look=True), lw=1.1)
    preview = (
        '<div style="flex:1;background:var(--canvas);border-radius:8px;border:1px solid var(--stroke);display:flex;align-items:center;justify-content:center;padding:26px;position:relative">'
        '<div style="width:100%;aspect-ratio:11/8.5;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.35);border-radius:2px;padding:4.5% 4.5% 3%;display:flex;flex-direction:column;color:#111">'
        '<div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1.5px solid #111;padding-bottom:6px;margin-bottom:8px">'
        '<div><div style="font-size:15px;font-weight:600">Opener arc</div><div style="font-size:10px;color:#555">Spring Show 2027 · sketch</div></div>'
        '<div style="font-size:9.5px;color:#555;text-align:right">Oct 18, 2026<br>College football · 8-to-5</div></div>'
        f'<div style="flex:1;display:flex;align-items:center">{fsvg}</div>'
        '<div style="font-size:8.5px;color:#777;display:flex;justify-content:space-between;margin-top:4px"><span>Made with OpenMarch</span><span>1 / 1</span></div>'
        "</div>"
        '</div>'
    )
    opts = (
        '<div style="width:300px;display:flex;flex-direction:column;gap:14px">'
        '<div><div class="lbl">Format</div><div class="seg"><span>PNG</span><span>SVG</span><span class="on">PDF</span></div></div>'
        '<div><div class="lbl">Area</div><div class="radio on"><i></i>Whole field</div><div class="radio"><i></i>Drawing only</div><div class="radio" style="color:var(--text-dis)"><i></i>Selection</div></div>'
        '<div><div class="lbl">Include</div>'
        f'<div class="check on"><i>{icon("check",11,3)}</i>Field</div><div class="check on"><i>{icon("check",11,3)}</i>Yard numbers</div>'
        '<div class="check"><i></i>Step grid</div>'
        f'<div class="check on"><i>{icon("check",11,3)}</i>Title block</div><div class="check"><i></i>Sticky notes</div></div>'
        '<div><div class="lbl">Look</div><div class="seg"><span>As drawn</span><span class="on">Print (black on white)</span></div></div>'
        '<div class="row" style="gap:8px"><div style="flex:1"><div class="lbl">Paper</div>'
        f'<div class="input" style="height:30px">Letter{icon("chev",14,extra=" style=\"margin-left:auto\"")}</div></div>'
        '<div style="flex:1"><div class="lbl">Orientation</div><div class="seg"><span class="on">Land.</span><span>Port.</span></div></div></div>'
        '<div class="dim" style="font-size:12px">File name: <span class="mono" style="color:var(--text)">Spring Show 2027 - Opener arc.pdf</span></div>'
        "</div>"
    )
    dlg = (
        '<div class="dialog panel" style="width:1060px">'
        f'<div class="row" style="justify-content:space-between;margin-bottom:16px"><h2>Export sketch</h2><span class="icbtn dim">{icon("x",18)}</span></div>'
        f'<div class="row" style="gap:20px;align-items:stretch">{preview}{opts}</div>'
        '<div class="row" style="justify-content:space-between;border-top:1px solid var(--stroke);padding-top:14px;margin-top:18px">'
        f'<span class="btn">{icon("clip",15)}Copy as PNG</span>'
        f'<div class="row" style="gap:8px"><span class="btn">Cancel</span><span class="btn primary">{icon("export",15)}Export PDF</span></div></div></div>'
    )
    b = frame_b("tmp")
    inner = b[b.index(">") + 1 : b.rindex("</div>")]
    return f'<div class="frame" id="frame-d">{inner}<div class="scrim"></div>{dlg}</div>'


def frame_e():
    """Empty states: sidebar with no sketches + a blank sketch with hints."""
    svg = field_svg("", "paper", vb=(-150, -32, 250, 150), cls="fieldsvg", step_grid=True)
    hints = (
        # hint toward toolbar
        '<svg class="float" style="left:0;top:0;width:100%;height:100%;pointer-events:none;color:var(--text-sub)" viewBox="0 0 1300 782" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">'
        '<path d="M640 92 C 652 84, 668 78, 690 66"/><path d="M679 63 L691 65 L686 76"/>'
        '<path d="M1150 100 C 1168 92, 1180 82, 1186 66"/><path d="M1178 74 L1186 64 L1193 75"/>'
        '<path d="M420 668 C 400 690, 392 705, 380 724"/><path d="M378 711 L379 725 L391 720"/>'
        "</svg>"
        '<div class="float hint" style="left:380px;top:84px;font-size:21px;line-height:1.25">Pick a tool &amp; start drawing<br><span style="font-size:15px">or press P and just scribble</span></div>'
        '<div class="float hint" style="left:960px;top:100px;font-size:19px">Field, grid &amp; colors</div>'
        '<div class="float hint" style="left:430px;top:648px;font-size:19px">Snap to yard lines &amp; hashes</div>'
    )
    ui = (
        f'<div class="panel float" style="left:12px;top:12px;display:flex;align-items:center;gap:4px;padding:4px 10px 4px 4px">'
        f'<span class="icbtn">{icon("menu",19)}</span><b style="font-weight:500;font-size:14px">Sketch 5</b></div>'
        f'<div class="panel float toolbar" style="left:50%;transform:translateX(-50%);top:12px">{toolbar_html().replace("icbtn on","icbtn").replace(icon("pen",19), icon("pen",19)).replace("<span class=\"icbtn \">" + icon("pen",19), "<span class=\"icbtn on\">" + icon("pen",19))}</div>'
        f'<div class="float" style="right:12px;top:12px;display:flex;gap:6px">'
        f'<span class="panel btn" style="height:38px">{icon("field",17)}Field</span>'
        f'<span class="panel btn" style="height:38px">{icon("eyeoff",17)}On field</span>'
        f'<span class="btn primary" style="height:38px">{icon("export",17)}Export</span></div>'
        f'<div class="panel float" style="left:12px;bottom:12px;display:flex;gap:2px;padding:3px;align-items:center">'
        f'<span class="icbtn sm">{icon("minus",15)}</span><span class="btn ghost sm mono">82%</span><span class="icbtn sm">{icon("plus",15)}</span>'
        f'<span class="sep"></span><span class="icbtn sm dim">{icon("undo",16)}</span><span class="icbtn sm dim">{icon("redo",16)}</span></div>'
        f'<div class="float" style="left:290px;bottom:12px;display:flex;gap:6px">'
        f'<span class="panel btn">{icon("magnet",16)}Snap: Off{icon("chev",14)}</span>'
        f'<span class="panel btn">{icon("mirror",16)}Mirror 50</span></div>'
    )
    # sidebar empty state card, pinned at the left like the editor panel
    empty = (
        '<div class="panel float" style="left:12px;top:150px;width:300px;padding:14px">'
        '<div class="lbl" style="margin-bottom:10px">IN THE EDITOR: SKETCHES, NONE YET</div>'
        '<div style="border:1px dashed var(--stroke-strong);border-radius:10px;padding:18px 16px;text-align:center">'
        '<svg width="150" height="78" viewBox="0 0 150 78" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" style="color:var(--text-sub)">'
        '<rect x="6" y="10" width="128" height="58" rx="3"/><path d="M28 10v58M50 10v58M72 10v58M94 10v58M116 10v58"/>'
        '<path d="M40 52c10-22 38-30 58-14" stroke="var(--accent)" stroke-width="2.4"/>'
        '<path d="M118 4l14 14-26 26-16 4 4-16z" fill="var(--modal)" stroke="var(--text)"/></svg>'
        '<div style="font-weight:600;font-size:15px;margin:8px 0 4px">Sketch a form</div>'
        '<div class="dim" style="font-size:12.5px;margin-bottom:12px">Draw freely on the field, with no marchers or counts. Use a sketch as an overlay while you write drill.</div>'
        f'<span class="btn primary">{icon("plus",14,2)}New sketch</span>'
        '<div style="font-size:12.5px;color:var(--accent);margin-top:10px">Start from a template</div></div></div>'
    )
    return f'<div class="frame" id="frame-e">{titlebar("<b>Sketch 5</b> — Spring Show 2027 · Sketchpad")}<div class="sp-canvas">{svg}{hints}{ui}{empty}</div></div>'


def main():
    frames = [
        ("frame-a", "A · Main editor", "Sketches menu in the left sidebar, with “Opener arc” shown as an overlay below the marchers on pages 12–16.", "MVP", frame_a(), [
            "New Sketches button (pencil) at the bottom of the sidebar's top group; the panel is a SidebarModal like Marchers or Music.",
            "Each card has a field thumbnail, an eye (show on field) and a ⋯ menu (Open, Rename, Duplicate, Save as template, Export…, Delete).",
            "Overlay settings sit at the bottom of the panel; a floating chip on the field keeps them reachable when the panel is closed. The timeline shows which pages the overlay covers.",
            "The 12 trumpets were placed by hand on the sketch's 12 arc dots; the block's 48 dots still wait for brass.",
        ]),
        ("frame-b", "B · Sketchpad window", "Its own window, like the 3D View. Excalidraw-style floating tool bar and Properties panel, field-aware helpers at the bottom.", "MVP", frame_b(), [
            "Fills shown: dots (block, 48, selected), staggered dots (orange circle), even dots (red diamond, 14), lines (blue wedge), cross lines (guard area), plus “Dots along” on the arc (12).",
            "While dragging, the snap guide names what it snapped to (S1 35 yd line); the measure tool shows 18 steps to the front sideline in 8-to-5 steps.",
            "Arrow, handwritten text, freehand loop and a sticky note use the Sketchy look; dot fills stay crisp so counts are readable.",
            "The readout at the bottom right speaks drill: size in steps, position by yard line and sideline, and the dot count.",
        ]),
        ("frame-c", "C · New sketch dialog", "Opened from New sketch in the sidebar. Blank is focused, so Enter creates a sketch right away.", "MVP", frame_c(), [
            "The field always comes from the show at creation; templates carry drawing and field style only.",
            "A template made on another field layout shows a warning line; its content is placed by yard line.",
            "My templates live in the user's Library and work in every show. The web build keeps them in the file.",
        ]),
        ("frame-d", "D · Export dialog", "From ≡ → Export… or ⌘⇧E. Live preview on the left.", "MVP", frame_d(), [
            "PNG, SVG and PDF. Print look turns all colors black on white and keeps fills as patterns, so they still read on a copier.",
            "Area: whole field, drawing only (tight crop) or selection. Copy as PNG for pasting into a chat or a slide.",
        ]),
        ("frame-e", "E · Empty states", "A blank sketch with Excalidraw-style hints, and the sidebar's empty state (shown in an inset).", "MVP", frame_e(), [
            "Hints fade on the first stroke and don't come back for that sketch. The pen is preselected so you can start scribbling right away.",
        ]),
    ]
    body = (
        '<div class="page-head"><div><h1>Sketchpad — mockups</h1>'
        "<p>High-fidelity frames for the OpenMarch Sketchpad: free sketching on the field, with no marchers, counts or music. "
        'See <span class="mono">ux-spec.md</span> for flows, shortcuts and open questions. Static and self-contained; dark first.</p></div>'
        '<button class="theme-btn" onclick="var r=document.documentElement;r.dataset.theme=(r.dataset.theme===\'light\')?\'dark\':\'light\'">Toggle light / dark</button></div>'
    )
    for fid, title, sub, tag, html, notes in frames:
        nl = "".join(f"<li>{n}</li>" for n in notes)
        body += (
            f'<section class="frame-wrap" id="w-{fid}"><div class="frame-label"><b>{title}</b><span class="tag">{tag}</span><span>{sub}</span></div>'
            f'<div class="scroller">{html}</div><ul class="notes">{nl}</ul></section>'
        )
    html = (
        '<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        "<title>Sketchpad Mockups</title>"
        f"<style>{CSS}</style></head><body>{body}<div style='height:48px'></div></body></html>"
    )
    with open(OUT, "w") as fh:
        fh.write(html)
    print(OUT, len(html) // 1024, "KB")


if __name__ == "__main__":
    main()
