// cspell:ignore metalness
import {
    BoxGeometry,
    Color,
    DoubleSide,
    Group,
    InstancedMesh,
    Matrix4,
    Mesh,
    MeshStandardMaterial,
    PlaneGeometry,
    Quaternion,
    RepeatWrapping,
    SpotLight,
    Vector3,
    type BufferGeometry,
    type CanvasTexture,
    type Material,
    type Vector3Tuple,
} from "three";
import {
    createSharedMaterials,
    ft,
    lightingValues,
    setLightIntensity,
    videoBoard,
} from "../environment";
import type {
    CameraSeat,
    FieldFootprint,
    KitBuilder,
    LightingPreset,
    SeatRow,
} from "../types";
import { horseshoe, type Horseshoe } from "./college/horseshoe";
import { MeshBuilder, type P3 } from "./college/meshBuilder";
import {
    buildTier,
    FACADE_TILE,
    tierSections,
    WALL_TILE,
    type BuiltTier,
    type CollegeTier,
    type SeatingBuckets,
    type TierStyle,
} from "./college/seating";
import {
    brickTexture,
    collegeRibbonTexture,
    concreteTexture,
    crownTexture,
    facadeTexture,
    lampBankTexture,
    rgbOf,
    scoreboardTexture,
    seatTexture,
    suiteGlassTexture,
    wallTexture,
} from "./college/textures";
import {
    blimpCamera,
    cameraSeat,
    frameOf,
    GROUND_SIZE,
    GROUND_Y,
    OUTDOOR_PRESETS,
    topDownCamera,
    type Frame,
} from "./stands";

/**
 * College stadium kit (design.md section 6): a horseshoe. One continuous
 * lower bowl wraps both sidelines and the side-2 end behind a padded,
 * team-colored field wall; the side-1 end is open, with the video board,
 * scoreboard and a plaza. The home (front) side stacks two stories of suites
 * with a projecting press box, an upper deck and a roof canopy carrying the
 * light banks; the visitor side has club glass, an upper deck with an LED
 * ribbon fascia and a light truss on its rim. The home band sits in a block
 * in the side-2 back corner. Default night.
 */

/** Sideline to the field wall, and end line to the wall. */
export const COLLEGE_SIDE_MARGIN = ft(45);
export const COLLEGE_END_MARGIN = ft(30);
export const COLLEGE_CORNER_RADIUS = 24;

/** Lower bowl: 40 rows behind a 2.4 m wall. */
export const COLLEGE_LOWER = {
    rows: 40,
    depth: ft(2.75),
    rise: ft(1.15),
    base: ft(8),
};
/** Home upper deck, overhanging the last rows of the lower bowl. */
export const COLLEGE_HOME_UPPER = {
    offset: 28.5,
    bottom: 27.5,
    base: 29,
    rows: 28,
    depth: 0.9,
    rise: 0.52,
};
/** Visitor upper deck, lower and shallower. */
export const COLLEGE_AWAY_UPPER = {
    offset: 31,
    bottom: 21,
    base: 23,
    rows: 24,
    depth: 0.9,
    rise: 0.5,
};
/** Press box: projecting glass box at the back of the home lower bowl. */
export const COLLEGE_PRESS_BOX = {
    width: 44,
    bottom: 18,
    glassBottom: 19.4,
    glassTop: 25.6,
    roof: 26.2,
    /** How far the glass leans out over the bowl at the bottom and top. */
    reachBottom: 3.4,
    reachTop: 4.6,
};
/** Video board over the open side-1 end, `back` meters behind the wall. */
export const COLLEGE_BOARD = { w: 46, h: 19, y: 27, back: 24 };
/** Rows of the band block (in the side-2 back corner). */
export const COLLEGE_BAND_ROWS: [number, number] = [1, 21];
const SEATED_EYE = 1.2;
const LAMP_SPOT = 1.6;

const PRESETS: LightingPreset[] = [...OUTDOOR_PRESETS];

/** The horseshoe and tier layout for a footprint; exported for tests. */
export function collegeLayout(footprint: FieldFootprint) {
    const f = frameOf(footprint);
    const halfX = f.halfW + COLLEGE_END_MARGIN;
    const halfZ = f.halfD + COLLEGE_SIDE_MARGIN;
    const hs = horseshoe({
        cx: f.cx,
        cz: f.cz,
        halfX,
        halfZ,
        radius: COLLEGE_CORNER_RADIUS,
        openX: f.cx - halfX,
    });
    const front = hs.segments[0];
    const back = hs.segments[4];
    const lower: CollegeTier = {
        id: "lower",
        from: 0,
        to: hs.length,
        offset: 0,
        ...COLLEGE_LOWER,
        bottom: 0,
        side: "home",
        front: "wall",
        vomitories: {
            row: 16,
            rows: 4,
            width: 3,
            every: 2,
            segments: ["front", "end", "back"],
        },
    };
    const homeUpper: CollegeTier = {
        id: "homeUpper",
        from: front.s0,
        to: front.s1,
        ...COLLEGE_HOME_UPPER,
        side: "home",
        front: "fascia",
        rim: 1.4,
    };
    const awayUpper: CollegeTier = {
        id: "awayUpper",
        from: back.s0,
        to: back.s1,
        ...COLLEGE_AWAY_UPPER,
        side: "neutral",
        front: "fascia",
        rim: 1.4,
    };
    return { f, hs, lower, homeUpper, awayUpper };
}

export const buildCollege: KitBuilder = ({ footprint, params, quality }) => {
    const shadows = quality === "high";
    const shared = createSharedMaterials();
    const root = new Group();
    root.name = "kit:college";
    const geometries: BufferGeometry[] = [];
    const materials: Material[] = [];
    const textures: CanvasTexture[] = [];
    const disposers: (() => void)[] = [];
    const { f, hs, lower, homeUpper, awayUpper } = collegeLayout(footprint);
    const { halfX, halfZ } = hs.spec;

    const tex = (t: CanvasTexture, repeat = true) => {
        if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
        textures.push(t);
        return t;
    };
    const mat = (m: MeshStandardMaterial) => {
        materials.push(m);
        return m;
    };
    const add = (
        geo: BufferGeometry | null,
        material: Material,
        name: string,
        cast = shadows,
    ): Mesh | null => {
        if (!geo) return null;
        geometries.push(geo);
        const m = new Mesh(geo, material);
        m.name = name;
        m.castShadow = cast;
        m.receiveShadow = true;
        root.add(m);
        return m;
    };

    const home = rgbOf(params.homeColor, "#6442ff");
    const homeColor = new Color().setRGB(
        home[0] / 255,
        home[1] / 255,
        home[2] / 255,
        "srgb",
    );

    // Materials. Everything built with MeshBuilder carries vertex colors.
    const side = { side: DoubleSide, vertexColors: true };
    const seatingMat = mat(
        new MeshStandardMaterial({
            map: tex(concreteTexture()),
            roughness: 0.95,
            ...side,
        }),
    );
    const seatMat = mat(
        new MeshStandardMaterial({
            map: tex(seatTexture()),
            roughness: 0.7,
            ...side,
        }),
    );
    const wallMat = mat(
        new MeshStandardMaterial({
            map: tex(wallTexture(params.endZoneText, params.homeColor)),
            roughness: 0.75,
            ...side,
        }),
    );
    const ribbonMat = mat(
        new MeshStandardMaterial({
            color: 0x000000,
            emissive: 0xffffff,
            emissiveMap: tex(
                collegeRibbonTexture(params.endZoneText, params.homeColor),
            ),
            emissiveIntensity: 1.15,
            ...side,
        }),
    );
    const structureMat = mat(
        new MeshStandardMaterial({
            map: tex(facadeTexture()),
            roughness: 0.9,
            ...side,
        }),
    );
    const brickMat = mat(
        new MeshStandardMaterial({
            map: tex(brickTexture()),
            roughness: 0.92,
            ...side,
        }),
    );
    const glassMap = tex(suiteGlassTexture());
    const glassMat = mat(
        new MeshStandardMaterial({
            color: 0x2a3340,
            map: glassMap,
            emissive: 0xffffff,
            emissiveMap: glassMap,
            emissiveIntensity: 0.2,
            roughness: 0.12,
            metalness: 0.6,
            ...side,
        }),
    );
    const metalMat = mat(
        new MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.5,
            metalness: 0.5,
            ...side,
        }),
    );
    const lampMat = mat(
        new MeshStandardMaterial({
            color: 0x202226,
            emissive: 0xffffff,
            emissiveMap: tex(lampBankTexture()),
            emissiveIntensity: 0,
            roughness: 0.6,
            ...side,
        }),
    );
    const signMat = mat(
        new MeshStandardMaterial({
            color: 0x000000,
            emissive: 0xffffff,
            emissiveMap: tex(crownTexture(params.endZoneText, params.homeColor)),
            emissiveIntensity: 1,
            ...side,
        }),
    );

    // Ground, the turf apron inside the wall and the plaza at the open end.
    const plane = (
        w: number,
        d: number,
        color: number,
        at: Vector3Tuple,
        name: string,
    ) => {
        const geo = new PlaneGeometry(w, d);
        const m = add(
            geo,
            mat(new MeshStandardMaterial({ color, roughness: 1 })),
            name,
            false,
        )!;
        m.rotation.x = -Math.PI / 2;
        m.position.set(...at);
        m.userData.ground = true;
        return m;
    };
    plane(GROUND_SIZE, GROUND_SIZE, 0x4b4d52, [f.cx, GROUND_Y, f.cz], "ground");
    plane(2 * halfX, 2 * halfZ, 0x2f6a2b, [f.cx, 0.004, f.cz], "apron");
    plane(
        70,
        2 * (halfZ + awayUpper.offset + 24),
        0x8f8d88,
        [f.cx - halfX - 35, GROUND_Y + 0.05, f.cz],
        "plaza",
    );

    // Seating.
    const buckets: SeatingBuckets = {
        seating: new MeshBuilder(),
        seatBacks: new MeshBuilder(),
        wall: new MeshBuilder(),
        fascia: new MeshBuilder(),
        structure: new MeshBuilder(),
        facade: new MeshBuilder(),
    };
    const seatTone = homeColor.clone().multiplyScalar(0.8);
    const style: TierStyle = {
        seatColor: () => seatTone,
        tread: new Color(0.62, 0.62, 0.6),
        aisle: new Color(0.86, 0.85, 0.82),
        portal: new Color(0.05, 0.05, 0.06),
    };
    const plan = planSections(hs, lower);
    const lowerOut = buildTier(hs, lower, buckets, {
        ...style,
        reserve: (s, row) =>
            plan.band.has(s.index) &&
            row >= COLLEGE_BAND_ROWS[0] &&
            row < COLLEGE_BAND_ROWS[1],
        side: (s): SeatRow["side"] => {
            if (plan.away.has(s.index)) return "away";
            return s.segment === "back" ? "neutral" : "home";
        },
    });
    const homeOut = buildTier(hs, homeUpper, buckets, style);
    const awayOut = buildTier(hs, awayUpper, buckets, style);
    const L = lowerOut.tier;
    const HU = homeOut.tier;
    const AU = awayOut.tier;

    const glass = new MeshBuilder();
    const lamps = new MeshBuilder();
    const metal = new MeshBuilder(new Color(0.36, 0.37, 0.4));
    const signs = new MeshBuilder();
    addConcourse(hs, L, HU, buckets.structure, glass, 2);
    addConcourse(hs, L, AU, buckets.structure, glass, 1);
    const press = addPressBox(
        hs,
        f,
        L,
        buckets.structure,
        glass,
        signs,
        metal,
    );
    const banks = [
        ...addCanopy(hs, f, HU, buckets.structure, metal, lamps),
        ...addTruss(hs, f, AU, metal, lamps),
    ];
    addOpenEndWall(hs, buckets.wall);
    addGoalPosts(f, metal);
    const score = addBoardFrame(f, hs, signs, metal, buckets.structure);

    const seating = add(buckets.seating.build(), seatingMat, "college.seating");
    const seatBacks = add(buckets.seatBacks.build(), seatMat, "college.seats");
    add(buckets.wall.build(), wallMat, "college.wall");
    add(buckets.fascia.build(), ribbonMat, "college.ribbon", false);
    add(buckets.structure.build(), structureMat, "college.structure");
    add(buckets.facade.build(), brickMat, "college.facade");
    add(glass.build(), glassMat, "college.glass", false);
    add(metal.build(), metalMat, "college.metal");
    add(lamps.build(), lampMat, "college.lamps", false);
    add(signs.build(), signMat, "college.signs", false);

    const board = videoBoard(
        COLLEGE_BOARD.w,
        COLLEGE_BOARD.h,
        0,
        "SPRING SHOW",
        params.endZoneText || "OpenMarch",
        shared,
    );
    board.object.position.set(
        f.cx - halfX - COLLEGE_BOARD.back,
        COLLEGE_BOARD.y,
        f.cz,
    );
    board.object.rotation.y = Math.PI / 2;
    board.object.traverse((o) => (o.castShadow = shadows && o.castShadow));
    root.add(board.object);
    disposers.push(() => board.dispose());
    const scoreMat = mat(
        new MeshStandardMaterial({
            color: 0x000000,
            emissive: 0xffffff,
            emissiveMap: tex(
                scoreboardTexture(params.homeColor, params.awayColor),
                false,
            ),
            emissiveIntensity: 1.1,
        }),
    );
    const scoreMesh = add(
        new PlaneGeometry(score.w, score.h),
        scoreMat,
        "college.scoreboard",
        false,
    )!;
    scoreMesh.position.set(...score.at);
    scoreMesh.rotation.y = Math.PI / 2;

    const band = buildBand(lowerOut.reserved, homeColor, shadows);
    root.add(band.mesh);
    disposers.push(band.dispose);

    // One spot per lamp bank, aimed across the field.
    const spots: SpotLight[] = banks.map((b) => {
        const spot = new SpotLight(0xfff3e0, 0, 0, 0.62, 0.6, 0);
        spot.name = "college.bankSpot";
        spot.position.set(...b.at);
        spot.target.position.set(...b.aim);
        spot.visible = false;
        root.add(spot, spot.target);
        return spot;
    });
    disposers.push(() => spots.forEach((s) => s.dispose()));

    if (!shadows) root.traverse((o) => (o.castShadow = false));

    const setLighting = (preset: LightingPreset) => {
        if (!PRESETS.includes(preset)) return;
        const k = lightingValues(preset).kit;
        spots.forEach((s) =>
            setLightIntensity(s, k.lampsOn ? LAMP_SPOT * k.lampScale : 0),
        );
        lampMat.emissiveIntensity = k.lampsOn ? 2.4 : 0.05;
        glassMat.emissiveIntensity = k.lampsOn
            ? 0.45 + 0.45 * k.lampScale
            : 0.2;
    };
    const defaultLighting: LightingPreset = "night";
    setLighting(defaultLighting);

    return {
        root,
        focus: [f.cx, 0, f.cz],
        cameras: collegeCameras(hs, f, L, HU, press.eye),
        seatRows: [
            ...lowerOut.seatRows,
            ...homeOut.seatRows,
            ...awayOut.seatRows,
        ],
        pickTargets: [seating!, seatBacks!],
        crowdDensity: 0.7,
        lightingPresets: [...PRESETS],
        defaultLighting,
        setLighting,
        dispose() {
            disposers.forEach((d) => d());
            geometries.forEach((g) => g.dispose());
            textures.forEach((t) => t.dispose());
            materials.forEach((m) => m.dispose());
            shared.dispose();
            root.clear();
        },
    };
};

/**
 * Which lower-bowl sections hold the band (the two middle wedges of the
 * side-2 back corner) and the visiting fans (the four back sections nearest
 * the open end).
 */
function planSections(hs: Horseshoe, lower: CollegeTier) {
    const secs = tierSections(hs, lower);
    const corner = secs.filter((s) => s.segment === "arc2");
    const mid = Math.floor(corner.length / 2);
    const band = new Set(
        corner.slice(Math.max(0, mid - 1), mid + 1).map((s) => s.index),
    );
    const back = secs.filter((s) => s.segment === "back");
    const away = new Set(back.slice(-4).map((s) => s.index));
    return { band, away };
}

/**
 * The building between the lower bowl's rim and an upper deck's soffit:
 * a glass front (`stories` of suites) set back under a ceiling, and walls
 * closing both ends.
 */
function addConcourse(
    hs: Horseshoe,
    lower: BuiltTier,
    upper: BuiltTier,
    structure: MeshBuilder,
    glass: MeshBuilder,
    stories: 1 | 2,
) {
    const d = lower.back;
    const rimTop = lower.top + (lower.rim ?? 1.2);
    const drop = upper.soffitDrop ?? 1.8;
    const soffitAt = (o: number) =>
        upper.bottom -
        (drop * (o - upper.offset)) / (upper.back - upper.offset);
    const top = soffitAt(d);
    const glassTop = top - 0.4;
    const S = [upper.from, upper.to];
    const P = (s: number, o: number, y: number): P3 => {
        const [x, z] = hs.point(s, o);
        return [x, y, z];
    };
    const set = 0.6;
    structure.strip(
        S.map((s) => P(s, d, rimTop)),
        S.map((s) => P(s, d, rimTop + 0.4)),
        { tile: FACADE_TILE },
    );
    glass.strip(
        S.map((s) => P(s, d + set, rimTop + 0.4)),
        S.map((s) => P(s, d + set, glassTop)),
        { tile: 24, vA: stories === 2 ? 0 : 0.5, vB: 1, flipU: true },
    );
    structure.strip(
        S.map((s) => P(s, d, glassTop)),
        S.map((s) => P(s, d, top)),
        { tile: FACADE_TILE },
    );
    structure.strip(
        S.map((s) => P(s, d, glassTop)),
        S.map((s) => P(s, d + set, glassTop)),
        { tile: FACADE_TILE },
    );
    for (const s of S) {
        structure.polygon(
            [
                [d, 0],
                [upper.back, 0],
                [upper.back, upper.bottom - drop],
                [d, top],
            ],
            ([o, y]) => P(s, o, y),
            FACADE_TILE,
        );
    }
}

interface Bank {
    at: Vector3Tuple;
    aim: Vector3Tuple;
}

/**
 * A run of lamp heads facing the field: an emissive lamp face tilted toward
 * the field by `tilt` radians from vertical, with a metal back and top.
 * The face runs from `x0` to `x1` at outward offset `d`; `zAt` maps an
 * offset to world z and `nz` is the outward direction in z.
 */
function lampBank(
    lamps: MeshBuilder,
    metal: MeshBuilder,
    zAt: (d: number) => number,
    nz: 1 | -1,
    x0: number,
    x1: number,
    d: number,
    y: number,
    height: number,
    tilt: number,
) {
    const zb = zAt(d);
    const zt = zAt(d + Math.sin(tilt) * height);
    const yt = y + Math.cos(tilt) * height;
    const u = Math.abs(x1 - x0) / 6;
    lamps.quad(
        [x0, y, zb],
        [x1, y, zb],
        [x1, yt, zt],
        [x0, yt, zt],
        [
            [0, 0],
            [u, 0],
            [u, 1],
            [0, 1],
        ],
    );
    const back = 0.6 * nz;
    metal.quad(
        [x0, y, zb + back],
        [x1, y, zb + back],
        [x1, yt, zt + back],
        [x0, yt, zt + back],
    );
    metal.quad(
        [x0, yt, zt],
        [x1, yt, zt],
        [x1, yt, zt + back],
        [x0, yt, zt + back],
    );
}

/**
 * The home roof canopy over the upper deck: a slab with a metal edge, posts
 * from the rim and two lamp banks under its front edge.
 */
function addCanopy(
    hs: Horseshoe,
    f: Frame,
    upper: BuiltTier,
    structure: MeshBuilder,
    metal: MeshBuilder,
    lamps: MeshBuilder,
): Bank[] {
    const z0 = hs.spec.cz + hs.spec.halfZ;
    const zAt = (d: number) => z0 + d;
    const front = upper.offset + 10;
    const backD = upper.back + 0.6;
    const rimTop = upper.top + (upper.rim ?? 1.4);
    const y = rimTop + 6;
    const xa = hs.at(upper.from).x;
    const xb = hs.at(upper.to).x;
    const t = 1.1;
    const slab = (yy: number) =>
        structure.quad(
            [xa, yy, zAt(front)],
            [xb, yy, zAt(front)],
            [xb, yy, zAt(backD)],
            [xa, yy, zAt(backD)],
        );
    slab(y);
    slab(y + t);
    metal.quad(
        [xa, y, zAt(front)],
        [xb, y, zAt(front)],
        [xb, y + t, zAt(front)],
        [xa, y + t, zAt(front)],
    );
    for (const x of [xa, xb])
        structure.quad(
            [x, y, zAt(front)],
            [x, y, zAt(backD)],
            [x, y + t, zAt(backD)],
            [x, y + t, zAt(front)],
        );
    const n = Math.max(2, Math.round((xb - xa) / 12));
    for (let i = 0; i <= n; i++) {
        const x = xa + ((xb - xa) * i) / n;
        metal.box(
            x,
            (rimTop + y) / 2,
            zAt(upper.back - 0.3),
            0.5,
            y - rimTop,
            0.5,
        );
    }
    const banks: Bank[] = [];
    const bankY = y - 2.2;
    for (const sx of [-1, 1]) {
        const xc = f.cx + sx * 26;
        lampBank(
            lamps,
            metal,
            zAt,
            1,
            xc - 15,
            xc + 15,
            front + 0.6,
            bankY,
            2.2,
            0.75,
        );
        banks.push({
            at: [xc, bankY, zAt(front)],
            aim: [f.cx + sx * 10, 0, f.cz - 6],
        });
    }
    return banks;
}

/** The visitor light truss: two lamp banks on posts above the rim. */
function addTruss(
    hs: Horseshoe,
    f: Frame,
    upper: BuiltTier,
    metal: MeshBuilder,
    lamps: MeshBuilder,
): Bank[] {
    const z0 = hs.spec.cz - hs.spec.halfZ;
    const zAt = (d: number) => z0 - d;
    const rimTop = upper.top + (upper.rim ?? 1.4);
    const d = upper.back - 0.4;
    const y = rimTop + 6;
    const banks: Bank[] = [];
    for (const sx of [-1, 1]) {
        const xc = f.cx + sx * 26;
        for (const px of [xc - 12, xc, xc + 12])
            metal.box(
                px,
                (rimTop + y) / 2,
                zAt(d + 0.6),
                0.45,
                y - rimTop,
                0.45,
            );
        metal.box(xc, y - 0.2, zAt(d + 0.6), 32, 0.4, 0.5);
        lampBank(lamps, metal, zAt, -1, xc - 15, xc + 15, d, y, 3, 0.5);
        banks.push({
            at: [xc, y + 1.5, zAt(d)],
            aim: [f.cx + sx * 10, 0, f.cz + 6],
        });
    }
    return banks;
}

/**
 * The press box: a glass box leaning out over the back of the home lower
 * bowl at the 50, with a sign band under the glass. Returns the press
 * camera eye, just in front of the glass.
 */
function addPressBox(
    hs: Horseshoe,
    f: Frame,
    lower: BuiltTier,
    structure: MeshBuilder,
    glass: MeshBuilder,
    signs: MeshBuilder,
    frame: MeshBuilder,
) {
    const pb = COLLEGE_PRESS_BOX;
    const z0 = hs.spec.cz + hs.spec.halfZ;
    const zAt = (d: number) => z0 + d;
    const D = lower.back;
    const dB = D - pb.reachBottom;
    const dT = D - pb.reachTop;
    const x0 = f.cx - pb.width / 2;
    const x1 = f.cx + pb.width / 2;
    signs.quad(
        [x1, pb.bottom, zAt(dB)],
        [x0, pb.bottom, zAt(dB)],
        [x0, pb.glassBottom, zAt(dB)],
        [x1, pb.glassBottom, zAt(dB)],
    );
    glass.quad(
        [x1, pb.glassBottom, zAt(dB)],
        [x0, pb.glassBottom, zAt(dB)],
        [x0, pb.glassTop, zAt(dT)],
        [x1, pb.glassTop, zAt(dT)],
        [
            [0, 0],
            [pb.width / 24, 0],
            [pb.width / 24, 1],
            [0, 1],
        ],
    );
    structure.quad(
        [x0, pb.bottom, zAt(dB)],
        [x1, pb.bottom, zAt(dB)],
        [x1, pb.bottom, zAt(D)],
        [x0, pb.bottom, zAt(D)],
    );
    structure.box(
        f.cx,
        pb.roof - 0.3,
        zAt((dT - 0.3 + D) / 2),
        pb.width + 0.6,
        0.6,
        D - dT + 0.3,
    );
    for (const x of [x0, x1]) {
        structure.polygon(
            [
                [dB, pb.bottom],
                [D, pb.bottom],
                [D, pb.roof - 0.6],
                [dT, pb.roof - 0.6],
                [dT, pb.glassTop],
                [dB, pb.glassBottom],
            ],
            ([d, y]) => [x, y, zAt(d)],
            FACADE_TILE,
        );
    }
    // White fins at the ends and between the bays, and a white roof edge.
    const fin = new Color(0.92, 0.93, 0.95);
    const bays = 6;
    for (let i = 0; i <= bays; i++) {
        const x = x0 + (pb.width * i) / bays;
        const w = i === 0 || i === bays ? 0.6 : 0.25;
        frame.quad(
            [x - w / 2, pb.glassBottom, zAt(dB) - 0.05],
            [x + w / 2, pb.glassBottom, zAt(dB) - 0.05],
            [x + w / 2, pb.glassTop, zAt(dT) - 0.05],
            [x - w / 2, pb.glassTop, zAt(dT) - 0.05],
            undefined,
            fin,
        );
    }
    frame.box(f.cx, pb.roof + 0.1, zAt(dT - 0.35), pb.width + 1, 0.9, 0.5, fin);
    const eyeY = (pb.glassBottom + pb.glassTop) / 2 + 0.4;
    const eye: Vector3Tuple = [f.cx, eyeY, zAt(dT - 1.0)];
    return { eye };
}

/** A low padded wall across the open end, with a gate for the band. */
function addOpenEndWall(hs: Horseshoe, wall: MeshBuilder) {
    const { cx, cz, halfX, halfZ } = hs.spec;
    const x = cx - halfX;
    const h = 1.3;
    const gate = 7;
    for (const [z0, z1] of [
        [cz - halfZ, cz - gate],
        [cz + gate, cz + halfZ],
    ]) {
        wall.quad(
            [x, 0, z0],
            [x, 0, z1],
            [x, h, z1],
            [x, h, z0],
            [
                [-z0 / WALL_TILE, 0],
                [-z1 / WALL_TILE, 0],
                [-z1 / WALL_TILE, h / 2.44],
                [-z0 / WALL_TILE, h / 2.44],
            ],
        );
    }
}

/** Yellow college goal posts on both end lines (vertex-colored metal). */
function addGoalPosts(f: Frame, metal: MeshBuilder) {
    const yellow = new Color(1.0, 0.8, 0.1);
    const pad = new Color(0.12, 0.13, 0.16);
    const crossbar = 3.05;
    const half = 5.64 / 2;
    const upright = 9.1;
    const w = 0.16;
    for (const sx of [-1, 1]) {
        const xEnd = sx < 0 ? f.minX : f.maxX;
        const xPost = xEnd + sx * 1.8;
        metal.box(xPost, 1.1, f.cz, 0.5, 2.2, 0.5, pad);
        metal.box(
            xPost,
            (2.2 + crossbar) / 2,
            f.cz,
            w * 1.4,
            crossbar - 2.2,
            w * 1.4,
            yellow,
        );
        metal.box(
            (xPost + xEnd) / 2,
            crossbar,
            f.cz,
            1.8,
            w * 1.4,
            w * 1.4,
            yellow,
        );
        metal.box(xEnd, crossbar, f.cz, w, w, half * 2, yellow);
        for (const sz of [-1, 1])
            metal.box(
                xEnd,
                crossbar + upright / 2,
                f.cz + sz * half,
                w,
                upright,
                w,
                yellow,
            );
    }
}

/**
 * The open end's board structure: legs, a dark back frame, the scoreboard
 * housing and the crown sign. Returns where the scoreboard face goes.
 */
function addBoardFrame(
    f: Frame,
    hs: Horseshoe,
    signs: MeshBuilder,
    metal: MeshBuilder,
    structure: MeshBuilder,
) {
    const b = COLLEGE_BOARD;
    const x = f.cx - hs.spec.halfX - b.back;
    const dark = new Color(0.16, 0.17, 0.2);
    const bottom = b.y - b.h / 2;
    for (const sz of [-1, 1])
        structure.box(
            x - 3,
            bottom / 2,
            f.cz + sz * (b.w * 0.32),
            3.5,
            bottom,
            3.5,
        );
    metal.box(x - 2.2, b.y + 2, f.cz, 1.2, b.h + 12, b.w + 2, dark);
    const w = b.w * 0.7;
    const h = 5;
    const y = bottom - 1 - h / 2;
    metal.box(x - 0.9, y, f.cz, 1.0, h + 0.8, w + 0.8, dark);
    const crownY = b.y + b.h / 2 + 3.6;
    const crownW = b.w * 0.6;
    signs.quad(
        [x + 0.6, crownY - 2.2, f.cz + crownW / 2],
        [x + 0.6, crownY - 2.2, f.cz - crownW / 2],
        [x + 0.6, crownY + 2.2, f.cz - crownW / 2],
        [x + 0.6, crownY + 2.2, f.cz + crownW / 2],
    );
    return { w, h, at: [x - 0.35, y, f.cz] as Vector3Tuple };
}

/**
 * The home band in its block: every reserved seat filled with a member in a
 * team-color jacket and a white shako (one instanced mesh, two boxes each).
 */
function buildBand(rows: SeatRow[], jacket: Color, shadows: boolean) {
    const spots: { p: Vector3; yaw: number }[] = [];
    for (const row of rows) {
        const pts = row.points.map((p) => new Vector3(...p));
        for (let i = 0; i + 1 < pts.length; i++) {
            const a = pts[i];
            const b = pts[i + 1];
            const len = a.distanceTo(b);
            const t = new Vector3().subVectors(b, a).normalize();
            const yaw = Math.atan2(-t.z, t.x);
            for (let d = 0.3; d < len; d += 0.62)
                spots.push({ p: a.clone().addScaledVector(t, d), yaw });
        }
    }
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.6,
    });
    const PER = 3;
    const mesh = new InstancedMesh(
        geometry,
        material,
        Math.max(1, spots.length * PER),
    );
    mesh.name = "college.band";
    mesh.castShadow = shadows;
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const coat = jacket.clone().multiplyScalar(0.55);
    const white = new Color(0.95, 0.95, 0.95);
    const brass = new Color(0.95, 0.72, 0.25);
    const part = (i: number, at: Vector3, size: Vector3, color: Color) => {
        m.compose(at, q, size);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, color);
    };
    spots.forEach(({ p, yaw }, i) => {
        q.setFromAxisAngle(up, yaw);
        // Facing the field: local -z after the yaw is the row's inward side.
        const fwd = new Vector3(0, 0, 1).applyQuaternion(q);
        part(PER * i, new Vector3(p.x, p.y + 0.4, p.z), new Vector3(0.44, 0.8, 0.3), coat);
        part(
            PER * i + 1,
            new Vector3(p.x, p.y + 1.02, p.z),
            new Vector3(0.26, 0.36, 0.26),
            white,
        );
        part(
            PER * i + 2,
            p.clone().addScaledVector(fwd, -0.22).setY(p.y + 0.62),
            new Vector3(0.22, 0.22, 0.14),
            brass,
        );
    });
    mesh.count = spots.length * PER;
    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
            mesh.dispose();
        },
    };
}

/** Named cameras: the ids every stadium kit keeps, plus two extra seats. */
function collegeCameras(
    hs: Horseshoe,
    f: Frame,
    lower: BuiltTier,
    upper: BuiltTier,
    pressEye: Vector3Tuple,
): CameraSeat[] {
    const front = hs.spec.cz + hs.spec.halfZ;
    const rowEye = (t: BuiltTier, i: number) => ({
        y: t.rowHeight(i) + SEATED_EYE,
        d: t.rowOffset(i) + t.depth * 0.45,
    });
    const r1 = rowEye(lower, 1);
    // Upper deck front row, right behind the fascia: nothing in front.
    const up = rowEye(upper, 0);
    // End zone: the camera platform on the lower bowl's rim.
    const endD = lower.back - 0.6;
    const endY = lower.top + (lower.rim ?? 1.2) + 1.6;
    return [
        cameraSeat("pressBox", "seat", pressEye, [f.cx, 0, f.cz - ft(12)]),
        cameraSeat(
            "frontRow",
            "seat",
            [f.cx - ft(36), r1.y, front + r1.d],
            [f.cx - ft(12), ft(6), f.cz],
        ),
        cameraSeat(
            "upperDeck",
            "seat",
            [f.cx + 14, up.y + 0.4, front + up.d],
            [f.cx + 4, 0, f.cz - 2],
        ),
        cameraSeat(
            "endZone",
            "seat",
            [hs.spec.cx + hs.spec.halfX + endD, endY, f.cz],
            [f.cx, 0, f.cz],
        ),
        cameraSeat(
            "sideline",
            "floor",
            [f.cx - 8, 1.8, f.maxZ + 6],
            [f.cx + 6, 1.2, f.cz],
        ),
        blimpCamera(f),
        topDownCamera(f, ft(780)),
    ];
}
