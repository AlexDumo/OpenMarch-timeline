// cspell:words lerp
/**
 * The woodwinds' instruments (docs/3d/instruments.md §3, §4), built from
 * numbers in the manner of `brass.ts`; proportions follow the reference
 * pages, nothing is copied from them. Pure: no three.js.
 *
 * Instrument frame: the mouthpiece (the lips, for the flutes) is the
 * origin, +Z runs down the instrument toward its far end and +Y toward the
 * keys. Flute and piccolo: +Z along the tube toward the foot joint.
 * Clarinets and the soprano sax: +Z down the body toward the bell. Alto,
 * tenor and bari sax: +Z down the neck and body toward the bow; the bell
 * then turns back up along −Z, offset toward +X. The hold places the right
 * hand; `leftGrip` is the left hand's point on the body.
 */
import {
    arc,
    bellProfile,
    colorPieces,
    cylinder,
    smoothLathe,
    smoothTube,
    transformPiece,
    PART_BLACK,
    PART_CHROME,
    PART_METAL,
    PART_WOOD,
    type Mat4,
    type Piece,
    type Vec3,
} from "./mesh";
import type {
    Detail,
    InstrumentModel,
    ModelOptions,
    WoodwindModelId,
} from "./model";

/**
 * Overall length along +Z (crown to foot, or mouthpiece tip to the bottom of
 * the bow), the bore at the top of the body (a radius) and the bell's rim
 * diameter: meters.
 */
export const WOODWIND_DIMENSIONS: Record<
    WoodwindModelId,
    { length: number; bore: number; bell: number }
> = {
    piccolo: { length: 0.32, bore: 0.0075, bell: 0.015 },
    flute: { length: 0.67, bore: 0.0095, bell: 0.019 },
    clarinet: { length: 0.66, bore: 0.017, bell: 0.07 },
    bassClarinet: { length: 1.0, bore: 0.024, bell: 0.18 },
    sopranoSax: { length: 0.65, bore: 0.012, bell: 0.09 },
    altoSax: { length: 0.65, bore: 0.02, bell: 0.12 },
    tenorSax: { length: 0.8, bore: 0.024, bell: 0.14 },
    bariSax: { length: 1.0, bore: 0.032, bell: 0.19 },
};

/** Default colors by part: gold lacquer, chrome, black and cork. The window recolors the lacquer. */
export const WOODWIND_COLORS: Record<number, number> = {
    [PART_METAL]: 0xd9ad4f,
    [PART_CHROME]: 0xd9dde2,
    [PART_BLACK]: 0x141416,
    [PART_WOOD]: 0x5b3a1a,
};

interface SegmentCounts {
    tube: number;
    keys: number;
    bell: number;
    crook: number;
}
const SEGMENTS: Record<Detail, SegmentCounts> = {
    high: { tube: 24, keys: 12, bell: 48, crook: 10 },
    low: { tube: 8, keys: 5, bell: 12, crook: 4 },
};

const translate = (v: Vec3): Mat4 => [
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    v[0],
    v[1],
    v[2],
    1,
];
/** A lathe's +Y turned to +Z, or to −Z for a bell that opens upward. */
const Y_TO_Z: Mat4 = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
const Y_TO_NEG_Z: Mat4 = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
const at = (p: Piece, v: Vec3) => transformPiece(p, translate(v));

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Points between `a` and `b` at fractions `ts`. */
function between(a: Vec3, b: Vec3, ts: number[]): Vec3[] {
    return ts.map(
        (k): Vec3 => [
            lerp(a[0], b[0], k),
            lerp(a[1], b[1], k),
            lerp(a[2], b[2], k),
        ],
    );
}

/** Radii tapering from `r0` to `r1` by distance along `path`. */
function taper(path: Vec3[], r0: number, r1: number): number[] {
    const d = [0];
    for (let i = 1; i < path.length; i++) {
        const [a, b] = [path[i - 1], path[i]];
        d.push(d[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    const total = d[d.length - 1] || 1;
    return d.map((x) => lerp(r0, r1, x / total));
}

/**
 * A path drawn by heading and turns in the plane of +Z and +Y: heading 0°
 * is +Z, 90° is +Y. A positive turn swings the heading toward +Y.
 */
function turtle(start: Vec3, headingDeg: number) {
    const dir = (deg: number): Vec3 => {
        const r = (deg * Math.PI) / 180;
        return [0, Math.sin(r), Math.cos(r)];
    };
    const move = (p: Vec3, d: Vec3, k: number): Vec3 => [
        p[0] + d[0] * k,
        p[1] + d[1] * k,
        p[2] + d[2] * k,
    ];
    let p = start;
    let h = headingDeg;
    const points: Vec3[] = [start];
    const t = {
        points,
        end: () => p,
        heading: () => h,
        line(length: number) {
            p = move(p, dir(h), length);
            points.push(p);
            return t;
        },
        /** Straight on until z reaches `z` (heading 0°). */
        toZ(z: number) {
            return t.line(z - p[2]);
        },
        turn(deg: number, radius: number, steps: number) {
            const side = Math.sign(deg) * 90;
            const center = move(p, dir(h + side), radius);
            for (let i = 1; i <= steps; i++)
                points.push(
                    move(center, dir(h + (deg * i) / steps + side), -radius),
                );
            h += deg;
            p = points[points.length - 1];
            return t;
        },
    };
    return t;
}

/** Builders bound to one detail level. */
function tools(s: SegmentCounts) {
    const run = (
        path: Vec3[],
        r: number | number[],
        part = PART_METAL,
        caps = false,
    ) => smoothTube(path, r, s.tube, part, { capStart: caps, capEnd: caps });
    const thin = (a: Vec3, b: Vec3, r: number, part = PART_CHROME) =>
        smoothTube([a, b], r, s.keys, part);
    /** A sleeve around the +Z axis through `p`. */
    const band = (p: Vec3, r: number, width: number, part = PART_CHROME) =>
        smoothTube(
            [
                [p[0], p[1], p[2] - width / 2],
                [p[0], p[1], p[2] + width / 2],
            ],
            r,
            s.tube,
            part,
        );
    /** A domed key cup of radius `r` facing +Y, its pad seat at `p`, with the black pad's edge under it. */
    const cup = (p: Vec3, r: number, part = PART_METAL) => {
        const h = 0.004;
        return [
            at(
                smoothLathe(
                    [
                        [0, h],
                        [r * 0.55, h],
                        [r * 0.9, h * 0.85],
                        [r, h * 0.45],
                        [r, 0],
                        [r * 0.85, 0],
                    ],
                    s.keys,
                    part,
                ),
                p,
            ),
            at(
                smoothLathe(
                    [
                        [r * 0.85, 0],
                        [r * 0.9, -0.0012],
                    ],
                    s.keys,
                    PART_BLACK,
                ),
                p,
            ),
        ];
    };
    /** A ring key around an open tone hole, lying on the +Y face at `p`. */
    const ringKey = (p: Vec3, r: number) =>
        smoothTube(
            arc(p, r, 0, 360, s.crook * 2, "y"),
            0.0011,
            s.keys,
            PART_CHROME,
        );
    /** A key rod along +Z from `z0` to `z1` at (x, y), on a post at each end down to `bodyY`. */
    const rod = (
        x: number,
        y: number,
        z0: number,
        z1: number,
        bodyY: number,
    ) => [
        thin([x, y, z0], [x, y, z1], 0.0014),
        thin([x, bodyY, z0 + 0.004], [x, y, z0 + 0.004], 0.0018),
        thin([x, bodyY, z1 - 0.004], [x, y, z1 - 0.004], 0.0018),
    ];
    /** A flaring bell along +Z from `base` (or along −Z when `up`). */
    const bell = (
        throat: number,
        rim: number,
        length: number,
        base: Vec3,
        part = PART_METAL,
        up = false,
    ) =>
        at(
            transformPiece(
                smoothLathe(bellProfile(throat, rim, length), s.bell, part),
                up ? Y_TO_NEG_Z : Y_TO_Z,
            ),
            base,
        );
    /** A black reed mouthpiece from its tip at the origin to `end`, with a chrome ligature. */
    const mouthpiece = (end: Vec3, r: number) => [
        run(
            between([0, 0, 0], end, [0, 0.15, 0.7, 1]),
            [r * 0.45, r * 0.8, r, r],
            PART_BLACK,
            true,
        ),
        run(between([0, 0, 0], end, [0.45, 0.68]), r * 1.08, PART_CHROME),
    ];
    return { run, thin, band, cup, ringKey, rod, bell, mouthpiece };
}

function colored(
    id: WoodwindModelId,
    options: ModelOptions,
    pieces: Piece[],
    leftGrip: Vec3,
): InstrumentModel {
    return {
        id,
        options,
        pieces: colorPieces(
            pieces,
            (part) => WOODWIND_COLORS[part] ?? WOODWIND_COLORS[PART_METAL],
        ),
        leftGrip,
        mouthpiece: [0, 0, 0],
    };
}

/**
 * Flute and piccolo: a straight chrome tube from the crown behind the lips
 * to the foot, the lip plate on the player's side (−Y), the keys on top.
 */
function flute(
    id: "piccolo" | "flute",
    detail: Detail,
    options: ModelOptions,
): InstrumentModel {
    const d = WOODWIND_DIMENSIONS[id];
    const s = SEGMENTS[detail];
    const t = tools(s);
    const pic = id === "piccolo";
    const r = d.bore;
    const crown = pic ? -0.03 : -0.045;
    const end = crown + d.length;
    const headEnd = crown + (pic ? 0.11 : 0.21);
    const footStart = pic ? end : end - 0.12;
    const keys = pic ? 14 : 16;
    const first = headEnd + (pic ? 0.03 : 0.04);
    const last = end - 0.025;
    const rodX = r + 0.005;
    const rodY = r * 0.55;
    const plate = pic ? 0.009 : 0.011;
    const pieces: Piece[] = [
        t.run(
            [
                [0, 0, crown],
                [0, 0, 0],
                [0, 0, headEnd],
            ],
            [r * 0.88, r * 0.94, r],
            PART_CHROME,
        ),
        t.run(
            [
                [0, 0, headEnd],
                [0, 0, footStart],
            ],
            r,
            PART_CHROME,
            pic,
        ),
        t.band([0, 0, crown - 0.006], r * 1.15, 0.012),
        t.band([0, 0, headEnd], r * 1.12, 0.014),
        // the lip plate, an oval stretched along the tube, and its embouchure hole
        transformPiece(
            cylinder(
                plate,
                [0, -r + 0.002, 0],
                [0, -r - 0.0015, 0],
                s.keys,
                PART_CHROME,
            ),
            [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1.45, 0, 0, 0, 0, 1],
        ),
        cylinder(
            plate * 0.4,
            [0, -r - 0.0014, 0],
            [0, -r - 0.0018, 0],
            s.keys,
            PART_BLACK,
        ),
        ...t.rod(rodX, rodY, first - 0.01, last + 0.01, r * 0.5),
        ...t.rod(
            -rodX,
            rodY,
            first + 0.06,
            first + (pic ? 0.12 : 0.2),
            r * 0.5,
        ),
    ];
    if (!pic)
        pieces.push(
            t.run(
                [
                    [0, 0, footStart],
                    [0, 0, end],
                ],
                r,
                PART_CHROME,
                true,
            ),
            t.band([0, 0, footStart], r * 1.12, 0.014),
        );
    for (let i = 0; i < keys; i++) {
        const z = lerp(first, last, i / (keys - 1));
        const x = i % 4 === 3 ? -r * 0.35 : 0;
        pieces.push(
            ...t.cup([x, r - 0.0005, z], pic ? 0.0065 : 0.008, PART_CHROME),
            t.thin([x, r + 0.002, z], [rodX, rodY, z], 0.0012),
            // the key's hinge sleeve on the rod
            t.thin([rodX, rodY, z - 0.006], [rodX, rodY, z + 0.006], 0.0022),
        );
    }
    return colored(id, options, pieces, [0, 0, first + 0.03]);
}

/** The clarinet: a black body in joints, chrome rings and cups, a black bell with a chrome rim. */
function clarinet(detail: Detail, options: ModelOptions): InstrumentModel {
    const d = WOODWIND_DIMENSIONS.clarinet;
    const s = SEGMENTS[detail];
    const t = tools(s);
    const r = d.bore;
    const bellStart = d.length - 0.08;
    const pieces: Piece[] = [
        ...t.mouthpiece([0, 0, 0.09], 0.0135),
        // barrel, upper joint, lower joint, bell and its chrome rim
        t.run(
            between([0, 0, 0.09], [0, 0, 0.15], [0, 0.5, 1]),
            [r * 1.12, r * 1.08, r * 1.12],
            PART_BLACK,
        ),
        t.run(
            between([0, 0, 0.15], [0, 0, 0.38], [0, 1]),
            [r * 1.02, r],
            PART_BLACK,
        ),
        t.run(
            between([0, 0, 0.38], [0, 0, bellStart], [0, 1]),
            [r, r * 1.06],
            PART_BLACK,
        ),
        t.bell(r * 1.06, d.bell / 2, 0.08, [0, 0, bellStart], PART_BLACK),
        t.run(
            arc([0, 0, d.length], d.bell / 2, 0, 360, s.crook * 3, "z"),
            0.002,
            PART_CHROME,
        ),
        ...[0.09, 0.15, 0.38, bellStart].map((z) =>
            t.band([0, 0, z], r * 1.16, 0.008),
        ),
        // register key and thumb rest on the player's side
        t.thin([0, -r - 0.002, 0.19], [0, -r - 0.002, 0.25], 0.0016),
        t.thin([0, -r, 0.42], [0, -r - 0.012, 0.42], 0.004),
        ...t.rod(r + 0.004, r * 0.5, 0.17, 0.36, r * 0.4),
        ...t.rod(r + 0.004, r * 0.5, 0.4, 0.57, r * 0.4),
        ...t.rod(-r - 0.004, r * 0.5, 0.44, 0.57, r * 0.4),
    ];
    for (const z of [0.21, 0.25, 0.29, 0.44, 0.48, 0.52])
        pieces.push(t.ringKey([0, r + 0.0005, z], 0.0068));
    const cups: [number, number][] = [
        [0.17, 0.0075],
        [0.19, 0.007],
        [0.32, 0.0075],
        [0.34, 0.008],
        [0.36, 0.0075],
        [0.41, 0.008],
        [0.54, 0.009],
        [0.555, 0.009],
        [0.57, 0.0095],
        [0.585, 0.0095],
        [0.6, 0.011],
        [0.62, 0.012],
    ];
    cups.forEach(([z, cr], i) => {
        const x = (i % 2 ? 1 : -1) * r * 0.45;
        pieces.push(...t.cup([x, r * 0.92, z], cr, PART_CHROME));
    });
    return colored("clarinet", options, pieces, [0, 0, 0.24]);
}

/** The bass clarinet: a chrome crook to a long black body, then a chrome upturned bell and a peg. */
function bassClarinet(detail: Detail, options: ModelOptions): InstrumentModel {
    const d = WOODWIND_DIMENSIONS.bassClarinet;
    const s = SEGMENTS[detail];
    const t = tools(s);
    const r = d.bore;
    const mpEnd = turtle([0, 0, 0], 55).line(0.085).end();
    const neck = turtle(mpEnd, 55).line(0.04).turn(-55, 0.05, s.crook).toZ(0.2);
    const yb = neck.end()[1];
    const bodyEnd = 0.87;
    // the bell's crook: a U toward the front (+Y), opening upward
    const bow = turtle([0, yb, bodyEnd], 0)
        .turn(180, 0.06, s.crook * 2)
        .line(0.04);
    const pieces: Piece[] = [
        ...t.mouthpiece(mpEnd, 0.016),
        t.run(neck.points, taper(neck.points, 0.012, 0.016), PART_CHROME),
        t.run(between([0, yb, 0.2], [0, yb, 0.52], [0, 1]), r, PART_BLACK),
        t.run(
            between([0, yb, 0.52], [0, yb, bodyEnd], [0, 1]),
            [r, r * 1.08],
            PART_BLACK,
        ),
        ...[0.2, 0.52, bodyEnd].map((z) => t.band([0, yb, z], r * 1.15, 0.012)),
        t.run(bow.points, taper(bow.points, r * 1.1, r * 1.5), PART_CHROME),
        t.bell(r * 1.5, d.bell / 2, 0.13, bow.end(), PART_CHROME, true),
        // the peg under the crook
        t.thin(
            [0, yb + 0.06, bodyEnd + 0.06],
            [0, yb + 0.06, d.length - 0.002],
            0.004,
        ),
        ...t.rod(r + 0.005, yb + r * 0.5, 0.24, 0.5, yb + r * 0.4),
        ...t.rod(r + 0.005, yb + r * 0.5, 0.55, 0.84, yb + r * 0.4),
        ...t.rod(-r - 0.005, yb + r * 0.5, 0.6, 0.84, yb + r * 0.4),
    ];
    for (let i = 0; i < 16; i++) {
        const z = lerp(0.25, 0.83, i / 15);
        const x = (i % 2 ? 1 : -1) * r * 0.35;
        pieces.push(
            ...t.cup(
                [x, yb + r * 0.9, z],
                lerp(0.012, 0.016, i / 15),
                PART_CHROME,
            ),
        );
    }
    return colored("bassClarinet", options, pieces, [0, yb, 0.35]);
}

/** The straight soprano: a conical brass tube from the mouthpiece to a small bell. */
function sopranoSax(detail: Detail, options: ModelOptions): InstrumentModel {
    const d = WOODWIND_DIMENSIONS.sopranoSax;
    const t = tools(SEGMENTS[detail]);
    const flareAt = d.length - 0.1;
    const body = between(
        [0, 0, 0.06],
        [0, 0, flareAt],
        [0, 0.25, 0.5, 0.75, 1],
    );
    const rAt = (z: number) => lerp(0.012, 0.03, (z - 0.06) / (flareAt - 0.06));
    const pieces: Piece[] = [
        ...t.mouthpiece([0, 0, 0.06], 0.012),
        t.run(body, taper(body, 0.012, 0.03), PART_METAL),
        t.bell(0.03, d.bell / 2, 0.1, [0, 0, flareAt], PART_METAL),
        ...t.rod(0.02, 0.008, 0.1, 0.52, 0.004),
        ...t.rod(-0.022, 0.01, 0.3, 0.53, 0.006),
        // thumb rest
        t.thin([0, -0.016, 0.33], [0, -0.03, 0.33], 0.004),
    ];
    for (let i = 0; i < 16; i++) {
        const z = lerp(0.1, 0.53, i / 15);
        const x = ((i % 3) - 1) * rAt(z) * 0.3;
        pieces.push(
            ...t.cup(
                [x, rAt(z) * 0.9, z],
                lerp(0.009, 0.014, i / 15),
                PART_CHROME,
            ),
        );
    }
    return colored("sopranoSax", options, pieces, [0, 0, 0.18]);
}

interface SaxShape {
    /** The mouthpiece's heading from +Z toward +Y, and its length. */
    mpHeading: number;
    mpLength: number;
    /** The neck: a straight run, then turns as [degrees, radius] down to +Z. */
    neckLine: number;
    neck: [number, number][];
    /** Bari only: the drop below the neck, then two U turns (radii) with a rise between. */
    loop?: { drop: number; radii: [number, number]; rise: number };
    bodyTop: number;
    /** Body radius at the top and at the bow. */
    rTop: number;
    rBow: number;
    /** Bow width between the body's and the bell's axes. */
    bowWidth: number;
    /** The bell's straight rise above the bow, then its flare. */
    bellRise: number;
    flare: number;
    keys: number;
}

const SAX_SHAPES: Record<"altoSax" | "tenorSax" | "bariSax", SaxShape> = {
    altoSax: {
        mpHeading: 55,
        mpLength: 0.07,
        neckLine: 0.02,
        neck: [[-55, 0.08]],
        bodyTop: 0.2,
        rTop: 0.02,
        rBow: 0.045,
        bowWidth: 0.11,
        bellRise: 0.16,
        flare: 0.14,
        keys: 18,
    },
    tenorSax: {
        mpHeading: 50,
        mpLength: 0.085,
        neckLine: 0.02,
        // the tenor's neck rises a little before it bends down: an S
        neck: [
            [25, 0.07],
            [-75, 0.1],
        ],
        bodyTop: 0.25,
        rTop: 0.024,
        rBow: 0.052,
        bowWidth: 0.13,
        bellRise: 0.2,
        flare: 0.16,
        keys: 19,
    },
    bariSax: {
        mpHeading: 90,
        mpLength: 0.1,
        neckLine: 0.08,
        neck: [[-90, 0.07]],
        loop: { drop: 0.2, radii: [0.05, 0.07], rise: 0.07 },
        bodyTop: 0.2,
        rTop: 0.032,
        rBow: 0.068,
        bowWidth: 0.17,
        bellRise: 0.22,
        flare: 0.2,
        keys: 20,
    },
};

/** The neck (and the bari's loop, folding back toward the player) down to the top of the body. */
function saxTop(shape: SaxShape, s: SegmentCounts) {
    const mpEnd = turtle([0, 0, 0], shape.mpHeading).line(shape.mpLength).end();
    const neck = turtle(mpEnd, shape.mpHeading).line(shape.neckLine);
    for (const [deg, radius] of shape.neck) neck.turn(deg, radius, s.crook);
    if (!shape.loop) {
        neck.toZ(shape.bodyTop);
        return {
            mpEnd,
            neck: neck.points,
            loop: [] as Vec3[],
            top: neck.end(),
        };
    }
    const { drop, radii, rise } = shape.loop;
    neck.line(drop);
    const loop = turtle(neck.end(), neck.heading())
        .turn(-180, radii[0], s.crook * 2)
        .line(rise)
        .turn(180, radii[1], s.crook * 2);
    return { mpEnd, neck: neck.points, loop: loop.points, top: loop.end() };
}

/** A curved sax's key cups up the body's +Y side, bigger toward the bow, and the pearl touches. */
function saxKeys(
    t: ReturnType<typeof tools>,
    sh: SaxShape,
    bell: number,
    yb: number,
    topZ: number,
    bowZ: number,
): Piece[] {
    const rAt = (z: number) =>
        lerp(sh.rTop, sh.rBow, (z - topZ) / (bowZ - topZ));
    const pieces: Piece[] = [];
    for (let i = 0; i < sh.keys; i++) {
        const k = i / (sh.keys - 1);
        const z = lerp(topZ + 0.06, bowZ - 0.02, k);
        const cr = Math.min(
            0.016,
            lerp(0.011, 0.016, k) * Math.sqrt(bell / 0.12),
        );
        pieces.push(
            ...t.cup([((i % 3) - 1) * rAt(z) * 0.3, yb + rAt(z) * 0.9, z], cr),
        );
    }
    // the pearl touches under the fingers
    for (const k of [0.2, 0.28, 0.36, 0.55, 0.63, 0.71]) {
        const z = lerp(topZ, bowZ, k);
        const x = sh.rTop * 0.6;
        pieces.push(
            t.thin(
                [x, yb + rAt(z) + 0.004, z],
                [x, yb + rAt(z) + 0.008, z],
                0.006,
            ),
        );
    }
    return pieces;
}

/** Alto, tenor and bari: neck, conical body, the bow in pieces, and the bell back up. */
function curvedSax(
    id: "altoSax" | "tenorSax" | "bariSax",
    detail: Detail,
    options: ModelOptions,
): InstrumentModel {
    const d = WOODWIND_DIMENSIONS[id];
    const sh = SAX_SHAPES[id];
    const s = SEGMENTS[detail];
    const t = tools(s);
    const { mpEnd, neck, loop, top } = saxTop(sh, s);
    const yb = top[1];
    const w = sh.bowWidth;
    const bowZ = d.length - w / 2 - sh.rBow;
    const body = between(top, [0, yb, bowZ], [0, 0.25, 0.5, 0.75, 1]);
    const rBell = sh.rBow * 1.08;
    const bellBase = bowZ - sh.bellRise;
    const neckTop = sh.rTop * 0.55;
    const pieces: Piece[] = [
        ...t.mouthpiece(mpEnd, sh.rTop * 0.75),
        t.run(neck, taper(neck, neckTop, sh.rTop * (loop.length ? 0.8 : 1))),
        // the cork where the mouthpiece meets the neck
        t.run(
            between(neck[0], neck[1], [0, 0.5]),
            neckTop * 1.12,
            PART_WOOD,
            true,
        ),
        t.run(body, taper(body, sh.rTop, sh.rBow)),
        t.run(
            [
                [w, yb, bowZ],
                [w, yb, bellBase],
            ],
            [rBell, rBell * 1.1],
        ),
        t.bell(
            rBell * 1.1,
            d.bell / 2,
            sh.flare,
            [w, yb, bellBase],
            PART_METAL,
            true,
        ),
        t.band([0, yb, bowZ - 0.01], sh.rBow * 1.06, 0.012, PART_METAL),
        // octave key along the neck; the brace from body to bell
        t.thin(
            [0, neck[1][1] + 0.01, neck[1][2]],
            [0, yb + sh.rTop + 0.004, top[2] + 0.04],
            0.0016,
        ),
        t.thin(
            [sh.rBow * 0.8, yb, bowZ - 0.12],
            [w - rBell * 0.9, yb, bowZ - 0.12],
            0.004,
            PART_METAL,
        ),
        ...t.rod(
            sh.rTop + 0.008,
            yb + sh.rTop * 0.6,
            top[2] + 0.05,
            bowZ - 0.03,
            yb,
        ),
        ...t.rod(
            -sh.rTop - 0.008,
            yb + sh.rTop * 0.6,
            top[2] + 0.2,
            bowZ - 0.03,
            yb,
        ),
    ];
    if (loop.length)
        pieces.push(t.run(loop, taper(loop, sh.rTop * 0.8, sh.rTop)));
    // the bow in 30° pieces, so no piece of it is wider than the bell
    const bow = arc([w / 2, yb, bowZ], w / 2, -90, 90, 12, "y");
    for (let i = 0; i + 2 < bow.length; i += 2) {
        const part = bow.slice(i, i + 3);
        const [r0, r1] = [i / 12, (i + 2) / 12].map((k) =>
            lerp(sh.rBow, rBell, k),
        );
        pieces.push(t.run(part, taper(part, r0, r1)));
    }
    pieces.push(...saxKeys(t, sh, d.bell, yb, top[2], bowZ));
    return colored(id, options, pieces, [0, yb, top[2] + 0.12]);
}

export function woodwindModel(
    id: WoodwindModelId,
    detail: Detail = "high",
    options: ModelOptions = {},
): InstrumentModel {
    switch (id) {
        case "piccolo":
        case "flute":
            return flute(id, detail, options);
        case "clarinet":
            return clarinet(detail, options);
        case "bassClarinet":
            return bassClarinet(detail, options);
        case "sopranoSax":
            return sopranoSax(detail, options);
        case "altoSax":
        case "tenorSax":
        case "bariSax":
            return curvedSax(id, detail, options);
    }
}
