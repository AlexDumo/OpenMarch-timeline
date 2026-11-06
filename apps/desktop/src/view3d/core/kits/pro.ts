// cspell:ignore metalness vomitory vomitories
import {
    BackSide,
    BoxGeometry,
    BufferGeometry,
    DoubleSide,
    Float32BufferAttribute,
    Group,
    Mesh,
    MeshStandardMaterial,
    PlaneGeometry,
    SpotLight,
    Vector3,
    type Material,
    type MeshStandardMaterialParameters,
    type Vector3Tuple,
} from "three";
import {
    createRng,
    createSharedMaterials,
    ft,
    lightingValues,
    setLightIntensity,
    videoBoard,
    type SharedMaterials,
} from "../environment";
import type {
    CameraSeat,
    FieldFootprint,
    KitBuilder,
    LightingPreset,
    SeatRow,
    VenueParams,
} from "../types";
import {
    bandGeometry,
    bowlOutline,
    bowlTiers,
    ringSections,
    RING_PARTS,
    type BowlOutline,
    type BowlTier,
    type BuiltTier,
    type RingPair,
    type SectionLayout,
} from "./bowl";
import { BandBuilder, Members, splitSeatRow } from "./pro/geometry";
import {
    boardScreenTexture,
    FACADE_LAYOUT,
    facadeTextures,
    interiorWallTextures,
    ledRibbonTexture,
    parkingTexture,
    roofTopTexture,
    roofUndersideTexture,
    seatTexture,
    suiteTexture,
    towerTextures,
    windowWallTexture,
} from "./pro/textures";

/**
 * The pro dome kit (P2.4): a Lucas Oil-like stadium with a retractable roof
 * (design.md section 6, "pro"). Everything is placed relative to the
 * footprint: the bowl's inner outline is the footprint plus 7.6 m on each
 * side, with a 21.3 m corner radius.
 *
 * It should read as a building, not a carpet: blue seats split into sections
 * by aisles that run down the bowl (radial in the corners), vomitories in the
 * lower bowl, lit suites under an LED fascia, a field-level LED wall, two
 * long-span box trusses that carry the sliding roof panels with a grid of
 * cross trusses, catwalk lights and speaker clusters, end-zone boards hung
 * from the roof, and a brick-and-glass building around it all with a great
 * window wall at the side-1 end looking out on a few towers.
 */

/** Gap between the footprint and the bowl's first row, on every side. */
export const PRO_BOWL_MARGIN = ft(25);
export const PRO_CORNER_RADIUS = ft(70);

/** Seating sections: segments per section on each part of the ring. */
export const PRO_LOWER_SECTIONS: SectionLayout = { x: 4, z: 7, arc: 4 };
export const PRO_UPPER_SECTIONS: SectionLayout = { x: 4, z: 7, arc: 2 };

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
        sections: PRO_LOWER_SECTIONS,
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
        sections: PRO_UPPER_SECTIONS,
    },
];

/** Suite glass, between the decks just behind the lower tier. */
export const PRO_SUITE_GLASS = { bottom: ft(37), top: ft(49), inset: ft(2) };
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
/** The outer wall stands this far behind the upper deck's back wall. */
const FACADE_GAP = ft(6);
/** Corner radius of the building's outer wall. */
const FACADE_CORNER = ft(40);
/** End-zone video boards. */
export const PRO_BOARD = { width: ft(110), height: ft(58), y: ft(128) };
/** Aisle width between seating sections. */
export const PRO_AISLE = 1.2;
/** Lower-bowl vomitories (tunnel portals): rows covered, and width. */
export const PRO_VOMITORY = { firstRow: 9, lastRow: 15, width: 3.4 };
/** Depth of the long-span trusses that carry the panels, and of the rest. */
const SUPER_TRUSS_DEPTH = 9;
const TRUSS_DEPTH = 4;
/** Seated eye height above the tread (ui.md UI-3). */
const EYE = 1.2;
/** Fraction of the roof gap closed per 1/60 s frame (the demo's 0.06). */
const ROOF_EASE = 0.06;

const PRESETS: LightingPreset[] = ["day", "night", "roofClosed"];

/** Member colors (`Members` tints one shared material per instance). */
const STEEL = 0xd9dce0;
const DARK = 0x16171b;
const RAIL = 0x3a3d44;
const CONCRETE = 0x9a9ca3;

/** What the part builders share while one kit is being built. */
interface ProContext {
    root: Group;
    shared: SharedMaterials;
    shadows: boolean;
    quality: "low" | "high";
    footprint: FieldFootprint;
    ring: BowlOutline;
    /** The outer wall's outline (offset 0 is the wall). */
    shell: BowlOutline;
    /** Field center and the bowl's inner half-extents. */
    cx: number;
    cz: number;
    ax: number;
    az: number;
    /** Half-size of the outer wall and of the roof opening. */
    rx: number;
    rz: number;
    ox: number;
    oz: number;
    /** Roof steel, board hangers and speakers, built as one instanced mesh. */
    members: Members;
    /** Adds a mesh to the root and frees its geometry on dispose. */
    addMesh(
        geo: BufferGeometry,
        mat: Material | Material[],
        name: string,
        castShadow?: boolean,
    ): Mesh;
    /** Registers cleanup for resources the shared set doesn't own. */
    own(dispose: () => void): void;
    /** A material the kit disposes, with its textures. */
    mat(params: MeshStandardMaterialParameters): MeshStandardMaterial;
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
    const upper = PRO_TIERS[1];
    const upperBack = upper.offset + upper.rows * upper.depth;
    const rx = ax + upperBack + FACADE_GAP;
    const rz = az + upperBack + FACADE_GAP;
    const ctx: ProContext = {
        root,
        shared,
        shadows,
        quality,
        footprint,
        ring: bowlOutline({
            centerX: cx,
            centerZ: cz,
            halfX: ax,
            halfZ: az,
            cornerRadius: PRO_CORNER_RADIUS,
        }),
        shell: bowlOutline({
            centerX: cx,
            centerZ: cz,
            halfX: rx,
            halfZ: rz,
            cornerRadius: FACADE_CORNER,
        }),
        cx,
        cz,
        ax,
        az,
        rx,
        rz,
        ox: (footprint.maxX - footprint.minX) / 2 + OPENING_MARGIN_X,
        oz: (footprint.maxZ - footprint.minZ) / 2 + OPENING_MARGIN_Z,
        members: new Members(),
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
        mat(p) {
            const m = new MeshStandardMaterial(p);
            disposers.push(() => {
                m.map?.dispose();
                if (m.emissiveMap !== m.map) m.emissiveMap?.dispose();
                m.dispose();
            });
            return m;
        },
    };

    addGround(ctx);
    const bowl = addBowl(ctx, params);
    const shell = addShell(ctx, bowl.upper);
    const roof = addRoof(ctx);
    const boards = addBoards(ctx, bowl.upper, params);
    addTrusses(ctx, boards);
    const skyline = addSkyline(ctx);
    const steel = ctx.members.build(
        shared.unitBox,
        shared.std(0xffffff, { roughness: 0.55, metalness: 0.35 }),
        "pro.steel",
    );
    steel.castShadow = shadows;
    steel.receiveShadow = true;
    roof.group.add(steel);
    ctx.own(() => steel.dispose());

    const setLighting = (preset: LightingPreset, snap: boolean) => {
        if (!PRESETS.includes(preset)) return;
        roof.setLighting(preset, snap);
        const night = lightingValues(preset).kit.lampsOn;
        shell.setNight(night);
        skyline.setNight(night);
    };
    const defaultLighting: LightingPreset = "roofClosed";
    setLighting(defaultLighting, true);

    return {
        root,
        focus: [cx, 0, cz],
        cameras: proCameras(ctx, bowl.lower, bowl.upper),
        seatRows: bowl.seatRows,
        pickTargets: [bowl.treads],
        crowdDensity: 0.72,
        lightingPresets: [...PRESETS],
        defaultLighting,
        setLighting: (preset) => setLighting(preset, false),
        onFrame({ cameraPosition, dt }) {
            // From above, the roof and its steel hide (a cutaway), so the
            // blimp and top-down views see the drill; the walls stay.
            roof.group.visible = cameraPosition[1] < PRO_ROOF_Y - ft(2);
            roof.step(dt);
        },
        dispose() {
            disposers.forEach((d) => d());
            shared.dispose();
            root.clear();
        },
    };
};

/** Ground outside, a plaza around the building and the floor inside. */
function addGround(ctx: ProContext): void {
    const { shared, cx, cz, ax, az, shell } = ctx;
    const ground = ctx.addMesh(
        new PlaneGeometry(ft(9000), ft(9000)),
        shared.std(0x4d5056, { roughness: 1 }),
        "pro.ground",
        false,
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -ft(0.3);
    const n = shell(0, 0).length;
    ctx.addMesh(
        new BandBuilder().slice(shell(ft(90), -0.03), shell(0, -0.03), 0, n).build(),
        shared.std(0x9c9a94, { roughness: 0.95 }),
        "pro.plaza",
        false,
    );
    const lot = new BandBuilder()
        .slice(shell(ft(420), -0.05), shell(ft(90), -0.05), 0, n, {
            tile: 30,
            v1: (ft(420) - ft(90)) / 30,
        })
        .build();
    ctx.addMesh(
        lot,
        ctx.mat({ map: parkingTexture(), roughness: 0.95 }),
        "pro.parking",
        false,
    );
    const floor = ctx.addMesh(
        new PlaneGeometry(2 * ax + ft(10), 2 * az + ft(10)),
        shared.std(0x2f6328, { roughness: 1 }),
        "pro.floor",
        false,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, -ft(0.1), cz);
}

/**
 * The bowl: seat treads (one texture tile per section), concrete (risers,
 * walls, soffits, suite ledge and ceiling), the LED fascia and field wall,
 * the suite glass and the vomitories. Seat rows are split per section.
 */
function addBowl(ctx: ProContext, params: VenueParams) {
    const { ring, shared } = ctx;
    const bowl = bowlTiers(ring, PRO_TIERS, { fasciaTile: ft(48) });
    const [lower, upper] = bowl.tiers as [BuiltTier, BuiltTier];
    const ribbonMat = ctx.mat({
        color: 0x000000,
        emissive: 0xffffff,
        emissiveMap: ledRibbonTexture(
            params.endZoneText || "OPENMARCH",
            params.homeColor,
        ),
        emissiveIntensity: 1.15,
        roughness: 0.4,
        side: DoubleSide,
    });
    // The rings run counterclockwise seen from above, so from the field the
    // band's U runs right to left; mirror it so the text reads.
    ribbonMat.emissiveMap?.repeat.set(-1, 1);
    const suiteMap = suiteTexture();
    suiteMap.repeat.set(-1, 1);
    const suiteMat = ctx.mat({
        color: 0xffffff,
        map: suiteMap,
        emissive: 0xffffff,
        emissiveMap: suiteMap,
        emissiveIntensity: 0.75,
        roughness: 0.18,
        metalness: 0.2,
        side: DoubleSide,
    });

    const g = PRO_SUITE_GLASS;
    const suiteFront = lower.back + g.inset;
    const concrete = [
        ...bowl.risers,
        // The suites' front ledge, where the press box camera stands.
        { a: ring(lower.back, g.bottom), b: ring(suiteFront, g.bottom) },
        {
            a: ring(lower.back - g.inset, SUITE_CEILING),
            b: ring(upper.offset + g.inset * 2, SUITE_CEILING),
        },
    ];
    const side = { side: DoubleSide };
    const treads = ctx.addMesh(
        bandGeometry(bowl.treads),
        ctx.mat({ map: seatTexture(), roughness: 0.8, ...side }),
        "pro.treads",
    );
    ctx.addMesh(
        bandGeometry(concrete),
        shared.std(CONCRETE, { roughness: 0.95, ...side }),
        "pro.concrete",
    );
    // The field-level LED wall, just in front of the lower bowl's front wall.
    const fieldWall: RingPair = {
        a: ring(-0.05, 0.25),
        b: ring(-0.05, 1.15),
        tile: 7.2,
    };
    ctx.addMesh(
        bandGeometry([...bowl.fascia, fieldWall]),
        ribbonMat,
        "pro.fascia",
    );
    ctx.addMesh(
        bandGeometry([
            {
                a: ring(suiteFront, g.bottom),
                b: ring(suiteFront, g.top),
                tile: 36,
            },
        ]),
        suiteMat,
        "pro.suites",
    );

    const vom = addVomitories(ctx, lower);
    const seatRows = splitRows(bowl.seatRows, vom);
    return { lower, upper, treads, seatRows };
}

/** Each ring part's kind, first section index and section count. */
function sectionParts(layout: SectionLayout) {
    const out: { kind: "x" | "z" | "arc"; first: number; count: number }[] =
        [];
    let k = 0;
    for (const part of RING_PARTS) {
        const count = part.segments / layout[part.kind];
        out.push({ kind: part.kind, first: k, count });
        k += count;
    }
    return out;
}

/**
 * Vomitories in the lower bowl: a concrete block over a tunnel mouth that
 * faces the field, with rails, in the second section from each end of a
 * sideline, the middle two sections of each corner and both sections of
 * each end. Returns the sections that have one.
 */
function addVomitories(ctx: ProContext, lower: BuiltTier): Set<number> {
    const { ring } = ctx;
    const members = new Members();
    const { starts } = ringSections(PRO_LOWER_SECTIONS);
    const sections = new Set<number>();
    for (const part of sectionParts(PRO_LOWER_SECTIONS))
        for (let i = 0; i < part.count; i++) {
            const pick =
                part.kind === "x"
                    ? i === 1 || i === part.count - 2
                    : part.kind === "arc"
                      ? i === 1 || i === 2
                      : true;
            if (pick) sections.add(part.first + i);
        }
    const { firstRow, lastRow, width } = PRO_VOMITORY;
    const d0 = lower.offset + firstRow * lower.depth;
    const d1 = lower.offset + (lastRow + 1) * lower.depth;
    const h0 = lower.base + (firstRow - 1) * lower.rise;
    const h1 = lower.base + lastRow * lower.rise + 0.25;
    const r0 = ring(d0, 0);
    const r1 = ring(d1, 0);
    const n = r0.length;
    const at = (r: Vector3[], mid: number) => {
        const i = Math.floor(mid);
        return new Vector3().lerpVectors(r[i % n], r[(i + 1) % n], mid - i);
    };
    for (const k of sections) {
        const s = starts[k];
        const e = k + 1 < starts.length ? starts[k + 1] : n;
        const front = at(r0, (s + e) / 2);
        const back = at(r1, (s + e) / 2);
        const out = new Vector3().subVectors(back, front).normalize();
        const yaw = Math.atan2(out.x, out.z);
        const center = new Vector3()
            .addVectors(front, back)
            .multiplyScalar(0.5);
        const side = new Vector3(out.z, 0, -out.x);
        const depth = d1 - d0;
        // The opening: dark, with the tunnel mouth facing the field.
        members.box(
            center.clone().setY((h0 + h1) / 2 - 0.05),
            [width, h1 - h0 - 0.1, depth],
            0x0c0d10,
            yaw,
        );
        // Concrete side walls, and a rail along each and across the front.
        for (const sx of [-1, 1]) {
            const wall = center
                .clone()
                .addScaledVector(side, sx * (width / 2 + 0.15));
            members.box(
                wall.clone().setY((h0 + h1) / 2),
                [0.3, h1 - h0, depth],
                CONCRETE,
                yaw,
            );
            members.box(
                wall.setY(h1 + 0.9),
                [0.06, 0.06, depth],
                RAIL,
                yaw,
            );
        }
        members.box(
            front.clone().addScaledVector(out, 0.1).setY(h1 + 0.9),
            [width + 0.6, 0.06, 0.06],
            RAIL,
            yaw,
        );
    }
    const mesh = members.build(
        ctx.shared.unitBox,
        ctx.shared.std(0xffffff, { roughness: 0.9 }),
        "pro.vomitories",
    );
    mesh.receiveShadow = true;
    ctx.root.add(mesh);
    ctx.own(() => mesh.dispose());
    return sections;
}

/** Splits the closed bowl rows into per-section rows with aisle gaps. */
function splitRows(rows: SeatRow[], vomSections: Set<number>): SeatRow[] {
    const lowerRows = PRO_TIERS[0].rows;
    const lower = ringSections(PRO_LOWER_SECTIONS).starts;
    const upper = ringSections(PRO_UPPER_SECTIONS).starts;
    const { firstRow, lastRow, width } = PRO_VOMITORY;
    return rows.flatMap((row, i) =>
        splitSeatRow(row, {
            starts: i < lowerRows ? lower : upper,
            halfAisle: PRO_AISLE / 2,
            gaps:
                i >= firstRow && i <= lastRow
                    ? { sections: vomSections, width: width + 0.8 }
                    : undefined,
        }),
    );
}

/** Segment range of the side-1 end straight on a bowl outline ring. */
function side1EndSegments(): [number, number] {
    let i = 0;
    for (let p = 0; p < 6; p++) i += RING_PARTS[p].segments;
    return [i, i + RING_PARTS[6].segments];
}

/**
 * The building's outer wall, one band around everything: brick and glass
 * outside, dark panels with a lit concourse strip and clerestory inside, and
 * a great window wall at the side-1 end above the upper deck.
 */
function addShell(ctx: ProContext, upper: BuiltTier) {
    const { shell } = ctx;
    const H = FACADE_LAYOUT.height;
    const n = shell(0, 0).length;
    const [w0, w1] = side1EndSegments();
    const winBottom = FACADE_LAYOUT.brick + 1.4;
    const winTop = FACADE_LAYOUT.glass;
    const v = (y: number) => y / H;
    const tile = ft(80);
    const wall = new BandBuilder()
        .slice(shell(0, 0), shell(0, H), w1, n + w0, { tile })
        .slice(shell(0, 0), shell(0, winBottom), w0, w1, {
            tile,
            v1: v(winBottom),
        })
        .slice(shell(0, winTop), shell(0, H), w0, w1, { tile, v0: v(winTop) })
        .build();
    const facade = facadeTextures();
    const outsideMat = ctx.mat({
        map: facade.map,
        emissive: 0xffffff,
        emissiveMap: facade.emissive,
        emissiveIntensity: 0,
        roughness: 0.85,
    });
    const rimTop = upper.top + ft(4);
    const inside = interiorWallTextures(rimTop);
    const insideMat = ctx.mat({
        map: inside.map,
        emissive: 0xffffff,
        emissiveMap: inside.emissive,
        emissiveIntensity: 0.9,
        roughness: 0.8,
        side: BackSide,
    });
    ctx.addMesh(wall, outsideMat, "pro.facade");
    // The upper concourse's roof, from the deck's back rim to the wall, so
    // the corners read as building from above.
    ctx.addMesh(
        bandGeometry([
            {
                a: ctx.shell(0, rimTop),
                b: ctx.ring(upper.back, rimTop),
            },
        ]),
        ctx.shared.std(0x6f737a, { roughness: 0.95, side: DoubleSide }),
        "pro.concourseRoof",
    );
    // The same geometry seen from inside (addMesh would free it twice).
    const interior = new Mesh(wall, insideMat);
    interior.name = "pro.interiorWall";
    interior.receiveShadow = true;
    ctx.root.add(interior);

    const glass = ctx.addMesh(
        new BandBuilder()
            .slice(shell(0, winBottom), shell(0, winTop), w0, w1, { tile })
            .build(),
        ctx.mat({
            color: 0xffffff,
            map: windowWallTexture(),
            transparent: true,
            depthWrite: false,
            roughness: 0.08,
            metalness: 0.25,
            side: DoubleSide,
        }),
        "pro.windowWall",
        false,
    );
    glass.receiveShadow = false;
    return {
        setNight(on: boolean) {
            outsideMat.emissiveIntensity = on ? 1 : 0;
        },
    };
}

/** One geometry from several bands, one material group per band. */
function grouped(parts: BandBuilder[]): BufferGeometry {
    const pos: number[] = [];
    const uv: number[] = [];
    const geo = new BufferGeometry();
    parts.forEach((p, i) => {
        geo.addGroup(pos.length / 3, p.pos.length / 3, i);
        pos.push(...p.pos);
        uv.push(...p.uv);
    });
    geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    return geo;
}

/**
 * The roof: a fixed frame from the outer wall to the opening (membrane on
 * top, steel deck underneath), two standing-seam panels that slide over the
 * ends, and lights on the opening's edges. `setLighting` sets the panels'
 * target from the preset; `step` eases them toward it.
 */
function addRoof(ctx: ProContext) {
    const { cx, cz, ox, oz, shell } = ctx;
    const group = new Group();
    group.name = "pro.roof";
    const top = PRO_ROOF_Y + ROOF_THICKNESS / 2;
    const bottom = PRO_ROOF_Y - ROOF_THICKNESS / 2;
    const opening = bowlOutline({
        centerX: cx,
        centerZ: cz,
        halfX: ox,
        halfZ: oz,
        cornerRadius: 0,
    });
    const n = shell(0, 0).length;
    const underMat = ctx.mat({
        map: roofUndersideTexture(),
        roughness: 0.9,
        side: DoubleSide,
    });
    const frameGeo = grouped([
        new BandBuilder().slice(shell(0, top), opening(0, top), 0, n, {
            tile: 30,
            v1: 2,
        }),
        new BandBuilder()
            .slice(opening(0, bottom), shell(0, bottom), 0, n, {
                tile: 24,
                v1: 3,
            })
            .slice(opening(0, top), opening(0, bottom), 0, n, {
                tile: 24,
                v1: 0.05,
            }),
    ]);
    ctx.own(() => frameGeo.dispose());
    const frame = new Mesh(frameGeo, [
        ctx.mat({
            map: roofTopTexture(false),
            roughness: 0.75,
            side: DoubleSide,
        }),
        underMat,
    ]);
    frame.name = "pro.roofFrame";
    frame.castShadow = ctx.shadows;
    frame.receiveShadow = true;
    group.add(frame);

    // Panels: a unit box scaled to size, standing seam on top and sides and
    // steel deck below. UVs are scaled so the textures keep their size.
    const panelGeo = new BoxGeometry(1, 1, 1);
    ctx.own(() => panelGeo.dispose());
    const uv = panelGeo.getAttribute("uv");
    for (const face of [2, 3])
        for (let k = face * 4; k < face * 4 + 4; k++)
            uv.setXY(k, (uv.getX(k) * ox) / 24, (uv.getY(k) * 2 * oz) / 24);
    panelGeo.clearGroups();
    panelGeo.addGroup(0, 18, 0);
    panelGeo.addGroup(18, 6, 1);
    panelGeo.addGroup(24, 12, 0);
    const panelMat = ctx.mat({
        map: roofTopTexture(true),
        roughness: 0.5,
        metalness: 0.3,
    });
    // Panels reach down into the frame so no daylight shows between them.
    const panelTop = PRO_ROOF_Y + PANEL_LIFT + ROOF_THICKNESS / 2;
    const panelBottom = PRO_ROOF_Y - ROOF_THICKNESS / 2 + 0.05;
    const panels = [-1, 1].map((sx) => {
        const m = new Mesh(panelGeo, [panelMat, underMat]);
        m.name = "pro.roofPanel";
        m.scale.set(ox, panelTop - panelBottom, 2 * oz);
        m.position.set(cx + (sx * ox) / 2, (panelTop + panelBottom) / 2, cz);
        m.castShadow = ctx.shadows;
        m.receiveShadow = true;
        group.add(m);
        return m;
    });
    const panelX0 = panels.map((p) => p.position.x);
    const lights = addRoofLights(ctx, group);
    ctx.root.add(group);

    // 1 is open (panels over the fixed frame), 0 is closed.
    let open = 0;
    let target = 0;
    const place = () =>
        panels.forEach((p, i) => {
            p.position.x = panelX0[i] + (i ? 1 : -1) * ox * open;
        });
    return {
        group,
        setLighting(preset: LightingPreset, snap: boolean) {
            const k = lightingValues(preset).kit;
            lights.set(k.barEmissive, k.roofSpotIntensity);
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

/** Height of the long-span trusses' bottom chord. */
const superChordY = () =>
    PRO_ROOF_Y - ROOF_THICKNESS / 2 - 0.3 - SUPER_TRUSS_DEPTH;

/**
 * Light fixtures (one instanced mesh in the roof group) in rows under the
 * long-span trusses and across the opening's ends, and six spots on the
 * opening's edges that light the field.
 */
function addRoofLights(ctx: ProContext, roof: Group) {
    const { shared, cx, cz, ox, oz } = ctx;
    const barMat = shared.std(0x9ea3aa, {
        emissive: 0xfff4e2,
        emissiveIntensity: 0,
    });
    const chord = superChordY();
    const fixtures = new Members();
    for (const sz of [-1, 1])
        for (let x = -ox; x <= ox + 0.01; x += 6)
            fixtures.box(
                new Vector3(cx + x, chord - 0.8, cz + sz * oz),
                [1.8, 0.45, 1.2],
                0xffffff,
            );
    for (const sx of [-1, 1])
        for (let z = -oz + 6; z <= oz - 6 + 0.01; z += 6)
            fixtures.box(
                new Vector3(cx + sx * ox, chord + 2, cz + z),
                [1.2, 0.45, 1.8],
                0xffffff,
            );
    const bars = fixtures.build(shared.unitBox, barMat, "pro.roofBar");
    roof.add(bars);
    ctx.own(() => bars.dispose());

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
        const spot = new SpotLight(0xfff3e0, 0, 0, 0.7, 0.6, 0);
        spot.name = "pro.roofSpot";
        spot.position.set(cx + x, chord - 1, cz + z);
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
 * Roof steel: two long-span box trusses along the opening's long edges
 * (they carry the panels, as at Lucas Oil), cross trusses every 18 m and at
 * the opening's ends, a secondary truss over each sideline, and speaker
 * clusters under the long-span trusses. Skips the boards' planes.
 */
function addTrusses(ctx: ProContext, boardXs: number[]): void {
    const { cx, cz, rx, rz, ox, oz, members } = ctx;
    const topY = PRO_ROOF_Y - ROOF_THICKNESS / 2 - 0.3;
    const reachX = rx - FACADE_CORNER - 1;
    const reachZ = rz - FACADE_CORNER - 1;
    const P = (x: number, z: number, y = topY) =>
        new Vector3(cx + x, y, cz + z);

    // Long-span box trusses: two faces 3.2 m apart, tied at every node.
    const bay = 7;
    const span = 2 * rx - 4;
    const bays = Math.round(span / bay);
    for (const sz of [-1, 1]) {
        const z = sz * oz;
        for (const f of [-1.6, 1.6])
            members.truss(
                P(-rx + 2, z + f),
                P(rx - 2, z + f),
                SUPER_TRUSS_DEPTH,
                bay,
                1.1,
                0.55,
                STEEL,
            );
        for (let i = 0; i <= bays; i++) {
            const x = -rx + 2 + (span * i) / bays;
            for (const y of [topY, topY - SUPER_TRUSS_DEPTH])
                members.beam(P(x, z - 1.6, y), P(x, z + 1.6, y), 0.4, STEEL);
        }
        // Speaker clusters over the sidelines.
        const y = topY - SUPER_TRUSS_DEPTH;
        for (const x of [-ox * 0.55, 0, ox * 0.55]) {
            members.beam(P(x, z, y), P(x, z, y - 3.2), 0.12, RAIL);
            members.box(P(x, z, y - 5), [2.6, 3.6, 2.6], DARK);
        }
    }

    // Cross trusses over the end and sideline stands.
    const clear = (x: number) =>
        boardXs.every((b) => Math.abs(cx + x - b) > 4.5);
    const xs = new Set<number>([-ox, ox]);
    for (let x = 0; x <= reachX; x += 18) xs.add(x).add(-x);
    for (const x of xs) {
        if (Math.abs(x) > reachX || !clear(x)) continue;
        const atEnd = Math.abs(Math.abs(x) - ox) < 0.01;
        const depth = atEnd ? 6 : TRUSS_DEPTH;
        if (Math.abs(x) < ox - 0.01)
            for (const sz of [-1, 1])
                members.truss(
                    P(x, sz * (oz + 1.6)),
                    P(x, sz * reachZ),
                    depth,
                    6,
                    0.6,
                    0.3,
                    STEEL,
                );
        else
            members.truss(
                P(x, -reachZ),
                P(x, reachZ),
                depth,
                6,
                0.6,
                0.3,
                STEEL,
            );
    }
    // A secondary truss along each sideline, halfway out to the wall.
    for (const sz of [-1, 1]) {
        const z = sz * (oz + (rz - oz) / 2);
        members.truss(
            P(-reachX, z),
            P(reachX, z),
            TRUSS_DEPTH,
            6,
            0.6,
            0.3,
            STEEL,
        );
    }
}

/**
 * End-zone video boards hung from the roof on four rods with a catwalk on
 * top, kept clear of the seats, showing a show graphic in the home color.
 * Returns their x positions.
 */
function addBoards(
    ctx: ProContext,
    upper: BuiltTier,
    params: VenueParams,
): number[] {
    const offset = boardClearOffset(upper);
    const title = params.endZoneText || "OPENMARCH";
    const roofBottom = PRO_ROOF_Y - ROOF_THICKNESS / 2;
    const topY = PRO_BOARD.y + PRO_BOARD.height / 2 + ft(2);
    return [-1, 1].map((sx) => {
        const b = videoBoard(
            PRO_BOARD.width,
            PRO_BOARD.height,
            0,
            title,
            "3D View",
            ctx.shared,
        );
        b.setTexture(boardScreenTexture(title, params.homeColor));
        const x = ctx.cx + sx * (ctx.ax + offset);
        b.object.position.set(x, PRO_BOARD.y, ctx.cz);
        b.object.rotation.y = (-sx * Math.PI) / 2;
        b.object.traverse((o) => (o.castShadow = ctx.shadows && o.castShadow));
        ctx.root.add(b.object);
        ctx.own(() => b.dispose());
        for (const f of [-0.42, -0.14, 0.14, 0.42]) {
            const z = ctx.cz + f * PRO_BOARD.width;
            ctx.members.beam(
                new Vector3(x, topY, z),
                new Vector3(x, roofBottom, z),
                0.15,
                RAIL,
            );
        }
        ctx.members.box(
            new Vector3(x + sx * 0.4, topY + 0.25, ctx.cz),
            [1.4, 0.3, PRO_BOARD.width + ft(4)],
            0x2a2c31,
        );
        return x;
    });
}

/**
 * Downtown beyond the window wall at the side-1 end: a cluster of towers
 * (one instanced mesh) whose windows light up at night.
 */
function addSkyline(ctx: ProContext) {
    const { cx, cz, rx, shared } = ctx;
    const tex = towerTextures();
    const mat = ctx.mat({
        map: tex.map,
        emissive: 0xffffff,
        emissiveMap: tex.emissive,
        emissiveIntensity: 0,
        roughness: 0.6,
        metalness: 0.2,
    });
    const rnd = createRng(23);
    const towers = new Members();
    const count = ctx.quality === "low" ? 10 : 22;
    const tints = [0xffffff, 0xdfe6ee, 0xcfd3d8, 0xb9c4cf];
    for (let i = 0; i < count; i++) {
        const dist = 260 + rnd() * 420;
        const z = (rnd() - 0.5) * (240 + dist * 0.9);
        const w = 22 + rnd() * 26;
        const h = 45 + rnd() * rnd() * 170;
        towers.box(
            new Vector3(cx - rx - dist, h / 2 - 0.1, cz + z),
            [w, h, w * (0.7 + rnd() * 0.5)],
            tints[i % tints.length],
            (rnd() - 0.5) * 0.4,
        );
    }
    const mesh = towers.build(shared.unitBox, mat, "pro.skyline");
    ctx.root.add(mesh);
    ctx.own(() => mesh.dispose());
    return {
        setNight(on: boolean) {
            mat.emissiveIntensity = on ? 1.2 : 0;
        },
    };
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
        // In the middle of a section, not on an aisle.
        cam(
            "upperDeck",
            "seat",
            [cx + ft(77), upperRow.y, fz + upperRow.d],
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
