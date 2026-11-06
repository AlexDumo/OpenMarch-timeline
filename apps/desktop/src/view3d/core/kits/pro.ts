// cspell:ignore metalness
import {
    DoubleSide,
    Group,
    Matrix4,
    Mesh,
    MeshStandardMaterial,
    PlaneGeometry,
    Quaternion,
    SpotLight,
    Vector3,
    type BufferGeometry,
    type Material,
    type Vector3Tuple,
} from "three";
import {
    createSharedMaterials,
    ft,
    lightingValues,
    ribbonTexture,
    setLightIntensity,
    videoBoard,
    type SharedMaterials,
} from "../environment";
import type {
    CameraSeat,
    FieldFootprint,
    KitBuilder,
    LightingPreset,
    VenueParams,
} from "../types";
import {
    bandGeometry,
    bowlOutline,
    bowlTiers,
    ringLength,
    sectioned,
    type BowlOutline,
    type Ring,
    type BowlTier,
    type BuiltTier,
} from "./bowl";
import { MemberSet } from "./pro/steel";
import {
    adBoardTexture,
    clerestoryTexture,
    facadeTextures,
    plazaTexture,
    seatTexture,
    suiteTextures,
} from "./pro/textures";

/**
 * The pro dome kit (P2.4), a Lucas Oil-like stadium ported from the reference
 * demo's `buildPro` (design.md section 6, "pro"). Everything is placed
 * relative to the footprint: the bowl's inner outline is the footprint plus
 * 7.6 m on each side, with a 21.3 m corner radius.
 */

/** Gap between the footprint and the bowl's first row, on every side. */
export const PRO_BOWL_MARGIN = ft(25);
export const PRO_CORNER_RADIUS = ft(70);

/** Lower and upper tiers, from the demo (feet converted to meters). */
export const PRO_TIERS: BowlTier[] = [
    {
        offset: 0,
        rows: 32,
        depth: ft(2.8),
        rise: ft(0.95),
        base: ft(5),
        bottom: 0,
        side: "home",
    },
    {
        offset: ft(82),
        rows: 38,
        depth: ft(2.9),
        rise: ft(1.55),
        base: ft(58),
        bottom: ft(52),
        fascia: true,
        side: "home",
    },
];

/** Suite glass, between the decks just behind the lower tier. */
export const PRO_SUITE_GLASS = { bottom: ft(37), top: ft(46.5), inset: ft(2) };
/** The suite level's ribbon board sits between the glass and the ceiling. */
const SUITE_RIBBON_TOP = ft(50);
/** The concrete floor slab above the suites. */
const SUITE_CEILING = ft(50);
/** Roof height (the fixed frame's center). */
export const PRO_ROOF_Y = ft(168);
const ROOF_THICKNESS = ft(4);
/** The sliding panels ride above the fixed frame. */
const PANEL_LIFT = ft(6);
/** Half-size of the roof opening beyond the footprint's half-extents. */
const OPENING_MARGIN_X = ft(30);
const OPENING_MARGIN_Z = ft(40);
/** End-zone video boards. */
export const PRO_BOARD = { width: ft(104), height: ft(46), y: ft(128) };
/** Seated eye height above the tread (ui.md UI-3). */
const EYE = 1.2;
/** Fraction of the roof gap closed per 1/60 s frame (the demo's 0.06). */
const ROOF_EASE = 0.06;

const PRESETS: LightingPreset[] = ["day", "night", "roofClosed"];

/** What the part builders share while one kit is being built. */
interface ProContext {
    root: Group;
    shared: SharedMaterials;
    shadows: boolean;
    footprint: FieldFootprint;
    ring: BowlOutline;
    /** Field center and the bowl's inner half-extents. */
    cx: number;
    cz: number;
    ax: number;
    az: number;
    /** Adds a mesh to the root and frees its geometry on dispose. */
    addMesh(
        geo: BufferGeometry,
        mat: Material,
        name: string,
        castShadow?: boolean,
    ): Mesh;
    /** Registers cleanup for resources the shared set doesn't own. */
    own(dispose: () => void): void;
}

export const buildProKit: KitBuilder = ({ footprint, params, quality }) => {
    const shadows = quality === "high";
    const shared = createSharedMaterials();
    const disposers: (() => void)[] = [];
    const root = new Group();
    root.name = "kit.pro";
    const cx = (footprint.minX + footprint.maxX) / 2;
    const cz = (footprint.minZ + footprint.maxZ) / 2;
    const ax = (footprint.maxX - footprint.minX) / 2 + PRO_BOWL_MARGIN;
    const az = (footprint.maxZ - footprint.minZ) / 2 + PRO_BOWL_MARGIN;
    const ctx: ProContext = {
        root,
        shared,
        shadows,
        footprint,
        ring: bowlOutline({
            centerX: cx,
            centerZ: cz,
            halfX: ax,
            halfZ: az,
            cornerRadius: PRO_CORNER_RADIUS,
        }),
        cx,
        cz,
        ax,
        az,
        addMesh(geo, mat, name, castShadow = shadows) {
            disposers.push(() => geo.dispose());
            const m = new Mesh(geo, mat);
            m.name = name;
            m.castShadow = castShadow;
            m.receiveShadow = true;
            root.add(m);
            return m;
        },
        own(dispose) {
            disposers.push(dispose);
        },
    };

    addGround(ctx);
    const bowl = addBowl(ctx, params);
    const roof = addRoof(ctx, bowl.upper);
    addBoards(ctx, bowl.upper, params, roof.trussBottom);
    const defaultLighting: LightingPreset = "roofClosed";
    const light = (preset: LightingPreset, snap: boolean) => {
        roof.setLighting(preset, snap);
        if (!PRESETS.includes(preset)) return;
        const night = preset === "night";
        bowl.setGlow(
            night ? 1.1 : 0.12,
            night ? 1.4 : 0.55,
            night ? 2.4 : 1.4,
            night ? 3 : 0.25,
        );
    };
    light(defaultLighting, true);

    return {
        root,
        focus: [cx, 0, cz],
        cameras: proCameras(ctx, bowl.lower, bowl.upper),
        seatRows: bowl.seatRows,
        pickTargets: [bowl.treads],
        crowdDensity: 0.72,
        lightingPresets: [...PRESETS],
        defaultLighting,
        setLighting: (preset) => light(preset, false),
        onFrame({ cameraPosition, dt }) {
            const below = cameraPosition[1] < PRO_ROOF_Y - ft(2);
            roof.group.visible = below;
            bowl.clerestory.visible = below;
            roof.step(dt);
        },
        dispose() {
            disposers.forEach((d) => d());
            shared.dispose();
            root.clear();
        },
    };
};

/** Ground outside and the floor inside the bowl. */
function addGround(ctx: ProContext): void {
    const { shared, cx, cz, ax, az } = ctx;
    const ground = ctx.addMesh(
        new PlaneGeometry(ft(9000), ft(9000)),
        shared.std(0x55575c, { roughness: 1 }),
        "pro.ground",
        false,
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -ft(0.3);
    const floor = ctx.addMesh(
        new PlaneGeometry(2 * ax + ft(10), 2 * az + ft(10)),
        shared.std(0x3a7330, { roughness: 1 }),
        "pro.floor",
        false,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, -ft(0.1), cz);
}

/** Linear interpolation along a closed ring by arc length (meters). */
function pointAt(ring: Ring, s: number): { p: Vector3; tangent: Vector3 } {
    const total = ringLength(ring);
    let rest = ((s % total) + total) % total;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const seg = a.distanceTo(b);
        if (rest <= seg) {
            const tangent = b.clone().sub(a).normalize();
            return { p: a.clone().lerp(b, seg ? rest / seg : 0), tangent };
        }
        rest -= seg;
    }
    return { p: ring[0].clone(), tangent: new Vector3(1, 0, 0) };
}

/** An emissive material for light strips and similar, driven by `setGlow`. */
function glowMaterial(color: number): MeshStandardMaterial {
    return new MeshStandardMaterial({
        color: 0x000000,
        emissive: color,
        emissiveIntensity: 0,
        side: DoubleSide,
    });
}

/**
 * The bowl: seat sections with aisles, concrete (risers, walls, soffits,
 * suite ledge and ceiling), LED ribbons on both fascias, the suite glass with
 * lit suites behind it, under-deck light strips and field-level ad boards;
 * outside it, a brick-and-glass facade, buttress fins, a cornice and a plaza.
 */
function addBowl(ctx: ProContext, params: VenueParams) {
    const { ring, shared } = ctx;
    const bowl = bowlTiers(ring, PRO_TIERS);
    const [lower, upper] = bowl.tiers as [BuiltTier, BuiltTier];
    const ribbonMat = new MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xffffff,
        emissiveMap: ribbonTexture(params.endZoneText || "OPENMARCH"),
        emissiveIntensity: 1.2,
        side: DoubleSide,
    });
    const clerestoryMat = new MeshStandardMaterial({
        map: clerestoryTexture(),
        transparent: true,
        roughness: 0.2,
        metalness: 0.3,
        side: DoubleSide,
        depthWrite: false,
    });
    const suite = suiteTextures();
    const suiteMat = shared.std(0xffffff, {
        map: suite.map,
        emissive: 0xffffff,
        emissiveMap: suite.glow,
        emissiveIntensity: 0.8,
        roughness: 0.2,
        metalness: 0.4,
        side: DoubleSide,
    });
    const facade = facadeTextures();
    const facadeMat = shared.std(0xffffff, {
        map: facade.map,
        emissive: 0xffffff,
        emissiveMap: facade.glow,
        emissiveIntensity: 0.1,
        roughness: 0.85,
        side: DoubleSide,
    });
    const adTex = adBoardTexture();
    const adMat = new MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xffffff,
        emissiveMap: adTex,
        emissiveIntensity: 0.9,
        side: DoubleSide,
    });
    const coveMat = glowMaterial(0xffd9a0);
    const plazaTex = plazaTexture();
    const plazaMat = shared.std(0xffffff, { map: plazaTex, roughness: 1 });
    // The rings run counterclockwise seen from above, so from the field the
    // band's U runs right to left; mirror it so the text reads.
    ribbonMat.emissiveMap?.repeat.set(-1, 1);
    ctx.own(() => {
        ribbonMat.emissiveMap?.dispose();
        ribbonMat.dispose();
        clerestoryMat.map?.dispose();
        clerestoryMat.dispose();
        adTex.dispose();
        adMat.dispose();
        coveMat.dispose();
        plazaTex.dispose();
    });

    const g = PRO_SUITE_GLASS;
    const suiteFront = lower.back + g.inset;
    // The upper tier's back wall is the facade; keep it out of the concrete.
    const facadeWall = bowl.backWalls[bowl.backWalls.length - 1];
    const concrete = [
        ...bowl.risers.filter((r) => r !== facadeWall),
        // The suites' front ledge, where the press box camera stands.
        { a: ring(lower.back, g.bottom), b: ring(suiteFront, g.bottom) },
        {
            a: ring(lower.back - g.inset, SUITE_CEILING),
            b: ring(upper.offset + g.inset * 2, SUITE_CEILING),
        },
    ];
    const side = { side: DoubleSide };
    const lowerTreads = bowl.treads.slice(0, lower.rows);
    const upperTreads = bowl.treads.slice(lower.rows);
    const seatMat = (tones: { seat: string; alt: string; aisle: string }) =>
        shared.std(0xffffff, {
            map: seatTexture(tones),
            roughness: 0.8,
            ...side,
        });
    const treads = ctx.addMesh(
        bandGeometry([
            ...sectioned(lowerTreads, 44),
            ...sectioned(upperTreads, 64),
        ]),
        // One mesh for both decks: the sections' colors alternate in the
        // texture, so a single material keeps the draw call count down.
        seatMat({ seat: "#274a9c", alt: "#1c3a84", aisle: "#a4a7af" }),
        "pro.treads",
    );
    ctx.addMesh(
        bandGeometry(concrete),
        shared.std(0x9a9ca3, { roughness: 0.95, ...side }),
        "pro.concrete",
    );
    ctx.addMesh(bandGeometry(bowl.fascia), ribbonMat, "pro.fascia");
    ctx.addMesh(
        bandGeometry([
            {
                a: ring(suiteFront, SUITE_CEILING - ft(3.5)),
                b: ring(suiteFront, SUITE_RIBBON_TOP),
                tile: ft(30),
            },
        ]),
        ribbonMat,
        "pro.suiteRibbon",
    );
    ctx.addMesh(
        bandGeometry([
            {
                a: ring(suiteFront, g.bottom),
                b: ring(suiteFront, g.top),
                tile: ft(40),
            },
            {
                a: ring(suiteFront, g.top),
                b: ring(suiteFront, SUITE_CEILING - ft(3.5)),
                tile: ft(40),
            },
        ]),
        suiteMat,
        "pro.suites",
    );
    // Field-level ad boards on the front wall.
    ctx.addMesh(
        bandGeometry(
            sectioned(
                [{ a: ring(-0.04, 0), b: ring(-0.04, ft(3.2)) }],
                Math.round(ringLength(ring(0, 0)) / ft(60)),
            ),
        ),
        adMat,
        "pro.adBoards",
        false,
    );
    // Warm light strips along the upper deck's soffit.
    const soffitY = (d: number) =>
        upper.bottom -
        ft(6) * ((d - upper.offset) / (upper.back - upper.offset)) -
        0.04;
    const strips = [ft(18), ft(52), ft(88)].map((k) => {
        const d0 = upper.offset + k;
        const d1 = d0 + ft(1.6);
        return { a: ring(d0, soffitY(d0)), b: ring(d1, soffitY(d1)) };
    });
    ctx.addMesh(bandGeometry(strips), coveMat, "pro.cove", false);

    const rimTop = upper.top + ft(4);
    const clerestory = ctx.addMesh(
        bandGeometry(
            sectioned(
                [
                    {
                        a: ring(upper.back, rimTop),
                        b: ring(upper.back, PRO_ROOF_Y),
                    },
                ],
                Math.round(ringLength(ring(upper.back, 0)) / ft(40)),
            ),
        ),
        clerestoryMat,
        "pro.clerestory",
        false,
    );

    // Exterior: facade, fins, cornice, plaza.
    const bays = Math.round(ringLength(ring(upper.back, 0)) / ft(40));
    ctx.addMesh(
        bandGeometry(
            sectioned(
                [{ a: ring(upper.back, 0), b: ring(upper.back, rimTop) }],
                bays,
            ),
        ),
        facadeMat,
        "pro.facade",
    );
    addFins(ctx, ring(upper.back + 0.2, 0), bays, rimTop + ft(3));
    const copingMat = shared.std(0xc3c5cb, {
        roughness: 0.6,
        metalness: 0.3,
        ...side,
    });
    ctx.addMesh(
        bandGeometry([
            {
                a: ring(upper.back - ft(2), rimTop + 0.3),
                b: ring(upper.back + ft(5), rimTop + 0.3),
            },
            {
                a: ring(upper.back + ft(5), rimTop + 0.3),
                b: ring(upper.back + ft(5), rimTop - ft(3)),
            },
        ]),
        copingMat,
        "pro.cornice",
    );
    const plazaBands = Array.from({ length: 7 }, (_, i) => ({
        a: ring(upper.back + i * 8, 0.02),
        b: ring(upper.back + (i + 1) * 8, 0.02),
    }));
    ctx.addMesh(
        bandGeometry(
            sectioned(
                plazaBands,
                Math.round(ringLength(ring(upper.back + 28, 0)) / 8),
            ),
        ),
        plazaMat,
        "pro.plaza",
        false,
    );

    const mastLamps = addMasts(ctx, ring(upper.back + ft(60), 0));

    return {
        lower,
        upper,
        treads,
        clerestory,
        seatRows: bowl.seatRows,
        /** Night glow on the facade, suites, cove strips and plaza masts. */
        setGlow(
            facadeGlow: number,
            suiteGlow: number,
            cove: number,
            masts: number,
        ) {
            facadeMat.emissiveIntensity = facadeGlow;
            suiteMat.emissiveIntensity = suiteGlow;
            coveMat.emissiveIntensity = cove;
            mastLamps.emissiveIntensity = masts;
        },
    };
}

/** Plaza light masts every ~30 m on a ring; returns the lamp material. */
function addMasts(ctx: ProContext, plazaRing: Ring): MeshStandardMaterial {
    const total = ringLength(plazaRing);
    const count = Math.round(total / 30);
    const poles = new MemberSet();
    const heads = new MemberSet();
    for (let k = 0; k < count; k++) {
        const { p } = pointAt(plazaRing, (k * total) / count);
        poles.box(new Vector3(p.x, 7, p.z), new Vector3(0.45, 14, 0.45));
        heads.box(new Vector3(p.x, 14.3, p.z), new Vector3(3.2, 0.5, 1.2));
    }
    const poleMat = ctx.shared.std(0x6d7078, {
        metalness: 0.5,
        roughness: 0.5,
    });
    const lampMat = ctx.shared.std(0x30333a, {
        emissive: 0xfff0d0,
        emissiveIntensity: 0,
    });
    const a = poles.mesh(ctx.shared.unitBox, poleMat, "pro.masts");
    const b = heads.mesh(ctx.shared.unitBox, lampMat, "pro.mastLamps");
    ctx.root.add(a, b);
    ctx.own(() => {
        a.dispose();
        b.dispose();
    });
    return lampMat;
}

/** Buttress fins at the facade's bay seams, as one instanced mesh. */
function addFins(ctx: ProContext, wallRing: Ring, bays: number, top: number) {
    const total = ringLength(wallRing);
    const set = new MemberSet();
    const center = new Vector3(ctx.cx, 0, ctx.cz);
    for (let k = 0; k < bays; k++) {
        const { p, tangent } = pointAt(wallRing, (k * total) / bays);
        // Outward normal: perpendicular to the tangent, away from the center.
        const n = new Vector3(tangent.z, 0, -tangent.x);
        if (n.dot(p.clone().sub(center)) < 0) n.negate();
        const m = new Matrix4().makeBasis(
            tangent.clone().multiplyScalar(1.5),
            new Vector3(0, top, 0),
            n.clone().multiplyScalar(1.4),
        );
        m.setPosition(p.x + n.x * 0.5, top / 2, p.z + n.z * 0.5);
        set.matrices.push(m);
    }
    const mat = ctx.shared.std(0x8f8d93, { roughness: 0.8 });
    const mesh = set.mesh(ctx.shared.unitBox, mat, "pro.fins");
    mesh.castShadow = ctx.shadows;
    mesh.receiveShadow = true;
    ctx.root.add(mesh);
    ctx.own(() => mesh.dispose());
}

/**
 * The roof: a fixed frame around the opening and two panels that slide over
 * the ends, with the steel under them (lattice trusses on the frame, ribs
 * under the panels), light bars, lamps and spots. `setLighting` sets the
 * panels' target from the preset; `step` eases them toward it.
 */
function addRoof(ctx: ProContext, upper: BuiltTier) {
    const { shared, cx, cz, footprint } = ctx;
    const group = new Group();
    group.name = "pro.roof";
    const rx = ctx.ax + upper.back + ft(6);
    const rz = ctx.az + upper.back + ft(6);
    const ox = (footprint.maxX - footprint.minX) / 2 + OPENING_MARGIN_X;
    const oz = (footprint.maxZ - footprint.minZ) / 2 + OPENING_MARGIN_Z;
    const roofMat = shared.std(0xb4b8bf, {
        roughness: 0.6,
        side: DoubleSide,
        emissive: 0x8d929b,
        emissiveIntensity: 0.4,
    });
    const slab = (
        name: string,
        [x0, x1, z0, z1]: [number, number, number, number],
        y = PRO_ROOF_Y,
    ) => {
        const m = new Mesh(shared.unitBox, roofMat);
        m.name = name;
        m.scale.set(x1 - x0, ROOF_THICKNESS, z1 - z0);
        m.position.set(cx + (x0 + x1) / 2, y, cz + (z0 + z1) / 2);
        m.castShadow = ctx.shadows;
        group.add(m);
        return m;
    };
    slab("pro.roofFrame", [-rx, rx, oz, rz]);
    slab("pro.roofFrame", [-rx, rx, -rz, -oz]);
    slab("pro.roofFrame", [-rx, -ox, -oz, oz]);
    slab("pro.roofFrame", [ox, rx, -oz, oz]);
    const panelY = PRO_ROOF_Y + PANEL_LIFT;
    const panels = [
        slab("pro.roofPanel", [-ox, 0, -oz, oz], panelY),
        slab("pro.roofPanel", [0, ox, -oz, oz], panelY),
    ];
    const panelX0 = panels.map((p) => p.position.x);

    // Steel under the fixed frame.
    const steelMat = shared.std(0xdfe2e7, {
        roughness: 0.5,
        metalness: 0.35,
        emissive: 0x9aa0aa,
        emissiveIntensity: 0.2,
    });
    const lampMat = shared.std(0x30333a, {
        emissive: 0xfff0d8,
        emissiveIntensity: 0,
    });
    const trussTop = PRO_ROOF_Y - ROOF_THICKNESS / 2;
    const frame = new MemberSet();
    const lamps = new MemberSet();
    const pt = (x: number, z: number, y = trussTop) =>
        new Vector3(cx + x, y, cz + z);
    // Two deep trusses along each long edge of the opening, plus one out
    // over the side frames, and a girder across each end of the opening.
    for (const sz of [-1, 1]) {
        for (const z of [oz, (oz + rz) / 2]) {
            frame.truss(pt(-rx, sz * z), pt(rx, sz * z), ft(16), ft(20), 0.45);
        }
        const bottom = trussTop - ft(16) - 0.5;
        for (let x = -rx + ft(30); x < rx - ft(20); x += ft(28))
            lamps.box(
                new Vector3(cx + x, bottom, cz + sz * oz),
                new Vector3(ft(5), 0.4, ft(2.2)),
            );
    }
    for (const sx of [-1, 1]) {
        frame.truss(pt(sx * ox, -rz), pt(sx * ox, rz), ft(16), ft(20), 0.45);
    }
    // Secondary trusses across the frames every ~16 m (skipped at low quality).
    if (ctx.shadows) {
        const step = 16;
        const n = Math.round((2 * rx) / step);
        for (let i = 1; i < n; i++) {
            const x = -rx + (2 * rx * i) / n;
            const inside = Math.abs(x) < ox;
            for (const [z0, z1] of inside
                ? [
                      [oz, rz],
                      [-rz, -oz],
                  ]
                : [[-rz, rz]]) {
                frame.truss(pt(x, z0), pt(x, z1), ft(7), ft(22), 0.28);
            }
        }
    }
    const steel = frame.mesh(shared.unitBox, steelMat, "pro.roofSteel");
    steel.castShadow = false;
    group.add(steel);
    const lampMesh = lamps.mesh(shared.unitBox, lampMat, "pro.roofLamps");
    group.add(lampMesh);
    ctx.own(() => {
        steel.dispose();
        lampMesh.dispose();
    });

    // Ribs under each sliding panel; they ride along with it.
    const rig = new MemberSet();
    const pw = ox;
    const ribY = -ROOF_THICKNESS / 2 - 0.5;
    for (let u = -pw / 2 + 3; u < pw / 2; u += 6)
        rig.box(new Vector3(u, ribY, 0), new Vector3(0.5, 1.0, 2 * oz));
    for (const z of [-oz, -oz / 2, 0, oz / 2, oz])
        rig.box(new Vector3(0, ribY - 0.2, z), new Vector3(pw, 0.7, 0.6));
    const rigs = panels.map((p, i) => {
        const mesh = rig.mesh(shared.unitBox, steelMat, "pro.panelRibs");
        mesh.position.set(p.position.x, panelY, p.position.z);
        mesh.userData.panel = i;
        group.add(mesh);
        ctx.own(() => mesh.dispose());
        return mesh;
    });

    const lights = addRoofLights(ctx, group, ox, oz);
    ctx.root.add(group);

    // 1 is open (panels over the fixed frame), 0 is closed.
    let open = 0;
    let target = 0;
    const place = () =>
        panels.forEach((p, i) => {
            p.position.x = panelX0[i] + (i ? 1 : -1) * ox * open;
            rigs[i].position.x = p.position.x;
        });
    return {
        group,
        trussBottom: trussTop - ft(7),
        setLighting(preset: LightingPreset, snap: boolean) {
            if (!PRESETS.includes(preset)) return;
            const k = lightingValues(preset).kit;
            lights.set(k.barEmissive, k.roofSpotIntensity);
            lampMat.emissiveIntensity = k.barEmissive * 0.9;
            // The underside is lit by the stadium lights at night, by the
            // roof's own glow in the day.
            roofMat.emissiveIntensity = preset === "night" ? 0.12 : 0.45;
            steelMat.emissiveIntensity = preset === "night" ? 0.05 : 0.2;
            target = k.roofOpen ? 1 : 0;
            if (snap) {
                open = target;
                place();
            }
        },
        step(dt: number) {
            const gap = target - open;
            if (gap === 0) return;
            const ease = 1 - Math.pow(1 - ROOF_EASE, Math.max(0, dt) * 60);
            open = Math.abs(gap) < 0.001 ? target : open + gap * ease;
            place();
        },
    };
}

/** Light bars (in the roof group) and six spots on the opening's edges. */
function addRoofLights(ctx: ProContext, roof: Group, ox: number, oz: number) {
    const { shared, cx, cz } = ctx;
    const barMat = shared.std(0x30333a, {
        emissive: 0xffffff,
        emissiveIntensity: 0,
    });
    const spots: SpotLight[] = [];
    const edges: [number, number][] = [
        [-ox, 0],
        [ox, 0],
        [0, oz],
        [0, -oz],
        [-ox * 0.6, oz],
        [ox * 0.6, -oz],
    ];
    for (const [x, z] of edges) {
        const bar = new Mesh(shared.unitBox, barMat);
        bar.name = "pro.roofBar";
        bar.scale.set(z ? ft(60) : ft(3), ft(3), z ? ft(3) : ft(60));
        bar.position.set(cx + x, PRO_ROOF_Y - ft(4), cz + z);
        roof.add(bar);
        const spot = new SpotLight(0xfff3e0, 0, 0, 0.7, 0.6, 0);
        spot.name = "pro.roofSpot";
        spot.position.set(cx + x, PRO_ROOF_Y - ft(6), cz + z);
        spot.target.position.set(cx + x * 0.2, 0, cz + z * 0.2);
        spot.visible = false;
        ctx.root.add(spot, spot.target);
        spots.push(spot);
    }
    ctx.own(() => spots.forEach((s) => s.dispose()));
    return {
        set(barEmissive: number, spotIntensity: number) {
            barMat.emissiveIntensity = barEmissive;
            spots.forEach((s) => setLightIntensity(s, spotIntensity));
        },
    };
}

/**
 * End-zone video boards, kept clear of the seats: each with a steel trim, a
 * deep back housing, a service catwalk with lamps and four cables up into the
 * roof steel. All the structure is one instanced mesh.
 */
function addBoards(
    ctx: ProContext,
    upper: BuiltTier,
    params: VenueParams,
    hangFrom: number,
) {
    const offset = boardClearOffset(upper);
    const members = new MemberSet();
    const lamps = new MemberSet();
    const { width: w, height: h } = PRO_BOARD;
    for (const sx of [-1, 1]) {
        const b = videoBoard(
            w,
            h,
            0,
            params.endZoneText || "OPENMARCH",
            "3D View",
            ctx.shared,
        );
        const x = ctx.cx + sx * (ctx.ax + offset);
        b.object.position.set(x, PRO_BOARD.y, ctx.cz);
        b.object.rotation.y = (-sx * Math.PI) / 2;
        b.object.traverse((o) => (o.castShadow = ctx.shadows && o.castShadow));
        ctx.root.add(b.object);
        ctx.own(() => b.dispose());

        b.object.updateMatrixWorld(true);
        const frame = b.object.matrixWorld;
        const q = new Quaternion().setFromRotationMatrix(frame);
        const world = (lx: number, ly: number, lz: number) =>
            new Vector3(lx, ly, lz).applyMatrix4(frame);
        const add = (
            set: MemberSet,
            lx: number,
            ly: number,
            lz: number,
            sx_: number,
            sy: number,
            sz: number,
        ) =>
            set.matrices.push(
                new Matrix4().compose(
                    world(lx, ly, lz),
                    q,
                    new Vector3(sx_, sy, sz),
                ),
            );
        const trim = ft(3);
        // Steel trim proud of the screen on all four sides.
        add(members, 0, h / 2 + ft(2), ft(1.4), w + ft(8), trim, ft(2.4));
        add(members, 0, -h / 2 - ft(2), ft(1.4), w + ft(8), trim, ft(2.4));
        for (const s of [-1, 1])
            add(
                members,
                s * (w / 2 + ft(2)),
                0,
                ft(1.4),
                trim,
                h + ft(4),
                ft(2.4),
            );
        // The housing behind the screen.
        add(members, 0, 0, -ft(7), w + ft(4), h + ft(4), ft(11));
        // Catwalk under the board, and lamps along its front edge.
        add(members, 0, -h / 2 - ft(6.5), ft(1), w + ft(10), ft(1.2), ft(8));
        add(members, 0, -h / 2 - ft(5), ft(5), w + ft(10), ft(2.8), ft(0.4));
        for (let k = -4; k <= 4; k++)
            add(
                lamps,
                k * (w / 9),
                -h / 2 - ft(8),
                ft(5.4),
                ft(6),
                ft(1.2),
                ft(1.2),
            );
        // Cables: an A-frame from each top corner up into the truss.
        const topY = h / 2 + ft(2);
        const rise = hangFrom - PRO_BOARD.y;
        for (const s of [-1, 1])
            for (const sz of [-1, 1]) {
                members.bar(
                    world(s * w * 0.42, topY, 0),
                    world(s * w * 0.42, rise, sz * ft(7)),
                    0.18,
                );
            }
    }
    const steelMat = ctx.shared.std(0xb6bac2, {
        roughness: 0.5,
        metalness: 0.5,
    });
    const lampMat = ctx.shared.std(0x30333a, {
        emissive: 0xfff0d8,
        emissiveIntensity: 0.8,
    });
    const struct = members.mesh(ctx.shared.unitBox, steelMat, "pro.boardSteel");
    const lampMesh = lamps.mesh(ctx.shared.unitBox, lampMat, "pro.boardLamps");
    struct.castShadow = ctx.shadows;
    ctx.root.add(struct, lampMesh);
    ctx.own(() => {
        struct.dispose();
        lampMesh.dispose();
    });
}

/** Named cameras (design.md section 6), from the demo's seats. */
function proCameras(
    ctx: ProContext,
    lower: BuiltTier,
    upper: BuiltTier,
): CameraSeat[] {
    const { cx, cz, ax, footprint } = ctx;
    const fz = footprint.maxZ + PRO_BOWL_MARGIN; // the bowl's front edge
    const focus: Vector3Tuple = [cx, 0, cz];
    const rowEye = (t: BuiltTier, i: number) => ({
        y: t.base + i * t.rise + EYE,
        d: t.offset + (i + 0.45) * t.depth,
    });
    const lowerRow = rowEye(lower, 12);
    const upperRow = rowEye(upper, 24);
    const endRow = rowEye(upper, 14);
    const cam = (
        id: string,
        kind: CameraSeat["kind"],
        position: Vector3Tuple,
        target: Vector3Tuple,
    ): CameraSeat => ({
        id,
        labelKey: `view3d.camera.${id}`,
        kind,
        position,
        target,
    });
    return [
        // Suite level, in front of the glass and below the upper-deck soffit.
        cam(
            "pressBox",
            "seat",
            [cx, ft(45), fz + lower.back + ft(1)],
            [cx, 0, cz - ft(14)],
        ),
        cam(
            "lowerBowl",
            "seat",
            [cx - ft(30), lowerRow.y, fz + lowerRow.d],
            [cx - ft(10), ft(4), cz],
        ),
        cam(
            "upperDeck",
            "seat",
            [cx + ft(60), upperRow.y, fz + upperRow.d],
            [cx, 0, cz - ft(6)],
        ),
        cam("endZone", "seat", [cx + ax + endRow.d, endRow.y, cz], focus),
        cam(
            "sideline",
            "floor",
            [cx - ft(20), ft(6), footprint.maxZ + ft(14)],
            [cx + ft(10), ft(4), footprint.maxZ - ft(60)],
        ),
        cam("blimp", "aerial", [cx - ft(620), ft(640), cz + ft(600)], focus),
        // A tiny +Z offset keeps the front at the bottom of the screen.
        cam("topDown", "topDown", [cx, ft(980), cz + ft(0.5)], focus),
    ];
}

/**
 * Outline offset for the end-zone boards: the demo's spot 30 ft inside the
 * upper tier's back, moved toward the field until the board's frame clears
 * the seated crowd under it.
 */
function boardClearOffset(upper: BuiltTier): number {
    const bottom = PRO_BOARD.y - PRO_BOARD.height / 2 - ft(2);
    const halfThickness = ft(1.5);
    const headroom = ft(1.35) + 0.9 + 0.3; // seat, person, clearance
    let d = upper.back - ft(30);
    const treadAt = (x: number) => {
        const i = Math.floor((x - upper.offset) / upper.depth);
        if (i < 0) return -Infinity;
        return upper.base + Math.min(i, upper.rows - 1) * upper.rise;
    };
    while (d > upper.offset && treadAt(d + halfThickness) + headroom > bottom)
        d -= 0.25;
    return d;
}
