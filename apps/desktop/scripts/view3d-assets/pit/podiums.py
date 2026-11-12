# cspell:words pitlib toeboard toeboards mathutils
# Podiums a conductor or drum major stands on: the boxy conductor podiums, the
# aluminum drum major stand and towers, a rolling field podium, a stepladder and
# a one-layer scaffold tower. Generic shapes, no marks.
#
# The drum major faces the field (+Y) with the audience behind (-Y); every podium
# is climbed from behind, except the rolling one, which has a ladder at each end.
# Each builder sets parts.stand: where the drum major's feet go, in Blender
# coordinates (x, y, top of the standing surface).
from mathutils import Matrix

from pitlib import INCH, caster, place

FT = 12 * INCH
RAIL_H = 0.95  # guardrail height above the deck


def _lerp(a, b, t):
    return tuple(p + (q - p) * t for p, q in zip(a, b))


def _sides(high):
    return 8 if high else 4


def _rail_run(parts, mat, pts, z, high, mid=True, r=0.016):
    """Posts at each point and a top rail (and mid rail) joining them in order."""
    s = _sides(high)
    for x, y in pts:
        parts[mat].rod((x, y, z - 0.01), (x, y, z + RAIL_H), r, s)
    for p, q in zip(pts, pts[1:]):
        parts[mat].rod((p[0], p[1], z + RAIL_H), (q[0], q[1], z + RAIL_H), r, s)
        if mid and high:
            parts[mat].rod((p[0], p[1], z + RAIL_H * 0.5), (q[0], q[1], z + RAIL_H * 0.5), r * 0.75, s)


def _ladder(parts, mat, tread, half_w, foot, top, steps, high, r=0.02, flat=True):
    """A straight ladder from foot (x=0, y, z) to top (x=0, y, z): two stiles and
    `steps` evenly spaced flat treads (or round rungs), not counting the top."""
    s = _sides(high)
    for sx in (-1, 1):
        parts[mat].rod((sx * half_w, foot[0], foot[1]), (sx * half_w, top[0], top[1]), r, s)
    for i in range(1, steps + 1):
        y, z = _lerp(foot, top, i / (steps + 1))
        if flat:
            parts[tread].box((-half_w + r, y - 0.05, z - 0.02), (half_w - r, y + 0.05, z))
        else:
            parts[mat].rod((-half_w, y, z), (half_w, y, z), r * 0.7, s)


def _deck(parts, mat, tread, w, d, z, rim=0.05, high=True):
    """A deck: a tube rim with a plate top and a grip surface inset into it."""
    parts[mat].box((-w / 2, -d / 2, z - rim), (w / 2, d / 2, z - 0.006))
    parts[tread].box((-w / 2 + 0.02, -d / 2 + 0.02, z - 0.006), (w / 2 - 0.02, d / 2 - 0.02, z))


def _finish(black):
    return "powder-black" if black else "aluminum"


def conductor_podium(parts, high, tall=False, **_):
    """A conductor's podium: a low box with a step, or a tall tower with a ladder,
    climbed from behind, with a rail on the other three sides."""
    # Built with the access toward +Y, then mirrored so it faces the audience (-Y).
    with place(parts, Matrix.Scale(-1, 4, (0, 1, 0))):
        _conductor_podium(parts, high, tall)
    parts.stand = (0.0, 0.0, (1.5 if tall else 0.42) + 0.006)


def _conductor_podium(parts, high, tall):
    w = d = 1.2
    h = 1.5 if tall else 0.42
    sides = _sides(high)
    if tall:
        a = w / 2 - 0.04
        for sx in (-1, 1):
            for sy in (-1, 1):
                parts["frame"].tube((sx * a, sy * a, 0), (sx * a, sy * a, h - 0.06), 0.06)
        parts["frame"].box((-w / 2, -d / 2, h - 0.08), (w / 2, d / 2, h))
        z0, z1 = 0.15, h - 0.2
        for p, q in (((-a, -a), (a, -a)), ((a, -a), (a, a)), ((-a, a), (-a, -a))):
            parts["frame"].tube((p[0], p[1], z0), (q[0], q[1], z1), 0.03)
            parts["frame"].tube((q[0], q[1], z0), (p[0], p[1], z1), 0.03)
        run = 0.55
        for s in (-1, 1):
            parts["metal"].rod((s * 0.25, d / 2 + run, 0.0), (s * 0.25, d / 2, h), 0.018, sides)
        steps = 6
        for i in range(1, steps):
            t = i / steps
            y = d / 2 + run * (1 - t)
            parts["metal"].rod((-0.25, y, h * t), (0.25, y, h * t), 0.014, sides)
    elif high:
        parts["frame"].chamfer_box((-w / 2, -d / 2, 0.0), (w / 2, d / 2, h), 0.015)
        parts["frame"].chamfer_box((-0.32, d / 2 - 0.02, 0.0), (0.32, d / 2 + 0.3, h * 0.5), 0.012)
    else:
        parts["frame"].box((-w / 2, -d / 2, 0.0), (w / 2, d / 2, h))
        parts["frame"].box((-0.32, d / 2, 0.0), (0.32, d / 2 + 0.3, h * 0.5))
    parts["felt"].box((-w / 2 + 0.02, -d / 2 + 0.02, h), (w / 2 - 0.02, d / 2 - 0.02, h + 0.006))
    # a safety rail on three sides, open where you climb on
    rail_h = h + 0.95
    inset = 0.04
    pts = [(-w / 2 + inset, d / 2 - inset), (-w / 2 + inset, -d / 2 + inset), (w / 2 - inset, -d / 2 + inset), (w / 2 - inset, d / 2 - inset)]
    for x, y in pts:
        parts["metal"].rod((x, y, h), (x, y, rail_h), 0.016, sides)
    for p, q in zip(pts, pts[1:]):
        parts["metal"].rod((p[0], p[1], rail_h), (q[0], q[1], rail_h), 0.016, sides)
        if high:
            parts["metal"].rod((p[0], p[1], h + 0.48), (q[0], q[1], h + 0.48), 0.011, sides)


def stand(parts, high, black=False, **_):
    """A 2 ft aluminum drum major stand: a 24 in deck on four splayed legs, no rail."""
    m = _finish(black)
    h, w = 2 * FT, 2 * FT
    a, b = w / 2 - 0.03, w / 2 + 0.05  # leg inset at the top, splay at the foot
    _deck(parts, m, "tread", w, w, h, 0.045, high)
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts[m].tube((sx * a, sy * a, h - 0.045), (sx * b, sy * b, 0.02), 0.032)
            parts["rubber"].box((sx * b - 0.025, sy * b - 0.025, 0), (sx * b + 0.025, sy * b + 0.025, 0.02))
    z = 0.18
    t = 1 - (z - 0.02) / (h - 0.065)
    c = a + (b - a) * (1 - t)
    for p, q in (((-c, -c), (c, -c)), ((c, -c), (c, c)), ((c, c), (-c, c)), ((-c, c), (-c, -c))):
        parts[m].tube((p[0], p[1], z), (q[0], q[1], z), 0.022)
    parts.stand = (0.0, 0.0, h)


def tower(parts, high, height_ft, black=False, rail="back-sides", **_):
    """An aluminum drum major tower: tapered square-tube legs, a 36 x 32 in deck
    and a steep ladder up the back. rail is "back-sides" (open toward the
    field) or "full"."""
    m = _finish(black)
    h = height_ft * FT
    w, d = 36 * INCH, 32 * INCH
    splay = 0.06 + 0.05 * h
    ax, ay = w / 2 - 0.03, d / 2 - 0.03
    bx, by = ax + splay, ay + splay
    _deck(parts, m, "tread", w, d, h, 0.06, high)
    legs = {}
    for sx in (-1, 1):
        for sy in (-1, 1):
            top, foot = (sx * ax, sy * ay, h - 0.06), (sx * bx, sy * by, 0.025)
            legs[sx, sy] = (foot, top)
            parts[m].tube(top, foot, 0.04)
            parts["rubber"].box((foot[0] - 0.03, foot[1] - 0.03, 0), (foot[0] + 0.03, foot[1] + 0.03, 0.025))

    def leg_at(k, z):
        foot, top = legs[k]
        return _lerp(foot, top, (z - foot[2]) / (top[2] - foot[2]))

    rings = [0.25, h * 0.55] if h > 1.4 else [0.25]
    for z in rings:
        order = [(-1, -1), (1, -1), (1, 1), (-1, 1), (-1, -1)]
        for k0, k1 in zip(order, order[1:]):
            parts[m].tube(leg_at(k0, z), leg_at(k1, z), 0.025)
    # X braces on the two sides and the field side
    z0, z1 = rings[0], h - 0.1
    for k0, k1 in (((-1, -1), (-1, 1)), ((1, -1), (1, 1)), ((-1, 1), (1, 1))):
        parts[m].tube(leg_at(k0, z0), leg_at(k1, z1), 0.022)
        if high or rail == "full":
            parts[m].tube(leg_at(k1, z0), leg_at(k0, z1), 0.022)
    # the ladder up the back, its stiles carried on up as handholds
    half = 0.24
    run = 0.32 * h
    y_top = -d / 2
    steps = max(3, round(h / 0.3) - 1)
    _ladder(parts, m, "tread", half, (y_top - run, 0.0), (y_top, h), steps, high, 0.022)
    # rail: the back has a gap where the ladder comes in
    ix, iy = w / 2 - 0.025, d / 2 - 0.025
    _rail_run(parts, m, [(-half, -iy), (-ix, -iy), (-ix, iy)] + ([(ix, iy)] if rail == "full" else []), h, high)
    _rail_run(parts, m, [(half, -iy), (ix, -iy), (ix, iy)], h, high)
    parts.stand = (0.0, 0.0, h)


def rolling(parts, high, black=False, **_):
    """A 6 ft rolling field podium: a 6 x 4 ft deck on a braced frame with casters,
    a ladder at each end, and a rail all round but for the two ladder gaps."""
    m = _finish(black)
    h = 6 * FT
    w, d = 6 * FT, 4 * FT
    cz = 0.15  # caster top
    a, b = w / 2 - 0.03, d / 2 - 0.03
    _deck(parts, m, "tread", w, d, h, 0.08, high)
    for sx in (-1, 0, 1):
        for sy in (-1, 1):
            parts[m].tube((sx * a, sy * b, cz), (sx * a, sy * b, h - 0.08), 0.05)
            if sx:
                caster(parts, sx * a, sy * b, high, 0.065)
    # base frame and X braces on the long sides
    for sy in (-1, 1):
        parts[m].tube((-a, sy * b, cz + 0.05), (a, sy * b, cz + 0.05), 0.045)
        for x0, x1 in ((-a, 0), (0, a)):
            parts[m].tube((x0, sy * b, cz + 0.08), (x1, sy * b, h - 0.12), 0.03)
            if high:
                parts[m].tube((x1, sy * b, cz + 0.08), (x0, sy * b, h - 0.12), 0.03)
    for sx in (-1, 0, 1):
        parts[m].tube((sx * a, -b, cz + 0.05), (sx * a, b, cz + 0.05), 0.045)
    # a steep ladder hooked over each end
    half = 0.24
    run = 0.45
    steps = 6
    for sx in (-1, 1):
        with place(parts, Matrix.Rotation(sx * 1.5707963, 4, "Z")):
            _ladder(parts, m, "tread", half, (-(w / 2) - run, 0.0), (-(w / 2), h), steps, high, 0.022)
    ix, iy = w / 2 - 0.03, d / 2 - 0.03
    for sy in (-1, 1):
        _rail_run(parts, m, [(-ix, sy * half), (-ix, sy * iy), (ix, sy * iy), (ix, sy * half)], h, high)
    parts.stand = (0.0, 0.0, h)


def stepladder(parts, high, **_):
    """A 6 ft aluminum A-frame stepladder, steps toward the audience. The drum
    major stands on the highest step you may stand on, two below the top cap."""
    h = 6 * FT
    s = _sides(high)
    steps = 5
    top_w, foot_w = 0.40, 0.56
    y_front_foot, y_front_top = -0.46, -0.07
    y_back_foot, y_back_top = 0.44, 0.07
    # front stiles: flat rails, the steps between them
    for sx in (-1, 1):
        parts["aluminum"].tube((sx * foot_w / 2, y_front_foot, 0.03), (sx * top_w / 2, y_front_top, h - 0.05), 0.022, 0.07)
        parts["rubber"].box((sx * foot_w / 2 - 0.025, y_front_foot - 0.04, 0), (sx * foot_w / 2 + 0.025, y_front_foot + 0.04, 0.03))
        parts["aluminum"].tube((sx * foot_w / 2, y_back_foot, 0.03), (sx * top_w / 2, y_back_top, h - 0.05), 0.022, 0.05)
        parts["rubber"].box((sx * foot_w / 2 - 0.025, y_back_foot - 0.03, 0), (sx * foot_w / 2 + 0.025, y_back_foot + 0.03, 0.03))
        # spreader arm, folded out flat
        z = h * 0.48
        t = z / h
        yf = y_front_foot + (y_front_top - y_front_foot) * t
        yb = y_back_foot + (y_back_top - y_back_foot) * t
        x = sx * (foot_w / 2 + (top_w - foot_w) / 2 * t)
        parts["aluminum"].tube((x, yf + 0.02, z), (x, yb - 0.02, z), 0.006, 0.02)
    stand_z = 0.0
    for i in range(1, steps + 1):
        z = h * i / (steps + 1)
        t = z / h
        yf = y_front_foot + (y_front_top - y_front_foot) * t
        half = foot_w / 2 + (top_w - foot_w) / 2 * t - 0.012
        parts["aluminum"].box((-half, yf - 0.045, z - 0.025), (half, yf + 0.045, z))
        if high:
            for k in range(3):
                yr = yf - 0.03 + k * 0.03
                parts["rubber"].box((-half + 0.01, yr - 0.004, z), (half - 0.01, yr + 0.004, z + 0.004))
        if i == steps - 1:
            stand_z, stand_y = z, yf
        # rear bracing rungs
        if i % 2:
            yb = y_back_foot + (y_back_top - y_back_foot) * t
            parts["aluminum"].rod((-half, yb, z), (half, yb, z), 0.009, s)
    # the molded top cap
    parts["rubber"].chamfer_box((-top_w / 2 - 0.02, -0.11, h - 0.05), (top_w / 2 + 0.02, 0.11, h), 0.01)
    parts.stand = (0.0, stand_y, stand_z)


def scaffold(parts, high, **_):
    """One layer of rolling frame scaffold: two 5 ft end frames with built-in
    rungs, 7 ft cross braces on the long sides, a plank deck about 2 m up,
    a guardrail with a mid rail and toeboards, on locking casters. You climb
    the rungs of the audience-side end frame."""
    s = _sides(high)
    w = 5 * FT
    span = 7 * FT
    deck = 2.0
    plank_t = 0.05
    frame_top = deck - plank_t
    cz = 0.15
    a, b = w / 2, span / 2
    r = 0.024
    for sy in (-1, 1):
        y = sy * b
        for sx in (-1, 1):
            parts["galvanized"].rod((sx * a, y, cz), (sx * a, y, frame_top), r, s)
            caster(parts, sx * a, y, high, 0.065)
        parts["galvanized"].rod((-a, y, frame_top - r), (a, y, frame_top - r), r, s)
        parts["galvanized"].rod((-a, y, cz + 0.06), (a, y, cz + 0.06), r, s)
        # inner ladder: rungs about 30 cm apart
        n = 5
        for i in range(1, n + 1):
            z = cz + 0.06 + (frame_top - r - cz - 0.06) * i / (n + 1)
            parts["galvanized"].rod((-a, y, z), (a, y, z), r * 0.75, s)
        if high:
            for sx in (-1, 1):
                parts["galvanized"].rod((sx * 0.25, y, cz + 0.06), (sx * 0.25, y, frame_top - r), r * 0.75, s)
    # cross braces on the long sides, pinned to the frame legs
    for sx in (-1, 1):
        x = sx * (a + 0.03)
        z0, z1 = cz + 0.35, frame_top - 0.35
        parts["galvanized"].rod((x, -b, z0), (x, b, z1), 0.012, s)
        parts["galvanized"].rod((x, -b, z1), (x, b, z0), 0.012, s)
    # plank deck across the frames' top bars
    planks = 5
    pw = w / planks
    for i in range(planks):
        x0 = -a + i * pw + 0.005
        parts["plank"].box((x0, -b - 0.1, frame_top), (x0 + pw - 0.01, b + 0.1, deck))
    # guardrail: posts on the frame legs, open in the middle of the audience side
    gap = 0.3
    for sy in (-1, 1):
        y = sy * b
        for sx in (-1, 1):
            parts["galvanized"].rod((sx * a, y, deck), (sx * a, y, deck + RAIL_H), r, s)
    rails = [((-a, -b), (-a, b)), ((a, -b), (a, b)), ((-a, b), (a, b)), ((-a, -b), (-gap, -b)), ((gap, -b), (a, -b))]
    for p, q in rails:
        for z in (deck + RAIL_H, deck + RAIL_H * 0.5):
            parts["galvanized"].rod((p[0], p[1], z), (q[0], q[1], z), r * 0.8, s)
    for sx in (-1, 1):
        parts["galvanized"].rod((sx * gap, -b, deck), (sx * gap, -b, deck + RAIL_H), r * 0.8, s)
    # toeboards
    t = 0.025
    tb = 0.1
    parts["plank"].box((-a, b - t, deck), (a, b, deck + tb))
    for sx in (-1, 1):
        parts["plank"].box((sx * a - (t if sx > 0 else 0), -b, deck), (sx * a + (0 if sx > 0 else t), b, deck + tb))
        x0, x1 = sorted((sx * a, sx * gap))
        parts["plank"].box((x0, -b, deck), (x1, -b + t, deck + tb))
    parts.stand = (0.0, 0.0, deck)
