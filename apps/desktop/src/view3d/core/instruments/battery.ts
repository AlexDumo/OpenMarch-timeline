// cspell:words spocks
/**
 * The battery's drums and cymbals (docs/3d/instruments.md §3, §4). Pure: no
 * three.js. Proportions follow side-view reference photos; nothing is
 * copied from them.
 *
 * Frames (they agree with `holds.ts`, which places the instrument frame on
 * the body: +Z the hold's bell axis, +Y its caps axis, +X = Y × Z):
 * - snare, tenors: origin at the top of the drum on the carrier, +Z up
 *   (the head's normal), +Y forward, so +X is the performer's right; the
 *   shells hang along −Z. They ride the chest (`spine002`).
 * - bass: origin at the drum's center, +Z the heads' axis toward the
 *   performer's left, +Y up, so +X points back at the player, where the
 *   carrier plate is. It rides the chest.
 * - cymbals: one plate in each hand, vertical, facing each other across X.
 *
 * Every piece, whichever bone it rides, is built in the instrument frame:
 * the window places the whole model by the hold and then carries each
 * piece on its bone. So sticks, mallets and cymbals are built at the hold's
 * hand grips, read from `holds.ts`, along each hand's fingers.
 */
import {
    arc,
    colorPieces,
    cylinder,
    smoothLathe,
    smoothTube,
    transformPiece,
    PART_BLACK,
    PART_CHROME,
    PART_HEAD,
    PART_METAL,
    PART_SHELL,
    PART_WOOD,
    type Mat4,
    type Piece,
    type Vec3,
} from "./mesh";
import { hold, type HoldFamily } from "./holds";
import type {
    BatteryModelId,
    Detail,
    InstrumentModel,
    ModelOptions,
} from "./model";

const IN = 0.0254;

/** The marching bass sizes, inches across the head, smallest first. */
export const BASS_SIZES_IN = [18, 20, 22, 24, 26, 28, 30, 32] as const;

/**
 * Sizes for a bass line of `count` drums, spread evenly over
 * `BASS_SIZES_IN`, smallest first. One drum gets the middle size; past
 * eight, sizes repeat.
 */
export function bassSizesFor(count: number): number[] {
    const n = Math.max(0, Math.floor(count));
    if (n === 0) return [];
    const last = BASS_SIZES_IN.length - 1;
    if (n === 1) return [BASS_SIZES_IN[Math.floor(BASS_SIZES_IN.length / 2)]];
    return Array.from(
        { length: n },
        (_, i) => BASS_SIZES_IN[Math.round((i * last) / (n - 1))],
    );
}

/** Default colors by part. The window recolors the shell (section) and the metal (finish). */
export const BATTERY_COLORS: Record<number, number> = {
    [PART_SHELL]: 0xffffff,
    [PART_HEAD]: 0xe9e6dc,
    [PART_CHROME]: 0xd9dde2,
    [PART_BLACK]: 0x141416,
    [PART_WOOD]: 0xd8b98a,
    [PART_METAL]: 0xc9a24a,
};

interface SegmentCounts {
    /** Around a shell and a head. */
    round: number;
    /** Points along a hoop. */
    hoop: number;
    /** Around a hoop's tube. */
    hoopRing: number;
    /** Around a lug, a rod, a bar. */
    small: number;
    /** Around a stick or a mallet. */
    stick: number;
    /** Rings in a head's profile, center to rim. */
    headRings: number;
}

const SEGMENTS: Record<Detail, SegmentCounts> = {
    high: {
        round: 64,
        hoop: 64,
        hoopRing: 10,
        small: 10,
        stick: 12,
        headRings: 4,
    },
    low: { round: 20, hoop: 20, hoopRing: 5, small: 5, stick: 5, headRings: 2 },
};
/** Six drums on one carrier: coarser rings so the set keeps the budget. */
const TENOR_SEGMENTS: Record<Detail, SegmentCounts> = {
    high: {
        round: 48,
        hoop: 40,
        hoopRing: 8,
        small: 7,
        stick: 10,
        headRings: 3,
    },
    low: { round: 14, hoop: 12, hoopRing: 4, small: 4, stick: 4, headRings: 1 },
};

// ---- small vector and matrix helpers ----

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => scale(a, 1 / (Math.hypot(...a) || 1));

/** A matrix taking the lathe's +Y to unit `dir`, with its origin at `at`. */
function alongAxis(dir: Vec3, at: Vec3): Mat4 {
    const y = unit(dir);
    const x = unit(cross(y, Math.abs(y[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const z = cross(x, y);
    return [...x, 0, ...y, 0, ...z, 0, ...at, 1];
}
/** A lathe along +Z, its base at `at`. */
const upZ = (p: Piece, at: Vec3) => transformPiece(p, alongAxis([0, 0, 1], at));

/** The hold's hand grips and finger directions, in the instrument frame. */
function hands(family: HoldFamily) {
    const h = hold(family, "up");
    const z = unit(h.instrument.bellAxis);
    const caps = h.instrument.capsAxis;
    const y = unit(sub(caps, scale(z, dot(caps, z))));
    const x = cross(y, z);
    const toFrame = (v: Vec3): Vec3 => [dot(v, x), dot(v, y), dot(v, z)];
    const grip = (wrist: Vec3, fingers: Vec3): Vec3 =>
        toFrame(sub(add(wrist, scale(fingers, 0.07)), h.instrument.origin));
    return {
        right: {
            grip: grip(h.right.wrist, h.right.fingers),
            fingers: toFrame(h.right.fingers),
        },
        left: {
            grip: grip(h.left.wrist, h.left.fingers),
            fingers: toFrame(h.left.fingers),
        },
    };
}

// ---- builders ----

interface DrumSpec {
    diameter: number;
    depth: number;
    lugs: number;
    /** A second head and hoop at the bottom (snare, bass); tenors are open below. */
    bottom: boolean;
}

/**
 * A drum along +Z: the shell from z = −depth to 0 at the origin, chrome
 * hoops and heads at the ends, lugs and tension rods around the shell.
 */
function drum(spec: DrumSpec, s: SegmentCounts): Piece[] {
    const r = spec.diameter / 2;
    const d = spec.depth;
    const out: Piece[] = [
        upZ(
            smoothLathe(
                [
                    [r, 0],
                    [r, d * 0.5],
                    [r, d],
                ],
                s.round,
                PART_SHELL,
            ),
            [0, 0, -d],
        ),
    ];
    // a head: a disc from the center to the rim, a little proud of the shell
    const headProfile = (h: number, up: boolean): [number, number][] => {
        const rings: [number, number][] = [[0, h]];
        for (let i = 1; i <= s.headRings; i++)
            rings.push([(r * 0.97 * i) / s.headRings, h]);
        rings.push([r + 0.003, h - (up ? 0.004 : -0.004)]);
        // traversed rim to center the normals face +Y; center to rim, −Y
        return up ? rings.reverse() : rings;
    };
    const hoop = (z: number) =>
        smoothTube(
            arc([0, 0, z], r + 0.004, 0, 360, s.hoop, "z"),
            0.006,
            s.hoopRing,
            PART_CHROME,
            { capStart: false, capEnd: false },
        );
    out.push(
        upZ(
            smoothLathe(headProfile(0.001, true), s.round, PART_HEAD),
            [0, 0, 0],
        ),
        hoop(0.004),
    );
    if (spec.bottom)
        out.push(
            upZ(smoothLathe(headProfile(-0.001, false), s.round, PART_HEAD), [
                0,
                0,
                -d,
            ]),
            hoop(-d - 0.004),
        );
    // lugs: a casing on the shell and rods to the hoops
    const lr = r + 0.012;
    for (let i = 0; i < spec.lugs; i++) {
        const a = ((i + 0.5) / spec.lugs) * Math.PI * 2;
        const x = Math.cos(a) * lr;
        const y = Math.sin(a) * lr;
        const top = -Math.min(0.04, d * 0.15);
        const low = spec.bottom ? -d - top : top - Math.min(0.07, d * 0.3);
        out.push(
            smoothTube(
                [
                    [x, y, low],
                    [x, y, top],
                ],
                0.0065,
                s.small,
                PART_CHROME,
            ),
            smoothTube(
                [
                    [x, y, top],
                    [x, y, 0.009],
                ],
                0.0028,
                s.small,
                PART_CHROME,
            ),
        );
        if (spec.bottom)
            out.push(
                smoothTube(
                    [
                        [x, y, -d - 0.009],
                        [x, y, low],
                    ],
                    0.0028,
                    s.small,
                    PART_CHROME,
                ),
            );
    }
    return out;
}

const moved = (pieces: Piece[], at: Vec3) =>
    pieces.map((p) =>
        transformPiece(p, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...at, 1]),
    );

/** A wooden stick from the hand's grip along `dir`, 0.41 long, with a bead tip. */
function stick(
    grip: Vec3,
    dir: Vec3,
    bone: "handR" | "handL",
    s: SegmentCounts,
) {
    const u = unit(dir);
    const len = 0.41;
    const at = (t: number) => add(grip, scale(u, t * len));
    const shaft = smoothTube(
        [at(0), at(0.6), at(0.92), at(0.985)],
        [0.008, 0.008, 0.0045, 0.0035],
        s.stick,
        PART_WOOD,
    );
    const bead = transformPiece(
        smoothLathe(sphereProfile(0.0065, 6), s.stick, PART_WOOD),
        alongAxis(u, at(0.985)),
    );
    return [shaft, bead].map((p) => ({ ...p, bone }));
}

/** (radius, height) pairs of a sphere of `r`, bottom pole to top pole. */
function sphereProfile(r: number, steps: number): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * Math.PI;
        out.push([Math.sin(t) * r, -Math.cos(t) * r]);
    }
    return out;
}

/**
 * The carrier at the chest: a black plate (radius 0.12, 0.02 thick) whose
 * axis is `normal`, at `center`, and chrome bars from `mounts` to it.
 */
function carrier(
    center: Vec3,
    normal: Vec3,
    mounts: [Vec3, Vec3][],
    s: SegmentCounts,
): Piece[] {
    const n = unit(normal);
    return [
        cylinder(
            0.12,
            sub(center, scale(n, 0.01)),
            add(center, scale(n, 0.01)),
            s.round,
            PART_BLACK,
        ),
        ...mounts.map(([a, b]) =>
            smoothTube(
                [a, add(scale(a, 0.5), scale(b, 0.5)), b],
                0.007,
                s.small,
                PART_CHROME,
            ),
        ),
    ];
}

const finish = (
    id: BatteryModelId,
    pieces: Piece[],
    extra: Partial<InstrumentModel> = {},
): InstrumentModel => ({
    id,
    pieces: colorPieces(
        pieces,
        (part) => BATTERY_COLORS[part] ?? BATTERY_COLORS[PART_CHROME],
    ),
    leftGrip: [0, 0, 0],
    mouthpiece: [0, 0, 0],
    ...extra,
});

/** Sticks for a drum family: along each hand's fingers, tipped down toward the heads. */
function sticks(family: HoldFamily, s: SegmentCounts): Piece[] {
    const h = hands(family);
    const down: Vec3 = [0, 0, -0.22];
    return [
        ...stick(h.right.grip, add(h.right.fingers, down), "handR", s),
        ...stick(h.left.grip, add(h.left.fingers, down), "handL", s),
    ];
}

/** The marching snare: 14 by 12 inches, ten lugs, on a carrier. */
function snare(detail: Detail): InstrumentModel {
    const s = SEGMENTS[detail];
    const r = 0.356 / 2;
    const d = 0.305;
    const back = -Math.sqrt(r * r - 0.1 * 0.1) - 0.012;
    const pieces: Piece[] = [
        ...drum({ diameter: 0.356, depth: d, lugs: 10, bottom: true }, s),
        // the plate sits against the chest, behind and below the shell's middle
        ...carrier(
            [0, -0.215, -0.2],
            [0, 1, 0],
            [
                [
                    [0.1, back, -0.03],
                    [0.08, -0.205, -0.28],
                ],
                [
                    [-0.1, back, -0.03],
                    [-0.08, -0.205, -0.28],
                ],
            ],
            s,
        ),
        ...sticks("snare", s),
    ];
    return finish("snare", pieces, { bone: "spine002" });
}

/**
 * Quads and spocks. Instrument +X is the performer's right, so the
 * 10 inch drum sits at −X and the 14 at +X; the middle drums sit 0.2 m
 * forward of the outer ones, the spocks in front of them.
 */
const TENOR_DRUMS: { inches: number; x: number; y: number; depth: number }[] = [
    { inches: 10, x: -0.42, y: -0.05, depth: 0.25 },
    { inches: 12, x: -0.16, y: 0.15, depth: 0.27 },
    { inches: 13, x: 0.17, y: 0.15, depth: 0.28 },
    { inches: 14, x: 0.48, y: -0.05, depth: 0.29 },
    // spocks
    { inches: 6, x: -0.08, y: 0.4, depth: 0.16 },
    { inches: 8, x: 0.12, y: 0.42, depth: 0.18 },
];

function tenors(detail: Detail): InstrumentModel {
    const s = TENOR_SEGMENTS[detail];
    const pieces: Piece[] = [];
    for (const t of TENOR_DRUMS) {
        const diameter = t.inches * IN;
        pieces.push(
            ...moved(
                drum(
                    {
                        diameter,
                        depth: t.depth,
                        lugs: t.inches < 10 ? 4 : 6,
                        bottom: false,
                    },
                    s,
                ),
                [t.x, t.y, 0],
            ),
        );
    }
    // the frame: a chrome bar behind the four drums, struts to the spocks, and the carrier
    const z = -0.07;
    const behind = TENOR_DRUMS.slice(0, 4).map(
        (t): Vec3 => [t.x, t.y - (t.inches * IN) / 2 - 0.015, z],
    );
    const front = (i: number): Vec3 => {
        const t = TENOR_DRUMS[i];
        return [t.x, t.y + (t.inches * IN) / 2 + 0.01, z];
    };
    const spockBack = (i: number): Vec3 => {
        const t = TENOR_DRUMS[i];
        return [t.x, t.y - (t.inches * IN) / 2 - 0.01, z];
    };
    pieces.push(
        smoothTube(behind, 0.009, s.small, PART_CHROME),
        smoothTube([front(1), spockBack(4)], 0.006, s.small, PART_CHROME),
        smoothTube([front(2), spockBack(5)], 0.006, s.small, PART_CHROME),
        smoothTube([front(1), front(2)], 0.006, s.small, PART_CHROME),
        ...carrier(
            [0, -0.235, -0.15],
            [0, 1, 0],
            [
                [
                    [-0.1, -0.03, z],
                    [-0.07, -0.225, -0.2],
                ],
                [
                    [0.1, -0.045, z],
                    [0.07, -0.225, -0.2],
                ],
            ],
            s,
        ),
        ...sticks("tenors", s),
    );
    return finish("tenors", pieces, { bone: "spine002" });
}

/** A marching bass on its side: heads along ±Z, the carrier plate at +X (the player). */
function bass(detail: Detail, inches: number): InstrumentModel {
    const s = SEGMENTS[detail];
    const diameter = inches * IN;
    const r = diameter / 2;
    const d = 0.356;
    const pieces: Piece[] = moved(
        drum({ diameter, depth: d, lugs: 10, bottom: true }, s),
        [0, 0, d / 2],
    );
    pieces.push(
        ...carrier(
            [r + 0.04, 0, 0],
            [1, 0, 0],
            [
                [
                    [r + 0.004, 0.06, d / 2 - 0.004],
                    [r + 0.03, 0.06, 0.06],
                ],
                [
                    [r + 0.004, 0.06, -d / 2 + 0.004],
                    [r + 0.03, 0.06, -0.06],
                ],
            ],
            s,
        ),
    );
    // mallets: shaft from the grip, the head on the drum head's plane, low and forward
    const h = hands("bass");
    const L = 0.38;
    for (const [side, bone, sign] of [
        [h.right, "handR", -1],
        [h.left, "handL", 1],
    ] as const) {
        const g = side.grip;
        const headZ = sign * (d / 2 + 0.05);
        const headY = g[1] - 0.2;
        const dz = headZ - g[2];
        const dy = headY - g[1];
        const reach = L - 0.045;
        const dx = -Math.sqrt(Math.max(reach * reach - dz * dz - dy * dy, 0));
        const head: Vec3 = [g[0] + dx, headY, headZ];
        const dir = unit(sub(head, g));
        pieces.push(
            {
                ...smoothTube(
                    [g, add(g, scale(dir, reach))],
                    0.012,
                    s.stick,
                    PART_WOOD,
                ),
                bone,
            },
            {
                ...transformPiece(
                    smoothLathe(
                        sphereProfile(0.045, 10),
                        s.stick * 2,
                        PART_BLACK,
                    ),
                    alongAxis(dir, add(head, scale(dir, 0.04))),
                ),
                bone,
            },
        );
    }
    return finish("bass", pieces, {
        bone: "spine002",
        options: { bassInches: inches },
    });
}

/**
 * A crash cymbal's profile, (radius, height): the underside from the
 * center out, the edge, then the top back in, so the normals face out on
 * both sides. The bell (radius 0.06, 0.03 high) rises toward +Y.
 */
function cymbalProfile(detail: Detail): [number, number][] {
    const R = 0.457 / 2;
    const bellR = 0.06;
    const bellH = 0.03;
    const bow = 0.022;
    const th = 0.0025;
    const bellSteps = detail === "high" ? 5 : 2;
    const bowSteps = detail === "high" ? 9 : 5;
    const top: [number, number][] = [];
    for (let i = 0; i <= bellSteps; i++) {
        const r = (i / bellSteps) * bellR;
        top.push([r, bow + bellH * Math.cos(((r / bellR) * Math.PI) / 2)]);
    }
    for (let i = 1; i <= bowSteps; i++) {
        const t = i / bowSteps;
        top.push([bellR + (R - bellR) * t, bow * (1 - t) ** 1.3]);
    }
    const under = top.map(([r, y]): [number, number] => [
        r === 0 ? 0 : Math.max(r - th * 0.3, 0),
        y - th,
    ]);
    return [...under, ...top.reverse()];
}

/** Two 18 inch crash cymbals, one in each hand, inside faces toward each other. */
function cymbals(detail: Detail): InstrumentModel {
    const s = SEGMENTS[detail];
    const h = hands("cymbals");
    const profile = cymbalProfile(detail);
    const plate = (grip: Vec3, bell: Vec3, bone: "handR" | "handL"): Piece => ({
        // the strap holds the bell against the palm: the plate sits just inside the grip
        ...transformPiece(
            smoothLathe(profile, s.round, PART_METAL),
            alongAxis(bell, sub(grip, scale(bell, 0.03))),
        ),
        bone,
    });
    // the right hand is at −X, the left at +X (the cymbals' frame keeps +X the performer's left)
    return finish("cymbals", [
        plate(h.right.grip, [-1, 0, 0], "handR"),
        plate(h.left.grip, [1, 0, 0], "handL"),
    ]);
}

export function batteryModel(
    id: BatteryModelId,
    detail: Detail = "high",
    options: ModelOptions = {},
): InstrumentModel {
    switch (id) {
        case "snare":
            return snare(detail);
        case "tenors":
            return tenors(detail);
        case "bass":
            return bass(detail, options.bassInches ?? 26);
        case "cymbals":
            return cymbals(detail);
    }
}
