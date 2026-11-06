// cspell:ignore metalness wordmark
import {
    AdditiveBlending,
    BackSide,
    BoxGeometry,
    CircleGeometry,
    ConeGeometry,
    CubeTexture,
    CylinderGeometry,
    DirectionalLight,
    DoubleSide,
    Group,
    InstancedMesh,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    MeshLambertMaterial,
    type MeshLambertMaterialParameters,
    PlaneGeometry,
    Quaternion,
    SpotLight,
    TorusGeometry,
    Vector3,
    type BufferGeometry,
    type Object3D,
    type Texture,
    type Vector3Tuple,
} from "three";
import {
    createSharedMaterials,
    DEFAULT_AISLE_EVERY,
    lightingValues,
    PERSON_SPACING,
    setLightIntensity,
    type SharedMaterials,
} from "../environment";
import type {
    CameraSeat,
    FrameContext,
    KitBuilder,
    LightingPreset,
    SeatRow,
} from "../types";
import {
    aimY,
    InstanceBatch,
    quadsGeometry,
    yaw,
    type Quad,
} from "./gym/batch";
import {
    BANNER_CELL,
    bannerAtlas,
    backboardTexture,
    beamTexture,
    BLOCK_TILE_WIDTH,
    blockWallTexture,
    COURT_LENGTH,
    CURTAIN_TILE_WIDTH,
    curtainTexture,
    deckTexture,
    exitTexture,
    floorTexture,
    gymPalette,
    muralTexture,
    scoreboardTexture,
    type BannerSpec,
} from "./gym/textures";

/** Room and bleacher dimensions in meters (design.md section 6, "gym"). */
export const GYM_ROOM_MARGIN = 9;
export const GYM_ROOM_HEIGHT = 11;
export const GYM_BLEACHER_ROWS = 12;
export const GYM_BLEACHER_TREAD = 0.73;
export const GYM_BLEACHER_RISE = 0.35;
export const GYM_BLEACHER_BASE = 0.43;
/** Gap between the performance area's front edge and the first bleacher row. */
export const GYM_BLEACHER_GAP = 3;
/** Wall clearance behind the top row. */
const BLEACHER_WALL_GAP = 0.6;
const EYE_ABOVE_TREAD = 1.22;
/** Roof trusses: bottom and top chord heights below the ceiling. */
const TRUSS_BOTTOM_BELOW_CEILING = 2.3;
const TRUSS_TOP_BELOW_CEILING = 0.45;
/** Scoreboard brightness per preset (the lighting lane owns the rest). */
const SCOREBOARD_GLOW = { house: 1.1, show: 0.75 };
const EXIT_GLOW = 2.2;
const SPOT_LENS_GLOW = 4;
/** Ceiling deck glow per unit of high-bay lens emissive (bounce light). */
const DECK_BOUNCE = 0.16;
/** Opacity of the faked show-spot light cones. */
const BEAM_OPACITY = 0.09;

const BANNERS: BannerSpec[] = [
    { top: "WINTER GUARD", title: ["STATE", "CHAMPIONS"], year: "2025" },
    { top: "INDOOR PERCUSSION", title: ["REGIONAL", "FINALIST"], year: "2024" },
    { top: "MARCHING BAND", title: ["STATE", "FINALIST"], year: "2023" },
    { top: "WINTER GUARD", title: ["SCHOLASTIC", "A CLASS"], year: "2022" },
    { top: "INDOOR PERCUSSION", title: ["CIRCUIT", "CHAMPIONS"], year: "2021" },
    { top: "CONCERT BAND", title: ["SUPERIOR", "RATING"], year: "2019" },
    { top: "WINTER GUARD", title: ["REGIONAL", "CHAMPIONS"], year: "2018" },
    { top: "MARCHING BAND", title: ["GRAND", "CHAMPIONS"], year: "2016" },
    { top: "WINTER GUARD", title: ["CIRCUIT", "FINALIST"], year: "2015" },
    { top: "INDOOR PERCUSSION", title: ["STATE", "CHAMPIONS"], year: "2013" },
];
const BANNER_COLS = 5;

const m4 = new Matrix4();
const quat = new Quaternion();
const pos = new Vector3();
const scl = new Vector3();
const place = (
    mesh: InstancedMesh,
    i: number,
    p: Vector3Tuple,
    s: Vector3Tuple,
): void => {
    m4.compose(pos.set(...p), quat, scl.set(...s));
    mesh.setMatrixAt(i, m4);
};

/**
 * Bleacher aisle centers for a seat row starting at `start`: where the crowd
 * builder leaves its default two-person gaps (crowd.ts), up to `end`.
 */
export function gymAisles(start: number, end: number): number[] {
    const out: number[] = [];
    const every = DEFAULT_AISLE_EVERY;
    for (let k = 0; ; k++) {
        const x = start + (every + 0.5 + k * (every + 2)) * PERSON_SPACING;
        if (x > end) return out;
        out.push(x);
    }
}

/** A wall seen from inside: `u` runs to the right, `n` into the room. */
interface WallFrame {
    q: Quaternion;
    right: Vector3;
    at(u: number, y: number, n: number): Vector3Tuple;
}

function wallFrame(ox: number, oz: number, angle: number): WallFrame {
    const q = yaw(angle);
    const right = new Vector3(1, 0, 0).applyQuaternion(q);
    const inward = new Vector3(0, 0, 1).applyQuaternion(q);
    return {
        q,
        right,
        at: (u, y, n) => [
            ox + right.x * u + inward.x * n,
            y,
            oz + right.z * u + inward.z * n,
        ],
    };
}

/**
 * Indoor gym: a painted block room sized to the footprint, a maple floor with
 * a stained border, court lines and the safety tape, wooden pull-out
 * bleachers with aisles and rails on the front side, folded bleachers,
 * championship banners and a scoreboard on the back wall, a stage and wall
 * pads on the ends, steel trusses, ducts and high-bay lights overhead, and
 * house and show lighting. The tarp is the field surface (P2.1); the floor
 * sits at y = 0 so the surface at y = 0.02 lies on top. The room extends past
 * the footprint by 9 m on the sides and back, and further in front so its
 * front wall clears the bleachers.
 */
export const buildGym: KitBuilder = ({ footprint, params, quality }) => {
    const fp = footprint;
    const hi = quality === "high";
    const cx = (fp.minX + fp.maxX) / 2;
    const cz = (fp.minZ + fp.maxZ) / 2;
    const w = fp.maxX - fp.minX;
    const d = fp.maxZ - fp.minZ;
    const RH = GYM_ROOM_HEIGHT;
    const pal = gymPalette(params.homeColor);
    const wordmark = params.endZoneText.trim().toUpperCase();

    const bleacherDepth = GYM_BLEACHER_ROWS * GYM_BLEACHER_TREAD;
    const frontPad = Math.max(
        GYM_ROOM_MARGIN,
        GYM_BLEACHER_GAP + bleacherDepth + BLEACHER_WALL_GAP,
    );
    const room = {
        minX: fp.minX - GYM_ROOM_MARGIN,
        maxX: fp.maxX + GYM_ROOM_MARGIN,
        minZ: fp.minZ - GYM_ROOM_MARGIN,
        maxZ: fp.maxZ + frontPad,
    };
    const roomW = room.maxX - room.minX;
    const roomD = room.maxZ - room.minZ;
    const roomCz = (room.minZ + room.maxZ) / 2;

    const shared: SharedMaterials = createSharedMaterials();
    const { std, unitBox } = shared;
    const geometries: BufferGeometry[] = [];
    const textures: Texture[] = [];
    const instanced: InstancedMesh[] = [];
    const geo = <G extends BufferGeometry>(g: G): G => {
        geometries.push(g);
        return g;
    };
    const tex = <T extends Texture>(t: T): T => {
        textures.push(t);
        return t;
    };
    // Matte surfaces opt out of the scene's environment map: it is an
    // outdoor sky over turf, and its green ground would light the ceiling,
    // walls and anything facing down. A Lambert material with its own plain
    // cube map gets no image-based light, and reflectivity 0 keeps the cube
    // out of the color, so these are lit by the room's lights alone.
    const blank = document.createElement("canvas");
    blank.width = blank.height = 1;
    const noEnvironment = tex(new CubeTexture(Array(6).fill(blank)));
    noEnvironment.needsUpdate = true;
    const matte: MeshLambertMaterial[] = [];
    const lambert = (
        color: number,
        p: MeshLambertMaterialParameters = {},
    ): MeshLambertMaterial => {
        const m = new MeshLambertMaterial({
            color,
            envMap: noEnvironment,
            reflectivity: 0,
            ...p,
        });
        matte.push(m);
        return m;
    };
    const root = new Group();
    root.name = "gym";

    // Batches: painted and wooden parts, low steel, rails, and the roof
    // structure (hidden when the camera is above the ceiling).
    const paint = new InstanceBatch();
    const metal = new InstanceBatch();
    const rails = new InstanceBatch();
    const roofSteel = new InstanceBatch();
    const roofPipes = new InstanceBatch();
    const exitQuads: Quad[] = [];

    // Room shell, seen from inside: painted block walls and a roof deck.
    const wallTex = tex(blockWallTexture(pal, RH));
    wallTex.repeat.set(roomW / BLOCK_TILE_WIDTH, 1);
    const endTex = tex(wallTex.clone());
    endTex.repeat.set(roomD / BLOCK_TILE_WIDTH, 1);
    const deck = tex(deckTexture());
    deck.repeat.set(1, roomD / 0.9);
    const endMat = lambert(0xffffff, { map: endTex, side: BackSide });
    const wallMat = lambert(0xffffff, { map: wallTex, side: BackSide });
    // The deck glows a little with the high-bays' bounce off the floor.
    const deckMat = lambert(0xffffff, {
        map: deck,
        emissiveMap: deck,
        emissive: 0xffffff,
        side: BackSide,
    });
    const roomGeo = geo(new BoxGeometry(roomW, RH, roomD));
    const shell = new Mesh(roomGeo, [
        endMat,
        endMat,
        deckMat,
        std(0x1a1a1a, { side: BackSide }),
        wallMat,
        wallMat,
    ]);
    shell.name = "gym-room";
    shell.position.set(cx, RH / 2 - 0.1, roomCz);
    shell.receiveShadow = true;
    root.add(shell);

    // Maple floor: clear-coated boards, stained border, court and tape.
    const floorGeo = geo(new PlaneGeometry(roomW, roomD));
    const floor = new Mesh(
        floorGeo,
        std(0xffffff, {
            map: tex(
                floorTexture({
                    ...room,
                    footprint: fp,
                    palette: pal,
                    wordmark,
                }),
            ),
            roughness: 0.32,
        }),
    );
    floor.name = "gym-floor";
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0, roomCz);
    floor.receiveShadow = true;
    root.add(floor);

    // Roof: steel trusses spanning x in the school color, joists, two spiral
    // ducts and rows of high-bay lights between the trusses.
    const yB = RH - TRUSS_BOTTOM_BELOW_CEILING;
    const yT = RH - TRUSS_TOP_BELOW_CEILING;
    const trussCount = Math.max(3, Math.round(roomD / 6.5));
    const trussZ = (k: number) => room.minZ + ((k + 0.5) * roomD) / trussCount;
    const panelsX = Math.max(2, Math.round(roomW / 2.2));
    const steel = pal.deep;
    for (let k = 0; k < trussCount; k++) {
        const z = trussZ(k);
        for (const y of [yB, yT]) {
            roofSteel.beam(
                [room.minX, y, z],
                [room.maxX, y, z],
                0.22,
                0.2,
                steel,
            );
        }
        for (let i = 0; i <= panelsX; i++) {
            const x = room.minX + (i * roomW) / panelsX;
            roofSteel.beam([x, yB, z], [x, yT, z], 0.09, 0.09, steel);
            if (i === panelsX) continue;
            const x1 = room.minX + ((i + 1) * roomW) / panelsX;
            const up = i % 2 === 0;
            roofSteel.beam(
                [x, up ? yB : yT, z],
                [x1, up ? yT : yB, z],
                0.08,
                0.08,
                steel,
            );
        }
    }
    const joists = Math.max(4, Math.round(roomW / 2.4));
    for (let i = 0; i < joists; i++) {
        const x = room.minX + ((i + 0.5) * roomW) / joists;
        roofSteel.beam(
            [x, RH - 0.32, room.minZ],
            [x, RH - 0.32, room.maxZ],
            0.07,
            0.22,
            "#3a3c40",
        );
    }
    const ductY = (yB + yT) / 2;
    for (const side of [-1, 1]) {
        const x = cx + side * roomW * 0.24;
        roofPipes.pipe(
            [x, ductY, room.minZ],
            [x, ductY, room.maxZ],
            0.86,
            "#a9aeb3",
        );
        for (let z = room.minZ + 1.5; z < room.maxZ; z += 1.5) {
            roofPipes.pipe([x, ductY, z], [x, ductY, z + 0.05], 0.9, "#8c9196");
        }
    }

    const lightRowsX = Math.max(2, Math.round(roomW / 6.5));
    const lampY = yB - 0.55;
    const lamps: Vector3Tuple[] = [];
    for (let i = 0; i < lightRowsX; i++) {
        for (let k = 1; k < trussCount; k++) {
            lamps.push([
                room.minX + ((i + 0.5) * roomW) / lightRowsX,
                lampY,
                room.minZ + (k * roomD) / trussCount,
            ]);
        }
    }
    const housingGeo = geo(new CylinderGeometry(0.15, 0.38, 0.42, 16));
    const housing = new InstancedMesh(
        housingGeo,
        lambert(0xb9bcc0),
        lamps.length,
    );
    housing.name = "gym-lamp-housings";
    const lensGeo = geo(new CircleGeometry(0.34, 20).rotateX(Math.PI / 2));
    const panelMat = std(0x222222, {
        emissive: 0xfff6e6,
        emissiveIntensity: lightingValues("house").kit.panelEmissive,
    });
    const panels = new InstancedMesh(lensGeo, panelMat, lamps.length);
    panels.name = "gym-panels";
    lamps.forEach(([x, y, z], i) => {
        place(housing, i, [x, y + 0.21, z], [1, 1, 1]);
        place(panels, i, [x, y - 0.005, z], [1, 1, 1]);
        roofPipes.pipe([x, y + 0.4, z], [x, yB, z], 0.04, "#2a2c30");
    });
    instanced.push(housing, panels);

    // Bleachers: front side only, rising toward +z. Wooden decks and benches
    // over dark risers, aisle steps where the crowd leaves its aisles, rails.
    const bleacherLength = Math.min(roomW - 1, w + 9);
    const bx0 = cx - bleacherLength / 2;
    const bx1 = cx + bleacherLength / 2;
    const bz0 = fp.maxZ + GYM_BLEACHER_GAP;
    const T = GYM_BLEACHER_TREAD;
    const treadTop = (i: number) => GYM_BLEACHER_BASE + i * GYM_BLEACHER_RISE;
    const rowStart = (i: number) => bz0 + i * T;
    const rowZ = (i: number) => rowStart(i) + T / 2;
    const rowsMesh = new InstancedMesh(
        unitBox,
        std(0x2e2a27, { roughness: 0.9 }),
        GYM_BLEACHER_ROWS,
    );
    rowsMesh.name = "gym-bleachers";
    instanced.push(rowsMesh);

    const seatX0 = bx0 + 0.5;
    const aisleXs = gymAisles(seatX0, bx1 - 2);
    const sections: [number, number][] = [];
    let sectionStart = bx0 + 0.08;
    for (const ax of aisleXs) {
        sections.push([sectionStart, ax - 0.55]);
        sectionStart = ax + 0.55;
    }
    sections.push([sectionStart, bx1 - 0.08]);

    const woodTones = ["#c99a5c", "#d1a467", "#bf8f53", "#c7995f"];
    const wood = (i: number) => woodTones[i % woodTones.length];
    const riserWood = "#4a3f35";
    const seatRows: SeatRow[] = [];
    for (let i = 0; i < GYM_BLEACHER_ROWS; i++) {
        const h = treadTop(i);
        place(rowsMesh, i, [cx, h / 2, rowZ(i)], [bleacherLength, h, T]);
        // Three deck boards per row.
        const board = (T - 0.04) / 3;
        for (let b = 0; b < 3; b++) {
            paint.add(
                [cx, h + 0.012, rowStart(i) + 0.02 + board * (b + 0.5)],
                [bleacherLength - 0.02, 0.024, board - 0.012],
                wood(i * 3 + b),
            );
        }
        // Benches per section, on steel brackets.
        const benchZ = rowStart(i) + 0.23;
        sections.forEach(([a, b], s) => {
            paint.add(
                [(a + b) / 2, h + 0.41, benchZ],
                [b - a, 0.05, 0.3],
                wood(i + s * 2 + 1),
            );
            const n = Math.max(2, Math.round((b - a) / 1.8) + 1);
            for (let k = 0; k < n; k++) {
                const x = a + 0.15 + ((b - a - 0.3) * k) / (n - 1);
                metal.add([x, h + 0.2, benchZ], [0.05, 0.38, 0.05], "#5c5f66");
            }
        });
        // A wooden kick plate on each riser face.
        paint.add(
            [cx, h - GYM_BLEACHER_RISE / 2 + 0.01, rowStart(i) - 0.006],
            [bleacherLength - 0.02, GYM_BLEACHER_RISE - 0.06, 0.012],
            riserWood,
        );
        const z = rowStart(i) + T * 0.42;
        seatRows.push({
            points: [
                [seatX0, h, z],
                [bx1 - 0.5, h, z],
            ],
            closed: false,
            depth: T,
            side: "home",
        });
    }
    // Aisle steps with yellow nosings.
    const nosing = "#e5b800";
    for (const ax of aisleXs) {
        paint.add([ax, 0.11, bz0 - 0.18], [1.0, 0.22, 0.36], riserWood);
        paint.add([ax, 0.225, bz0 - 0.34], [1.0, 0.012, 0.05], nosing);
        for (let i = 0; i < GYM_BLEACHER_ROWS; i++) {
            const h = treadTop(i);
            paint.add(
                [ax, h + 0.026, rowStart(i) + 0.03],
                [1.0, 0.004, 0.05],
                nosing,
            );
            if (i === GYM_BLEACHER_ROWS - 1) continue;
            paint.add(
                [ax, h + 0.0875, rowStart(i) + T * 0.75],
                [1.0, 0.175, T * 0.5],
                riserWood,
            );
            paint.add(
                [ax, h + 0.18, rowStart(i) + T * 0.5 + 0.03],
                [1.0, 0.012, 0.05],
                nosing,
            );
        }
    }
    // End rails sloping with the rows, and a guard rail along the top row.
    const railColor = "#c9ccd2";
    const lastRow = GYM_BLEACHER_ROWS - 1;
    const railRun = T * GYM_BLEACHER_ROWS - 0.2;
    for (const xe of [bx0 + 0.05, bx1 - 0.05]) {
        for (const hgt of [1.0, 0.55]) {
            rails.pipe(
                [xe, treadTop(0) + hgt, rowStart(0) + 0.1],
                [xe, treadTop(lastRow) + hgt, rowStart(0) + 0.1 + railRun],
                0.045,
                railColor,
            );
        }
        for (let p = 0; p <= 3; p++) {
            const t = p / 3;
            const z = rowStart(0) + 0.1 + t * railRun;
            const y0 = treadTop(Math.round(t * lastRow));
            const y1 =
                treadTop(0) + 1.0 + t * (treadTop(lastRow) - treadTop(0));
            rails.pipe([xe, y0, z], [xe, y1, z], 0.05, railColor);
        }
    }
    const backZ = rowStart(lastRow) + T - 0.06;
    const topRowY = treadTop(lastRow);
    for (const hgt of [1.05, 0.55]) {
        rails.pipe(
            [bx0, topRowY + hgt, backZ],
            [bx1, topRowY + hgt, backZ],
            0.045,
            railColor,
        );
    }
    for (let x = bx0 + 0.05; x <= bx1; x += 2.4) {
        rails.pipe(
            [x, topRowY, backZ],
            [x, topRowY + 1.05, backZ],
            0.05,
            railColor,
        );
    }

    // Back wall: folded bleachers, a scoreboard and championship banners.
    const back = wallFrame(cx, room.minZ, 0);
    const foldedW = Math.min(roomW - 4, w + 6);
    const foldedH = GYM_BLEACHER_ROWS * GYM_BLEACHER_RISE;
    const folded = new Mesh(unitBox, std(0x2a2623, { roughness: 0.9 }));
    folded.name = "gym-folded-bleachers";
    folded.scale.set(foldedW, foldedH, 1.1);
    folded.position.set(cx, foldedH / 2, room.minZ + 0.6);
    folded.castShadow = hi;
    root.add(folded);
    for (let i = 0; i < GYM_BLEACHER_ROWS; i++) {
        const y = 0.05 + i * GYM_BLEACHER_RISE;
        const zf = room.minZ + 1.17;
        paint.add([cx, y + 0.3, zf], [foldedW - 0.3, 0.07, 0.04], wood(i));
        paint.add(
            [cx, y + 0.14, zf - 0.005],
            [foldedW - 0.3, 0.2, 0.03],
            "#7a5f45",
        );
        paint.add([cx, y + 0.02, zf], [foldedW - 0.3, 0.04, 0.04], wood(i + 2));
    }
    for (const side of [-1, 1]) {
        metal.add(
            [cx + side * (foldedW / 2 - 0.05), foldedH / 2, room.minZ + 0.62],
            [0.1, foldedH + 0.06, 1.16],
            "#3b3d42",
        );
    }

    const boardW = 5.4;
    const boardH = boardW * (280 / 640);
    const boardY = 7.0;
    paint.add(
        back.at(0, boardY, 0.2),
        [boardW + 0.3, boardH + 0.3, 0.36],
        "#141518",
        back.q,
    );
    const scoreTex = tex(scoreboardTexture(wordmark || "HOME", pal));
    const scoreMat = std(0xffffff, {
        map: scoreTex,
        emissiveMap: scoreTex,
        emissive: 0xffffff,
        emissiveIntensity: SCOREBOARD_GLOW.house,
        roughness: 0.6,
    });
    const scoreboard = new Mesh(
        geo(
            quadsGeometry([
                {
                    center: back.at(0, boardY, 0.385),
                    right: [boardW / 2, 0, 0],
                    up: [0, boardH / 2, 0],
                },
            ]),
        ),
        scoreMat,
    );
    scoreboard.name = "gym-scoreboard";
    root.add(scoreboard);

    const bannerW = 2.0;
    const bannerH = bannerW * (BANNER_CELL.height / BANNER_CELL.width);
    const bannerStep = 2.55;
    const perSide = Math.max(
        1,
        Math.min(
            BANNERS.length / 2,
            Math.floor((foldedW / 2 - boardW / 2 - 0.6) / bannerStep),
        ),
    );
    const bannerRows = Math.ceil(BANNERS.length / BANNER_COLS);
    const bannerQuads: Quad[] = [];
    for (let k = 0, bi = 0; k < perSide; k++) {
        for (const side of [-1, 1]) {
            const u = side * (boardW / 2 + 0.6 + bannerStep * (k + 0.5));
            const col = bi % BANNER_COLS;
            const v1 = 1 - Math.floor(bi / BANNER_COLS) / bannerRows;
            bannerQuads.push({
                center: back.at(u, boardY - 0.1, 0.06),
                right: [bannerW / 2, 0, 0],
                up: [0, bannerH / 2, 0],
                uv: [
                    col / BANNER_COLS,
                    v1 - 1 / bannerRows,
                    (col + 1) / BANNER_COLS,
                    v1,
                ],
            });
            metal.add(
                back.at(u, boardY - 0.1 + bannerH / 2 + 0.03, 0.08),
                [bannerW + 0.2, 0.04, 0.04],
                "#b8bbc0",
            );
            bi++;
        }
    }
    const banners = new Mesh(
        geo(quadsGeometry(bannerQuads)),
        lambert(0xffffff, {
            map: tex(bannerAtlas(BANNERS, pal, BANNER_COLS)),
            alphaTest: 0.5,
        }),
    );
    banners.name = "gym-banners";
    root.add(banners);

    // Double doors with exit signs.
    const door = (f: WallFrame, u: number) => {
        for (const s of [-1, 1]) {
            const leaf = u + s * 0.475;
            paint.add(
                f.at(leaf, 1.08, 0.035),
                [0.93, 2.14, 0.05],
                pal.deep,
                f.q,
            );
            paint.add(
                f.at(leaf, 1.55, 0.065),
                [0.2, 0.55, 0.01],
                "#1b222b",
                f.q,
            );
            metal.add(
                f.at(leaf, 1.0, 0.09),
                [0.78, 0.05, 0.05],
                railColor,
                f.q,
            );
            metal.add(
                f.at(u + s, 1.12, 0.05),
                [0.1, 2.24, 0.1],
                "#3b3d42",
                f.q,
            );
        }
        metal.add(f.at(u, 2.22, 0.05), [2.1, 0.1, 0.1], "#3b3d42", f.q);
        paint.add(f.at(u, 2.62, 0.05), [0.44, 0.2, 0.1], "#e6e4de", f.q);
        exitQuads.push({
            center: f.at(u, 2.62, 0.101),
            right: [f.right.x * 0.19, 0, f.right.z * 0.19],
            up: [0, 0.083, 0],
        });
    };
    // Padded wall mats between `u0` and `u1`.
    const pads = (f: WallFrame, u0: number, u1: number) => {
        const n = Math.floor((u1 - u0) / 1.22);
        const start = (u0 + u1) / 2 - (n * 1.22) / 2;
        for (let i = 0; i < n; i++) {
            paint.add(
                f.at(start + (i + 0.5) * 1.22, 1.17, 0.045),
                [1.19, 1.9, 0.09],
                i % 2 ? pal.deep : pal.darker,
                f.q,
            );
        }
    };

    const front = wallFrame(cx, room.maxZ, Math.PI);
    const left = wallFrame(room.minX, cz, Math.PI / 2);
    const right = wallFrame(room.maxX, cz, -Math.PI / 2);
    // Front wall: a door each side of the bleachers.
    const frontDoorU = bleacherLength / 2 + 2.0;
    if (frontDoorU + 1.3 < roomW / 2) {
        door(front, frontDoorU);
        door(front, -frontDoorU);
    }
    // Back wall: doors in the corners beside the folded bleachers.
    if (roomW / 2 - foldedW / 2 > 2.6) {
        const u = foldedW / 2 + (roomW - foldedW) / 4;
        door(back, -u);
        door(back, u);
    }
    // End walls: a door near the front; the left wall gets pads, the right
    // wall a stage with pads either side. `u` on the left wall runs toward
    // the back, on the right wall toward the front.
    const sideDoorZ = Math.min(room.maxZ - 2, bz0 + 2);
    door(left, cz - sideDoorZ);
    door(right, sideDoorZ - cz);
    pads(left, cz - (sideDoorZ - 1.6), cz - (room.minZ + 1.8));
    const stageW = Math.min(14, roomD * 0.42);
    const stageDepth = 2.6;
    const stageH = 1.05;
    pads(right, room.minZ + 1.8 - cz, -stageW / 2 - 1.3);
    pads(right, stageW / 2 + 1.3, sideDoorZ - cz - 1.6);

    // Stage on the right wall: apron, proscenium, curtain and valance.
    paint.add(
        right.at(0, stageH / 2, stageDepth / 2),
        [stageW, stageH, stageDepth],
        pal.darker,
        right.q,
    );
    paint.add(
        right.at(0, stageH + 0.02, stageDepth / 2),
        [stageW, 0.04, stageDepth],
        "#b98a52",
        right.q,
    );
    paint.add(
        right.at(0, stageH - 0.06, stageDepth + 0.005),
        [stageW, 0.08, 0.02],
        pal.accent,
        right.q,
    );
    for (const s of [-1, 1]) {
        const u = s * (stageW / 2 + 0.45);
        paint.add(right.at(u, 3.9, 0.3), [0.9, 7.8, 0.6], pal.wall, right.q);
        paint.add(right.at(u, 0.8, 0.31), [0.92, 1.6, 0.6], pal.deep, right.q);
    }
    paint.add(
        right.at(0, 7.3, 0.3),
        [stageW + 1.8, 1.0, 0.6],
        pal.wall,
        right.q,
    );
    paint.add(
        right.at(0, 6.82, 0.61),
        [stageW + 0.2, 0.06, 0.02],
        pal.accent,
        right.q,
    );
    for (let k = 0; k < 3; k++) {
        const hk = (stageH * (k + 1)) / 4;
        paint.add(
            right.at(
                stageW / 2 - 0.9,
                hk / 2,
                stageDepth + 0.3 * (3 - k) - 0.15,
            ),
            [1.4, hk, 0.3],
            riserWood,
            right.q,
        );
    }
    const curtainTop = 6.8;
    const curtainU = stageW / CURTAIN_TILE_WIDTH;
    const curtain = new Mesh(
        geo(
            quadsGeometry([
                {
                    center: right.at(0, (stageH + curtainTop) / 2, 0.4),
                    right: [0, 0, stageW / 2],
                    up: [0, (curtainTop - stageH) / 2, 0],
                    uv: [0, 0, curtainU, 1],
                },
                {
                    center: right.at(0, curtainTop - 0.45, 0.5),
                    right: [0, 0, stageW / 2 + 0.05],
                    up: [0, 0.45, 0],
                    uv: [0, 0.6, curtainU * 1.6, 1],
                },
            ]),
        ),
        lambert(0xffffff, { map: tex(curtainTexture(pal)) }),
    );
    curtain.name = "gym-stage-curtain";
    root.add(curtain);

    // Folded-up basketball goals over the court ends.
    const backboards = new InstancedMesh(
        geo(new PlaneGeometry(1.83, 1.07)),
        lambert(0xffffff, { map: tex(backboardTexture()), side: DoubleSide }),
        2,
    );
    backboards.name = "gym-backboards";
    const rims = new InstancedMesh(
        geo(new TorusGeometry(0.23, 0.014, 6, 20).rotateX(Math.PI / 2)),
        std(0xe0552a, { metalness: 0.4, roughness: 0.5 }),
        2,
    );
    rims.name = "gym-rims";
    instanced.push(backboards, rims);
    const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1.2);
    [-1, 1].forEach((s, i) => {
        const hx = Math.min(
            room.maxX - 2.5,
            Math.max(room.minX + 2.5, cx + s * (COURT_LENGTH / 2 - 1.22)),
        );
        const q = yaw(-s * (Math.PI / 2)).multiply(tilt);
        const c = new Vector3(hx, yB - 0.9, cz);
        m4.compose(c, q, scl.set(1, 1, 1));
        backboards.setMatrixAt(i, m4);
        const rim = new Vector3(0, -0.36, 0.3).applyQuaternion(q).add(c);
        m4.compose(rim, q, scl.set(1, 1, 1));
        rims.setMatrixAt(i, m4);
        const frame = new Vector3(0, 0, -0.06).applyQuaternion(q).add(c);
        roofSteel.add(
            [frame.x, frame.y, frame.z],
            [1.95, 1.17, 0.06],
            "#2a2c30",
            q,
        );
        for (const dz of [-0.6, 0.6]) {
            roofPipes.pipe(
                [hx, c.y, cz + dz],
                [hx, yB, cz + dz],
                0.09,
                "#2a2c30",
            );
        }
        roofPipes.pipe(
            [hx - s * 0.3, c.y + 0.3, cz],
            [hx - s * 2.2, yB, cz],
            0.09,
            "#2a2c30",
        );
    });

    // Wall mural above the bleachers.
    const muralW = Math.min(bleacherLength * 0.6, 17);
    const muralH = muralW / 4;
    const muralY = Math.max(topRowY + 1.6 + muralH / 2, 6.3);
    const mural = new Mesh(
        geo(
            quadsGeometry([
                {
                    center: front.at(0, muralY, 0.03),
                    right: [-muralW / 2, 0, 0],
                    up: [0, muralH / 2, 0],
                },
            ]),
        ),
        lambert(0xffffff, {
            map: tex(muralTexture(wordmark || "HOME", pal)),
            transparent: true,
            polygonOffset: true,
            polygonOffsetFactor: -1,
        }),
    );
    mural.name = "gym-mural";
    root.add(mural);

    // Scorer's table near the front edge and PA speakers on stands.
    const tableX = cx + Math.min(w * 0.3, 9);
    const tableZ = fp.maxZ + 1.95;
    paint.add([tableX, 0.75, tableZ], [2.4, 0.04, 0.75], "#d9d6cf");
    paint.add([tableX, 0.42, tableZ - 0.36], [2.4, 0.62, 0.02], pal.deep);
    paint.add([tableX, 0.66, tableZ - 0.35], [2.4, 0.05, 0.03], pal.accent);
    for (let k = -1; k <= 1; k++) {
        const x = tableX + k * 0.75;
        metal.add([x, 0.45, tableZ + 0.6], [0.42, 0.04, 0.4], "#2b2d31");
        metal.add([x, 0.75, tableZ + 0.8], [0.42, 0.34, 0.03], "#2b2d31");
        metal.add([x, 0.22, tableZ + 0.6], [0.36, 0.44, 0.02], "#55585e");
    }
    for (const side of [-1, 1]) {
        const x = side > 0 ? fp.maxX + 2.3 : fp.minX - 2.3;
        const z = fp.maxZ + 0.6;
        const toward = yaw(Math.atan2(cx - x, cz - z));
        paint.add([x, 2.1, z], [0.42, 0.7, 0.36], "#18191b", toward);
        rails.pipe([x, 0, z], [x, 1.75, z], 0.05, "#2b2d31");
        for (let k = 0; k < 3; k++) {
            const a = (k / 3) * Math.PI * 2;
            rails.pipe(
                [x + Math.cos(a) * 0.6, 0, z + Math.sin(a) * 0.6],
                [x, 0.8, z],
                0.03,
                "#2b2d31",
            );
        }
    }

    // Lights: four show spots hung from the trusses, each with a visible can
    // and a faint beam, and one overhead directional for house light.
    const spotX = Math.max(6, w * 0.44);
    const nearestTruss = (z: number) => {
        let best = trussZ(0);
        for (let k = 1; k < trussCount; k++) {
            if (Math.abs(trussZ(k) - z) < Math.abs(best - z)) best = trussZ(k);
        }
        return best;
    };
    const spotZs = [nearestTruss(fp.maxZ + 7.6), nearestTruss(fp.minZ - 7.6)];
    const showSpots: SpotLight[] = [];
    const spotLensQuads: Quad[] = [];
    const beams: { at: Vector3; to: Vector3; r: number }[] = [];
    for (const side of [-1, 1]) {
        for (const sz of spotZs) {
            const at = new Vector3(cx + side * spotX, yB - 0.45, sz);
            const to = new Vector3(cx + side * spotX * 0.3, 0, cz);
            const dist = to.distanceTo(at);
            const angle = Math.min(
                0.6,
                Math.max(0.3, Math.atan((0.32 * Math.max(w, d)) / dist)),
            );
            const sp = new SpotLight(0xf3eaff, 0, 0, angle, 0.7, 0);
            sp.position.copy(at);
            sp.target.position.copy(to);
            root.add(sp, sp.target);
            showSpots.push(sp);
            const dir = to.clone().sub(at).normalize();
            const tail = at.clone().addScaledVector(dir, -0.5);
            roofPipes.pipe(tail.toArray(), at.toArray(), 0.34, "#17181a");
            roofPipes.pipe(at.toArray(), [at.x, yB, at.z], 0.05, "#17181a");
            const qd = aimY([0, 0, 0], dir.clone().negate().toArray());
            const r = new Vector3(0.15, 0, 0).applyQuaternion(qd);
            const u = new Vector3(0, 0, 0.15).applyQuaternion(qd);
            spotLensQuads.push({
                center: at.clone().addScaledVector(dir, 0.005).toArray(),
                right: r.toArray(),
                up: u.toArray(),
            });
            beams.push({ at, to, r: Math.tan(angle * 0.85) * dist });
        }
    }
    const spotLensMat = std(0x111111, {
        emissive: 0xfff3e0,
        emissiveIntensity: 0,
        side: DoubleSide,
    });
    const spotLenses = new Mesh(geo(quadsGeometry(spotLensQuads)), spotLensMat);
    spotLenses.name = "gym-spot-lenses";

    const beamMat = new MeshBasicMaterial({
        color: 0xfff1dc,
        alphaMap: tex(beamTexture()),
        transparent: true,
        opacity: BEAM_OPACITY,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
    });
    const beamMesh = new InstancedMesh(
        geo(new ConeGeometry(1, 1, 32, 1, true).translate(0, -0.5, 0)),
        beamMat,
        beams.length,
    );
    beamMesh.name = "gym-spot-beams";
    beamMesh.renderOrder = 10;
    beams.forEach(({ at, to, r }, i) => {
        const q = aimY(to.toArray(), at.toArray());
        m4.compose(at, q, scl.set(r, to.distanceTo(at), r));
        beamMesh.setMatrixAt(i, m4);
    });
    beamMesh.visible = false;
    instanced.push(beamMesh);

    const overhead = new DirectionalLight(0xfff4e6, 1);
    overhead.position.set(cx + 9, 61, cz + 6);
    overhead.target.position.set(cx, 0, cz);
    overhead.castShadow = hi;
    overhead.shadow.mapSize.set(2048, 2048);
    const half = Math.max(w, d) * 0.6 + 6;
    Object.assign(overhead.shadow.camera, {
        left: -half,
        right: half,
        top: half,
        bottom: -half,
        near: 15,
        far: 125,
    });
    overhead.shadow.camera.updateProjectionMatrix();
    root.add(overhead, overhead.target);

    // Build the batches.
    const exitTex = tex(exitTexture());
    const exitSigns = new Mesh(
        geo(quadsGeometry(exitQuads)),
        std(0x111111, {
            map: exitTex,
            emissiveMap: exitTex,
            emissive: 0xffffff,
            emissiveIntensity: EXIT_GLOW,
        }),
    );
    exitSigns.name = "gym-exit-signs";
    const pipeGeo = geo(new CylinderGeometry(0.5, 0.5, 1, 12));
    const paintMesh = paint.build("gym-paint", unitBox, lambert(0xffffff));
    const metalMesh = metal.build(
        "gym-metal",
        unitBox,
        std(0xffffff, { metalness: 0.5, roughness: 0.45 }),
    );
    const railMesh = rails.build(
        "gym-rails",
        pipeGeo,
        std(0xffffff, { metalness: 0.7, roughness: 0.3 }),
    );
    const roofSteelMesh = roofSteel.build(
        "gym-roof-steel",
        unitBox,
        lambert(0xffffff),
    );
    const roofPipeMesh = roofPipes.build(
        "gym-roof-pipes",
        pipeGeo,
        lambert(0xffffff),
    );
    const isMesh = (m: InstancedMesh | null): m is InstancedMesh => m !== null;
    const low = [paintMesh, metalMesh, railMesh].filter(isMesh);
    const roof = [roofSteelMesh, roofPipeMesh].filter(isMesh);
    instanced.push(...low, ...roof);
    if (paintMesh) paintMesh.castShadow = paintMesh.receiveShadow = hi;
    rowsMesh.castShadow = rowsMesh.receiveShadow = hi;
    root.add(
        rowsMesh,
        housing,
        panels,
        backboards,
        rims,
        spotLenses,
        beamMesh,
        exitSigns,
        ...low,
        ...roof,
    );
    const ceilingParts: Object3D[] = [
        panels,
        housing,
        backboards,
        rims,
        spotLenses,
        ...roof,
    ];

    const rowEye = (i: number, dx = 0): Vector3Tuple => [
        cx + dx,
        treadTop(i) + EYE_ABOVE_TREAD,
        rowZ(i),
    ];
    // High enough to frame the whole room at a 50 degree field of view, 16:9.
    const topDownY =
        Math.max(
            (d + 2 * frontPad) / (2 * Math.tan(Math.PI / 7.2)),
            roomW / (2 * Math.tan(Math.PI / 7.2) * 1.6),
            30,
        ) * 1.02;
    const cameras: CameraSeat[] = [
        {
            id: "geJudge",
            labelKey: "view3d.camera.geJudge",
            kind: "seat",
            position: rowEye(9),
            target: [cx, 0, cz - 0.6],
        },
        {
            id: "frontRow",
            labelKey: "view3d.camera.frontRow",
            kind: "seat",
            position: rowEye(0, -Math.min(4.3, bleacherLength * 0.2)),
            target: [cx - 1.8, 1.2, cz],
        },
        {
            id: "corner",
            labelKey: "view3d.camera.corner",
            kind: "aerial",
            position: [room.minX + 1.8, 7.3, fp.maxZ + 6],
            target: [cx, 0, cz],
        },
        {
            id: "floor",
            labelKey: "view3d.camera.floor",
            kind: "floor",
            position: [cx, 1.68, fp.minZ - 1],
            target: [cx, 1.83, fp.maxZ + 6.1],
        },
        {
            id: "topDown",
            labelKey: "view3d.camera.topDown",
            kind: "topDown",
            position: [cx, topDownY, cz + 0.06],
            target: [cx, 0, cz],
        },
    ];

    const lightingPresets: LightingPreset[] = ["house", "show"];
    const setLighting = (preset: LightingPreset): void => {
        if (!lightingPresets.includes(preset)) return;
        const k = lightingValues(preset).kit;
        const show = k.showSpotIntensity > 0;
        panelMat.emissiveIntensity = k.panelEmissive;
        deckMat.emissiveIntensity = k.panelEmissive * DECK_BOUNCE;
        setLightIntensity(overhead, k.overheadIntensity);
        showSpots.forEach((s) => setLightIntensity(s, k.showSpotIntensity));
        spotLensMat.emissiveIntensity = show ? SPOT_LENS_GLOW : 0;
        beamMesh.visible = show;
        scoreMat.emissiveIntensity = show
            ? SCOREBOARD_GLOW.show
            : SCOREBOARD_GLOW.house;
    };
    setLighting("house");

    const pickTargets: Object3D[] = [rowsMesh];
    let aboveCeiling = false;
    return {
        root,
        focus: [cx, 0, cz],
        cameras,
        seatRows,
        pickTargets,
        crowdDensity: 0.75,
        lightingPresets,
        defaultLighting: "house",
        setLighting,
        onFrame({ cameraPosition }: FrameContext) {
            const above = cameraPosition[1] >= RH - 0.5;
            if (above === aboveCeiling) return;
            aboveCeiling = above;
            ceilingParts.forEach((o) => (o.visible = !above));
        },
        dispose() {
            geometries.forEach((g) => g.dispose());
            instanced.forEach((m) => m.dispose());
            textures.forEach((t) => t.dispose());
            beamMat.dispose();
            matte.forEach((m) => m.dispose());
            overhead.shadow.map?.dispose();
            shared.dispose();
            root.clear();
        },
    };
};
