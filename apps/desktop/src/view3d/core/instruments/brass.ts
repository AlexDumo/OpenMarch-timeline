/**
 * The brass section's horns, built from a few dimensions
 * (docs/3d/instruments.md §3, §4). Instrument frame: origin at the right
 * hand's grip, +Z toward the bell, +Y up through the valve caps, +X the
 * performer's left. Proportions follow the reference pages; nothing is
 * copied from them. Pure: no three.js.
 */
import {
    cylinder,
    lathe,
    tube,
    transformPiece,
    PART_BLACK,
    PART_CHROME,
    PART_METAL,
    type Mat4,
    type Piece,
    type Vec3,
} from "./mesh";

export type BrassModelId =
    | "trumpet"
    | "mellophone"
    | "baritone"
    | "euphonium"
    | "trombone"
    | "bassTrombone"
    | "contra";

export interface InstrumentModel {
    id: BrassModelId;
    pieces: Piece[];
    /** The left hand's grip point in the instrument frame. */
    leftGrip: Vec3;
    /** The mouthpiece's position in the instrument frame. */
    mouthpiece: Vec3;
}

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

const SEG = 12;

/** A lathe along +Z instead of +Y: rotate the profile's axis. */
const Y_TO_Z: Mat4 = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
const latheZ = (profile: [number, number][], part: number) =>
    transformPiece(lathe(profile, SEG, part), Y_TO_Z);

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

/** A bell flare from the throat radius at z0 to the rim radius at z1. */
function bell(throat: number, rim: number, z0: number, z1: number): Piece {
    const steps = 6;
    const profile: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        // exponential flare: slow at the throat, fast at the rim
        const r =
            throat +
            (rim - throat) * ((Math.exp(3 * t) - 1) / (Math.exp(3) - 1));
        profile.push([r, z0 + (z1 - z0) * t]);
    }
    return latheZ(profile, PART_METAL);
}

/** Three piston valves standing on the block at the origin, caps in chrome. */
function valves(bore: number, spacing: number, height: number): Piece[] {
    const out: Piece[] = [];
    for (let i = -1; i <= 1; i++) {
        const z = i * spacing;
        out.push(
            cylinder(
                bore * 1.6,
                [0, -height * 0.5 - 0.01, z],
                [0, height * 0.5, z],
                6,
                PART_METAL,
            ),
            cylinder(
                bore * 1.3,
                [0, height * 0.5, z],
                [0, height * 0.5 + 0.018, z],
                6,
                PART_CHROME,
            ),
        );
    }
    return out;
}

function mouthpieceAt(p: Vec3, bore: number): Piece {
    return tube([p, [p[0], p[1], p[2] - 0.05]], bore * 1.4, 8, PART_CHROME);
}

function valvedHorn(id: BrassModelId, bellLift: number): InstrumentModel {
    const d = BRASS_DIMENSIONS[id];
    const bore = d.bore;
    const back = -d.length * 0.35; // mouthpiece end
    const front = d.length + back; // bell rim
    const bellStart = front - d.length * 0.3;
    const mouthpiece: Vec3 = [0.02, 0, back + 0.05];
    const pieces: Piece[] = [
        // leadpipe from the mouthpiece to the valve block
        tube(
            [
                [0.02, 0, back + 0.05],
                [0.02, 0, -0.03],
                [0, 0, -0.02],
            ],
            bore,
            8,
            PART_METAL,
        ),
        ...valves(bore, 0.022, 0.07),
        // bell pipe from the block up and forward to the bell
        tube(
            [
                [0, 0.01, 0.02],
                [0, 0.01 + bellLift * 0.5, 0.08],
                [0, bellLift, bellStart],
            ],
            bore * 1.2,
            8,
            PART_METAL,
        ),
        transformPiece(
            bell(bore * 1.3, d.bell / 2, bellStart, front),
            translate(0, bellLift, 0),
        ),
        // tuning slide loop under the block
        tube(
            [
                [-0.02, -0.05, 0],
                [-0.02, -0.05, 0.1],
                [0.02, -0.05, 0.1],
                [0.02, -0.05, 0],
            ],
            bore,
            8,
            PART_METAL,
        ),
        // three valve slides out to the performer's left
        tube(
            [
                [0.02, 0, -0.022],
                [0.07, 0, -0.022],
                [0.07, 0, 0.022],
                [0.02, 0, 0.022],
            ],
            bore * 0.9,
            6,
            PART_METAL,
        ),
        mouthpieceAt(mouthpiece, bore),
        // finger ring on the leadpipe for the left hand
        cylinder(
            0.012,
            [0.035, -0.02, -0.06],
            [0.035, 0.02, -0.06],
            6,
            PART_BLACK,
        ),
    ];
    return { id, pieces, leftGrip: [0.045, 0, -0.06], mouthpiece };
}

function trombone(id: "trombone" | "bassTrombone"): InstrumentModel {
    const d = BRASS_DIMENSIONS[id];
    const bore = d.bore;
    const back = -0.3; // mouthpiece behind the grip
    const front = d.length + back;
    const bellStart = front - 0.32;
    const mouthpiece: Vec3 = [0.03, 0, back + 0.05];
    const slideLen = 0.55;
    const pieces: Piece[] = [
        // the two inner slide tubes from the brace forward
        tube(
            [
                [0.03, 0, 0],
                [0.03, 0, slideLen],
            ],
            bore,
            8,
            PART_METAL,
        ),
        tube(
            [
                [-0.03, 0, 0],
                [-0.03, 0, slideLen],
            ],
            bore,
            8,
            PART_METAL,
        ),
        // the slide bow
        tube(
            [
                [0.03, 0, slideLen],
                [0.03, 0, slideLen + 0.04],
                [-0.03, 0, slideLen + 0.04],
                [-0.03, 0, slideLen],
            ],
            bore,
            6,
            PART_METAL,
        ),
        // slide brace (the right hand's grip)
        cylinder(0.006, [-0.03, 0, 0], [0.03, 0, 0], 6, PART_CHROME),
        // bell section: mouthpiece tube back, around, and forward to the bell
        tube(
            [
                [0.03, 0, -0.26],
                [0.03, 0, back + 0.05],
            ],
            bore,
            8,
            PART_METAL,
        ),
        tube(
            [
                [0.03, 0, -0.26],
                [0.03, 0.05, -0.3],
                [-0.03, 0.05, -0.3],
                [-0.03, 0.05, bellStart],
            ],
            bore * 1.2,
            8,
            PART_METAL,
        ),
        transformPiece(
            bell(bore * 1.3, d.bell / 2, bellStart, front),
            translate(-0.03, 0.05, 0),
        ),
        // bell brace, the left hand's grip
        cylinder(0.006, [-0.03, 0.05, -0.08], [0.03, 0, -0.08], 6, PART_CHROME),
        mouthpieceAt(mouthpiece, bore),
    ];
    if (id === "bassTrombone")
        pieces.push(
            cylinder(
                0.025,
                [-0.06, 0.05, -0.2],
                [-0.02, 0.05, -0.2],
                8,
                PART_METAL,
            ),
        ); // rotor
    return { id, pieces, leftGrip: [0, 0.025, -0.08], mouthpiece };
}

function contra(): InstrumentModel {
    const d = BRASS_DIMENSIONS.contra;
    const bore = d.bore;
    const mouthpiece: Vec3 = [0.05, 0.25, -0.12];
    // the body is a wrapped loop beside the player's head; the bell flares forward above
    const pieces: Piece[] = [
        ...valves(bore, 0.03, 0.09),
        tube(
            [
                [0.05, 0.25, -0.07],
                [0.05, 0.1, -0.05],
                [0, 0, -0.03],
            ],
            bore,
            8,
            PART_METAL,
        ),
        // main loop: down, back, up behind the shoulder and forward over it
        tube(
            [
                [0, 0, 0.04],
                [0, -0.25, 0.05],
                [0.15, -0.3, -0.05],
                [0.25, -0.1, -0.2],
                [0.25, 0.3, -0.2],
                [0.15, 0.55, -0.05],
                [0.05, 0.6, 0.1],
            ],
            bore * 1.5,
            10,
            PART_METAL,
        ),
        tube(
            [
                [0.05, 0.6, 0.1],
                [0.05, 0.62, 0.3],
            ],
            bore * 2,
            8,
            PART_METAL,
        ),
        transformPiece(
            bell(bore * 2.1, d.bell / 2, 0.3, 0.3 + (d.length - 0.55)),
            translate(0.05, 0.62, 0),
        ),
        // shoulder pad
        cylinder(0.05, [0.12, 0.2, -0.1], [0.12, 0.2, 0.0], 8, PART_BLACK),
        mouthpieceAt(mouthpiece, bore),
    ];
    return { id: "contra", pieces, leftGrip: [0.2, 0.35, -0.2], mouthpiece };
}

export function brassModel(id: BrassModelId): InstrumentModel {
    switch (id) {
        case "trumpet":
            return valvedHorn(id, 0.0);
        case "mellophone":
            return valvedHorn(id, 0.02);
        case "baritone":
            return valvedHorn(id, 0.06);
        case "euphonium":
            return valvedHorn(id, 0.07);
        case "trombone":
        case "bassTrombone":
            return trombone(id);
        case "contra":
            return contra();
    }
}
