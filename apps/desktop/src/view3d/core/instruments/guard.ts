// cspell:words cofactor forestock
/**
 * The color guard's equipment (docs/3d/instruments.md §3): a 6 ft flag, a
 * swing flag, a pair of swing flags, a drill rifle and a sabre. Pure: no
 * three.js.
 *
 * Instrument frame (must agree with the `flag`, `rifle` and `sabre` holds in
 * `holds.ts`): origin at the right hand's grip, +Z along the pole, barrel or
 * blade toward its far end, +Y the silk's face, the rifle's top or the
 * blade's flat. A flag's silk hangs from the top of its pole toward +X.
 *
 * `detail` sets segment counts: "high" for the full bodies, "low" for the
 * block tier.
 */
import {
    colorPieces,
    smoothLathe,
    smoothTube,
    PART_BLACK,
    PART_CHROME,
    PART_METAL,
    PART_SILK,
    PART_WOOD,
    type Piece,
    type Vec3,
} from "./mesh";
import type {
    Detail,
    InstrumentModel,
    ModelOptions,
    GuardModelId,
} from "./model";

/**
 * Default colors by part: chrome, black, a brass hilt, the white of a drill
 * rifle. The window recolors the metal finish and the silk (the section's
 * color), so those two are placeholders.
 */
export const GUARD_COLORS: Record<number, number> = {
    [PART_METAL]: 0xd9ad4f,
    [PART_CHROME]: 0xd9dde2,
    [PART_BLACK]: 0x141416,
    [PART_WOOD]: 0xf2f2f2,
    [PART_SILK]: 0xffffff,
};

interface SegmentCounts {
    /** Rings around a pole, barrel or strap. */
    tube: number;
    /** Rings around a lathed body: stock, blade, grip. */
    lathe: number;
    /** Rings around small parts: caps, bolt, swivels. */
    small: number;
    /** A silk's grid: cells out from the pole and along it. */
    silkOut: number;
    silkAlong: number;
    /** Rings along the sabre's blade, and ridges of wire on its grip. */
    blade: number;
    ridges: number;
}
const SEGMENTS: Record<Detail, SegmentCounts> = {
    high: {
        tube: 32,
        lathe: 48,
        small: 16,
        silkOut: 56,
        silkAlong: 36,
        blade: 40,
        ridges: 24,
    },
    low: {
        tube: 10,
        lathe: 12,
        small: 6,
        silkOut: 6,
        silkAlong: 4,
        blade: 10,
        ridges: 6,
    },
};

/** Row-major 3x3. */
type Mat3 = [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
];

function inverseTranspose(m: Mat3): Mat3 {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h;
    const B = -(d * i - f * g);
    const C = d * h - e * g;
    const det = a * A + b * B + c * C;
    // the cofactor matrix over the determinant is the inverse's transpose
    return [
        A / det,
        B / det,
        C / det,
        -(b * i - c * h) / det,
        (a * i - c * g) / det,
        -(a * h - b * g) / det,
        (b * f - c * e) / det,
        -(a * f - c * d) / det,
        (a * e - b * d) / det,
    ];
}

const det3 = (m: Mat3) =>
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6]);

/**
 * Applies `p' = M p + t` to a piece, carrying the normals through the
 * inverse transpose (so squashes and shears shade right) and flipping the
 * winding when M mirrors.
 */
function mapPiece(p: Piece, m: Mat3, t: Vec3 = [0, 0, 0]): Piece {
    const n = inverseTranspose(m);
    const out: Piece = { ...p, positions: [], normals: [], indices: [] };
    for (let i = 0; i < p.positions.length; i += 3) {
        const [x, y, z] = [
            p.positions[i],
            p.positions[i + 1],
            p.positions[i + 2],
        ];
        out.positions.push(
            m[0] * x + m[1] * y + m[2] * z + t[0],
            m[3] * x + m[4] * y + m[5] * z + t[1],
            m[6] * x + m[7] * y + m[8] * z + t[2],
        );
        const [a, b, c] = [p.normals[i], p.normals[i + 1], p.normals[i + 2]];
        const nx = n[0] * a + n[1] * b + n[2] * c;
        const ny = n[3] * a + n[4] * b + n[5] * c;
        const nz = n[6] * a + n[7] * b + n[8] * c;
        const l = Math.hypot(nx, ny, nz) || 1;
        out.normals.push(nx / l, ny / l, nz / l);
    }
    const flip = det3(m) < 0;
    for (let i = 0; i < p.indices.length; i += 3)
        if (flip)
            out.indices.push(p.indices[i], p.indices[i + 2], p.indices[i + 1]);
        else out.indices.push(p.indices[i], p.indices[i + 1], p.indices[i + 2]);
    return out;
}

/** smoothLathe's +Y axis turned onto +Z: (x, y, z) -> (x, -z, y). */
const Y_TO_Z: Mat3 = [1, 0, 0, 0, 0, -1, 0, 1, 0];
const mul = (a: Mat3, b: Mat3): Mat3 => {
    const o: number[] = [];
    for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++)
            o.push(
                a[r * 3] * b[c] +
                    a[r * 3 + 1] * b[3 + c] +
                    a[r * 3 + 2] * b[6 + c],
            );
    return o as Mat3;
};
const scaleXY = (sx: number, sy: number, shearYZ = 0): Mat3 => [
    sx,
    0,
    0,
    0,
    sy,
    shearYZ,
    0,
    0,
    1,
];

/**
 * A lathe along +Z: `profile` is (radius, z) pairs, the cross-section
 * scaled by `sx` and `sy` into an oval, its center dropped by `shearYZ * z`,
 * then moved by `t`. A zero radius at an end closes it to a point.
 */
function latheZ(
    profile: [number, number][],
    segments: number,
    part: number,
    sx = 1,
    sy = 1,
    t: Vec3 = [0, 0, 0],
    shearYZ = 0,
): Piece {
    return mapPiece(
        smoothLathe(profile, segments, part),
        mul(scaleXY(sx, sy, shearYZ), Y_TO_Z),
        t,
    );
}

/**
 * A flag's silk: a grid of `out` by `along` cells in the XZ plane, from
 * `x0` out `width` toward +X and from `z0` up `height` along the pole, with a
 * sine ripple of `ripple` in +Y that is still at the pole and grows toward
 * the fly end, so it reads as cloth. Shared vertices; per-vertex normals
 * follow the ripple's slope and face +Y (counterclockwise seen from +Y).
 */
function silk(
    width: number,
    height: number,
    ripple: number,
    out: number,
    along: number,
    x0: number,
    z0: number,
): Piece {
    const p: Piece = {
        part: PART_SILK,
        positions: [],
        normals: [],
        indices: [],
    };
    // u: 0 at the pole, 1 at the fly; v: 0 at the bottom, 1 at the top
    const f = (u: number, v: number) =>
        ripple *
        Math.sin((Math.PI / 2) * Math.min(1, 3 * u)) *
        Math.sin(2 * Math.PI * 1.5 * u + 0.6 * Math.PI * v);
    const h = 1e-4;
    for (let j = 0; j <= along; j++)
        for (let i = 0; i <= out; i++) {
            const u = i / out;
            const v = j / along;
            p.positions.push(x0 + u * width, f(u, v), z0 + v * height);
            // surface y = f(x, z): normal (-df/dx, 1, -df/dz)
            const dx = (f(u + h, v) - f(u - h, v)) / (2 * h * width);
            const dz = (f(u, v + h) - f(u, v - h)) / (2 * h * height);
            const l = Math.hypot(dx, 1, dz);
            p.normals.push(-dx / l, 1 / l, -dz / l);
        }
    const row = out + 1;
    for (let j = 0; j < along; j++)
        for (let i = 0; i < out; i++) {
            const a = j * row + i; // (x, z)
            const b = (j + 1) * row + i; // (x, z + 1)
            const c = (j + 1) * row + i + 1; // (x + 1, z + 1)
            const d = j * row + i + 1; // (x + 1, z)
            // +Z then +X from a: the cross product points +Y
            p.indices.push(a, b, c, a, c, d);
        }
    return p;
}

/** A capped chrome pole along Z from `from` to `to`. */
const pole = (from: number, to: number, radius: number, s: SegmentCounts) =>
    smoothTube(
        [
            [0, 0, from],
            [0, 0, to],
        ],
        radius,
        s.tube,
        PART_CHROME,
    );

/** A black rubber end cap over a pole's end at `z`, `dir` pointing off the end. */
function endCap(z: number, dir: 1 | -1, radius: number, s: SegmentCounts) {
    const r = radius + 0.003;
    const profile: [number, number][] = [
        [radius, z - dir * 0.045],
        [r, z - dir * 0.04],
        [r, z - dir * 0.006],
        [r * 0.8, z + dir * 0.004],
        [r * 0.4, z + dir * 0.008],
        [0, z + dir * 0.009],
    ];
    // the lathe's outward winding needs the profile to run toward +Z
    return latheZ(dir > 0 ? profile : profile.reverse(), s.small, PART_BLACK);
}

/** A band of black tape around a pole at `z`. */
const tape = (z: number, radius: number, s: SegmentCounts) =>
    smoothTube(
        [
            [0, 0, z - 0.015],
            [0, 0, z + 0.015],
        ],
        radius + 0.0015,
        s.tube,
        PART_BLACK,
    );

/** A pole from `butt` to `tip` with the silk hanging from its top `height`. */
function flag(
    butt: number,
    tip: number,
    radius: number,
    width: number,
    height: number,
    s: SegmentCounts,
): Piece[] {
    const bottom = tip - height;
    return [
        pole(butt, tip, radius, s),
        endCap(butt, -1, radius, s),
        endCap(tip, 1, radius, s),
        silk(width, height, 0.03, s.silkOut, s.silkAlong, radius, bottom),
        tape(bottom + 0.015, radius, s),
        tape(tip - 0.06, radius, s),
    ];
}

/**
 * Where the left hand holds the second swing flag in the instrument frame:
 * the `flag` carry hold's left wrist relative to the right. The flag hold
 * turns instrument +X onto the body's right, so the left hand is at −X.
 */
const LEFT_FLAG: Vec3 = [-0.55, -0.07, -0.05];

/** The 6 ft flag: a 1.83 m pole (butt below the hand) and a 36 by 54 in silk. */
function flag6(s: SegmentCounts): Omit<InstrumentModel, "id"> {
    return {
        pieces: flag(-0.6, 1.23, 0.012, 1.37, 0.9, s),
        leftGrip: [0, 0, -0.25],
        mouthpiece: [0, 0, 0],
    };
}

/** A swing flag: a 0.9 m pole with a 1.2 by 0.9 m silk along its length. */
function swingFlag(s: SegmentCounts): Omit<InstrumentModel, "id"> {
    return {
        pieces: flag(-0.3, 0.6, 0.013, 1.2, 0.9, s),
        leftGrip: [0, 0, -0.2],
        mouthpiece: [0, 0, 0],
    };
}

/** Two swing flags: the second mirrored in x and riding the left hand. */
function doubleSwingFlag(s: SegmentCounts): Omit<InstrumentModel, "id"> {
    const right = swingFlag(s).pieces;
    const left = right.map(
        (p): Piece => ({
            ...mapPiece(p, [-1, 0, 0, 0, 1, 0, 0, 0, 1], LEFT_FLAG),
            bone: "handL",
        }),
    );
    return {
        pieces: [...right, ...left],
        leftGrip: LEFT_FLAG,
        mouthpiece: [0, 0, 0],
    };
}

/**
 * A drill rifle, 0.91 m: a white stock from the butt 0.3 m behind the hand,
 * the wrist at the grip, a forestock and barrel ahead to the muzzle, a
 * chrome bolt on the right side (−X), a black sling slung under the body.
 */
function rifle(s: SegmentCounts): Omit<InstrumentModel, "id"> {
    const butt = -0.3;
    const muzzle = 0.61;
    const pieces: Piece[] = [
        // the stock: an oval deeper than wide, dropping toward the butt plate
        latheZ(
            [
                [0, butt],
                [0.016, butt],
                [0.024, butt + 0.003],
                [0.028, butt + 0.012],
                [0.03, butt + 0.04],
                [0.03, -0.2],
                [0.028, -0.15],
                [0.024, -0.1],
                [0.019, -0.05],
                [0.016, -0.02],
                [0.0155, 0.0],
                [0.017, 0.02],
                [0.02, 0.035],
            ],
            s.lathe,
            PART_WOOD,
            0.75,
            2,
            [0, 0, 0],
            0.1,
        ),
        // the receiver and forestock: a slimmer oval tapering to the barrel band
        latheZ(
            [
                [0, 0.03],
                [0.018, 0.03],
                [0.02, 0.04],
                [0.021, 0.08],
                [0.02, 0.15],
                [0.019, 0.25],
                [0.018, 0.35],
                [0.017, 0.45],
                [0.016, 0.5],
                [0.012, 0.515],
                [0, 0.52],
            ],
            s.lathe,
            PART_WOOD,
            0.85,
            1.35,
        ),
        // the barrel along the top of the forestock to the muzzle
        smoothTube(
            [
                [0, 0.012, 0.2],
                [0, 0.012, muzzle],
            ],
            0.0095,
            s.tube,
            PART_WOOD,
        ),
        // barrel bands
        smoothTube(
            [
                [0, 0.004, 0.47],
                [0, 0.004, 0.49],
            ],
            0.02,
            s.small,
            PART_CHROME,
        ),
        // the bolt: a chrome receiver plate on top, a handle out to the right with a ball knob
        smoothTube(
            [
                [0, 0.026, 0.04],
                [0, 0.026, 0.12],
            ],
            0.008,
            s.small,
            PART_CHROME,
        ),
        smoothTube(
            [
                [-0.004, 0.026, 0.06],
                [-0.03, 0.018, 0.055],
            ],
            0.003,
            s.small,
            PART_CHROME,
        ),
        latheZ(
            [
                [0, -0.007],
                [0.004, -0.006],
                [0.0065, -0.003],
                [0.007, 0],
                [0.0065, 0.003],
                [0.004, 0.006],
                [0, 0.007],
            ],
            s.small,
            PART_CHROME,
            1,
            1,
            [-0.034, 0.017, 0.055],
        ),
        // trigger guard under the wrist
        smoothTube(
            [
                [0, -0.028, 0.035],
                [0, -0.045, 0.045],
                [0, -0.045, 0.075],
                [0, -0.028, 0.085],
            ],
            0.0025,
            s.small,
            PART_CHROME,
        ),
    ];
    // the sling: swivel to swivel under the body, sagging a little in between
    const front: Vec3 = [0, -0.035, 0.45];
    const back: Vec3 = [0, -0.075, -0.22];
    const steps = 24;
    const sling: Vec3[] = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        sling.push([
            0,
            front[1] + (back[1] - front[1]) * t - 0.03 * Math.sin(Math.PI * t),
            front[2] + (back[2] - front[2]) * t,
        ]);
    }
    pieces.push(
        mapPiece(
            smoothTube(sling, 0.005, s.tube, PART_BLACK),
            // a flat strap: wide across X, thin in Y
            [2.4, 0, 0, 0, 0.6, 0, 0, 0, 1],
        ),
        // swivels
        smoothTube(
            [
                [0, -0.012, front[2]],
                [0, front[1], front[2]],
            ],
            0.003,
            s.small,
            PART_CHROME,
        ),
        smoothTube(
            [
                [0, -0.05, back[2]],
                [0, back[1], back[2]],
            ],
            0.003,
            s.small,
            PART_CHROME,
        ),
    );
    return { pieces, leftGrip: [0, 0, 0.36], mouthpiece: [0, 0, 0] };
}

/**
 * A guard sabre: a curved chrome blade 0.8 m ahead of the guard, flat across
 * Y, edge toward +X; a brass guard, knuckle bow and pommel; a black grip
 * 0.12 m behind the origin.
 */
function sabre(s: SegmentCounts): Omit<InstrumentModel, "id"> {
    const length = 0.8;
    const base = 0.015;
    const rings = s.blade;
    const profile: [number, number][] = [];
    for (let i = 0; i < rings; i++) {
        const t = i / rings;
        // tapers from 15 mm to 4 mm, then sweeps to a point over the last tenth
        const r =
            t < 0.9
                ? 0.015 + (0.004 - 0.015) * (t / 0.9)
                : 0.004 * Math.sqrt((1 - t) / 0.1) + 0.0008;
        profile.push([r, base + t * length]);
    }
    profile.push([0, base + length]);
    // a thin, flat blade (thick in Y a fifth of its width) curving back toward −X
    const blade = latheZ(profile, s.lathe, PART_CHROME, 1, 0.2);
    const k = 0.05 / (length * length);
    const bent: Piece = { ...blade, positions: [], normals: [] };
    for (let i = 0; i < blade.positions.length; i += 3) {
        const [x, y, z] = [
            blade.positions[i],
            blade.positions[i + 1],
            blade.positions[i + 2],
        ];
        const d = z - base;
        bent.positions.push(x - k * d * d, y, z);
        // x' = x + f(z): the normal's z loses f'(z) times its x
        const [nx, ny, nz] = [
            blade.normals[i],
            blade.normals[i + 1],
            blade.normals[i + 2] + 2 * k * d * blade.normals[i],
        ];
        const l = Math.hypot(nx, ny, nz) || 1;
        bent.normals.push(nx / l, ny / l, nz / l);
    }
    // the grip: a wire-wrapped black barrel from the pommel to the guard
    const grip: [number, number][] = [];
    const ridges = s.ridges;
    for (let i = 0; i <= ridges; i++) {
        const t = i / ridges;
        const swell = 0.013 + 0.002 * Math.sin(Math.PI * t);
        grip.push([swell + (i % 2 ? 0.0008 : 0), -0.12 + 0.12 * t]);
    }
    const pieces: Piece[] = [
        bent,
        latheZ(grip, s.lathe, PART_BLACK, 0.85, 1),
        // the guard: an oval brass plate, wider toward the edge side
        latheZ(
            [
                [0, 0],
                [0.025, 0],
                [0.03, 0.003],
                [0.03, 0.009],
                [0.025, 0.012],
                [0, 0.012],
            ],
            s.lathe,
            PART_METAL,
            1.3,
            0.8,
            [0.01, 0, 0.002],
        ),
        // the knuckle bow: from the guard's edge side back to the pommel
        smoothTube(
            [
                [0.042, 0, 0.006],
                [0.05, 0, -0.03],
                [0.046, 0, -0.08],
                [0.03, 0, -0.115],
                [0.012, 0, -0.128],
            ],
            0.004,
            s.small,
            PART_METAL,
        ),
        // the pommel cap
        latheZ(
            [
                [0, -0.14],
                [0.007, -0.138],
                [0.012, -0.132],
                [0.0145, -0.124],
                [0.014, -0.118],
                [0.012, -0.116],
            ],
            s.lathe,
            PART_METAL,
        ),
    ];
    return { pieces, leftGrip: [0, 0, -0.06], mouthpiece: [0, 0, 0] };
}

export function guardModel(
    id: GuardModelId,
    detail: Detail = "high",
    options: ModelOptions = {},
): InstrumentModel {
    const s = SEGMENTS[detail];
    const build =
        id === "flag6"
            ? flag6
            : id === "swingFlag"
              ? swingFlag
              : id === "doubleSwingFlag"
                ? doubleSwingFlag
                : id === "rifle"
                  ? rifle
                  : sabre;
    const model = build(s);
    return {
        id,
        options,
        ...model,
        pieces: colorPieces(
            model.pieces,
            (part) => GUARD_COLORS[part] ?? GUARD_COLORS[PART_CHROME],
        ),
    };
}
