// cspell:ignore vomitory vomitories metalness tarped concourse downlights emissivemap
import { DIESEL_TURF } from "./turf";
import {
    BufferGeometry,
    DoubleSide,
    Color,
    Float32BufferAttribute,
    Group,
    Mesh,
    MeshBasicMaterial,
    MeshLambertMaterial,
    MeshStandardMaterial,
    Vector3,
    type Material,
    type Vector3Tuple,
} from "three";
import { GROUND_LAYER, setGroundLayer } from "../../environment";
import type { SeatRow } from "../../types";
import {
    bowlOutline,
    outlineOffset,
    RING_PARTS,
    RING_POINTS,
    ringSections,
    type Ring,
    type SectionLayout,
} from "../bowl";
import { BandBuilder, Members, type SliceOptions } from "../pro/geometry";
import { concreteTexture } from "../pro/textures";
import { dieselNameRingTexture } from "./brand";
import type { FrameTier, DieselCtx, DieselFrame, DieselPart } from "./frame";
import { dieselLighting } from "./lighting";
import {
    DIESEL_CONCOURSE_TILE,
    dieselConcourseTexture,
    dieselSeatTexture,
    dieselSectionNumberTexture,
    DIESEL_SUITE_TILE,
    dieselSuiteFrontTexture,
    DIRECTOR_PLACARD,
    DIRECTOR_PLACARD_ASPECT,
    sectionAtlasCell,
} from "./seatTextures";
import { buildDieselStadiumSign } from "./stadiumSign";

/**
 * The seating bowl of the Mark Diesel kit, in kit-root space (`frame.ts`).
 *
 * Four seated decks, from the field outward on a sideline:
 *
 * - the 100s and the 200s on one bank, split by a cross-aisle at street
 *   level (the tunnels come out through the front of the 200s);
 * - the open loge boxes behind the 200s, then the 300s behind LED ribbon 1
 *   and the 400s (the judges' level) above the 300s' back wall;
 * - one level of suites, hanging over the back of the 400s, with the
 *   stadium sign's fascia under its glass;
 * - the 500s behind the ring of names and the 600s above their back wall.
 *
 * The same rings run round the south end and the corners (where the fascia
 * of the 500s is LED ribbon 2 and the 400s run deeper under it). The 600s
 * stand on both sidelines, at the south end and in the north-east and
 * south-west corners; the other two corners hold the video boards. The
 * north end is its own stand: a tall lower bank, an open concourse and one
 * high deck under the window wall. It takes the north half of both north
 * corner arcs.
 *
 * The back sideline is the stand the drape masks: its lower seats are
 * tarped black and have no crowd.
 *
 * Seats are geometry, not a texture: every row has a band of seat backs and
 * a band of folded pans, cut at the aisles, the tunnels and the platforms,
 * with one seat per texture tile. Nothing here glows on its own but the
 * concourse and the glass; every surface carries a baked light level
 * (`dieselSpill`), so the stands fall into shadow away from the field.
 *
 * The level fascias, balcony fronts and soffits are the exception: bare
 * light-gray concrete that the hall's house lights keep lit while the show
 * runs (photos 12 and 13), so each deck reads apart from the one above it.
 * They are their own mesh (`markDiesel.fascias`), lit by the scene and by a
 * warm house level (`DIESEL_HOUSE`) scaled by each face's baked tint.
 */

/** A range of ring segments, `[from, to)`; `to` may run past the ring's end. */
export type RingRange = [from: number, to: number];

/** Where each part of the ring starts (`RING_PARTS` order), plus the end. */
const PART_START = RING_PARTS.reduce<number[]>(
    (acc, part) => [...acc, acc[acc.length - 1] + part.segments],
    [0],
);
const N = RING_POINTS;
/** Half a corner arc, in segments. */
const HALF_ARC = RING_PARTS[1].segments / 2;

/**
 * Ring ranges of the Mark Diesel bowl. Points run counterclockwise from
 * above: west straight (north to south), south-west corner, south end,
 * south-east corner, east straight, north-east corner, north end,
 * north-west corner.
 */
export const DIESEL_RING = {
    all: [[0, N]] as RingRange[],
    /** The front (+Z, west, audience) and back (-Z, east, draped) straights. */
    front: [PART_START[0], PART_START[1]] as RingRange,
    back: [PART_START[4], PART_START[5]] as RingRange,
    straights: [
        [PART_START[0], PART_START[1]],
        [PART_START[4], PART_START[5]],
    ] as RingRange[],
    /** The south end (+X). */
    south: [PART_START[2], PART_START[3]] as RingRange,
    /**
     * The north stand: the north end (-X) and the north half of each north
     * corner arc.
     */
    north: [PART_START[5] + HALF_ARC, PART_START[7] + HALF_ARC] as RingRange,
    /** Everything but the north stand (wraps past the end). */
    main: [PART_START[7] + HALF_ARC, PART_START[5] + HALF_ARC + N] as RingRange,
    /** The four corners of the main ring. */
    southWest: [PART_START[1], PART_START[2]] as RingRange,
    southEast: [PART_START[3], PART_START[4]] as RingRange,
    northEast: [PART_START[5], PART_START[5] + HALF_ARC] as RingRange,
    northWest: [PART_START[7] + HALF_ARC, PART_START[8]] as RingRange,
    corners: [
        [PART_START[1], PART_START[2]],
        [PART_START[3], PART_START[4]],
        [PART_START[5], PART_START[5] + HALF_ARC],
        [PART_START[7] + HALF_ARC, PART_START[8]],
    ] as RingRange[],
    /** Where the fascia of the 500s is LED ribbon 2: corners and south end. */
    ribbon2: [
        [PART_START[1], PART_START[4]],
        [PART_START[5], PART_START[5] + HALF_ARC],
        [PART_START[7] + HALF_ARC, PART_START[8]],
    ] as RingRange[],
    /** The corners and the ends: everything but the two straights. */
    round: [
        [PART_START[1], PART_START[4]],
        [PART_START[5], PART_START[8]],
    ] as RingRange[],
    /** The tarped seats: the back straight and half of each back corner. */
    tarp: [PART_START[3] + HALF_ARC, PART_START[6] - HALF_ARC] as RingRange,
    /** The seats left open: the rest of the ring (wraps past the end). */
    open: [PART_START[6] - HALF_ARC, PART_START[3] + HALF_ARC + N] as RingRange,
};

/** Seating sections of the 100s and 200s: segments per section. */
export const DIESEL_SECTIONS: SectionLayout = { x: 4, z: 7, arc: 4 };
/**
 * Sections of the decks above them, which stand further out, where a
 * corner arc is long enough for twice as many.
 */
export const DIESEL_UPPER_SECTIONS: SectionLayout = { x: 4, z: 7, arc: 2 };
/** Aisle width between seating sections. */
export const DIESEL_AISLE = 1.2;
/**
 * The tunnels from the street concourse: they come out onto the cross-aisle
 * through the front rows of the 200s. Rows covered, and width.
 */
export const DIESEL_VOMITORY = { firstRow: 0, lastRow: 3, width: 3.4 };
/** Width of one seat along a row. The crowd sits at the same pitch. */
export const DIESEL_SEAT_PITCH = 0.5;
/**
 * How far round a camera's eye the crowd mask leaves seats empty: the seat
 * the eye sits over (about 0.8 m below it), and nobody else's.
 */
export const DIESEL_SEAT_CLEAR = 1;
/** Seat height above the tread: where a person's hips are. */
const SEAT_HEIGHT = 0.41;
/**
 * Wheelchair platforms at the top of the 100s on the front sideline: a
 * flat deck at the cross-aisle's level in place of rows `firstRow` to
 * `lastRow` (the last rows), a section wide, with a rail at its front.
 * `sections` are indices into the front straight's sections. The reference
 * photos were taken from the first row of the 200s behind the middle one
 * (140). Section 139, south of it, keeps its seats up to the wall: the
 * directors sit there (photo 13).
 */
export const DIESEL_PLATFORM = {
    firstRow: 20,
    lastRow: 22,
    sections: [2, 3],
};
/**
 * The directors' viewing area (photo 13): in the 200s over section 139,
 * the north part of the section's front rows give way to a platform at
 * the cross-aisle's level, with the cross-aisle's glass rail at its front
 * and people standing at it. Behind it a wide tunnel opens under the rows,
 * dark against the lit stands. Meters are along the section from its north
 * end; `rows` are the 200s rows the platform takes. Over the opening every
 * row of the 200s is cut, back to the loge boxes' wall.
 */
export const DIESEL_DIRECTORS = {
    section: 239,
    platform: [0.6, 8] as [number, number],
    rows: 4,
    opening: { center: 3.7, width: 6 },
};
/** The glass rails' height over the deck they guard, meters. */
const GLASS_RAIL = { aisle: 1.05, deck: 0.8, upper: 1.05 };
/** The glass rails' posts, meters apart (high quality). */
const GLASS_POST_PITCH = 1.8;
/** The ring of names' tile along the fascia, meters (a 1.4 m fascia). */
const NAME_TILE = 45;
/** Upper-deck portals: rows covered, and width. */
const UPPER_PORTAL = { firstRow: 4, lastRow: 6, width: 3 };
/** The turf apron round the field: over the site's paint, under the field. */
const FLOOR_Y = 0.02;
/** Height of a tier's back wall above its last tread. */
const RIM = 1.2;

type Tint = [number, number, number];
/** Vertex tints on the concrete mesh (they multiply the concrete texture). */
const PLAIN: Tint = [1, 1, 1];
const RISER: Tint = [0.78, 0.78, 0.8];
/** Sealed, scuffed treads: darker than the risers. */
const TREAD: Tint = [0.5, 0.5, 0.52];
const SOFFIT: Tint = [0.3, 0.31, 0.33];
/** Walls in the shade of the deck above them. */
const SHADE: Tint = [0.2, 0.205, 0.22];
const TARP: Tint = [0.035, 0.035, 0.04];
/** The padded field wall: the home blue of the building. */
const WALL_BLUE: Tint = [0.06, 0.2, 0.86];
const WALL_BLACK: Tint = [0.03, 0.03, 0.035];
/** Seats: the baked share of the hall's light on molded plastic. */
const SEAT: Tint = [0.82, 0.82, 0.82];
const RAIL_TINT: Tint = [0.09, 0.095, 0.11];
/**
 * The wall behind the last row of the 100s, up to the cross-aisle, painted
 * the building's blue (photo 13).
 */
const AISLE_WALL: Tint = [0.2, 0.26, 0.6];
/** The dark faces the LED ribbons hang on. */
const FASCIA: Tint = [0.05, 0.052, 0.06];

/**
 * The house lights on the bare concrete (`markDiesel.fascias`): a warm
 * white, and its level by preset (times the concrete's own gray).
 * Under the closed roof the downlights in the soffits and the concourse
 * spill keep the fascias a light gray while the bowl's seats fall dark.
 */
export const DIESEL_HOUSE = { color: 0xffe2c2, lampsOn: 0.9, day: 0.2 };
/**
 * The house lights' fill on the seats (`markDiesel.seats`), by preset, times
 * the seat texture and each seat's baked tint.
 */
export const DIESEL_SEAT_HOUSE = { lampsOn: 1.5, day: 0.4 };

/**
 * Scales a material's emissive light by its vertex colors, so a house-lit
 * surface keeps the baked falloff of the stands. Every material it patches
 * shares one program.
 */
function houseLit<M extends MeshLambertMaterial>(material: M): M {
    material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
            "#include <emissivemap_fragment>",
            "#include <emissivemap_fragment>\n#if defined( USE_COLOR )\n\ttotalEmissiveRadiance *= vColor.rgb;\n#endif",
        );
    };
    material.customProgramCacheKey = () => "markDiesel.houseLit";
    return material;
}

/** Bare fascias and balcony fronts, facing the field. */
const FASCIA_LIT: Tint = [0.82, 0.82, 0.8];
/** The underside of a deck or a balcony: a step darker than its front. */
const SOFFIT_LIT: Tint = [0.5, 0.5, 0.5];
/** The walls behind a deck's last row, in the shade of the deck above. */
const BACK_LIT: Tint = [0.6, 0.6, 0.59];

const RAIL = 0x2a2d34;
/** Glass rails' posts and cap: brushed aluminum. */
const RAIL_METAL = 0xa9adb3;
/** The glass rails' cap, on the house-lit mesh: a pale metal gray. */
const CAP_LIT: Tint = [0.9, 0.92, 0.95];
/** Rail glass (unlit, faint): its lower part, and the top that catches light. */
const GLASS_LOW: Tint = [0.5, 0.55, 0.6];
const GLASS_HIGH: Tint = [0.85, 0.88, 0.92];
const CONCRETE = 0x8e8f8d;
const PORTAL = 0x08090b;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const mix = (a: number, b: number, t: number) => a + (b - a) * clamp01(t);
const scale = ([r, g, b]: Tint, k: number): Tint => [r * k, g * k, b * k];
const dim = (hex: number, k: number) =>
    new Color(hex).multiplyScalar(k).getHex();

/** The decks by height: which one a point `d` out and `y` up belongs to. */
type Deck = "bank" | "club" | "mid" | "terrace" | "upper";
function deckAt(frame: DieselFrame, d: number, y: number): Deck {
    const { club, mid, terrace, upperWest, northMid } = frame.BOWL;
    if (y < club.bottom - 2) return "bank";
    if (y < mid.bottom + 0.5) return "club";
    // The north deck climbs through the height of the 500s, further out.
    if (y < terrace.bottom - 0.4 || d >= northMid.offset - 0.5)
        return y < upperWest.base - 0.2 ? "mid" : "upper";
    return y < upperWest.bottom + 0.5 ? "terrace" : "upper";
}

/**
 * The share of the field's light that reaches a seat `d` meters out from
 * the bowl's inner outline at height `y`: full at the field wall, falling
 * off up the bank of the 100s and 200s, low under each overhang and lowest
 * at the top of the upper deck. Baked into the vertex colors of the stands
 * and into the crowd, so both go dark together away from the field.
 */
export function dieselSpill(
    frame: DieselFrame,
): (d: number, y: number) => number {
    const { loge, mid, upperWest, upperSouth } = frame.BOWL;
    return (d, y) => {
        switch (deckAt(frame, d, y)) {
            case "bank":
                return mix(0.82, 0.36, d / loge.back);
            case "club":
                return 0.34;
            case "mid":
                // Under the suites from the fourth row back.
                return mix(0.34, 0.17, (d - mid.offset - 1.6) / 6);
            case "terrace":
                return 0.32;
            default:
                return mix(
                    0.36,
                    0.2,
                    (y - upperWest.base) / (upperSouth.top - upperWest.base),
                );
        }
    };
}

/** Smooth value noise in 0..1 on a 1 m lattice. */
function valueNoise(x: number, y: number, z: number): number {
    const hash = (i: number, j: number, k: number) => {
        const h = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
        return h - Math.floor(h);
    };
    const [x0, y0, z0] = [Math.floor(x), Math.floor(y), Math.floor(z)];
    const s = (t: number) => t * t * (3 - 2 * t);
    const [fx, fy, fz] = [s(x - x0), s(y - y0), s(z - z0)];
    const at = (j: number, k: number) =>
        hash(x0, y0 + j, z0 + k) * (1 - fx) + hash(x0 + 1, y0 + j, z0 + k) * fx;
    const low = at(0, 0) * (1 - fy) + at(1, 0) * fy;
    const high = at(0, 1) * (1 - fy) + at(1, 1) * fy;
    return low * (1 - fz) + high * fz;
}

/**
 * How full each seat is, 0 to 1, in kit-root space: a finals-night full
 * house. Every seat the drape leaves open is taken, with the odd empty seat
 * and a few more gaps toward the top of the 600s. Nobody sits within
 * `clearRadius` of a point in `clear` (the kit's camera seats): that leaves
 * the camera's own seat empty and no more, so from every other camera the
 * house stays full. The scene clears a little more round whichever seat
 * the camera is in (`KitCrowdOptions.clearRadius`).
 */
export function dieselCrowdFill(
    frame: DieselFrame,
    clear: Vector3Tuple[] = [],
    clearRadius = DIESEL_SEAT_CLEAR,
): (x: number, y: number, z: number) => number {
    const { upperWest, upperSouth } = frame.BOWL;
    return (x, y, z) => {
        for (const [cx, cy, cz] of clear)
            if (Math.hypot(x - cx, y - cy, z - cz) < clearRadius) return 0;
        const groups = valueNoise(x / 3.3, y / 0.9, z / 3.3);
        // Higher in the 600s a few more seats are empty.
        const high = clamp01(
            (y - upperWest.base) / (upperSouth.top - upperWest.base),
        );
        return clamp01(0.97 - 0.12 * high + (groups - 0.5) * 0.12);
    };
}

/** The crowd's baked light at a point in kit-root space (`dieselSpill`). */
export function dieselCrowdShade(
    frame: DieselFrame,
): (x: number, y: number, z: number) => number {
    const spill = dieselSpill(frame);
    return (x, y, z) =>
        spill(outlineOffset(frame.BOWL.outline, x, z), y - SEAT_HEIGHT);
}

/** Width of a section on the sidelines, meters (20 seats and an aisle). */
const SIDELINE_SECTION = 12.5;

/**
 * The building's number for the section at a point of the bowl (kit-root
 * space) on a level: 1 for the 100s, up to 6 for the 600s. As at Lucas Oil
 * Stadium, every level counts its sections 1 to 53 clockwise seen from
 * above, from the middle of the north end:
 *
 * - 4 to 7: north-east corner; 8 to 18: east sideline, 13 at the 50;
 * - 19 to 23: south-east corner; 24 to 29: across the south end;
 * - 30 to 34: south-west corner; 35 to 45: west sideline, 40 at the 50 and
 *   39 just south of it (the directors' section, 139);
 * - 46 to 49: north-west corner; 50 to 53 and 1 to 3: the north end.
 *
 * Sideline sections are `SIDELINE_SECTION` wide; the corners and ends
 * spread the rest evenly. The model's own sections are wider, so a number
 * here and there is skipped.
 */
export function dieselSectionNumber(
    frame: DieselFrame,
    x: number,
    z: number,
    level: number,
): number {
    const { halfX, halfZ, outline } = frame.BOWL;
    const sx = halfX - outline.cornerRadius;
    const sz = halfZ - outline.cornerRadius;
    const half = sx / SIDELINE_SECTION;
    /** 0 at the end of a corner, 1 where it meets a sideline. */
    const turn = (along: number, across: number) =>
        Math.atan2(across, along) / (Math.PI / 2);
    let c: number;
    if (Math.abs(x) <= sx)
        c = z >= 0 ? 40 - x / SIDELINE_SECTION : 13 + x / SIDELINE_SECTION;
    else if (Math.abs(z) <= sz)
        c = x > 0 ? 26.5 + (3 * z) / sz : 53.5 - (3.5 * z) / sz;
    else if (x > 0)
        c =
            z > 0
                ? 29.5 + (40 - half - 29.5) * turn(x - sx, z - sz)
                : 23.5 - (23.5 - 13 - half) * turn(x - sx, -z - sz);
    else
        c =
            z > 0
                ? 50 - (50 - 40 - half) * turn(-x - sx, z - sz)
                : 4 + (13 - half - 4) * turn(-x - sx, -z - sz);
    const n = (((Math.round(c) - 1) % 53) + 53) % 53;
    return level * 100 + n + 1;
}

export interface DieselBowl extends DieselPart {
    /** Seat rows for the crowd, in kit-root space. */
    seatRows: SeatRow[];
    /** The seat treads: what pick-a-seat raycasts against. */
    treads: Mesh;
}

/** The point at fractional index `f` on a ring (along its chords). */
function ringAt(ring: Ring, f: number): Vector3 {
    const i = Math.floor(f);
    return new Vector3().lerpVectors(ring[i % N], ring[(i + 1) % N], f - i);
}

/** Meters along a ring from point `s` to point `e`. */
function ringLength(ring: Ring, s: number, e: number): number {
    let len = 0;
    for (let i = s; i < e; i++)
        len += ring[i % N].distanceTo(ring[(i + 1) % N]);
    return len;
}

/**
 * Fractional indices covering the stretch of `ring` from `a` to `b` meters
 * past point `s` (no further than point `e`): the two ends and every ring
 * point between them.
 */
function ringSpan(
    ring: Ring,
    s: number,
    e: number,
    a: number,
    b: number,
): number[] {
    let acc = 0;
    let from = -1;
    let to = -1;
    for (let i = s; i < e; i++) {
        const len = ring[i % N].distanceTo(ring[(i + 1) % N]);
        if (from < 0 && a <= acc + len) from = i + (a - acc) / len;
        if (to < 0 && b <= acc + len) to = i + (b - acc) / len;
        acc += len;
    }
    if (from < 0) return [];
    if (to < 0) to = e;
    const out = [from];
    for (let i = Math.floor(from) + 1; i < to - 1e-6; i++)
        if (i - from > 1e-6) out.push(i);
    out.push(to);
    return out;
}

/** Colored, textured quads: the seats and the section plaques. */
class Quads {
    readonly pos: number[] = [];
    readonly uv: number[] = [];
    readonly color: number[] = [];

    /** `a`, `b` along the bottom, `c` above `b`, `d` above `a`. */
    add(
        [a, b, c, d]: [Vector3, Vector3, Vector3, Vector3],
        [u0, v0, u1, v1]: [number, number, number, number],
        tint: Tint = PLAIN,
    ): this {
        for (const p of [a, b, c, a, c, d]) this.pos.push(p.x, p.y, p.z);
        this.uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
        for (let k = 0; k < 6; k++) this.color.push(...tint);
        return this;
    }

    build(): BufferGeometry {
        const geo = new BufferGeometry();
        geo.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
        geo.setAttribute("uv", new Float32BufferAttribute(this.uv, 2));
        geo.setAttribute("color", new Float32BufferAttribute(this.color, 3));
        geo.computeVertexNormals();
        return geo;
    }
}

export function buildDieselBowl(ctx: DieselCtx): DieselBowl {
    const { frame, shared, quality } = ctx;
    const { BOWL } = frame;
    const { lower, loge, club, mid, cornerMid, terrace } = BOWL;
    const { upperWest, upperEast, upperSouth, cornerUpper } = BOWL;
    const { northLower, northMid } = BOWL;
    const outline = bowlOutline(BOWL.outline);
    const R = DIESEL_RING;
    const high = quality === "high";
    const spill = dieselSpill(frame);
    const object = new Group();
    object.name = "markDiesel.bowl";
    const disposers: (() => void)[] = [];
    const mat = (
        params: ConstructorParameters<typeof MeshStandardMaterial>[0],
    ) => {
        const m = new MeshStandardMaterial(params);
        disposers.push(() => {
            m.map?.dispose();
            if (m.emissiveMap !== m.map) m.emissiveMap?.dispose();
            m.dispose();
        });
        return m;
    };
    /**
     * The big rough surfaces (treads, seats, concrete): their light is baked
     * into vertex colors and they have next to no highlight, so Lambert
     * shading looks the same and is much cheaper under the hall's spots.
     */
    const matte = (
        params: ConstructorParameters<typeof MeshLambertMaterial>[0],
    ) => {
        const m = new MeshLambertMaterial(params);
        disposers.push(() => {
            m.map?.dispose();
            m.dispose();
        });
        return m;
    };
    const addMesh = (geo: BufferGeometry, material: Material, name: string) => {
        disposers.push(() => geo.dispose());
        const mesh = new Mesh(geo, material);
        mesh.name = name;
        mesh.receiveShadow = true;
        object.add(mesh);
        return mesh;
    };

    // Every ring is the inner outline pushed out along its own normals, so
    // one base ring and its normals make them all.
    const base = outline(0, 0);
    const out = outline(1, 0).map((p, i) => p.sub(base[i]));
    const ring = (d: number, y: number): Ring =>
        base.map(
            (p, i) => new Vector3(p.x + out[i].x * d, y, p.z + out[i].z * d),
        );
    /** The point of ring `(d, y)` at ring point `i`. */
    const at = (i: number, d: number, y: number) =>
        new Vector3(
            base[i % N].x + out[i % N].x * d,
            y,
            base[i % N].z + out[i % N].z * d,
        );

    /**
     * `band.slice` over a section, leaving out the stretch `gap` (fractional
     * ring indices) when there is one: the two pieces either side of it.
     */
    const sliceAround = (
        band: BandBuilder,
        a: Ring,
        b: Ring,
        { s, e }: { s: number; e: number },
        gap: [number, number] | null,
        options: SliceOptions,
    ) => {
        if (!gap) {
            band.slice(a, b, s, e, options);
            return;
        }
        for (const [f0, f1] of [
            [s, gap[0]],
            [gap[1], e],
        ]) {
            if (f1 - f0 < 1e-6) continue;
            const fs = [f0];
            for (let i = Math.floor(f0) + 1; i < f1 - 1e-6; i++)
                if (i - f0 > 1e-6) fs.push(i);
            fs.push(f1);
            band.slice(
                fs.map((f) => ringAt(a, f)),
                fs.map((f) => ringAt(b, f)),
                0,
                fs.length - 1,
                options,
            );
        }
    };

    const treadBand = new BandBuilder(true);
    const concrete = new BandBuilder(true);
    /** The house-lit concrete: fascias, balcony fronts and soffits. */
    const lit = new BandBuilder(true);
    const names = new BandBuilder();
    const glass = new BandBuilder();
    /** The glass rails' panes (`markDiesel.railGlass`). */
    const railGlass = new BandBuilder(true);
    const concourse = new BandBuilder();
    const seats = new Quads();
    const plaques = new Quads();
    const structure = new Members();
    const seatRows: SeatRow[] = [];
    interface Section {
        k: number;
        s: number;
        e: number;
    }
    const layoutSections = (layout: SectionLayout): Section[] => {
        const starts = ringSections(layout).starts;
        return starts.map((s, k) => ({
            k,
            s,
            e: k + 1 < starts.length ? starts[k + 1] : N,
        }));
    };
    /** Sections of the 100s and 200s, and of the decks above them. */
    const sections = layoutSections(DIESEL_SECTIONS);
    const upperSections = layoutSections(DIESEL_UPPER_SECTIONS);
    const inRanges = ({ s, e }: Section, ranges: RingRange[]) =>
        ranges.some(
            ([i0, i1]) => (s >= i0 && e <= i1) || (s + N >= i0 && e + N <= i1),
        );
    /** Ring points where an aisle runs: the edges of the sections in `ranges`. */
    const aisles = (ranges: RingRange[], of: Section[] = sections) => {
        const set = new Set<number>();
        for (const sec of of)
            if (inRanges(sec, ranges)) set.add(sec.s % N).add(sec.e % N);
        return [...set];
    };

    /** Whether a point lies in the tarped part of the ring. */
    const { halfX, halfZ } = BOWL;
    const rc = BOWL.outline.cornerRadius;
    const inTarp = (x: number, z: number) => {
        if (z > -(halfZ - rc)) return false;
        const dx = Math.abs(x) - (halfX - rc);
        return dx <= 0 || -z - (halfZ - rc) > dx;
    };

    const platforms = new Set(
        DIESEL_PLATFORM.sections.map(
            (i) => i + sections.findIndex((sec) => sec.s === R.front[0]),
        ),
    );
    const P = DIESEL_PLATFORM;
    const platformRows = P.lastRow - P.firstRow + 1;
    /** The section of the 200s the directors' platform opens from. */
    const directors = sections.find((sec) => {
        if (!inRanges(sec, [R.front])) return false;
        const r = ring(loge.offset, 0);
        const p = ringAt(r, (sec.s + sec.e) / 2);
        // A small show's field can leave the section too short for it.
        return (
            dieselSectionNumber(frame, p.x, p.z, 2) ===
                DIESEL_DIRECTORS.section &&
            ringLength(r, sec.s, sec.e) >
                DIESEL_DIRECTORS.platform[1] + DIESEL_AISLE
        );
    });
    /** Where row `i` of the 200s is cut for the directors, meters along. */
    const directorsCut = (i: number): [number, number] => {
        const D = DIESEL_DIRECTORS;
        if (i < D.rows) return D.platform;
        return [
            D.opening.center - D.opening.width / 2,
            D.opening.center + D.opening.width / 2,
        ];
    };
    /** Fractional ring indices of `[a, b]` meters along a section of `r`. */
    const metersSpan = (
        r: Ring,
        sec: { s: number; e: number },
        [a, b]: [number, number],
    ): [number, number] => {
        const ps = ringSpan(r, sec.s, sec.e, a, b);
        return [ps[0], ps[ps.length - 1]];
    };

    interface TierOptions {
        ranges: RingRange[];
        /** Laid out in the upper decks' sections (`DIESEL_UPPER_SECTIONS`). */
        fine?: boolean;
        /** Where the tier has seats; everywhere it stands when unset. */
        seats?: RingRange[];
        /** Height the first riser starts at (the tier's own bottom if unset). */
        from?: number;
        /** Where the first riser goes; the concrete mesh when unset. */
        fascia?: { band: BandBuilder; tile: number };
        /** Tint of the first riser when it is concrete. */
        wall?: Tint;
        /** The first riser is a house-lit fascia (`markDiesel.fascias`). */
        litWall?: boolean;
        /** Ranges whose treads are tarped instead of seats. */
        tarp?: RingRange[];
        /** Which seat rows the crowd may use, by a row's midpoint. */
        crowd: (x: number, z: number) => boolean;
        /** Rows with a tunnel gap, and the sections that have one. */
        gaps?: {
            firstRow: number;
            lastRow: number;
            width: number;
            sections: Set<number>;
        };
        /** Sections with a wheelchair platform (`DIESEL_PLATFORM`). */
        platforms?: Set<number>;
        /** The directors' section, and where each of its rows is cut. */
        directors?: {
            k: number;
            cut: (row: number) => [number, number];
        };
    }
    const addTier = (t: FrameTier, options: TierOptions) => {
        const mine = (options.fine ? upperSections : sections).filter((sec) =>
            inRanges(sec, options.ranges),
        );
        const prevH = new Map<number, number>();
        for (let i = 0; i < t.rows; i++) {
            const o = t.offset + i * t.depth;
            const h = t.base + i * t.rise;
            const light = spill(o + t.depth / 2, h);
            const front = ring(o, h);
            const back = ring(o + t.depth, h);
            const seatLine = ring(o + t.depth * 0.5, h + SEAT_HEIGHT);
            const below = new Map<number, Ring>();
            // A seat: its back leans away from the field, and the folded pan
            // stands in front of the back's lower half.
            const profile = {
                backFoot: ring(o + t.depth - 0.15, h + 0.38),
                backTop: ring(o + t.depth - 0.07, h + 0.88),
                panFoot: ring(o + t.depth - 0.33, h + 0.2),
                panTop: ring(o + t.depth - 0.2, h + 0.62),
            };
            for (const sec of mine) {
                const platform = options.platforms?.has(sec.k) ?? false;
                if (platform && i > P.firstRow && i <= P.lastRow) continue;
                const deck = platform && i === P.firstRow;
                const tarped = options.tarp
                    ? inRanges(sec, options.tarp)
                    : false;
                const from = prevH.get(sec.k) ?? options.from ?? t.bottom;
                if (!below.has(from)) below.set(from, ring(o, from));
                const under = below.get(from)!;
                // A platform's deck stands level with the cross-aisle.
                const hs = deck ? BOWL.crossAisle : h;
                const edge = deck ? ring(o, hs) : front;
                // A tunnel's mouth takes the middle of its rows' risers and
                // treads (`addLogeTunnels` lines the opening).
                const g = options.gaps;
                const dCut =
                    options.directors?.k === sec.k
                        ? options.directors.cut(i)
                        : null;
                const mouth = dCut
                    ? metersSpan(front, sec, dCut)
                    : g &&
                        !tarped &&
                        g.sections.has(sec.k) &&
                        i >= g.firstRow &&
                        i <= g.lastRow
                      ? tunnelSpan(sec)
                      : null;
                if (i === 0 && options.fascia)
                    options.fascia.band.slice(under, edge, sec.s, sec.e, {
                        tile: options.fascia.tile,
                    });
                else
                    sliceAround(
                        i === 0 && options.litWall && !tarped ? lit : concrete,
                        under,
                        edge,
                        sec,
                        mouth,
                        {
                            tint: tarped
                                ? i === 0
                                    ? WALL_BLACK
                                    : TARP
                                : i === 0
                                  ? (options.wall ?? scale(RISER, light))
                                  : scale(RISER, light),
                        },
                    );
                sliceAround(
                    tarped ? concrete : treadBand,
                    edge,
                    deck ? ring(o + platformRows * t.depth, hs) : back,
                    sec,
                    mouth,
                    { tint: tarped ? TARP : scale(TREAD, light) },
                );
                prevH.set(sec.k, hs);
                if (tarped) continue;
                if (options.seats && !inRanges(sec, options.seats)) continue;

                const len = ringLength(seatLine, sec.s, sec.e);
                const half = DIESEL_AISLE / 2;
                if (deck) {
                    // A few people on the platform, toward its two ends.
                    const line = ring(o + 1.3, hs + SEAT_HEIGHT);
                    for (const [a, b] of [
                        [2, 5.2],
                        [len - 5.6, len - 2.2],
                    ])
                        pushSeatRow(line, sec, a, b, t.depth, options);
                    continue;
                }
                const cut =
                    g &&
                    g.sections.has(sec.k) &&
                    i >= g.firstRow &&
                    i <= g.lastRow
                        ? g.width + 0.8
                        : 0;
                const spans = dCut
                    ? [
                          [half, dCut[0] - 0.15],
                          [dCut[1] + 0.15, len - half],
                      ]
                    : cut
                      ? [
                            [half, (len - cut) / 2],
                            [(len + cut) / 2, len - half],
                        ]
                      : [[half, len - half]];
                for (const [a, b] of spans) {
                    const count = Math.floor((b - a) / DIESEL_SEAT_PITCH);
                    if (count < 1) continue;
                    // Whole seats, centered in the span.
                    const a1 = a + (b - a - count * DIESEL_SEAT_PITCH) / 2;
                    const b1 = a1 + count * DIESEL_SEAT_PITCH;
                    const ps = ringSpan(seatLine, sec.s, sec.e, a1, b1);
                    const tint = scale(SEAT, light);
                    let u = 0;
                    for (let k = 0; k + 1 < ps.length; k++) {
                        const [f0, f1] = [ps[k], ps[k + 1]];
                        const u1 =
                            u +
                            ringAt(seatLine, f0).distanceTo(
                                ringAt(seatLine, f1),
                            ) /
                                DIESEL_SEAT_PITCH;
                        const u0 = u;
                        for (const [lo, hi, v0] of [
                            [profile.backFoot, profile.backTop, 0.5],
                            [profile.panFoot, profile.panTop, 0],
                        ] as const)
                            seats.add(
                                [
                                    ringAt(lo, f0),
                                    ringAt(lo, f1),
                                    ringAt(hi, f1),
                                    ringAt(hi, f0),
                                ],
                                [u0, v0, u1, v0 + 0.5],
                                tint,
                            );
                        u = u1;
                    }
                    // The crowd sits in the seats: one person per pitch,
                    // starting at the middle of the first seat.
                    pushSeatRow(
                        seatLine,
                        sec,
                        a1 + DIESEL_SEAT_PITCH / 2,
                        b1,
                        t.depth,
                        options,
                    );
                }
            }
        }
    };
    function pushSeatRow(
        line: Ring,
        sec: Section,
        a: number,
        b: number,
        depth: number,
        options: TierOptions,
        standing?: number,
    ): void {
        const ps = ringSpan(line, sec.s, sec.e, a, b);
        if (ps.length < 2) return;
        const points = ps.map((f): Vector3Tuple => {
            const p = ringAt(line, f);
            return [p.x, p.y, p.z];
        });
        const mid = points[Math.floor(points.length / 2)];
        if (!options.crowd(mid[0], mid[2])) return;
        seatRows.push({
            points,
            closed: false,
            depth,
            side: "home",
            ...(standing === undefined ? {} : { standing }),
        });
    }

    // ---- The decks ----
    const tunnels = logeTunnels();
    const tarp = [R.tarp];
    const main = [R.main];
    /** The main ring's open part: everything on it that is not tarped. */
    const openMain: RingRange[] = [[R.main[0], R.tarp[0] + N]];
    const sides = [R.front, R.south, R.back];
    const notTarped = (x: number, z: number) => !inTarp(x, z);

    // The 100s and the 200s: one bank, tarped on the draped side.
    addTier(lower, {
        ranges: main,
        tarp,
        wall: WALL_BLUE,
        crowd: notTarped,
        platforms,
    });
    addTier(northLower, {
        ranges: [R.north],
        wall: WALL_BLUE,
        crowd: notTarped,
    });
    // The 200s' front wall, over the cross-aisle: bare concrete, house-lit,
    // with the 2xx plaques (photo 13).
    addTier(loge, {
        ranges: main,
        tarp,
        wall: FASCIA_LIT,
        litWall: true,
        crowd: notTarped,
        gaps: { ...DIESEL_VOMITORY, sections: tunnels },
        directors: directors
            ? { k: directors.k, cut: directorsCut }
            : undefined,
    });
    // The 300s, behind LED ribbon 1 (`ribbons.ts` hangs it just in front of
    // their dark parapet), and the 400s above their back wall. The stand
    // behind the drape keeps its steps but has no seats to draw.
    addTier(club, {
        ranges: main,
        fine: true,
        seats: [R.open],
        wall: FASCIA,
        crowd: notTarped,
    });
    const midWall = FASCIA_LIT;
    addTier(mid, {
        ranges: sides,
        fine: true,
        seats: [R.open],
        wall: midWall,
        litWall: true,
        crowd: notTarped,
    });
    addTier(cornerMid, {
        ranges: R.corners,
        fine: true,
        seats: [R.open],
        wall: midWall,
        litWall: true,
        crowd: notTarped,
    });
    // The 500s: their fascia is the ring of names on the sidelines and LED
    // ribbon 2 round the corners and the south end.
    // The east 500s stand behind the drape's upper hang: steps, no seats.
    addTier(terrace, {
        ranges: R.straights,
        fine: true,
        seats: [R.open],
        fascia: { band: names, tile: NAME_TILE },
        crowd: notTarped,
    });
    addTier(terrace, {
        ranges: R.ribbon2,
        fine: true,
        seats: [R.open],
        wall: FASCIA,
        crowd: notTarped,
    });
    // The 600s. The east stand and its corner are behind the drape and have
    // no seats to draw.
    const upperWall = FASCIA_LIT;
    const uppers: [FrameTier, RingRange, boolean][] = [
        [upperWest, R.front, true],
        [cornerUpper, R.southWest, true],
        [upperSouth, R.south, true],
        [upperEast, R.back, false],
        [cornerUpper, R.northEast, false],
    ];
    for (const [t, range, seated] of uppers)
        addTier(t, {
            ranges: [range],
            fine: true,
            seats: seated ? undefined : [],
            wall: upperWall,
            litWall: true,
            crowd: notTarped,
        });
    // The north stand's high deck.
    addTier(northMid, {
        ranges: [R.north],
        fine: true,
        wall: FASCIA,
        crowd: notTarped,
    });

    // ---- Walls, slabs and soffits ----
    const band = (
        d0: number,
        y0: number,
        d1: number,
        y1: number,
        ranges: RingRange[],
        tint: Tint = PLAIN,
        into: BandBuilder = concrete,
    ) => {
        const a = ring(d0, y0);
        const b = ring(d1, y1);
        for (const range of ranges) into.slice(a, b, ...range, { tint });
    };
    /** A house-lit concrete face (`markDiesel.fascias`). */
    const litBand = (
        d0: number,
        y0: number,
        d1: number,
        y1: number,
        ranges: RingRange[],
        tint: Tint,
    ) => band(d0, y0, d1, y1, ranges, tint, lit);
    const glazing = (
        d: number,
        y0: number,
        y1: number,
        ranges: RingRange[],
    ) => {
        const a = ring(d, y0);
        const b = ring(d, y1);
        for (const range of ranges)
            glass.slice(a, b, ...range, { tile: DIESEL_SUITE_TILE });
    };
    /** A thin rail along a ring: an upright strip and a flat one. */
    const rail = (d: number, y: number, ranges: RingRange[]) => {
        band(d, y - 0.05, d, y, ranges, RAIL_TINT);
        band(d - 0.03, y, d + 0.03, y, ranges, RAIL_TINT);
    };
    /**
     * A glass rail along a ring, `d` out, from `y0` up to its cap at `y1`
     * (photos 12 and 13): clear panes that catch a little of the hall's
     * light, brighter toward their top, a pale metal cap, and at high
     * quality a post at every joint. `pieces` are stretches of the ring as
     * fractional ring indices.
     */
    const glassRail = (
        d: number,
        y0: number,
        y1: number,
        pieces: [number, number][],
    ) => {
        const line = ring(d, y0);
        const color = dim(RAIL_METAL, Math.max(0.55, spill(d, y0)));
        const split = y0 + (y1 - y0) * 0.68;
        for (const [f0, f1] of pieces) {
            if (f1 - f0 < 1e-6) continue;
            const fs = [f0];
            for (let i = Math.floor(f0) + 1; i < f1 - 1e-6; i++)
                if (i - f0 > 1e-6) fs.push(i);
            fs.push(f1);
            const strip = (
                into: BandBuilder,
                da: number,
                ya: number,
                db: number,
                yb: number,
                tint: Tint,
            ) => {
                const a = ring(da, ya);
                const b = ring(db, yb);
                into.slice(
                    fs.map((f) => ringAt(a, f)),
                    fs.map((f) => ringAt(b, f)),
                    0,
                    fs.length - 1,
                    { tint },
                );
            };
            strip(railGlass, d, y0 + 0.05, d, split, GLASS_LOW);
            strip(railGlass, d, split, d, y1 - 0.04, GLASS_HIGH);
            strip(lit, d - 0.035, y1, d + 0.035, y1, CAP_LIT);
            strip(lit, d - 0.035, y1 - 0.05, d - 0.035, y1, CAP_LIT);
            if (!high) continue;
            // Posts at equal steps along the piece, ends included, an odd
            // number of panes so the middle of a section (where the seat
            // cameras sit) looks through a pane, not at a post.
            let len = 0;
            for (let i = 0; i + 1 < fs.length; i++)
                len += ringAt(line, fs[i]).distanceTo(ringAt(line, fs[i + 1]));
            const n = 2 * Math.floor(len / GLASS_POST_PITCH / 2) + 1;
            let acc = 0;
            let k = 0;
            for (let i = 0; i + 1 < fs.length; i++) {
                const p = ringAt(line, fs[i]);
                const q = ringAt(line, fs[i + 1]);
                const seg = p.distanceTo(q);
                while (k <= n && (k * len) / n <= acc + seg + 1e-6) {
                    const t = seg > 0 ? ((k * len) / n - acc) / seg : 0;
                    const foot = p.clone().lerp(q, Math.min(1, t));
                    structure.beam(foot, foot.clone().setY(y1), 0.04, color);
                    k++;
                }
                acc += seg;
            }
        }
    };
    /** The sections of `of` in `ranges`, as `glassRail` pieces. */
    const whole = (
        ranges: RingRange[],
        of: Section[] = upperSections,
    ): [number, number][] =>
        of.filter((sec) => inRanges(sec, ranges)).map((sec) => [sec.s, sec.e]);
    const walk = (d: number, y: number, k = 0.8) =>
        scale(TREAD, spill(d, y) * k);
    const boxes = BOWL.logeBoxes;
    const [suite] = BOWL.suites;
    const sign = BOWL.suiteFascia;
    const ring2 = BOWL.upperFascia;

    // The cross-aisle between the 100s and the 200s, at street level: a
    // blue wall behind the last row of the 100s rises to it (photo 13),
    // with a rail along its edge.
    const aisleY = BOWL.crossAisle;
    band(lower.back, lower.top, lower.back, aisleY, openMain, AISLE_WALL);
    band(lower.back, lower.top, lower.back, aisleY, tarp, WALL_BLACK);
    band(
        lower.back,
        aisleY,
        loge.offset,
        aisleY,
        openMain,
        walk(lower.back, aisleY),
    );
    band(lower.back, aisleY, loge.offset, aisleY, tarp, TARP);
    // Behind the 200s: a low wall, then the open loge boxes' glass.
    litBand(loge.back, loge.top, loge.back, boxes.bottom, openMain, BACK_LIT);
    band(loge.back, loge.top, loge.back, boxes.bottom, tarp, scale(SHADE, 1.2));
    band(
        loge.back,
        boxes.bottom,
        boxes.offset,
        boxes.bottom,
        main,
        scale(SOFFIT, 0.6),
    );
    glazing(boxes.offset, boxes.bottom, boxes.top, openMain);
    band(boxes.offset, boxes.bottom, boxes.offset, boxes.top, tarp, WALL_BLACK);
    // The soffit over the boxes, out to ribbon 1's parapet in front of the
    // 300s.
    litBand(
        boxes.offset,
        boxes.top,
        club.offset,
        club.bottom,
        main,
        SOFFIT_LIT,
    );
    band(club.offset, club.bottom, club.offset, BOWL.ribbon.top, main, FASCIA);
    band(
        club.back,
        club.top,
        mid.offset,
        club.top,
        main,
        walk(club.back, club.top, 0.6),
    );
    // Sidelines and south end: the suite level hangs over the back rows of
    // the 400s. Its fascia carries the stadium sign; the glass stands back
    // from it, under the soffit of the 500s.
    band(mid.back, mid.top, mid.back, sign.bottom, sides, scale(SHADE, 0.7));
    litBand(sign.offset, sign.bottom, mid.back, sign.bottom, sides, SOFFIT_LIT);
    litBand(sign.offset, sign.bottom, sign.offset, sign.top, sides, FASCIA_LIT);
    litBand(
        sign.offset,
        sign.top,
        suite.offset,
        suite.bottom,
        sides,
        FASCIA_LIT,
    );
    glazing(suite.offset, suite.bottom, suite.top, sides);
    litBand(
        suite.offset,
        suite.top,
        ring2.offset,
        ring2.bottom,
        sides,
        SOFFIT_LIT,
    );
    // Corners: the 400s run back under the 500s to a wall of suite glass.
    const cornerSill = cornerMid.top + 0.5;
    const cornerHead = ring2.bottom - 0.3;
    band(
        cornerMid.back,
        cornerMid.top,
        cornerMid.back,
        cornerSill,
        R.corners,
        SHADE,
    );
    glazing(cornerMid.back, cornerSill, cornerHead, R.corners);
    band(
        cornerMid.back,
        cornerHead,
        cornerMid.back,
        ring2.bottom,
        R.corners,
        SHADE,
    );
    litBand(
        ring2.offset,
        ring2.bottom,
        cornerMid.back,
        ring2.bottom,
        R.corners,
        SOFFIT_LIT,
    );
    // Behind the 500s: a walkway to the 600s' front wall. Where there are
    // no 600s the wall is a parapet, with the deck the boards hang over
    // behind it.
    band(
        terrace.back,
        terrace.top,
        upperWest.offset,
        upperWest.bottom,
        main,
        walk(terrace.back, terrace.top, 0.6),
    );
    const bare = [R.southEast, R.northWest];
    const deckBack = upperSouth.back + 1;
    litBand(
        upperWest.offset,
        upperWest.bottom,
        upperWest.offset,
        upperWest.base,
        bare,
        upperWall,
    );
    band(
        upperWest.offset,
        upperWest.base,
        deckBack,
        upperWest.base,
        bare,
        scale(TREAD, 0.22),
    );
    band(deckBack, upperWest.base, deckBack, 0, bare, SHADE);
    // The 600s: a back wall, and the slab under them.
    for (const [t, range] of uppers) {
        band(t.back, t.top + RIM, t.back, t.bottom, [range], SHADE);
        litBand(t.offset, t.bottom, t.back, t.bottom, [range], SOFFIT_LIT);
        band(t.back, t.bottom, t.back, 0, [range], SHADE);
    }
    // The press box: a glazed box over the top rows of the west 600s.
    const box = BOWL.pressBox;
    {
        const west = [R.front];
        const back = upperWest.back;
        const sill = box.bottom + 1;
        const head = box.top - 0.9;
        litBand(box.offset, box.bottom, back, box.bottom, west, SOFFIT_LIT);
        litBand(box.offset, box.bottom, box.offset, sill, west, FASCIA_LIT);
        glazing(box.offset, sill, head, west);
        litBand(box.offset, head, box.offset, box.top, west, FASCIA_LIT);
        band(box.offset, box.top, back, box.top, west, SHADE);
        band(back, upperWest.top + RIM, back, box.top, west, SHADE);
    }
    // The north stand: an open concourse behind the lower bank, dark under
    // the high deck, and a ledge from the deck's back wall to the window.
    const northRange = [R.north];
    const recess = northMid.offset + 1;
    band(
        northLower.back,
        northLower.top,
        recess,
        northLower.top,
        northRange,
        walk(northLower.back, northLower.top, 0.7),
    );
    {
        const a = ring(recess, northLower.top);
        const b = ring(recess, northMid.bottom);
        concourse.slice(a, b, ...R.north, { tile: DIESEL_CONCOURSE_TILE });
    }
    band(
        northMid.offset,
        northMid.bottom,
        recess,
        northMid.bottom,
        northRange,
        scale(SOFFIT, 0.5),
    );
    band(
        northMid.back,
        northMid.top + RIM,
        northMid.back,
        northMid.bottom,
        northRange,
        SHADE,
    );
    band(
        northMid.back,
        northMid.top + RIM,
        northMid.back + 8,
        northMid.top + RIM,
        northRange,
        scale(TREAD, 0.25),
    );

    // ---- End walls: where a deck stops, or meets a different one ----
    const wallQuad = (k: number, points: [number, number][], tint: Tint) => {
        const [a, b, c, d] = points.map(([d0, y]) => at(k, d0, y));
        concrete.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        concrete.pos.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
        concrete.uv.push(0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0);
        for (let i = 0; i < 6; i++) concrete.color.push(...tint);
    };
    const END: Tint = scale(PLAIN, 0.3);
    /** The side of a deck: its rake, from `floor` up, with a parapet. */
    const endWall = (k: number, t: FrameTier, floor: number, parapet = 0) =>
        wallQuad(
            k,
            [
                [t.offset, floor],
                [t.offset, t.base + parapet],
                [t.back, t.top + t.rise + parapet],
                [t.back, floor],
            ],
            END,
        );
    // The north stand meets the main ring halfway round each north corner:
    // a bulkhead closes the main ring's decks, and each bank shows its side.
    for (const k of [R.north[0], R.north[1]]) {
        const hasUpper = k === R.northEast[1];
        const top = hasUpper
            ? cornerUpper.top + cornerUpper.rise + RIM
            : upperWest.base;
        endWall(k, lower, 0);
        endWall(k, northLower, 0);
        endWall(k, loge, 0);
        endWall(k, northMid, northMid.bottom, RIM);
        wallQuad(
            k,
            [
                [loge.back, 0],
                [loge.back, top],
                [deckBack, top],
                [deckBack, 0],
            ],
            END,
        );
    }
    for (const [t, [from, to]] of uppers) {
        endWall(from, t, t.bottom, RIM);
        endWall(to, t, t.bottom, RIM);
    }
    // Where the 400s of a straight meet a corner's deeper ones: the end of
    // the suite level, and the wall beside the corner's back rows.
    for (const [from, to] of R.corners)
        for (const k of [from, to]) {
            if (k === R.north[0] || k === R.north[1]) continue;
            wallQuad(
                k,
                [
                    [sign.offset, sign.bottom],
                    [sign.offset, ring2.bottom],
                    [cornerMid.back, ring2.bottom],
                    [cornerMid.back, sign.bottom],
                ],
                END,
            );
            wallQuad(
                k,
                [
                    [mid.back, mid.bottom],
                    [mid.back, sign.bottom],
                    [cornerMid.back, sign.bottom],
                    [cornerMid.back, mid.bottom],
                ],
                END,
            );
        }
    for (const k of R.front)
        wallQuad(
            k,
            [
                [box.offset, box.bottom],
                [box.offset, box.top],
                [upperWest.back, box.top],
                [upperWest.back, box.bottom],
            ],
            END,
        );

    // The padded field wall stands above the first tread: its face is the
    // pads (`surround.ts`), its top a concrete cap.
    const wallCap = 0.3;
    band(0, lower.base, 0, BOWL.fieldWall, openMain, WALL_BLUE);
    band(0, lower.base, 0, BOWL.fieldWall, tarp, WALL_BLACK);
    band(0, BOWL.fieldWall, wallCap, BOWL.fieldWall, main, scale(TREAD, 0.9));
    band(wallCap, BOWL.fieldWall, wallCap, lower.base, main, SHADE);
    // The field wall's rail and the 200s' front rail are dark steel (photos
    // 1 and 10). The cross-aisle's edge and the balcony fronts above are
    // glass with a metal cap (photos 12 and 13).
    rail(lower.offset + 0.06, BOWL.fieldWall + 0.5, [R.open]);
    glassRail(
        lower.back + 0.06,
        aisleY,
        aisleY + GLASS_RAIL.aisle,
        whole(openMain, sections),
    );
    // The 200s' front: along the wall only, not across the tunnels' mouths
    // and the directors' platform.
    const logeFront = ring(loge.offset, 0);
    const logePieces: [number, number][] = [];
    for (const sec of sections) {
        if (!inRanges(sec, openMain)) continue;
        const gap =
            sec.k === directors?.k
                ? metersSpan(logeFront, sec, DIESEL_DIRECTORS.platform)
                : tunnels.has(sec.k)
                  ? tunnelSpan(sec)
                  : null;
        if (gap) logePieces.push([sec.s, gap[0]], [gap[1], sec.e]);
        else logePieces.push([sec.s, sec.e]);
    }
    // Dark steel, as the field wall's (photo 1's foreground).
    for (const [f0, f1] of logePieces) {
        if (f1 - f0 < 1e-6) continue;
        const fs = [f0];
        for (let i = Math.floor(f0) + 1; i < f1 - 1e-6; i++)
            if (i - f0 > 1e-6) fs.push(i);
        fs.push(f1);
        const d = loge.offset + 0.06;
        const y = loge.base + 0.75;
        for (const [da, ya, db, yb] of [
            [d, y - 0.05, d, y],
            [d - 0.03, y, d + 0.03, y],
        ]) {
            const a = ring(da, ya);
            const b = ring(db, yb);
            concrete.slice(
                fs.map((f) => ringAt(a, f)),
                fs.map((f) => ringAt(b, f)),
                0,
                fs.length - 1,
                { tint: RAIL_TINT },
            );
        }
    }
    glassRail(
        mid.offset + 0.06,
        mid.base,
        mid.base + GLASS_RAIL.deck,
        whole(openMain),
    );
    glassRail(
        terrace.offset + 0.06,
        terrace.base,
        terrace.base + GLASS_RAIL.upper,
        whole(main),
    );
    glassRail(
        upperWest.offset + 0.06,
        upperWest.base,
        upperWest.base + GLASS_RAIL.upper,
        whole([R.front, R.southWest, R.south]),
    );
    glassRail(
        northMid.offset + 0.06,
        northMid.base,
        northMid.base + GLASS_RAIL.upper,
        whole(northRange),
    );

    addPlatforms();
    addLogeTunnels(tunnels);
    if (directors) addDirectors(directors);
    const plaqueLabels = addSectionNumbers();
    if (high) {
        addUpperPortals();
        addAisleSteps();
    }

    // The floor inside the bowl: turf out to the field wall.
    const floor = ring(0.4, FLOOR_Y);
    const floorPos: number[] = [];
    for (let i = 0; i < N; i++) {
        const p = floor[i];
        const q = floor[(i + 1) % N];
        // Wound to face up (the ring runs counterclockwise from above).
        floorPos.push(0, FLOOR_Y, 0, p.x, p.y, p.z, q.x, q.y, q.z);
    }
    const floorGeo = new BufferGeometry();
    floorGeo.setAttribute("position", new Float32BufferAttribute(floorPos, 3));
    floorGeo.computeVertexNormals();
    addMesh(
        floorGeo,
        setGroundLayer(
            // The same synthetic turf as the field (`turf.ts`).
            shared.std(parseInt(DIESEL_TURF.base.slice(1), 16), {
                roughness: 0.95,
            }),
            // The apron round the field: over the site's paint, under the
            // field itself.
            GROUND_LAYER.track,
        ),
        "markDiesel.floor",
    );

    const side = { side: DoubleSide };
    const concreteMap = concreteTexture();
    disposers.push(() => concreteMap.dispose());
    const treads = addMesh(
        treadBand.build(),
        matte({
            map: concreteMap,
            vertexColors: true,
            ...side,
        }),
        "markDiesel.treads",
    );
    // The seats take the hall's light like the concrete, plus the house
    // lights' warm fill on both faces (`DIESEL_SEAT_HOUSE`, times each
    // seat's baked tint): without it the backs, which face away from the
    // catwalks, fall to black where the photos show dark navy.
    const seatMap = dieselSeatTexture();
    const seatMat = houseLit(
        matte({
            map: seatMap,
            // White: the photos' warm cast is already in the seat color.
            emissive: 0xffffff,
            emissiveMap: seatMap,
            emissiveIntensity: 0,
            vertexColors: true,
            ...side,
        }),
    );
    addMesh(seats.build(), seatMat, "markDiesel.seats");
    addMesh(
        concrete.build(),
        matte({
            map: concreteMap,
            vertexColors: true,
            ...side,
        }),
        "markDiesel.concrete",
    );
    // The house-lit concrete: the scene's light on it, plus the house level
    // times each face's tint (its baked share of the downlights' spill).
    const fasciaMat = matte({
        // The hall's own light on them is the field's bounce; the house
        // level carries most of their color.
        color: 0x8a8a8a,
        map: concreteMap,
        // The map carries the concrete's own gray; the emissive color is the
        // house lights' white.
        emissive: DIESEL_HOUSE.color,
        emissiveMap: concreteMap,
        emissiveIntensity: 0,
        vertexColors: true,
        ...side,
    });
    addMesh(lit.build(), houseLit(fasciaMat), "markDiesel.fascias");
    // The rings run counterclockwise seen from above, so from the field a
    // band's U runs right to left; mirror it so the marks read.
    const nameMap = dieselNameRingTexture();
    nameMap.repeat.set(-1, 1);
    addMesh(
        names.build(),
        mat({
            color: 0xffffff,
            map: nameMap,
            emissive: 0xffffff,
            emissiveMap: nameMap,
            emissiveIntensity: 0.12,
            roughness: 0.7,
            ...side,
        }),
        "markDiesel.nameRing",
    );
    const suiteMap = dieselSuiteFrontTexture();
    suiteMap.repeat.set(-1, 1);
    const suiteMat = mat({
        color: 0xffffff,
        map: suiteMap,
        emissive: 0xffffff,
        emissiveMap: suiteMap,
        emissiveIntensity: 0.6,
        roughness: 0.22,
        metalness: 0.1,
        ...side,
    });
    addMesh(glass.build(), suiteMat, "markDiesel.suites");
    // The glass rails: faint panes over whatever is behind them, catching
    // a little of the hall's light. Unlit, as glass at this size reads.
    const railGlassMat = new MeshBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        opacity: 0.07,
        depthWrite: false,
        ...side,
    });
    railGlassMat.name = "markDiesel.railGlass";
    disposers.push(() => railGlassMat.dispose());
    const railGlassMesh = addMesh(
        railGlass.build(),
        railGlassMat,
        "markDiesel.railGlass",
    );
    railGlassMesh.receiveShadow = false;
    const concourseMap = dieselConcourseTexture();
    const concourseMat = mat({
        color: 0xffffff,
        map: concourseMap,
        emissive: 0xffffff,
        emissiveMap: concourseMap,
        emissiveIntensity: 0.5,
        roughness: 1,
        ...side,
    });
    addMesh(concourse.build(), concourseMat, "markDiesel.concourse");
    const plaqueMap = dieselSectionNumberTexture(plaqueLabels);
    addMesh(
        plaques.build(),
        mat({
            color: 0xffffff,
            map: plaqueMap,
            emissive: 0xffffff,
            emissiveMap: plaqueMap,
            emissiveIntensity: 0.1,
            roughness: 0.8,
            vertexColors: true,
            ...side,
        }),
        "markDiesel.sectionNumbers",
    );
    // The red signs on the suite fascia at the 50 (photos 6 and 13).
    const stadiumSigns = buildDieselStadiumSign(frame);
    disposers.push(() => stadiumSigns.dispose());
    object.add(stadiumSigns.object);
    if (structure.count > 0) {
        const mesh = structure.build(
            shared.unitBox,
            shared.std(0xffffff, { roughness: 0.9 }),
            "markDiesel.structure",
        );
        mesh.receiveShadow = true;
        object.add(mesh);
        disposers.push(() => mesh.dispose());
    }

    return {
        object,
        seatRows,
        treads,
        pickTargets: [treads],
        setLighting(preset) {
            const k = dieselLighting(preset).kit;
            // Dimmer glass by day, when the sun reaches the suites as well.
            const day = k.roofOpen && !k.lampsOn;
            suiteMat.emissiveIntensity = day ? 0.35 : 0.6;
            fasciaMat.emissiveIntensity = k.lampsOn
                ? DIESEL_HOUSE.lampsOn
                : DIESEL_HOUSE.day;
            seatMat.emissiveIntensity = k.lampsOn
                ? DIESEL_SEAT_HOUSE.lampsOn
                : DIESEL_SEAT_HOUSE.day;
            concourseMat.emissiveIntensity = day ? 0.25 : 0.5;
        },
        dispose() {
            disposers.forEach((d) => d());
            object.clear();
        },
    };

    /**
     * The sections of the 200s with a tunnel through their front rows:
     * every section of the main ring but the ones behind a platform.
     */
    function logeTunnels(): Set<number> {
        const picked = new Set<number>();
        for (const sec of sections)
            if (
                inRanges(sec, [R.main]) &&
                !platforms.has(sec.k) &&
                sec.k !== directors?.k
            )
                picked.add(sec.k);
        return picked;
    }

    /**
     * The wheelchair platforms: the walls at each end of the deck, where the
     * neighboring sections' rows step down past it, and at high quality the
     * rail at its front.
     */
    function addPlatforms(): void {
        const hDeck = BOWL.crossAisle;
        const dFront = lower.offset + P.firstRow * lower.depth;
        const light = spill(dFront, hDeck);
        for (const sec of sections) {
            if (!platforms.has(sec.k)) continue;
            const ends = [
                platforms.has(sec.k - 1) ? null : sec.s,
                platforms.has(sec.k + 1) ? null : sec.e,
            ].filter((k): k is number => k !== null);
            for (const k of ends)
                for (let r = P.firstRow; r < P.lastRow; r++) {
                    const d = lower.offset + r * lower.depth;
                    const y = lower.base + r * lower.rise;
                    wallQuad(
                        k,
                        [
                            [d, y],
                            [d, hDeck],
                            [d + lower.depth, hDeck],
                            [d + lower.depth, y],
                        ],
                        scale(RISER, light),
                    );
                }
            if (!high) continue;
            // Two dark steel bars on posts (photo 1).
            const color = dim(RAIL, 1);
            const bars = [0.92, 0.48];
            const a = at(sec.s, dFront + 0.08, hDeck);
            const b = at(sec.e, dFront + 0.08, hDeck);
            const along = new Vector3().subVectors(b, a).normalize();
            a.addScaledVector(along, DIESEL_AISLE / 2);
            b.addScaledVector(along, -DIESEL_AISLE / 2);
            const up = (p: Vector3, dy: number) => p.clone().setY(p.y + dy);
            for (const bar of bars)
                structure.beam(up(a, bar), up(b, bar), 0.05, color);
            const posts = Math.round(a.distanceTo(b) / 1.6);
            for (let i = 0; i <= posts; i++) {
                const p = new Vector3().lerpVectors(a, b, i / posts);
                structure.beam(p, up(p, bars[0]), 0.045, color);
            }
        }
    }

    /** Where the tunnel of a section of the 200s comes out, and its size. */
    function tunnelMouth() {
        const { firstRow, lastRow } = DIESEL_VOMITORY;
        return {
            d0: loge.offset + firstRow * loge.depth - 0.06,
            d1: loge.offset + (lastRow + 1) * loge.depth,
            h0: BOWL.crossAisle,
            h1: loge.base + lastRow * loge.rise + 0.25,
        };
    }

    /**
     * The middle of a section's ring at the tunnel's mouth (`ring(d0)`), as
     * a fractional ring index, and the stretch the opening takes there.
     */
    function tunnelSpan(sec: Section): [number, number] {
        const r0 = ring(tunnelMouth().d0, 0);
        const len = ringLength(r0, sec.s, sec.e);
        const half = DIESEL_VOMITORY.width / 2;
        const ps = ringSpan(r0, sec.s, sec.e, len / 2 - half, len / 2 + half);
        return [ps[0], ps[ps.length - 1]];
    }

    /**
     * The tunnels' mouths: an opening through the 200s' front wall, the
     * size of a door, lined with house-lit concrete and looking through to
     * the concourse's warm light (photo 13); a slab over it carries the
     * rows' rail. Behind the drape, where nobody sees them, a dark block.
     */
    function addLogeTunnels(picked: Set<number>): void {
        const { width } = DIESEL_VOMITORY;
        const { d0, d1, h0, h1 } = tunnelMouth();
        const r0 = ring(d0, 0);
        const r1 = ring(d1, 0);
        const light = spill((d0 + d1) / 2, h0);
        const half = width / 2;
        /** The slab over the opening, and the opening's ceiling under it. */
        const LID = 0.25;
        const top = h1 - LID;
        /**
         * The slab and the side walls stand this far off the lining, so
         * the two never share a plane (and never z-fight).
         */
        const GAP = 0.08;
        /** Side walls' thickness, and the walls' axis off the centerline. */
        const WALL = 0.3;
        const wallAt = half + GAP + WALL / 2;
        for (const sec of sections) {
            if (!picked.has(sec.k)) continue;
            const [fa, fb] = tunnelSpan(sec);
            const mid = (fa + fb) / 2;
            const front = ringAt(r0, mid);
            const back = ringAt(r1, mid);
            const depth = front.distanceTo(back);
            const away = new Vector3().subVectors(back, front).normalize();
            const yaw = Math.atan2(away.x, away.z);
            const center = new Vector3()
                .addVectors(front, back)
                .multiplyScalar(0.5);
            const across = new Vector3(away.z, 0, -away.x);
            /** A point `x` across the mouth, `d` in from its front, at `y`. */
            const p = (x: number, d: number, y: number) =>
                front
                    .clone()
                    .addScaledVector(across, x)
                    .addScaledVector(away, d)
                    .setY(y);
            const dark = inRanges(sec, [R.tarp]);
            if (dark)
                structure.box(
                    center.clone().setY((h0 + h1) / 2 - 0.05),
                    [width, h1 - h0 - 0.1, depth],
                    PORTAL,
                    yaw,
                );
            else {
                structure.box(
                    center.clone().setY((top + GAP + h1) / 2),
                    [2 * (wallAt + WALL / 2), h1 - top - GAP, depth],
                    dim(CONCRETE, light),
                    yaw,
                );
                lineTunnel(p, half, depth, h0, top);
            }
            for (const sx of [-1, 1]) {
                const wall = center
                    .clone()
                    .addScaledVector(
                        across,
                        sx * (dark ? half + 0.15 : wallAt),
                    );
                // Under the slab when the mouth is open; full height beside
                // the dark block.
                const wallTop = dark ? h1 : top;
                structure.box(
                    wall.clone().setY((h0 + wallTop) / 2),
                    [WALL, wallTop - h0, depth],
                    dark ? PORTAL : dim(CONCRETE, light),
                    yaw,
                );
                if (high)
                    structure.box(
                        wall.setY(h1 + 0.9),
                        [0.06, 0.06, depth],
                        RAIL,
                        yaw,
                    );
            }
            if (high)
                structure.box(
                    front
                        .clone()
                        .addScaledVector(away, 0.1)
                        .setY(h1 + 0.9),
                    [width + 0.6, 0.06, 0.06],
                    RAIL,
                    yaw,
                );
        }
    }

    /**
     * The directors' platform (`DIESEL_DIRECTORS`): a deck at the
     * cross-aisle's level where the section's front rows are cut away, walls
     * where the rows beside it step down to it, a wide tunnel mouth at its
     * back, and a few people standing at the glass.
     */
    function addDirectors(sec: Section): void {
        const D = DIESEL_DIRECTORS;
        const deck = BOWL.crossAisle;
        const dRow = (i: number) => loge.offset + i * loge.depth;
        const hRow = (i: number) => loge.base + i * loge.rise;
        const [oa, ob] = directorsCut(D.rows);
        const strip = (
            into: BandBuilder,
            d0: number,
            d1: number,
            span: [number, number],
            tint: Tint,
        ) => {
            const r0 = ring(d0, deck);
            const r1 = ring(d1, deck);
            const fs = ringSpan(r0, sec.s, sec.e, span[0], span[1]);
            into.slice(
                fs.map((f) => ringAt(r0, f)),
                fs.map((f) => ringAt(r1, f)),
                0,
                fs.length - 1,
                { tint },
            );
        };
        // The deck: out over the platform's rows, and further back over the
        // rows that step back to the tunnel.
        const floor = walk(dRow(1), deck);
        strip(treadBand, loge.offset, dRow(D.rows), D.platform, floor);
        strip(treadBand, dRow(D.rows), loge.back, [oa, ob], floor);
        /** A wall at `m` meters along the section, under row `i`. */
        const fAt = (m: number) =>
            metersSpan(ring(loge.offset, 0), sec, [m, m + 0.01])[0];
        const wall = (f: number, pts: [number, number][], tint: Tint) => {
            const [a, b, c, d] = pts.map(([d0, y]) => ringAt(ring(d0, y), f));
            lit.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
            lit.pos.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
            lit.uv.push(0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0);
            for (let k = 0; k < 6; k++) lit.color.push(...tint);
        };
        // House-lit concrete, as the walls round the cross-aisle are.
        const side = scale(SOFFIT_LIT, 0.8);
        const rowWall = (m: number, i: number) =>
            wall(
                fAt(m),
                [
                    [dRow(i), deck],
                    [dRow(i), hRow(i)],
                    [dRow(i + 1), hRow(i)],
                    [dRow(i + 1), deck],
                ],
                side,
            );
        for (let i = 0; i < loge.rows; i++) {
            const [a, b] = directorsCut(i);
            rowWall(a, i);
            rowWall(b, i);
        }
        // The back of the platform either side of the opening, up to the
        // last row it took.
        const back = scale(SOFFIT_LIT, 0.65);
        const top = hRow(D.rows - 1);
        for (const [a, b] of [
            [D.platform[0], oa],
            [ob, D.platform[1]],
        ]) {
            if (b - a < 0.05) continue;
            const r0 = ring(dRow(D.rows), deck);
            const r1 = ring(dRow(D.rows), top);
            const fs = ringSpan(r0, sec.s, sec.e, a, b);
            lit.slice(
                fs.map((f) => ringAt(r0, f)),
                fs.map((f) => ringAt(r1, f)),
                0,
                fs.length - 1,
                { tint: back },
            );
        }
        addDirectorsOpening(sec, oa, ob);
        addDirectorsFront(sec);
    }

    /**
     * The opening at the back of the directors' platform, `oa` to `ob`
     * meters along the section.
     */
    function addDirectorsOpening(sec: Section, oa: number, ob: number): void {
        const deck = BOWL.crossAisle;
        // The opening at the back: the 200s and the loge box above them are
        // open over its width, back to a dark wall (photo 13: a dark gap
        // from the platform up to ribbon 1). The concourse's doors at its
        // foot catch a little light.
        const dBack = loge.back - 0.03;
        const shut = (y0: number, y1: number, tint: Tint) => {
            const r0 = ring(dBack, y0);
            const r1 = ring(dBack, y1);
            const fs = ringSpan(r0, sec.s, sec.e, oa, ob);
            lit.slice(
                fs.map((f) => ringAt(r0, f)),
                fs.map((f) => ringAt(r1, f)),
                0,
                fs.length - 1,
                { tint },
            );
        };
        const doors = deck + 2.6;
        shut(deck, doors, scale(SOFFIT_LIT, 0.16));
        shut(doors, BOWL.logeBoxes.top, scale(SOFFIT_LIT, 0.045));
    }

    /**
     * The front of the directors' platform: a pale curb along the top of
     * the blue wall under its glass, and people standing on the deck.
     */
    function addDirectorsFront(sec: Section): void {
        const D = DIESEL_DIRECTORS;
        const deck = BOWL.crossAisle;
        const curb = scale(FASCIA_LIT, 0.95);
        const r0 = ring(lower.back - 0.02, aisleY);
        const fs = ringSpan(r0, sec.s, sec.e, D.platform[0], D.platform[1]);
        const curbBand = (d0: number, y0: number, d1: number, y1: number) => {
            const a = ring(d0, y0);
            const b = ring(d1, y1);
            lit.slice(
                fs.map((f) => ringAt(a, f)),
                fs.map((f) => ringAt(b, f)),
                0,
                fs.length - 1,
                { tint: curb },
            );
        };
        curbBand(lower.back - 0.02, aisleY - 0.16, lower.back - 0.02, aisleY);
        curbBand(
            lower.back - 0.02,
            aisleY + 0.001,
            lower.back + 0.3,
            aisleY + 0.001,
        );
        // People standing at the glass and further back on the deck.
        const standAt = (d: number, spans: [number, number][]) => {
            const line = ring(d, deck + SEAT_HEIGHT);
            for (const [a, b] of spans)
                pushSeatRow(
                    line,
                    sec,
                    a,
                    b,
                    0.8,
                    {
                        ranges: [],
                        crowd: () => true,
                    },
                    1,
                );
        };
        standAt(lower.back + 0.5, [
            [1.0, 2.7],
            [4.4, 5.6],
        ]);
        standAt(loge.offset + 1.2, [
            [2.3, 3.4],
            [5.7, 6.4],
        ]);
    }

    /**
     * A tunnel mouth's lining, inside its walls: house-lit floor, ceiling
     * and sides, and the concourse's light through the back. `p(x, d, y)`
     * is a point `x` across the mouth, `d` in from its front, at height `y`.
     */
    function lineTunnel(
        p: (x: number, d: number, y: number) => Vector3,
        half: number,
        depth: number,
        h0: number,
        top: number,
    ): void {
        /** Lining tints (times the house lights): floor, ceiling, sides. */
        const FLOOR: Tint = [0.16, 0.16, 0.18];
        const CEILING: Tint = [0.15, 0.15, 0.18];
        const SIDES: Tint = [0.24, 0.24, 0.27];
        const quad = (
            band: BandBuilder,
            [a, b, c, d]: Vector3[],
            options: SliceOptions,
        ) => band.slice([a, b], [d, c], 0, 1, options);
        const e = 0.01;
        const [x0, x1] = [-half, half];
        const flat = (y: number, d0: number, d1: number) => [
            p(x0, d0, y),
            p(x1, d0, y),
            p(x1, d1, y),
            p(x0, d1, y),
        ];
        quad(lit, flat(h0 + e, 0, depth), { tint: FLOOR });
        quad(lit, flat(top, depth, 0), { tint: CEILING });
        for (const x of [x0, x1])
            quad(
                lit,
                [p(x, 0, h0), p(x, depth, h0), p(x, depth, top), p(x, 0, top)],
                { tint: SIDES },
            );
        // Through the back: the concourse and its lights.
        const d = depth - e;
        quad(
            concourse,
            [p(x0, d, h0), p(x1, d, h0), p(x1, d, top), p(x0, d, top)],
            { tile: DIESEL_CONCOURSE_TILE / 3 },
        );
    }

    /** Portals in the 600s the audience sees, one in the middle of each section. */
    function addUpperPortals(): void {
        const { firstRow, lastRow, width } = UPPER_PORTAL;
        const decks: [FrameTier, RingRange][] = [
            [upperWest, R.front],
            [upperSouth, R.south],
        ];
        for (const [t, range] of decks) {
            const d0 = t.offset + firstRow * t.depth;
            const d1 = t.offset + (lastRow + 1) * t.depth;
            const h0 = t.base + (firstRow - 1) * t.rise;
            const h1 = t.base + lastRow * t.rise + 0.3;
            const depth = d1 - d0;
            const line = ring((d0 + d1) / 2, (h0 + h1) / 2);
            for (const sec of upperSections) {
                if (!inRanges(sec, [range])) continue;
                const mid = (sec.s + sec.e) / 2;
                const p = ringAt(line, mid);
                const away = out[Math.floor(mid) % N];
                const yaw = Math.atan2(away.x, away.z);
                const across = new Vector3(away.z, 0, -away.x);
                structure.box(p, [width, h1 - h0, depth], PORTAL, yaw);
                // Parapets round the stair well: its two sides and its head.
                const wall = dim(CONCRETE, spill(d0, h0) * 0.9);
                const top = h1 + 0.75;
                for (const sx of [-1, 1])
                    structure.box(
                        p
                            .clone()
                            .addScaledVector(across, sx * (width / 2 + 0.1))
                            .setY((h0 + top) / 2),
                        [0.2, top - h0, depth],
                        wall,
                        yaw,
                    );
                structure.box(
                    p
                        .clone()
                        .addScaledVector(away, depth / 2)
                        .setY((h1 + top) / 2),
                    [width + 0.4, top - h1, 0.2],
                    wall,
                    yaw,
                );
            }
        }
    }

    /**
     * The aisles of the steep decks: a half step on every tread, and in the
     * west 600s a handrail down the middle, in short runs.
     */
    function addAisleSteps(): void {
        const stepped: [FrameTier, RingRange[], Section[]][] = [
            [loge, openMain, sections],
            [mid, [R.front, R.south], upperSections],
            [cornerMid, [R.southWest, R.northWest], upperSections],
            [upperWest, [R.front], upperSections],
            [cornerUpper, [R.southWest], upperSections],
            [upperSouth, [R.south], upperSections],
            [northMid, [R.north], upperSections],
        ];
        for (const [t, ranges, of] of stepped)
            for (const k of aisles(ranges, of)) {
                const yaw = Math.atan2(out[k].x, out[k].z);
                for (let i = 0; i + 1 < t.rows; i++) {
                    const d = t.offset + (i + 0.75) * t.depth;
                    const h = t.base + i * t.rise;
                    structure.box(
                        at(k, d, h + t.rise / 4),
                        [DIESEL_AISLE, t.rise / 2, t.depth / 2],
                        dim(CONCRETE, spill(d, h) * 0.8),
                        yaw,
                    );
                }
            }
        for (const k of aisles([R.front], upperSections)) {
            const t = upperWest;
            const top = (i: number) =>
                at(
                    k,
                    t.offset + (i + 0.5) * t.depth,
                    t.base + i * t.rise + 0.95,
                );
            for (let i = 1; i + 2 < t.rows; i += 4) {
                const a = top(i);
                const b = top(i + 2);
                structure.beam(a, b, 0.05, RAIL);
                for (const p of [a, b])
                    structure.beam(p.clone().setY(p.y - 0.95), p, 0.045, RAIL);
            }
        }
    }

    /**
     * Section number plaques, facing the field, numbered as the building
     * does (`dieselSectionNumber`): the 100s on the blue wall under the
     * cross-aisle, the 200s on their front wall over it, the 300s on the front
     * wall of the 400s and the 500s on the front wall of the 600s. Over the
     * directors' seats in section 139 the wall also carries their printed
     * sign. Returns the atlas's labels, in cell order.
     */
    function addSectionNumbers(): string[] {
        interface Plaque {
            corners: [Vector3, Vector3, Vector3, Vector3];
            label: string;
        }
        const placed: Plaque[] = [];
        const used = new Set<number>();
        const plaque = (
            sec: Section,
            level: number,
            d: number,
            y0: number,
            y1: number,
            width: number,
            /** Where along the section, 0 to 1. */
            at = 0.5,
            label?: string,
        ) => {
            const f = sec.s + (sec.e - sec.s) * at;
            const line = ring(d, y0);
            const c = ringAt(line, f);
            const n = dieselSectionNumber(frame, c.x, c.z, level);
            if (!label) {
                // A section the model draws wider than the building's can
                // fall on the same number as its neighbor.
                if (used.has(n)) return;
                used.add(n);
            }
            const along = new Vector3()
                .subVectors(ringAt(line, f + 0.25), ringAt(line, f - 0.25))
                .normalize()
                .multiplyScalar(width / 2);
            const a = c.clone().sub(along);
            const b = c.clone().add(along);
            placed.push({
                corners: [a, b, b.clone().setY(y1), a.clone().setY(y1)],
                label: label ?? String(n),
            });
        };
        // The 100s' plaque sits toward one end of its section's wall, as
        // 139's does in photo 13.
        const wallY = lower.top + 0.45;
        for (const sec of sections) {
            if (!inRanges(sec, openMain)) continue;
            plaque(sec, 1, lower.back - 0.03, wallY, wallY + 0.62, 1.24, 0.82);
            plaque(
                sec,
                2,
                loge.offset - 0.03,
                BOWL.crossAisle + 0.4,
                BOWL.crossAisle + 0.9,
                1,
                0.82,
            );
        }
        for (const sec of upperSections) {
            if (inRanges(sec, openMain)) {
                const y = (mid.bottom + mid.base) / 2;
                plaque(sec, 3, mid.offset - 0.05, y - 0.3, y + 0.3, 1.2);
            }
            if (!high) continue;
            if (!inRanges(sec, [R.front, R.southWest, R.south])) continue;
            const y = (upperWest.bottom + upperWest.base) / 2;
            plaque(sec, 5, upperWest.offset - 0.05, y - 0.35, y + 0.35, 1.4);
        }
        // The directors' sign: a letter-size sheet taped high on 139's wall.
        const directors = sections.find(
            (sec) =>
                inRanges(sec, [R.front]) &&
                (() => {
                    const p = ringAt(ring(lower.back, 0), (sec.s + sec.e) / 2);
                    return dieselSectionNumber(frame, p.x, p.z, 1) === 139;
                })(),
        );
        if (directors) {
            const h = 0.28;
            const y = BOWL.crossAisle - 0.42;
            plaque(
                directors,
                1,
                lower.back - 0.03,
                y - h,
                y,
                h * DIRECTOR_PLACARD_ASPECT,
                0.38,
                DIRECTOR_PLACARD,
            );
        }
        const labels = [...new Set(placed.map((p) => p.label))];
        for (const p of placed) {
            const index = labels.indexOf(p.label);
            plaques.add(
                p.corners,
                sectionAtlasCell(
                    index,
                    labels.length,
                    p.label === DIRECTOR_PLACARD,
                ),
                scale(PLAIN, 0.8),
            );
        }
        return labels;
    }
}
