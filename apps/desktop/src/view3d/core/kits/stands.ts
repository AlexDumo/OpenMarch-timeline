// cspell:ignore metalness
import {
    DoubleSide,
    FrontSide,
    Group,
    InstancedMesh,
    Matrix4,
    Mesh,
    MeshStandardMaterial,
    PlaneGeometry,
    Quaternion,
    Vector2,
    Vector3,
    type BufferGeometry,
    type Object3D,
    type Vector3Tuple,
} from "three";
import {
    createSharedMaterials,
    ft,
    lightingValues,
    lightPole,
    videoBoard,
    type LightPole,
    type SharedMaterials,
    type VideoBoard,
} from "../environment";
import type {
    CameraSeat,
    FieldFootprint,
    KitBuildInput,
    KitResult,
    LightingPreset,
    SeatRow,
    VenueKitId,
} from "../types";
import { BoxBatch, QuadBuilder } from "./hs/geometry";
import { buildPressBox, type PressBox } from "./hs/pressBox";
import { buildTrackRibbon } from "./hs/track";
import { STAND_BANDS, STAND_TILE, standTexture, wallTexture } from "./hs/textures";

/**
 * Rectangular stands and the shared builder behind the `hs`, `bighs`, `college`
 * and `blank` kits (P2.3). Ported from the reference demo's `stand`,
 * `buildStadium`, `addTrack` and `stadiumPath`, in meters, with everything
 * placed relative to the field footprint (design.md section 6).
 *
 * The field surface itself is P2.1's job. These kits only leave the footprint
 * area free, with a grass apron around it.
 */

/** The footprint with its center and half sizes, in world meters. */
export interface Frame extends FieldFootprint {
    cx: number;
    cz: number;
    halfW: number;
    halfD: number;
}

export function frameOf(fp: FieldFootprint): Frame {
    return {
        ...fp,
        cx: (fp.minX + fp.maxX) / 2,
        cz: (fp.minZ + fp.maxZ) / 2,
        halfW: (fp.maxX - fp.minX) / 2,
        halfD: (fp.maxZ - fp.minZ) / 2,
    };
}

export interface PressBoxSpec {
    width: number;
    height: number;
    /** Lift above the top row, on steel columns. */
    lift: number;
    /** Glass bands, default 1. */
    stories?: number;
}

/** A stand in its own frame: front edge at z = 0, rising toward +z. */
export interface StandSpec {
    length: number;
    rows: number;
    /** Tread depth. */
    depth: number;
    rise: number;
    /** Height of the first row's tread. */
    base: number;
    side: SeatRow["side"];
    pressBox?: PressBoxSpec;
    /**
     * `aluminum`: open bleachers on a steel frame (high school). `concrete`:
     * a closed precast stand. Default `concrete`.
     */
    style?: "aluminum" | "concrete";
}

/** Team dressing for a stand: wall pad color and painted text. */
export interface StandDressing {
    /** "#rrggbb" */
    color: string;
    /** Painted on the front wall, e.g. "HOME"; may be empty. */
    wallText: string;
    /** Fascia text on the press box; may be empty. */
    pressText: string;
}

/** Where a stand's local origin goes: world x and z, and its yaw about +Y. */
export interface StandPlacement {
    x: number;
    z: number;
    yaw: number;
}

export interface Stand {
    group: Group;
    /** One polyline per row, in the kit root's frame (placement applied). */
    seatRows: SeatRow[];
    /** The stepped seating surface: what pick-a-seat raycasts against. */
    pickTarget: Object3D;
    /** Eye position in front of the press box glass, kit frame. */
    pressEye?: Vector3Tuple;
    /** Eye position above row `i`, kit frame. */
    rowEye(i: number): Vector3Tuple;
    /** Press box window glow, 0 (day) to 1 (night). */
    setGlow(k: number): void;
    dispose(): void;
}

const BENCH_LIFT = ft(1.35);
const BENCH_THICK = ft(0.25);
const BENCH_DEPTH = ft(0.9);
/** Steel frame spacing along an aluminum stand. */
const FRAME_EVERY = ft(12);
/** People per aisle block and aisle width in people (matches buildCrowd). */
const AISLE_BLOCK = 18;
const AISLE_GAP = 2;
const PERSON_STEP = 0.64;

/** Aisle center positions along a stand of `length`, in its local x. */
export function aisleCenters(length: number): number[] {
    const out: number[] = [];
    for (let k = 0; ; k++) {
        const x =
            -length / 2 +
            PERSON_STEP * (AISLE_BLOCK + (AISLE_GAP - 1) / 2 + k * (AISLE_BLOCK + AISLE_GAP));
        if (x > length / 2 - 2) break;
        out.push(x);
    }
    return out;
}

/** Builds the stepped surface (treads, risers, and for concrete the walls). */
function standSurface(
    spec: StandSpec,
    concrete: boolean,
): BufferGeometry {
    const { length: L, rows, depth: d, rise, base } = spec;
    const q = new QuadBuilder();
    const h = (i: number) => base + i * rise;
    const xa = -L / 2;
    const xb = L / 2;
    const u = (x: number) => x / STAND_TILE;
    const { tread, riser, side } = STAND_BANDS;
    const up = new Vector3(0, 1, 0);
    const front = new Vector3(0, 0, -1);
    for (let i = 0; i < rows; i++) {
        const z0 = i * d;
        const z1 = (i + 1) * d;
        const y = h(i);
        q.quad(
            new Vector3(xa, y, z0),
            new Vector3(xb, y, z0),
            new Vector3(xb, y, z1),
            new Vector3(xa, y, z1),
            [u(xa), tread[0]],
            [u(xb), tread[0]],
            [u(xb), tread[1]],
            [u(xa), tread[1]],
            undefined,
            up,
        );
        const yb = i === 0 ? 0 : h(i - 1);
        q.quad(
            new Vector3(xa, yb, z0),
            new Vector3(xb, yb, z0),
            new Vector3(xb, y, z0),
            new Vector3(xa, y, z0),
            [u(xa), riser[0]],
            [u(xb), riser[0]],
            [u(xb), riser[1]],
            [u(xa), riser[1]],
            undefined,
            front,
        );
    }
    if (concrete) {
        const top = h(rows - 1);
        const back = rows * d;
        const vy = (y: number) => side[0] + ((side[1] - side[0]) * y) / top;
        for (const sx of [-1, 1]) {
            const x = (sx * L) / 2;
            const out = new Vector3(sx, 0, 0);
            for (let i = 0; i < rows; i++) {
                const z0 = i * d;
                const z1 = (i + 1) * d;
                const y = h(i);
                q.quad(
                    new Vector3(x, 0, z0),
                    new Vector3(x, 0, z1),
                    new Vector3(x, y, z1),
                    new Vector3(x, y, z0),
                    [u(z0), vy(0)],
                    [u(z1), vy(0)],
                    [u(z1), vy(y)],
                    [u(z0), vy(y)],
                    undefined,
                    out,
                );
            }
        }
        q.quad(
            new Vector3(xa, 0, back),
            new Vector3(xb, 0, back),
            new Vector3(xb, top, back),
            new Vector3(xa, top, back),
            [u(xa), vy(0)],
            [u(xb), vy(0)],
            [u(xb), vy(top)],
            [u(xa), vy(top)],
            undefined,
            new Vector3(0, 0, 1),
        );
        // pilasters on the back wall, so it reads as structure, not a slab
        const n = Math.max(2, Math.round(L / 6.1));
        for (let k = 0; k <= n; k++) {
            const x = xa + 0.35 + ((L - 0.7) * k) / n;
            q.box(
                new Vector3(x - 0.35, 0, back),
                new Vector3(x + 0.35, top + 0.4, back + 0.55),
                STAND_TILE,
                side,
                [0.5, (side[0] + side[1]) / 2],
                top + 0.4,
            );
        }
    }
    return q.build();
}

/**
 * Railings for every stand (back rail, end rails, aisle handrails) and, for
 * aluminum, the steel understructure: sloped stringers, posts and bracing.
 */
function standSteel(spec: StandSpec, aluminum: boolean, s: BoxBatch): void {
    const { length: L, rows, depth: d, rise, base } = spec;
    const h = (i: number) => base + i * rise;
    const top = h(rows - 1);
    const back = rows * d;
    const rail = ft(3.5);
    const t = ft(0.17);
    // back rail
    for (let x = -L / 2; x <= L / 2 + 1e-3; x += ft(8)) {
        s.add([x, top + rail / 2, back - t], [t, rail, t]);
    }
    s.beam([-L / 2, top + rail, back - t], [L / 2, top + rail, back - t], ft(0.2));
    s.beam([-L / 2, top + rail * 0.5, back - t], [L / 2, top + rail * 0.5, back - t], t);
    // end rails follow the slope, with a post every four rows
    for (const sx of [-1, 1]) {
        const x = sx * (L / 2 - t);
        s.beam([x, base + rail, d * 0.5], [x, top + rail, back - d * 0.5], ft(0.2));
        s.beam([x, base + rail * 0.5, d * 0.5], [x, top + rail * 0.5, back - d * 0.5], t);
        for (let i = 0; i < rows; i += 4) {
            s.add([x, h(i) + rail / 2, i * d + d * 0.5], [t, rail, t]);
        }
    }
    // aisle handrails from row 3 up, at the aisle centers the crowd leaves free
    const hand = ft(2.8);
    for (const x of aisleCenters(L)) {
        const i0 = Math.min(3, rows - 1);
        s.beam([x, h(i0) + hand, i0 * d + d * 0.5], [x, top + hand, back - d * 0.5], ft(0.15));
        for (let i = i0; i < rows; i += 4) {
            s.add([x, h(i) + hand / 2, i * d + d * 0.5], [ft(0.15), hand, ft(0.15)]);
        }
    }
    if (!aluminum) return;
    const frames = Math.max(2, Math.ceil(L / FRAME_EVERY) + 1);
    const beam = ft(0.45);
    const postEvery = 4;
    for (let k = 0; k < frames; k++) {
        const x = -L / 2 + 0.3 + ((L - 0.6) * k) / (frames - 1);
        // stringer under the nosings
        s.beam([x, base - beam, 0.15], [x, top - beam, back - 0.15], beam);
        for (let i = 0; i < rows; i += postEvery) {
            const y = h(i) - beam;
            s.add([x, y / 2, i * d + 0.15], [ft(0.35), y, ft(0.35)]);
        }
        const yb = top - beam;
        s.add([x, yb / 2, back - 0.15], [ft(0.4), yb, ft(0.4)]);
        // diagonal brace in the back bay, alternating direction
        if (k < frames - 1) {
            const x2 = -L / 2 + 0.3 + ((L - 0.6) * (k + 1)) / (frames - 1);
            const lo = 0.4;
            const hi = yb * 0.85;
            if (k % 2 === 0) s.beam([x, lo, back - 0.15], [x2, hi, back - 0.15], ft(0.3));
            else s.beam([x, hi, back - 0.15], [x2, lo, back - 0.15], ft(0.3));
        }
    }
    // ledgers along the back and the middle
    const yb = top - beam;
    for (const y of [yb * 0.35, yb * 0.7]) {
        s.beam([-L / 2, y, back - 0.15], [L / 2, y, back - 0.15], ft(0.35));
    }
    const midRow = Math.floor(rows / 2 / postEvery) * postEvery;
    const ym = (h(midRow) - beam) * 0.5;
    s.beam([-L / 2, ym, midRow * d + 0.15], [L / 2, ym, midRow * d + 0.15], ft(0.3));
}

/** Builds one stand, positioned by `placement`. */
export function buildStand(
    spec: StandSpec,
    placement: StandPlacement,
    shared: SharedMaterials,
    dressing: StandDressing = { color: "#3a3d44", wallText: "", pressText: "" },
): Stand {
    const { length, rows, depth, rise, base } = spec;
    const aluminum = spec.style === "aluminum";
    const group = new Group();
    group.name = `stand:${spec.side}`;
    group.position.set(placement.x, 0, placement.z);
    group.rotation.y = placement.yaw;
    group.updateMatrix();
    const owned: { dispose(): void }[] = [];

    const surfaceGeo = standSurface(spec, !aluminum);
    const surfaceMap = standTexture(aluminum ? "aluminum" : "concrete");
    surfaceMap.repeat.set(1, 1);
    const surfaceMat = new MeshStandardMaterial({
        map: surfaceMap,
        roughness: aluminum ? 0.5 : 0.95,
        metalness: aluminum ? 0.45 : 0,
        side: aluminum ? DoubleSide : FrontSide,
    });
    owned.push(surfaceGeo, surfaceMap, surfaceMat);
    const treads = new Mesh(surfaceGeo, surfaceMat);
    treads.name = "treads";
    treads.castShadow = treads.receiveShadow = true;

    const bench = new InstancedMesh(shared.unitBox, shared.bench, rows);
    bench.name = "bench";
    const m = new Matrix4();
    const q = new Quaternion();
    const seatRows: SeatRow[] = [];
    const toKit = (p: Vector3Tuple): Vector3Tuple => {
        const v = new Vector3(...p).applyMatrix4(group.matrix);
        return [v.x, v.y, v.z];
    };
    for (let i = 0; i < rows; i++) {
        const h = base + i * rise;
        m.compose(
            new Vector3(0, h + BENCH_LIFT, i * depth + depth * 0.32),
            q,
            new Vector3(length, BENCH_THICK, BENCH_DEPTH),
        );
        bench.setMatrixAt(i, m);
        const z = i * depth + depth * 0.42;
        seatRows.push({
            points: [toKit([-length / 2, h, z]), toKit([length / 2, h, z])],
            closed: false,
            depth,
            side: spec.side,
        });
    }
    bench.receiveShadow = true;
    bench.castShadow = true;
    group.add(treads, bench);

    // The padded front wall with the team's color and painted text.
    const wallMap = wallTexture(
        dressing.color,
        dressing.wallText,
        length,
        length > 70 ? 3 : 2,
    );
    const wallMat = new MeshStandardMaterial({ map: wallMap, roughness: 0.7 });
    const wallGeo = new PlaneGeometry(length, base);
    const wall = new Mesh(wallGeo, wallMat);
    wall.name = "standWall";
    wall.rotation.y = Math.PI;
    wall.position.set(0, base / 2, -0.04);
    wall.receiveShadow = true;
    group.add(wall);
    owned.push(wallMap, wallMat, wallGeo);

    const steel = new BoxBatch();
    standSteel(spec, aluminum, steel);

    let pressEye: Vector3Tuple | undefined;
    let press: PressBox | undefined;
    if (spec.pressBox) {
        const pb = spec.pressBox;
        press = buildPressBox({
            width: pb.width,
            height: pb.height,
            lift: pb.lift,
            stories: pb.stories ?? 1,
            top: base + (rows - 1) * rise,
            back: rows * depth,
            homeColor: dressing.color,
            text: dressing.pressText,
            shared,
            steel,
        });
        group.add(press.group);
        pressEye = toKit(press.eye);
    }

    const steelMat = aluminum
        ? new MeshStandardMaterial({ color: 0x8d939c, metalness: 0.55, roughness: 0.45 })
        : new MeshStandardMaterial({ color: 0x41454d, metalness: 0.3, roughness: 0.6 });
    owned.push(steelMat);
    const steelMesh = steel.build(shared.unitBox, steelMat, "standSteel");
    steelMesh.castShadow = true;
    group.add(steelMesh);

    return {
        group,
        seatRows,
        pickTarget: treads,
        pressEye,
        rowEye: (i) =>
            toKit([0, base + i * rise + ft(4), i * depth + depth * 0.45]),
        setGlow(k) {
            press?.setGlow(k);
        },
        dispose() {
            bench.dispose();
            steelMesh.dispose();
            press?.dispose();
            owned.forEach((o) => o.dispose());
        },
    };
}

/** Stadium outline (straights plus semicircle ends) as world x, z points. */
export function stadiumPoints(
    cx: number,
    cz: number,
    straightHalf: number,
    r: number,
    segments = 48,
): Vector2[] {
    const pts: Vector2[] = [
        new Vector2(cx - straightHalf, cz - r),
        new Vector2(cx + straightHalf, cz - r),
    ];
    for (let i = 1; i < segments; i++) {
        const a = -Math.PI / 2 + (Math.PI * i) / segments;
        pts.push(
            new Vector2(
                cx + straightHalf + r * Math.cos(a),
                cz + r * Math.sin(a),
            ),
        );
    }
    pts.push(
        new Vector2(cx + straightHalf, cz + r),
        new Vector2(cx - straightHalf, cz + r),
    );
    for (let i = 1; i < segments; i++) {
        const a = Math.PI / 2 + (Math.PI * i) / segments;
        pts.push(
            new Vector2(
                cx - straightHalf + r * Math.cos(a),
                cz + r * Math.sin(a),
            ),
        );
    }
    return pts;
}

export interface TrackResult {
    objects: Object3D[];
    dispose(): void;
}

/** Height of the apron above y = 0. */
const APRON_Y = 0.005;

/**
 * A 6-lane track around the field: 29 to 38.1 m radius on a football field.
 * One textured ribbon (lanes baked in) plus a finish line decal.
 */
export function buildTrack(frame: Frame): TrackResult {
    return buildTrackRibbon(frame);
}

/** A flat ground plane, centered at (x, y, z). */
export function groundPlane(
    width: number,
    depth: number,
    material: MeshStandardMaterial,
    x: number,
    y: number,
    z: number,
    name: string,
): { mesh: Mesh; geometry: PlaneGeometry } {
    const geometry = new PlaneGeometry(width, depth);
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    mesh.userData.ground = true;
    return { mesh, geometry };
}

/** The big plane under everything (the demo's 9000 ft). */
export const GROUND_SIZE = ft(9000);
export const GROUND_Y = -ft(0.3);
export const APRON_HEIGHT = APRON_Y;

/** Blimp offset from the field center: back-left and high, toward the audience. */
export const BLIMP_OFFSET: Vector3Tuple = [-ft(380), ft(420), ft(410)];
/** The top-down camera sits this far toward the audience so "up" is the back. */
export const TOP_DOWN_NUDGE = 0.15;

export function cameraSeat(
    id: string,
    kind: CameraSeat["kind"],
    position: Vector3Tuple,
    target: Vector3Tuple,
): CameraSeat {
    return {
        id,
        labelKey: `view3d.camera.${id}`,
        kind,
        position,
        target,
    };
}

export function blimpCamera(frame: Frame): CameraSeat {
    return cameraSeat(
        "blimp",
        "aerial",
        [
            frame.cx + BLIMP_OFFSET[0],
            BLIMP_OFFSET[1],
            frame.cz + BLIMP_OFFSET[2],
        ],
        [frame.cx, 0, frame.cz],
    );
}

export function topDownCamera(frame: Frame, height: number): CameraSeat {
    return cameraSeat(
        "topDown",
        "topDown",
        [frame.cx, height, frame.cz + TOP_DOWN_NUDGE],
        [frame.cx, 0, frame.cz],
    );
}

export const OUTDOOR_PRESETS: LightingPreset[] = ["day", "dusk", "night"];

export interface PoleSpot {
    /** -1 for the side-1 end, 1 for side 2. */
    sx: -1 | 1;
    /** Meters past the field's end edge. */
    dx: number;
    /** True: in front of the front sideline; false: behind the back one. */
    front: boolean;
    /** Meters past that sideline. */
    dz: number;
}

/** What a kit's `decorate` hook adds around the stadium. */
export interface Decoration {
    objects: Object3D[];
    setLighting(preset: LightingPreset): void;
    dispose(): void;
}

export interface DecorateContext {
    frame: Frame;
    shared: SharedMaterials;
    input: KitBuildInput;
}

export interface StandsKitConfig {
    id: Extract<VenueKitId, "hs" | "bighs" | "college">;
    groundColor: number;
    /** Extra lawn around the footprint (inside a paved surround). */
    infield?: { extraW: number; extraD: number };
    track: boolean;
    /** Gap from the sideline to the stand's front edge. */
    front: { spec: Omit<StandSpec, "side">; gap: number };
    back: { spec: Omit<StandSpec, "side">; gap: number };
    /** Stands behind each end line, `gap` meters from it. */
    ends?: { spec: Omit<StandSpec, "side">; gap: number };
    board?: {
        w: number;
        h: number;
        legs: number;
        /** Center of the board past the side-2 end edge. */
        dx: number;
        /** Height of the screen center. */
        y: number;
        title: string;
    };
    /** Paved plaza behind the side-1 end zone. */
    plaza?: { dx: number; w: number; d: number };
    podium: boolean;
    poles: { height: number; spots: PoleSpot[] };
    cameras: {
        /** The press box camera aims this far behind the field center. */
        pressTargetBack: number;
        /**
         * End-zone camera: end, distance past the end edge, height, and an
         * optional sideways nudge toward the home side (clears goal posts).
         */
        endZone: { sx: -1 | 1; dx: number; y: number; dz?: number };
        topDownHeight: number;
    };
    crowdDensity: number;
    defaultLighting: LightingPreset;
    /** Adds the surroundings (site, buildings, fence, scoreboard...). */
    decorate?: (ctx: DecorateContext) => Decoration;
}

/** Press box and building window glow per lighting preset. */
export const WINDOW_GLOW: Partial<Record<LightingPreset, number>> = {
    day: 0,
    dusk: 0.75,
    night: 1.1,
};

const FRONT_ROW_OFFSET = -ft(36);
const PODIUM = { w: ft(6), h: ft(8), d: ft(6), z: ft(26) };

/**
 * The director's podium: an aluminum scaffold tower with a deck at 8 ft,
 * rails on the back and sides, a ladder and a team-colored skirt in front.
 * Its origin is the center of its footprint on the ground.
 */
function buildPodium(
    homeColor: string,
    shared: SharedMaterials,
): InstancedMesh {
    const { w, h, d } = PODIUM;
    const b = new BoxBatch();
    const t = ft(0.25);
    const rail = ft(3.5);
    const team = parseInt(homeColor.replace("#", ""), 16);
    b.add([0, h - ft(0.2), 0], [w, ft(0.4), d]);
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            b.add([(sx * w) / 2, h / 2, (sz * d) / 2], [t, h, t]);
        }
        // X braces on the sides and the back
        const x = (sx * w) / 2;
        b.beam([x, 0.2, -d / 2], [x, h - 0.3, d / 2], ft(0.15));
        b.beam([x, 0.2, d / 2], [x, h - 0.3, -d / 2], ft(0.15));
        b.beam([x, h + rail, -d / 2], [x, h + rail, d / 2], ft(0.18));
        b.add([x, h + rail / 2, -d / 2], [t, rail, t]);
        b.add([x, h + rail / 2, d / 2], [t, rail, t]);
    }
    b.beam([-w / 2, h + rail, d / 2], [w / 2, h + rail, d / 2], ft(0.18));
    b.beam([-w / 2, h + rail / 2, d / 2], [w / 2, h + rail / 2, d / 2], ft(0.15));
    // ladder at the back
    for (const sx of [-1, 1]) {
        b.add([sx * ft(0.8), h / 2, d / 2 + ft(0.4)], [ft(0.18), h, ft(0.18)]);
    }
    for (let y = ft(1); y < h; y += ft(1)) {
        b.add([0, y, d / 2 + ft(0.4)], [ft(1.6), ft(0.12), ft(0.12)]);
    }
    // skirt in the team color under the deck, facing the field
    b.add([0, h - ft(1.8), -d / 2 - ft(0.05)], [w, ft(3), ft(0.1)], [0, 0, 0], team);
    const mesh = b.build(
        shared.unitBox,
        shared.std(0xd5d9de, { metalness: 0.45, roughness: 0.45 }),
        "podium",
    );
    mesh.castShadow = true;
    return mesh;
}

/**
 * Shared builder for the three rectangular-stand kits. Builds the ground, the
 * apron around the footprint, the stands, extras and poles, then returns the
 * `KitResult`. The scene builds the crowd from `seatRows` and `crowdDensity`.
 */
export function buildStandsKit(
    cfg: StandsKitConfig,
    input: KitBuildInput,
): KitResult {
    const f = frameOf(input.footprint);
    const shared = createSharedMaterials();
    const root = new Group();
    root.name = `kit:${cfg.id}`;
    const geometries: { dispose(): void }[] = [];
    const disposables: { dispose(): void }[] = [];

    const ground = groundPlane(
        GROUND_SIZE,
        GROUND_SIZE,
        shared.std(cfg.groundColor, { roughness: 1 }),
        f.cx,
        GROUND_Y,
        f.cz,
        "ground",
    );
    root.add(ground.mesh);
    geometries.push(ground.geometry);
    if (cfg.infield) {
        const lawn = groundPlane(
            f.halfW * 2 + cfg.infield.extraW,
            f.halfD * 2 + cfg.infield.extraD,
            shared.std(0x3d6e31, { roughness: 1 }),
            f.cx,
            GROUND_Y + ft(0.1),
            f.cz,
            "infield",
        );
        root.add(lawn.mesh);
        geometries.push(lawn.geometry);
    }
    const apron = groundPlane(
        f.halfW * 2 + ft(40),
        f.halfD * 2 + ft(40),
        shared.std(0x3a7330, { roughness: 1 }),
        f.cx,
        APRON_Y,
        f.cz,
        "apron",
    );
    root.add(apron.mesh);
    geometries.push(apron.geometry);

    if (cfg.track) {
        const track = buildTrack(f);
        root.add(...track.objects);
        disposables.push(track);
    }

    const stands: Stand[] = [];
    const p = input.params;
    const dressings: Record<SeatRow["side"], StandDressing> = {
        home: {
            color: p.homeColor,
            wallText: "HOME",
            pressText: p.endZoneText,
        },
        away: { color: p.awayColor, wallText: "VISITORS", pressText: "" },
        neutral: { color: "#3a3d44", wallText: "", pressText: "" },
    };
    const addStand = (
        spec: Omit<StandSpec, "side">,
        side: SeatRow["side"],
        placement: StandPlacement,
    ) => {
        const stand = buildStand(
            { ...spec, side },
            placement,
            shared,
            dressings[side],
        );
        root.add(stand.group);
        stands.push(stand);
        return stand;
    };
    const front = addStand(cfg.front.spec, "home", {
        x: f.cx,
        z: f.maxZ + cfg.front.gap,
        yaw: 0,
    });
    addStand(cfg.back.spec, "away", {
        x: f.cx,
        z: f.minZ - cfg.back.gap,
        yaw: Math.PI,
    });
    if (cfg.ends) {
        for (const sx of [-1, 1] as const) {
            addStand(cfg.ends.spec, "neutral", {
                x: f.cx + sx * (f.halfW + cfg.ends.gap),
                z: f.cz,
                yaw: sx * (Math.PI / 2),
            });
        }
    }

    if (cfg.plaza) {
        const plaza = groundPlane(
            cfg.plaza.w,
            cfg.plaza.d,
            shared.std(0x8a8c90, { roughness: 1 }),
            f.minX - cfg.plaza.dx,
            GROUND_Y + ft(0.2),
            f.cz,
            "plaza",
        );
        root.add(plaza.mesh);
        geometries.push(plaza.geometry);
    }

    const boards: VideoBoard[] = [];
    if (cfg.board) {
        const b = cfg.board;
        const board = videoBoard(
            b.w,
            b.h,
            b.legs,
            b.title,
            "OpenMarch",
            shared,
        );
        board.object.position.set(f.maxX + b.dx, b.y, f.cz);
        board.object.rotation.y = -Math.PI / 2;
        root.add(board.object);
        boards.push(board);
    }

    if (cfg.podium) {
        const podium = buildPodium(p.homeColor, shared);
        podium.position.set(f.cx, 0, f.maxZ + PODIUM.z);
        root.add(podium);
        disposables.push(podium);
    }

    const poles: LightPole[] = cfg.poles.spots.map((s) => {
        const x = f.cx + s.sx * (f.halfW + s.dx);
        const z = s.front ? f.maxZ + s.dz : f.minZ - s.dz;
        // Aim a quarter of the way in x and a sixth in z from the field center
        // toward the pole (the demo's target), relative to the pole's base.
        const pole = lightPole(
            cfg.poles.height,
            [(x - f.cx) * -0.75, 0, (z - f.cz) * -0.85],
            shared,
        );
        pole.object.position.set(x, 0, z);
        root.add(pole.object);
        return pole;
    });

    const decoration = cfg.decorate?.({ frame: f, shared, input });
    if (decoration) root.add(...decoration.objects);

    const seatRows = stands.flatMap((s) => s.seatRows);

    const focus: Vector3Tuple = [f.cx, 0, f.cz];
    const cams: CameraSeat[] = [
        cameraSeat(
            "pressBox",
            "seat",
            front.pressEye ??
                front.rowEye(Math.max(0, cfg.front.spec.rows - 1)),
            [f.cx, 0, f.cz - cfg.cameras.pressTargetBack],
        ),
    ];
    const row1 = front.rowEye(1);
    cams.push(
        cameraSeat(
            "frontRow",
            "seat",
            [row1[0] + FRONT_ROW_OFFSET, row1[1], row1[2]],
            [f.cx - ft(12), ft(6), f.cz],
        ),
    );
    if (cfg.podium) {
        cams.push(
            cameraSeat(
                "podium",
                "seat",
                [f.cx, ft(13.5), f.maxZ + ft(24)],
                [f.cx, 0, f.cz + ft(10)],
            ),
        );
    }
    const ez = cfg.cameras.endZone;
    cams.push(
        cameraSeat(
            "endZone",
            "seat",
            [f.cx + ez.sx * (f.halfW + ez.dx), ez.y, f.cz + (ez.dz ?? 0)],
            [f.cx, 0, f.cz],
        ),
        blimpCamera(f),
        topDownCamera(f, cfg.cameras.topDownHeight),
    );

    if (input.quality === "low") {
        root.traverse((o) => {
            o.castShadow = false;
        });
    }

    const setLighting = (preset: LightingPreset) => {
        if (!OUTDOOR_PRESETS.includes(preset)) return;
        const k = lightingValues(preset).kit;
        poles.forEach((p) => p.setOn(k.lampsOn, k.lampScale));
        const glow = WINDOW_GLOW[preset] ?? 0;
        stands.forEach((s) => s.setGlow(glow));
        decoration?.setLighting(preset);
    };
    setLighting(cfg.defaultLighting);

    return {
        root,
        focus,
        cameras: cams,
        seatRows,
        pickTargets: stands.map((s) => s.pickTarget),
        crowdDensity: cfg.crowdDensity,
        lightingPresets: [...OUTDOOR_PRESETS],
        defaultLighting: cfg.defaultLighting,
        setLighting,
        dispose() {
            stands.forEach((s) => s.dispose());
            boards.forEach((b) => b.dispose());
            poles.forEach((p) => p.dispose());
            disposables.forEach((d) => d.dispose());
            decoration?.dispose();
            geometries.forEach((g) => g.dispose());
            shared.dispose();
        },
    };
}
