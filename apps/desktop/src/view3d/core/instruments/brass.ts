/**
 * The brass section's horns, traced from side-view reference photos
 * (docs/3d/instruments.md §3, §4). Instrument frame: origin at the right
 * hand's grip (the valve block, or the slide brace), +Z toward the bell,
 * +Y up through the valve caps, +X the performer's left. Proportions follow
 * the reference pages; nothing is copied from them. Pure: no three.js.
 *
 * Every horn is a list of tubing runs (a path and a bore), valve casings
 * with caps, stems and buttons, slides with crooks, braces, water keys, a
 * finger hook, a bell with a rim bead and a mouthpiece. `detail` sets the
 * segment counts: "high" for the full bodies, "low" for the block tier.
 */
import {
    arc,
    bellProfile,
    uPath,
    colorPieces,
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

import type { BrassModelId, Detail, InstrumentModel } from "./model";
import { bakedPieces, type BakedMesh } from "./meshAsset";
import trumpetMesh from "../../assets/instruments/trumpet.json";

export type { BrassModelId, Detail, InstrumentModel };

/** Overall length (bell rim to mouthpiece), bell diameter, bore: meters. */
export const BRASS_DIMENSIONS: Record<
    BrassModelId,
    { length: number; bell: number; bore: number }
> = {
    trumpet: { length: 0.48, bell: 0.125, bore: 0.0117 },
    mellophone: { length: 0.55, bell: 0.26, bore: 0.0118 },
    baritone: { length: 0.62, bell: 0.25, bore: 0.0142 },
    euphonium: { length: 0.66, bell: 0.28, bore: 0.0145 },
    trombone: { length: 1.18, bell: 0.21, bore: 0.0127 },
    bassTrombone: { length: 1.18, bell: 0.24, bore: 0.0142 },
    contra: { length: 0.95, bell: 0.5, bore: 0.0185 },
};

/**
 * Default colors by part: gold lacquer, chrome, black, and the pearl of the
 * trumpet's valve buttons. The window recolors silver.
 */
export const BRASS_COLORS: Record<number, number> = {
    [PART_METAL]: 0xd9ad4f,
    [PART_CHROME]: 0xd9dde2,
    [PART_BLACK]: 0x141416,
    [PART_WOOD]: 0xf2efe6,
};

interface SegmentCounts {
    tube: number;
    bell: number;
    small: number;
    crook: number;
}
const SEGMENTS: Record<Detail, SegmentCounts> = {
    high: { tube: 28, bell: 64, small: 14, crook: 10 },
    low: { tube: 8, bell: 16, small: 5, crook: 4 },
};
/** The contra: long, fat tubing. */
const CONTRA_SEGMENTS: Record<Detail, SegmentCounts> = {
    high: { tube: 32, bell: 72, small: 16, crook: 12 },
    low: { tube: 8, bell: 16, small: 5, crook: 4 },
};
/** Trombones are long, thin tubes seen end-on: they need finer rings. */
const TROMBONE_SEGMENTS: Record<Detail, SegmentCounts> = {
    high: { tube: 48, bell: 96, small: 24, crook: 14 },
    low: { tube: 12, bell: 24, small: 6, crook: 5 },
};

/** A lathe along +Z instead of +Y: rotate the profile's axis. */
const Y_TO_Z: Mat4 = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
const translate = (x: number, y: number, z: number): Mat4 => [
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
    x,
    y,
    z,
    1,
];
const at = (p: Piece, x: number, y: number, z: number) =>
    transformPiece(p, translate(x, y, z));

/** Builders bound to one detail level. */
function tools(s: SegmentCounts) {
    const run = (
        path: Vec3[],
        r: number | number[],
        part = PART_METAL,
        caps = false,
    ) => smoothTube(path, r, s.tube, part, { capStart: caps, capEnd: caps });
    const thin = (a: Vec3, b: Vec3, r: number, part = PART_CHROME) =>
        smoothTube([a, b], r, s.small, part);
    /** A bell along +Z from z0, flaring over `length` to `rim`, axis at (x, y). */
    const bell = (
        throat: number,
        rim: number,
        z0: number,
        length: number,
        x = 0,
        y = 0,
    ) =>
        at(
            transformPiece(
                smoothLathe(
                    bellProfile(throat, rim, length),
                    s.bell,
                    PART_METAL,
                ),
                Y_TO_Z,
            ),
            x,
            y,
            z0,
        );
    /** A U slide out along ±Z from `start`, crook of `width` toward +X, and back. */
    const uSlide = (
        start: Vec3,
        dirZ: 1 | -1,
        length: number,
        width: number,
        r: number,
    ) => run(uPath(start, [0, 0, dirZ], [1, 0, 0], length, width, s.crook), r);
    /** A valve slide out along +X from `start`, crook of `depth` toward −Z, and back. */
    const xSlide = (start: Vec3, length: number, depth: number, r: number) =>
        run(uPath(start, [1, 0, 0], [0, 0, -1], length, depth, s.crook), r);
    /** Three piston valves at z offsets, standing on the block: casing, cap, stem, button, bottom cap. */
    const valves = (
        zs: number[],
        bore: number,
        bottom: number,
        top: number,
    ) => {
        const out: Piece[] = [];
        const cr = bore * 1.55;
        for (const z of zs) {
            out.push(
                smoothTube(
                    [
                        [0, bottom, z],
                        [0, top, z],
                    ],
                    cr,
                    s.tube,
                    PART_METAL,
                ),
                smoothTube(
                    [
                        [0, top, z],
                        [0, top + 0.012, z],
                    ],
                    cr * 1.08,
                    s.small,
                    PART_CHROME,
                    { capStart: false },
                ),
                smoothTube(
                    [
                        [0, bottom - 0.008, z],
                        [0, bottom, z],
                    ],
                    cr * 1.08,
                    s.small,
                    PART_CHROME,
                    { capEnd: false },
                ),
                thin([0, top + 0.012, z], [0, top + 0.03, z], bore * 0.35),
                smoothTube(
                    [
                        [0, top + 0.03, z],
                        [0, top + 0.036, z],
                    ],
                    bore * 0.9,
                    s.small,
                    PART_CHROME,
                ),
                smoothTube(
                    [
                        [0, top + 0.036, z],
                        [0, top + 0.038, z],
                    ],
                    bore * 0.75,
                    s.small,
                    PART_BLACK,
                ),
            );
        }
        return out;
    };
    /** Mouthpiece: cup rim, cup, shank, pointing −Z from `p`. */
    const mouthpiece = (p: Vec3, bore: number) => {
        const r = bore * 1.3;
        const cup = smoothLathe(
            [
                [r * 0.35, 0],
                [r * 1.15, 0],
                [r * 1.2, 0.004],
                [r * 1.1, 0.012],
                [r * 0.7, 0.03],
                [r * 0.55, 0.055],
                [r * 0.6, 0.075],
            ],
            s.tube,
            PART_CHROME,
        );
        // the lathe's +Y becomes −Z (the mouthpiece points back)
        const flip: Mat4 = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
        return at(transformPiece(cup, flip), p[0], p[1], p[2] + 0.075);
    };
    const brace = (a: Vec3, b: Vec3, r = 0.003) => thin(a, b, r, PART_METAL);
    const waterKey = (p: Vec3, dirZ: 1 | -1) => [
        smoothTube(
            [
                [p[0], p[1] - 0.006, p[2]],
                [p[0], p[1] + 0.004, p[2]],
            ],
            0.006,
            s.small,
            PART_CHROME,
        ),
        thin(p, [p[0], p[1] + 0.006, p[2] + dirZ * 0.03], 0.0015),
        smoothTube(
            [
                [p[0], p[1] - 0.009, p[2]],
                [p[0], p[1] - 0.006, p[2]],
            ],
            0.005,
            s.small,
            PART_BLACK,
        ),
    ];
    const hook = (p: Vec3) =>
        run(arc(p, 0.014, 90, 330, s.crook, "x"), 0.002, PART_METAL, true);
    return {
        run,
        thin,
        bell,
        uSlide,
        xSlide,
        valves,
        mouthpiece,
        brace,
        waterKey,
        hook,
    };
}

function valvedHorn(id: BrassModelId, detail: Detail): InstrumentModel {
    const d = BRASS_DIMENSIONS[id];
    const t = tools(SEGMENTS[detail]);
    const bore = d.bore;
    const big = id === "baritone" || id === "euphonium";
    const mello = id === "mellophone";
    const bellLift = big ? 0.06 : mello ? 0.02 : 0;
    const back = -d.length * (big ? 0.36 : 0.35);
    const front = d.length + back;
    const bellLen = big ? d.length * 0.4 : d.length * 0.33;
    const bellStart = front - bellLen;
    const lead = 0.018; // leadpipe height above the grip
    const mouthpieceAt: Vec3 = [0.012, lead, back + 0.075];
    const pieces: Piece[] = [
        // leadpipe: mouthpiece to the third valve, a gentle taper
        t.run(
            [
                [0.012, lead, back + 0.075],
                [0.012, lead, -0.05],
                [0.004, lead, -0.026],
            ],
            [bore * 0.9, bore, bore],
        ),
        ...t.valves([-0.024, 0, 0.024], bore, -0.04, 0.03),
        // bell pipe: first valve forward, rising to the bell axis
        t.run(
            [
                [0, lead, 0.026],
                [0, lead + bellLift * 0.3, bellStart * 0.5],
                [0, bellLift, bellStart],
            ],
            [bore, bore * 1.15, bore * 1.35],
        ),
        t.bell(bore * 1.4, d.bell / 2, bellStart, bellLen, 0, bellLift),
        // tuning slide: back under the leadpipe with a crook
        t.uSlide([-0.016, -0.03, -0.02], -1, big ? 0.14 : 0.1, 0.032, bore),
        // valve slides out to the performer's left: first short, second a stub behind, third long
        t.xSlide([0.016, -0.012, -0.024], 0.03, 0.02, bore * 0.9),
        t.run(
            uPath(
                [-0.012, -0.015, 0.006],
                [-1, 0, 0],
                [0, 0, -1],
                0.018,
                0.012,
                SEGMENTS[detail].crook,
            ),
            bore * 0.9,
        ),
        t.xSlide([0.016, -0.015, 0.024], 0.054, 0.024, bore * 0.9),
        // braces
        t.brace([0.012, lead, -0.08], [-0.016, -0.03, -0.08]),
        t.brace(
            [0, lead + bellLift * 0.3, bellStart * 0.5],
            [0, -0.03, bellStart * 0.5],
        ),
        ...t.waterKey([-0.016, -0.03, -0.1], -1),
        t.hook([0.02, lead - 0.004, 0.06]),
        t.mouthpiece(mouthpieceAt, bore),
        // finger ring on the third slide
        t.run(
            arc(
                [0.075, -0.015, 0.012],
                0.01,
                0,
                360,
                SEGMENTS[detail].crook * 2,
                "x",
            ),
            0.0015,
            PART_CHROME,
            true,
        ),
    ];
    if (big || mello) {
        // the lower body: a second, larger bow under the tuning slide
        pieces.push(
            t.uSlide(
                [-0.022, -0.065, 0.03],
                -1,
                big ? 0.2 : 0.16,
                0.044,
                bore * 1.25,
            ),
            t.brace([-0.022, -0.03, -0.1], [-0.022, -0.065, -0.1]),
            ...t.waterKey([0.022, -0.065, -0.15], -1),
        );
    }
    return {
        id,
        pieces: colorPieces(
            pieces,
            (part) => BRASS_COLORS[part] ?? BRASS_COLORS[PART_METAL],
        ),
        leftGrip: [0.05, -0.012, -0.034],
        mouthpiece: mouthpieceAt,
    };
}

function trombone(
    id: "trombone" | "bassTrombone",
    detail: Detail,
): InstrumentModel {
    const d = BRASS_DIMENSIONS[id];
    const s = TROMBONE_SEGMENTS[detail];
    const t = tools(s);
    const bore = d.bore;
    const back = -0.3; // mouthpiece behind the grip
    const front = d.length + back;
    const bellLen = 0.34;
    const bellStart = front - bellLen;
    const slideLen = 0.55;
    const y = 0.05; // the bell section sits above the slide
    const mouthpieceAt: Vec3 = [0.03, 0, back + 0.075];
    const pieces: Piece[] = [
        // inner slide tubes and the outer slide (slightly wider), with the bow
        t.run(
            [
                [0.03, 0, -0.02],
                [0.03, 0, slideLen],
            ],
            bore,
        ),
        t.run(
            [
                [-0.03, 0, -0.02],
                [-0.03, 0, slideLen],
            ],
            bore,
        ),
        t.run(
            [
                [0.03, 0, 0.1],
                [0.03, 0, slideLen],
            ],
            bore * 1.12,
        ),
        t.run(
            [
                [-0.03, 0, 0.1],
                [-0.03, 0, slideLen],
            ],
            bore * 1.12,
        ),
        // the outer slide's bow beyond the slide end
        t.run(
            uPath(
                [0.03, 0, slideLen - 0.02],
                [0, 0, 1],
                [-1, 0, 0],
                0.02,
                0.06,
                s.crook,
            ),
            bore * 1.12,
        ),
        // slide braces: the grip and the outer brace
        t.thin([-0.03, 0, 0], [0.03, 0, 0], 0.004),
        t.thin([-0.03, 0, 0.1], [0.03, 0, 0.1], 0.004),
        // bell section: from the inner slide back, around the tuning bow, forward to the bell
        t.run(
            [
                [0.03, 0, -0.02],
                [0.03, 0, back + 0.075],
            ],
            bore,
        ),
        // the tuning bow behind the grip, then the bell pipe forward on the other side
        t.run(
            [
                [0.03, 0, -0.02],
                [0.03, y, -0.2],
            ],
            [bore, bore * 1.1],
        ),
        t.run(
            uPath([0.03, y, -0.2], [0, 0, -1], [-1, 0, 0], 0.06, 0.06, s.crook),
            bore * 1.1,
        ),
        t.run(
            [
                [-0.03, y, -0.2],
                [-0.03, y, bellStart],
            ],
            [bore * 1.15, bore * 1.3],
        ),
        t.bell(bore * 1.4, d.bell / 2, bellStart, bellLen, -0.03, y),
        // bell brace (the left hand) and a cross brace
        t.thin([-0.03, y, -0.08], [0.03, 0, -0.08], 0.004),
        t.thin([-0.03, y, 0.02], [0.03, 0, 0.02], 0.003),
        ...t.waterKey([0, 0, slideLen + 0.01], -1),
        t.mouthpiece(mouthpieceAt, bore),
    ];
    if (id === "bassTrombone")
        pieces.push(
            smoothTube(
                [
                    [-0.07, y, -0.2],
                    [-0.03, y, -0.2],
                ],
                0.024,
                s.tube,
                PART_METAL,
            ),
            t.thin([-0.09, y + 0.01, -0.2], [-0.07, y, -0.2], 0.003),
        );
    return {
        id,
        pieces: colorPieces(
            pieces,
            (part) => BRASS_COLORS[part] ?? BRASS_COLORS[PART_METAL],
        ),
        leftGrip: [0, y / 2, -0.08],
        mouthpiece: mouthpieceAt,
    };
}

/**
 * The marching contra: a long horizontal loop that lies along the player's
 * left shoulder behind the bell. The valves are at the rear by the mouthpiece
 * (the grip, the origin); the bell flares forward and a little up.
 */
function contra(detail: Detail): InstrumentModel {
    const d = BRASS_DIMENSIONS.contra;
    // the loop is long, fat tubing: finer rings than the small horns
    const s = CONTRA_SEGMENTS[detail];
    const t = tools(s);
    const bore = d.bore;
    const loopBack = -0.62; // the far bow
    const top = 0.1; // the bell branch's height
    const bottom = -0.12; // the bottom tube
    const bellLen = 0.42;
    const bellStart = -0.12;
    // the mouthpiece reaches across from the loop plane to the player's
    // lips (the head is beside the loop, toward -X), level with the valves
    const mouthpieceAt: Vec3 = [-0.1, -0.03, 0.1];
    const pieces: Piece[] = [
        // bottom tube from the valves back to the bow, the bow up, the top tube forward to the bell
        t.run(
            [
                [0, bottom, -0.04],
                [0, bottom, loopBack + 0.11],
                ...arc(
                    [0, (top + bottom) / 2, loopBack + 0.11],
                    (top - bottom) / 2,
                    180,
                    360,
                    s.crook + 6,
                    "x",
                ).map((p): Vec3 => [0, p[1], p[2]]),
                [0, top, loopBack + 0.11],
                [0, top, bellStart],
            ],
            [
                // the bell branch is a fat taper along the whole top of the loop
                bore * 1.1,
                bore * 1.4,
                bore * 1.7,
                bore * 2.0,
                bore * 2.3,
                bore * 2.6,
                bore * 3.2,
            ],
        ),
        t.bell(bore * 3.3, d.bell / 2, bellStart, bellLen, 0, top + 0.02),
        // leadpipe: across from the mouthpiece to the loop plane, then down to the valves
        t.run(
            [
                [-0.1, -0.03, 0.1],
                [-0.02, -0.03, 0.08],
                [0.0, -0.04, 0.04],
                [0.004, -0.045, -0.02],
            ],
            bore,
        ),
        ...t.valves([-0.03, 0, 0.03], bore, -0.045, 0.045),
        // tuning slide: a long U inside the loop
        t.uSlide([-0.025, -0.02, -0.06], -1, 0.3, 0.05, bore * 1.1),
        // valve slides: three Us to the performer's left, longest for the third
        t.uSlide([0.02, 0.0, 0.03], -1, 0.12, 0.028, bore),
        t.uSlide([0.02, 0.03, 0.0], -1, 0.06, 0.028, bore),
        t.uSlide([0.02, -0.02, -0.03], -1, 0.2, 0.028, bore),
        // braces between the tubes
        t.brace([0, bottom, -0.3], [0, top, -0.3], 0.004),
        t.brace([0, bottom, -0.5], [0, top, -0.5], 0.004),
        t.brace([-0.025, -0.02, -0.3], [0, bottom, -0.3], 0.003),
        ...t.waterKey([0, bottom, loopBack + 0.13], 1),
        t.mouthpiece(mouthpieceAt, bore),
    ];
    return {
        id: "contra",
        pieces: colorPieces(
            pieces,
            (part) => BRASS_COLORS[part] ?? BRASS_COLORS[PART_METAL],
        ),
        leftGrip: [0, bottom, -0.3],
        mouthpiece: mouthpieceAt,
    };
}

/**
 * The trumpet: "Trumpet" by Kagelok (CC BY 4.0, see
 * `assets/instruments/CREDITS.md`), baked into the instrument frame at
 * 0.48 m long with its mouthpiece rim where the valved horns put theirs,
 * so the brass holds bring it to the lips.
 */
function trumpet(detail: Detail): InstrumentModel {
    return {
        id: "trumpet",
        pieces: colorPieces(
            bakedPieces(trumpetMesh as BakedMesh, detail),
            (part) => BRASS_COLORS[part] ?? BRASS_COLORS[PART_METAL],
        ),
        leftGrip: [0.03, -0.012, 0.03],
        mouthpiece: [0, 0.018, -0.093],
    };
}

export function brassModel(
    id: BrassModelId,
    detail: Detail = "high",
): InstrumentModel {
    switch (id) {
        case "trumpet":
            return trumpet(detail);
        case "mellophone":
        case "baritone":
        case "euphonium":
            return valvedHorn(id, detail);
        case "trombone":
        case "bassTrombone":
            return trombone(id, detail);
        case "contra":
            return contra(detail);
    }
}
