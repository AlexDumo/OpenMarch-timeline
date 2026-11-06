// cspell:ignore metalness vomitory
import {
    AdditiveBlending,
    BufferGeometry,
    Color,
    CylinderGeometry,
    DirectionalLight,
    DoubleSide,
    Float32BufferAttribute,
    Group,
    HemisphereLight,
    InstancedMesh,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    PlaneGeometry,
    PointLight,
    Quaternion,
    SpotLight,
    Uint16BufferAttribute,
    Vector3,
    type Object3D,
    type Texture,
    type Vector3Tuple,
} from "three";
import {
    createSharedMaterials,
    lightingValues,
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
    RING_POINTS,
    bandGeometry,
    bowlOutline,
    bowlTiers,
    type BowlTier,
    type RingPair,
} from "./bowl";
import {
    BANNER_CELLS,
    arenaFloorTexture,
    arenaRibbonTexture,
    bannerAtlasTexture,
    beamTexture,
    scoreboardTexture,
    underboardTexture,
    seatTexture,
    tunnelGlowTexture,
} from "./arena/textures";

/**
 * Indoor arena (UD Arena style): a steep two-bowl college basketball arena
 * around a hardwood floor, with a concourse between the bowls, an LED ribbon
 * on the upper fascia and around the floor, a center-hung scoreboard, a dark
 * roof with catwalks and a lighting truss, championship banners, a performer
 * tunnel at the back and the judges' table on the floor in front of the
 * front-side seats. The tarp is the field surface; the floor sits at y = 0.
 *
 * Front is +z (the audience side), like every kit. The bowl is a rounded
 * rectangle around the footprint.
 */

/** Gap between the footprint and the lower bowl's first row, on every side. */
export const ARENA_FLOOR_MARGIN = 7.5;
export const ARENA_MIN_HALF_X = 24;
export const ARENA_MIN_HALF_Z = 17;
export const ARENA_CORNER_RADIUS = 16;

export const ARENA_LOWER: BowlTier = {
    offset: 0,
    rows: 18,
    depth: 0.82,
    rise: 0.46,
    base: 1,
    bottom: 0,
    fascia: true,
    side: "neutral",
};
/** Height of the concourse floor, level with the lower bowl's top row. */
export const ARENA_CONCOURSE_Y = ARENA_LOWER.base + 17 * ARENA_LOWER.rise;
export const ARENA_CONCOURSE_WIDTH = 4.5;
const LOWER_BACK = ARENA_LOWER.rows * ARENA_LOWER.depth;
export const ARENA_UPPER: BowlTier = {
    offset: LOWER_BACK + ARENA_CONCOURSE_WIDTH,
    rows: 15,
    depth: 0.78,
    rise: 0.6,
    base: ARENA_CONCOURSE_Y + 2.6,
    bottom: ARENA_CONCOURSE_Y,
    fascia: true,
    side: "neutral",
};
const UPPER_BACK = ARENA_UPPER.offset + ARENA_UPPER.rows * ARENA_UPPER.depth;
const UPPER_TOP = ARENA_UPPER.base + (ARENA_UPPER.rows - 1) * ARENA_UPPER.rise;
const RIM = 1.22;
/** Where the walls end and the roof starts. */
export const ARENA_WALL_TOP = 27.5;
export const ARENA_ROOF_PEAK = 34;
const EYE_ABOVE_TREAD = 1.22;
/** Seats at this width per tile of the seat texture. */
const SEAT_WIDTH = 0.52;
/** Quads per seating section and the last of them is the aisle. */
const SECTION_QUADS = 8;

const TUNNEL_HALF_WIDTH = 3.2;
const TUNNEL_HEIGHT = 3.4;
const TUNNEL_DEPTH = 4.5;
const TUNNEL_ROWS = 6;

const BANNER_LABELS: [string, string, string][] = [
    ["WORLD", "CLASS", "FINALIST"],
    ["OPEN", "CLASS", "CHAMPION"],
    ["WINTER", "GUARD", "2025"],
    ["INDOOR", "PERCUSSION", "2025"],
    ["REGIONAL", "FINALIST", "2024"],
    ["STATE", "CHAMPION", "2025"],
];

const m4 = new Matrix4();
const quat = new Quaternion();
const pos = new Vector3();
const scl = new Vector3();
const UP = new Vector3(0, 1, 0);
const place = (
    mesh: InstancedMesh,
    i: number,
    p: Vector3Tuple,
    s: Vector3Tuple,
): void => {
    m4.compose(pos.set(...p), quat.identity(), scl.set(...s));
    mesh.setMatrixAt(i, m4);
};

/** Per-preset values the arena owns (the shared presets cover lights). */
interface ArenaLook {
    screens: number;
    ribbon: number;
    rail: number;
    beams: number;
    glow: number;
    fixtures: number;
    lamps: number;
    bowl: number;
}
const LOOKS: Record<"house" | "show", ArenaLook> = {
    house: {
        screens: 0.85,
        ribbon: 0.7,
        rail: 0.7,
        beams: 0,
        glow: 0,
        fixtures: 1,
        lamps: 0.4,
        bowl: 0.55,
    },
    show: {
        screens: 1.7,
        ribbon: 1.5,
        rail: 1.6,
        beams: 0.2,
        glow: 1,
        fixtures: 0.05,
        lamps: 1,
        bowl: 0.5,
    },
};

/** Rotates a closed seat row and cuts the tunnel's gap out of it. */
function cutTunnel(row: SeatRow, cx: number, cz: number): SeatRow {
    const pts = row.points;
    const gap = (p: Vector3Tuple) =>
        Math.abs(p[0] - cx) < TUNNEL_HALF_WIDTH + 0.5 && p[2] < cz;
    const first = pts.findIndex(gap);
    if (first < 0) return row;
    let last = first;
    while (last + 1 < pts.length && gap(pts[last + 1])) last++;
    return {
        ...row,
        closed: false,
        points: [...pts.slice(last + 1), ...pts.slice(0, first)],
    };
}

/**
 * Tints each seating quad: sections of seven seats and an aisle, colored by
 * row. Aisle quads sample a flat gray strip of the seat texture.
 */
function colorTreads(
    geo: BufferGeometry,
    rows: number,
    rowColor: (row: number, section: number, quad: number) => Color,
    aisle: Color,
): void {
    const quads = rows * RING_POINTS;
    const color = new Float32Array(quads * 6 * 3);
    const uv = geo.getAttribute("uv");
    for (let q = 0; q < quads; q++) {
        const row = Math.floor(q / RING_POINTS);
        const i = q % RING_POINTS;
        const isAisle = i % SECTION_QUADS === SECTION_QUADS - 1;
        const c = isAisle
            ? aisle
            : rowColor(row, Math.floor(i / SECTION_QUADS), i);
        for (let k = 0; k < 6; k++) {
            const v = q * 6 + k;
            color.set([c.r, c.g, c.b], v * 3);
            if (isAisle) uv.setXY(v, 0.5, 0.04);
        }
    }
    geo.setAttribute("color", new Float32BufferAttribute(color, 3));
    uv.needsUpdate = true;
}

export const buildArena: KitBuilder = ({ footprint, params, quality }) => {
    const fp = footprint;
    const cx = (fp.minX + fp.maxX) / 2;
    const cz = (fp.minZ + fp.maxZ) / 2;
    const w = fp.maxX - fp.minX;
    const d = fp.maxZ - fp.minZ;
    const halfX = Math.max(ARENA_MIN_HALF_X, w / 2 + ARENA_FLOOR_MARGIN);
    const halfZ = Math.max(ARENA_MIN_HALF_Z, d / 2 + ARENA_FLOOR_MARGIN);
    const cornerRadius = Math.min(ARENA_CORNER_RADIUS, halfZ * 0.7);
    const outline = bowlOutline({
        centerX: cx,
        centerZ: cz,
        halfX,
        halfZ,
        cornerRadius,
    });
    const hostName = params.endZoneText || "OPENMARCH";
    const accent = params.homeColor;

    const shared: SharedMaterials = createSharedMaterials();
    const { std, unitBox } = shared;
    const geometries: { dispose(): void }[] = [];
    const materials: { dispose(): void }[] = [];
    const textures: Texture[] = [];
    const root = new Group();
    root.name = "arena";
    /** Everything that hangs from the roof; hidden when the camera is above it. */
    const ceiling = new Group();
    ceiling.name = "arena-ceiling";
    root.add(ceiling);

    const keep = <T extends { dispose(): void }>(
        list: { dispose(): void }[],
        item: T,
    ): T => {
        list.push(item);
        return item;
    };
    const geo = <T extends BufferGeometry>(g: T): T => keep(geometries, g);
    const own = (t: Texture): Texture => keep(textures, t);
    const mesh = (
        g: BufferGeometry,
        m: Mesh["material"],
        name: string,
        parent: Object3D = root,
    ): Mesh => {
        const o = new Mesh(geo(g), m);
        o.name = name;
        parent.add(o);
        return o;
    };
    const emissiveMat = (
        map: Texture,
        extra: { side?: typeof DoubleSide } = {},
    ): MeshStandardMaterial => {
        const m = keep(
            materials,
            new MeshStandardMaterial({
                color: 0x000000,
                emissive: 0xffffff,
                emissiveMap: map,
                emissiveIntensity: 1,
                ...extra,
            }),
        );
        return m;
    };

    // Floor: sealed hardwood inside the lower bowl's front edge.
    const fx0 = cx - halfX;
    const fz0 = cz - halfZ;
    const floorTex = own(
        arenaFloorTexture({
            minX: fx0,
            maxX: cx + halfX,
            minZ: fz0,
            maxZ: cz + halfZ,
            footprint: fp,
            accent,
        }),
    );
    {
        const ring = outline(0, 0);
        const p: number[] = [cx, 0, cz];
        const uv: number[] = [0.5, 0.5];
        for (const v of ring) {
            p.push(v.x, 0, v.z);
            uv.push((v.x - fx0) / (2 * halfX), 1 - (v.z - fz0) / (2 * halfZ));
        }
        const idx: number[] = [];
        for (let i = 0; i < ring.length; i++)
            idx.push(0, 1 + ((i + 1) % ring.length), 1 + i);
        const g = new BufferGeometry();
        g.setAttribute("position", new Float32BufferAttribute(p, 3));
        g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
        g.setIndex(new Uint16BufferAttribute(idx, 1));
        g.computeVertexNormals();
        const floor = mesh(
            g,
            std(0xffffff, {
                map: floorTex,
                roughness: 0.32,
                metalness: 0.05,
                side: DoubleSide,
            }),
            "arena-floor",
        );
        floor.receiveShadow = quality === "high";
    }

    // The bowls.
    const lowerBowl = bowlTiers(outline, [ARENA_LOWER], {
        rim: RIM,
        soffitDrop: 0,
        fasciaTile: 0.9 * 32,
    });
    const upperBowl = bowlTiers(outline, [ARENA_UPPER], {
        rim: RIM,
        soffitDrop: 0,
        fasciaTile: 2.6 * 12.8,
    });
    const seatMap = own(seatTexture());
    const seatMat = std(0xffffff, {
        map: seatMap,
        vertexColors: true,
        roughness: 0.78,
        side: DoubleSide,
    });
    const tread = (b: typeof lowerBowl): RingPair[] =>
        b.treads.map((t) => ({ ...t, tile: SEAT_WIDTH }));
    const lowerBlue = new Color(0x2c58c9);
    const lowerRed = new Color(0xc7313b);
    const upperRed = new Color(0xb92c36);
    const upperNavy = new Color(0x27397a);
    const aisleColor = new Color(0x8b8f9c);
    const shade = (c: Color, section: number): Color =>
        c.clone().multiplyScalar(section % 2 ? 1 : 0.92);
    const lowerGeo = bandGeometry(tread(lowerBowl));
    colorTreads(
        lowerGeo,
        ARENA_LOWER.rows,
        (row, section) =>
            shade(row < 12 ? lowerBlue : lowerRed, section + (row % 2)),
        aisleColor,
    );
    const upperGeo = bandGeometry(tread(upperBowl));
    colorTreads(
        upperGeo,
        ARENA_UPPER.rows,
        (row, section) =>
            shade(row < 10 ? upperRed : upperNavy, section + (row % 2)),
        aisleColor,
    );
    const lowerTreads = mesh(lowerGeo, seatMat, "arena-lower-seats");
    const upperTreads = mesh(upperGeo, seatMat, "arena-upper-seats");

    // Concrete: risers, back walls and the concourse floor and wall.
    const outerWall: RingPair = {
        a: outline(UPPER_BACK, UPPER_TOP + RIM),
        b: outline(UPPER_BACK, ARENA_WALL_TOP),
    };
    const concourseFloor: RingPair = {
        a: outline(LOWER_BACK, ARENA_CONCOURSE_Y),
        b: outline(ARENA_UPPER.offset, ARENA_CONCOURSE_Y),
    };
    mesh(
        bandGeometry([...lowerBowl.risers, ...upperBowl.risers]),
        std(0x2b2e3c, { roughness: 0.9, side: DoubleSide }),
        "arena-risers",
    );
    mesh(
        bandGeometry([concourseFloor]),
        std(0x3a3d4c, { roughness: 0.6, metalness: 0.1, side: DoubleSide }),
        "arena-concourse",
    );
    mesh(
        bandGeometry([outerWall]),
        std(0x2a2d3a, { roughness: 1, side: DoubleSide }),
        "arena-wall",
        ceiling,
    );

    // LED ribbons: the ad boards around the floor and the upper fascia.
    const courtRibbonTex = own(
        arenaRibbonTexture(hostName, [accent, "#c7313b"], false),
    );
    const upperRibbonTex = own(
        arenaRibbonTexture(hostName, ["#2c58c9", accent], true),
    );
    // The rings run counterclockwise from above; mirror U so text reads.
    courtRibbonTex.repeat.set(-1, 1);
    upperRibbonTex.repeat.set(-1, 1);
    const courtRibbonMat = emissiveMat(courtRibbonTex, { side: DoubleSide });
    const upperRibbonMat = emissiveMat(upperRibbonTex, { side: DoubleSide });
    mesh(bandGeometry(lowerBowl.fascia), courtRibbonMat, "arena-court-ribbon");
    mesh(bandGeometry(upperBowl.fascia), upperRibbonMat, "arena-ribbon");

    // Glowing handrails along the lower bowl's top and the concourse edge.
    const railMat = keep(
        materials,
        new MeshStandardMaterial({
            color: 0x000000,
            emissive: 0x6fa4ff,
            emissiveIntensity: 1,
            side: DoubleSide,
        }),
    );
    mesh(
        bandGeometry([
            {
                a: outline(LOWER_BACK, ARENA_CONCOURSE_Y + RIM),
                b: outline(LOWER_BACK, ARENA_CONCOURSE_Y + RIM + 0.12),
            },
            {
                a: outline(0.02, 1.0 + 0.02),
                b: outline(0.02, 1.0 + 0.1),
            },
        ]),
        railMat,
        "arena-rails",
    );

    // Seat rows for the crowd; the tunnel takes the lowest rows at the back.
    const seatRows: SeatRow[] = [
        ...lowerBowl.seatRows.map((r, i) =>
            i < TUNNEL_ROWS ? cutTunnel(r, cx, cz) : r,
        ),
        ...upperBowl.seatRows,
    ];

    // Performer tunnel: a dark housing with a lit portal at the back center.
    {
        const tz = cz - halfZ;
        const housing = new Mesh(unitBox, std(0x101118, { roughness: 0.9 }));
        housing.name = "arena-tunnel";
        housing.scale.set(
            TUNNEL_HALF_WIDTH * 2 + 1,
            TUNNEL_HEIGHT,
            TUNNEL_DEPTH,
        );
        housing.position.set(cx, TUNNEL_HEIGHT / 2, tz - TUNNEL_DEPTH / 2);
        root.add(housing);
        const glowTex = own(tunnelGlowTexture());
        const glow = mesh(
            new PlaneGeometry(TUNNEL_HALF_WIDTH * 2 - 0.4, TUNNEL_HEIGHT - 0.8),
            emissiveMat(glowTex),
            "arena-tunnel-glow",
        );
        glow.rotation.y = 0;
        glow.position.set(cx, (TUNNEL_HEIGHT - 0.8) / 2 + 0.05, tz + 0.04);
        const frameMat = keep(
            materials,
            new MeshBasicMaterial({ color: 0x6fa4ff }),
        );
        const frame = new InstancedMesh(unitBox, frameMat, 3);
        frame.name = "arena-tunnel-frame";
        place(
            frame,
            0,
            [cx, TUNNEL_HEIGHT - 0.35, tz + 0.07],
            [TUNNEL_HALF_WIDTH * 2, 0.12, 0.12],
        );
        place(
            frame,
            1,
            [cx - TUNNEL_HALF_WIDTH + 0.1, TUNNEL_HEIGHT / 2, tz + 0.07],
            [0.12, TUNNEL_HEIGHT - 0.7, 0.12],
        );
        place(
            frame,
            2,
            [cx + TUNNEL_HALF_WIDTH - 0.1, TUNNEL_HEIGHT / 2, tz + 0.07],
            [0.12, TUNNEL_HEIGHT - 0.7, 0.12],
        );
        root.add(frame);
        keep(geometries, { dispose: () => frame.dispose() });
    }

    // Judges' table on the floor in front of the front-side seats.
    const tableLength = Math.min(14, Math.max(8, w * 0.5));
    const tableZ = fp.maxZ + 3.4;
    const judgeCount = 6;
    const table = new InstancedMesh(
        unitBox,
        std(0xf1efe8, { roughness: 0.5 }),
        1,
    );
    table.name = "arena-judges-table";
    place(table, 0, [cx, 0.78, tableZ], [tableLength, 0.06, 0.9]);
    const skirt = new Mesh(unitBox, std(0x2a3f8a, { roughness: 0.9 }));
    skirt.name = "arena-judges-skirt";
    skirt.scale.set(tableLength - 0.1, 0.76, 0.82);
    skirt.position.set(cx, 0.38, tableZ);
    root.add(table, skirt);
    const chairs = new InstancedMesh(
        unitBox,
        std(0x15161d, { roughness: 0.8 }),
        judgeCount * 2,
    );
    chairs.name = "arena-judges-chairs";
    const laptops = new InstancedMesh(
        unitBox,
        std(0x20222c, { roughness: 0.5 }),
        judgeCount,
    );
    const lampMat = keep(materials, new MeshBasicMaterial({ color: 0xffc66b }));
    const lamps = new InstancedMesh(unitBox, lampMat, judgeCount);
    lamps.name = "arena-judges-lamps";
    laptops.name = "arena-judges-laptops";
    for (let i = 0; i < judgeCount; i++) {
        const x = cx + (i - (judgeCount - 1) / 2) * (tableLength / judgeCount);
        place(chairs, i * 2, [x, 0.46, tableZ + 1.35], [0.52, 0.06, 0.5]);
        place(chairs, i * 2 + 1, [x, 0.9, tableZ + 1.75], [0.5, 0.8, 0.06]);
        place(laptops, i, [x - 0.2, 0.84, tableZ + 0.05], [0.4, 0.04, 0.28]);
        place(lamps, i, [x + 0.35, 0.94, tableZ - 0.1], [0.07, 0.16, 0.07]);
    }
    root.add(chairs, laptops, lamps);

    // Roof: a shallow dark dome over the walls.
    {
        const rings = [
            outline(UPPER_BACK, ARENA_WALL_TOP),
            outline(UPPER_BACK - 8, ARENA_WALL_TOP + 2.6),
            outline(0, ARENA_ROOF_PEAK - 1.4),
        ];
        const g = bandGeometry([
            { a: rings[0], b: rings[1] },
            { a: rings[1], b: rings[2] },
        ]);
        const cap: number[] = [];
        const last = rings[2];
        for (let i = 0; i < last.length; i++) {
            const a = last[i];
            const b = last[(i + 1) % last.length];
            cap.push(a.x, a.y, a.z, b.x, b.y, b.z, cx, ARENA_ROOF_PEAK, cz);
        }
        const capGeo = new BufferGeometry();
        capGeo.setAttribute("position", new Float32BufferAttribute(cap, 3));
        capGeo.computeVertexNormals();
        const roofMat = std(0x2a2c38, {
            roughness: 1,
            emissive: 0x0b0c12,
            side: DoubleSide,
        });
        mesh(g, roofMat, "arena-roof", ceiling);
        mesh(capGeo, roofMat, "arena-roof-cap", ceiling);
    }

    // Catwalks and roof trusses: instanced steel beams.
    const steelMat = std(0x3b3e4c, { roughness: 0.7, metalness: 0.3 });
    {
        const zHalf = halfZ + UPPER_BACK - 6;
        const xHalf = halfX + UPPER_BACK - 6;
        const nBeamZ = Math.max(7, Math.round(xHalf / 4));
        const nBeamX = Math.max(4, Math.round(zHalf / 5));
        const beams = new InstancedMesh(unitBox, steelMat, nBeamZ + nBeamX + 2);
        beams.name = "arena-catwalks";
        let k = 0;
        for (let i = 0; i < nBeamZ; i++) {
            const x = cx + ((i + 0.5) / nBeamZ - 0.5) * 2 * xHalf * 0.9;
            place(beams, k++, [x, 29.4, cz], [0.6, 0.7, zHalf * 1.6]);
        }
        for (let i = 0; i < nBeamX; i++) {
            const z = cz + ((i + 0.5) / nBeamX - 0.5) * 2 * zHalf * 0.8;
            place(beams, k++, [cx, 29.0, z], [xHalf * 1.5, 0.6, 0.6]);
        }
        // Walkway rails along the roof perimeter.
        place(
            beams,
            k++,
            [cx, 28.4, cz - zHalf * 0.85],
            [xHalf * 1.6, 0.12, 1.2],
        );
        place(
            beams,
            k++,
            [cx, 28.4, cz + zHalf * 0.85],
            [xHalf * 1.6, 0.12, 1.2],
        );
        ceiling.add(beams);
        keep(geometries, { dispose: () => beams.dispose() });
    }

    // Lighting trusses over the floor, with their moving lights.
    const trussZ = [cz - halfZ * 0.5, cz + halfZ * 0.45];
    const trussY = 25.4;
    const moverCount = 8;
    const trussSpan = Math.min(halfX * 1.5, 40);
    {
        const trussMat = std(0x2a2d3a, { roughness: 0.5, metalness: 0.6 });
        const truss = new InstancedMesh(unitBox, trussMat, trussZ.length + 4);
        truss.name = "arena-truss";
        let k = 0;
        for (const z of trussZ) {
            place(truss, k++, [cx, trussY, z], [trussSpan * 2, 0.55, 0.55]);
        }
        // Hang cables from the catwalks.
        for (const z of trussZ) {
            for (const sx of [-1, 1]) {
                place(
                    truss,
                    k++,
                    [cx + sx * trussSpan * 0.85, (trussY + 29) / 2, z],
                    [0.06, 29 - trussY, 0.06],
                );
            }
        }
        ceiling.add(truss);
        keep(geometries, { dispose: () => truss.dispose() });
        const moverMat = std(0x0c0d12, { roughness: 0.5, metalness: 0.5 });
        const movers = new InstancedMesh(
            unitBox,
            moverMat,
            trussZ.length * moverCount,
        );
        movers.name = "arena-movers";
        const lensMat = keep(
            materials,
            new MeshBasicMaterial({ color: 0xcfe0ff }),
        );
        const lens = new InstancedMesh(
            unitBox,
            lensMat,
            trussZ.length * moverCount,
        );
        lens.name = "arena-mover-lenses";
        trussZ.forEach((z, r) => {
            for (let i = 0; i < moverCount; i++) {
                const x = cx + ((i + 0.5) / moverCount - 0.5) * trussSpan * 1.8;
                place(
                    movers,
                    r * moverCount + i,
                    [x, trussY - 0.65, z],
                    [0.5, 0.7, 0.5],
                );
                place(
                    lens,
                    r * moverCount + i,
                    [x, trussY - 1.02, z],
                    [0.34, 0.06, 0.34],
                );
            }
        });
        ceiling.add(movers, lens);
        keep(geometries, { dispose: () => movers.dispose() });
        keep(geometries, { dispose: () => lens.dispose() });
        lens.userData.lens = true;
    }

    // House fixtures: a grid over the floor and a ring over the upper bowl.
    const fixtureMat = std(0x222222, {
        emissive: 0xfff2dc,
        emissiveIntensity: lightingValues("house").kit.panelEmissive,
    });
    {
        const ring = outline(UPPER_BACK - 5, 28);
        const stride = 4;
        const nRing = Math.floor(ring.length / stride);
        const nx = 6;
        const nz = 3;
        const fixtures = new InstancedMesh(
            unitBox,
            fixtureMat,
            nRing + nx * nz,
        );
        fixtures.name = "arena-fixtures";
        let k = 0;
        for (let i = 0; i < nRing; i++) {
            const p = ring[i * stride];
            place(fixtures, k++, [p.x, 27.6, p.z], [1.0, 0.25, 1.0]);
        }
        for (let i = 0; i < nx; i++) {
            for (let j = 0; j < nz; j++) {
                place(
                    fixtures,
                    k++,
                    [
                        cx + ((i + 0.5) / nx - 0.5) * halfX * 1.6,
                        28.3,
                        cz + ((j + 0.5) / nz - 0.5) * halfZ * 1.4,
                    ],
                    [1.1, 0.25, 1.1],
                );
            }
        }
        ceiling.add(fixtures);
        keep(geometries, { dispose: () => fixtures.dispose() });
    }

    // Scoreboard: four video walls and an LED underside, hung on cables.
    const board = new Group();
    board.name = "arena-scoreboard";
    const boardY = 19;
    const bw = 11;
    const bd = 7.6;
    const bh = 4.6;
    board.position.set(cx, boardY, cz);
    const screenMats: MeshStandardMaterial[] = [];
    {
        const body = new Mesh(
            unitBox,
            std(0x14151c, { roughness: 0.5, metalness: 0.5 }),
        );
        body.scale.set(bw, bh, bd);
        body.name = "arena-scoreboard-body";
        board.add(body);
        const mainTex = own(
            scoreboardTexture(hostName, "CHAMPIONSHIP FINALS", accent),
        );
        const endTex = own(scoreboardTexture(hostName, "LIVE", "#c7313b"));
        const sides: {
            w: number;
            tex: Texture;
            rotY: number;
            at: Vector3Tuple;
        }[] = [
            { w: bw - 0.7, tex: mainTex, rotY: 0, at: [0, 0, bd / 2 + 0.03] },
            {
                w: bw - 0.7,
                tex: mainTex,
                rotY: Math.PI,
                at: [0, 0, -bd / 2 - 0.03],
            },
            {
                w: bd - 0.7,
                tex: endTex,
                rotY: Math.PI / 2,
                at: [bw / 2 + 0.03, 0, 0],
            },
            {
                w: bd - 0.7,
                tex: endTex,
                rotY: -Math.PI / 2,
                at: [-bw / 2 - 0.03, 0, 0],
            },
        ];
        for (const s of sides) {
            const m = emissiveMat(s.tex);
            screenMats.push(m);
            const screen = mesh(
                new PlaneGeometry(s.w, bh - 0.8),
                m,
                "arena-screen",
                board,
            );
            screen.rotation.y = s.rotY;
            screen.position.set(...s.at);
        }
        const underMat = emissiveMat(own(underboardTexture()));
        screenMats.push(underMat);
        const under = mesh(
            new PlaneGeometry(bw - 1, bd - 1),
            underMat,
            "arena-scoreboard-under",
            board,
        );
        under.rotation.x = Math.PI / 2;
        under.position.y = -bh / 2 - 0.03;
        // Cables up to the catwalks.
        const cables = new InstancedMesh(unitBox, steelMat, 4);
        for (let i = 0; i < 4; i++) {
            const sx = i % 2 ? 1 : -1;
            const sz = i < 2 ? 1 : -1;
            place(
                cables,
                i,
                [sx * bw * 0.4, (29 - boardY + bh / 2) / 2, sz * bd * 0.4],
                [0.08, 29 - boardY - bh / 2, 0.08],
            );
        }
        board.add(cables);
        keep(geometries, { dispose: () => cables.dispose() });
        ceiling.add(board);
    }

    // Banners hung on the back and end walls.
    {
        const bannerW = 3.4;
        const bannerH = 5.2;
        const pos3: number[] = [];
        const uv: number[] = [];
        const normals: number[] = [];
        const atlas = own(bannerAtlasTexture(BANNER_LABELS));
        const wallInset = 0.15;
        const quad = (
            center: Vector3Tuple,
            rotY: number,
            cell: number,
        ): void => {
            const c = Math.cos(rotY);
            const s = Math.sin(rotY);
            const corner = (lx: number, ly: number): Vector3Tuple => [
                center[0] + lx * c,
                center[1] + ly,
                center[2] - lx * s,
            ];
            const a = corner(-bannerW / 2, -bannerH / 2);
            const b = corner(bannerW / 2, -bannerH / 2);
            const cc = corner(bannerW / 2, bannerH / 2);
            const dd = corner(-bannerW / 2, bannerH / 2);
            const u0 = cell / BANNER_CELLS;
            const u1 = (cell + 1) / BANNER_CELLS;
            pos3.push(...a, ...b, ...cc, ...a, ...cc, ...dd);
            uv.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
            for (let n = 0; n < 6; n++)
                normals.push(Math.sin(rotY), 0, Math.cos(rotY));
        };
        const wallZ = cz - halfZ - UPPER_BACK + wallInset;
        const wallXR = cx + halfX + UPPER_BACK - wallInset;
        const wallXL = cx - halfX - UPPER_BACK + wallInset;
        const y = UPPER_TOP + RIM + 3.3;
        const spread = Math.min(6.6, (halfX * 1.5) / BANNER_CELLS);
        for (let i = 0; i < BANNER_CELLS; i++) {
            quad([cx + (i - (BANNER_CELLS - 1) / 2) * spread, y, wallZ], 0, i);
        }
        for (let i = 0; i < 3; i++) {
            const z = cz + (i - 1) * 6.6;
            quad([wallXR, y, z], -Math.PI / 2, i);
            quad([wallXL, y, z], Math.PI / 2, i + 3);
        }
        const g = new BufferGeometry();
        g.setAttribute("position", new Float32BufferAttribute(pos3, 3));
        g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
        g.setAttribute("normal", new Float32BufferAttribute(normals, 3));
        mesh(
            g,
            std(0xffffff, { map: atlas, roughness: 0.9, side: DoubleSide }),
            "arena-banners",
            ceiling,
        );
    }

    // Light beams from the movers, additive and only visible in show.
    const beamTex = own(beamTexture());
    const beamMat = keep(
        materials,
        new MeshBasicMaterial({
            color: 0xffffff,
            alphaMap: beamTex,
            transparent: true,
            opacity: 0.2,
            blending: AdditiveBlending,
            depthWrite: false,
            side: DoubleSide,
        }),
    );
    const beamCount = trussZ.length * 4;
    const beams = new InstancedMesh(
        geo(new CylinderGeometry(0.1, 1.9, 1, 20, 1, true)),
        beamMat,
        beamCount,
    );
    beams.name = "arena-beams";
    beams.frustumCulled = false;
    {
        const palette = [0x8fb0ff, 0xd9a0ff, 0xffcf8a, 0x7fffe0].map(
            (c) => new Color(c),
        );
        const from = new Vector3();
        const to = new Vector3();
        const dir = new Vector3();
        let k = 0;
        trussZ.forEach((z, r) => {
            for (let i = 0; i < 4; i++) {
                const t = (i + 0.5) / 4 - 0.5;
                from.set(
                    cx + t * trussSpan * 1.8 * (r ? 1 : -1),
                    trussY - 1.05,
                    z,
                );
                to.set(
                    cx + t * w * 0.7,
                    0,
                    cz + (r ? -1 : 1) * d * 0.25 * (i % 2 ? 1 : -1),
                );
                dir.copy(from).sub(to);
                const len = dir.length();
                quat.setFromUnitVectors(UP, dir.normalize());
                m4.compose(
                    pos.copy(from).add(to).multiplyScalar(0.5),
                    quat,
                    scl.set(1, len, 1),
                );
                beams.setMatrixAt(k, m4);
                beams.setColorAt(k, palette[k % palette.length]);
                k++;
            }
        });
        ceiling.add(beams);
        keep(geometries, { dispose: () => beams.dispose() });
    }

    // Lights: four show spots, one overhead for house, the scoreboard's glow.
    const spotX = Math.max(8, w * 0.36);
    const spotZs = [fp.maxZ + 2, fp.minZ - 2];
    const showSpots: SpotLight[] = [];
    for (const sx of [-1, 1]) {
        for (const sz of spotZs) {
            const sp = new SpotLight(0xf3eaff, 0, 0, 0.62, 0.7, 0);
            sp.position.set(cx + sx * spotX, trussY, sz);
            sp.target.position.set(cx + sx * spotX * 0.25, 0, cz);
            root.add(sp, sp.target);
            showSpots.push(sp);
        }
    }
    const overhead = new DirectionalLight(0xfff4e6, 1);
    overhead.position.set(cx + 9, 61, cz + 6);
    overhead.target.position.set(cx, 0, cz);
    overhead.castShadow = quality === "high";
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
    // Soft fill for the bowls from the scoreboard's video walls.
    const glow = new PointLight(0x6f8cff, 0, 85, 1.1);
    glow.position.set(cx, boardY - 1.5, cz);
    root.add(glow);
    // A cool fill from above for the seats while the house lights are down.
    const bowlFill = new HemisphereLight(0x7f8fc8, 0x2a2430, 0);
    root.add(bowlFill);

    // Cameras.
    const lowerEye = (row: number): number =>
        ARENA_LOWER.base + row * ARENA_LOWER.rise + EYE_ABOVE_TREAD;
    const lowerD = (row: number): number => (row + 0.45) * ARENA_LOWER.depth;
    const upperEye = (row: number): number =>
        ARENA_UPPER.base + row * ARENA_UPPER.rise + EYE_ABOVE_TREAD;
    const upperD = (row: number): number =>
        ARENA_UPPER.offset + (row + 0.45) * ARENA_UPPER.depth;
    // Front-side seat: +z straight; the corner is on the +x +z arc at 45 deg.
    const frontSeat = (dist: number, dx = 0): [number, number] => [
        cx + dx,
        cz + halfZ + dist,
    ];
    const cornerSeat = (dist: number): [number, number] => {
        const rc = cornerRadius;
        const ccx = cx + halfX - rc;
        const ccz = cz + halfZ - rc;
        const r = rc + dist;
        return [ccx + r * Math.SQRT1_2, ccz + r * Math.SQRT1_2];
    };
    const [jx, jz] = frontSeat(lowerD(9));
    const [fx, fz] = frontSeat(lowerD(0), -Math.min(4.3, w * 0.1));
    const [ux, uz] = frontSeat(upperD(7));
    const [kx, kz] = cornerSeat(upperD(5));
    const topY =
        Math.max(
            (2 * halfZ + 4) / (2 * Math.tan(Math.PI / 7.2)),
            (2 * halfX + 4) / (2 * Math.tan(Math.PI / 7.2) * 1.6),
            ARENA_ROOF_PEAK + 8,
        ) * 1.02;
    const cameras: CameraSeat[] = [
        {
            id: "geJudge",
            labelKey: "view3d.camera.geJudge",
            kind: "seat",
            position: [jx, lowerEye(9), jz],
            target: [cx, 0, cz - 0.6],
        },
        {
            id: "judgesTable",
            labelKey: "view3d.camera.judgesTable",
            kind: "seat",
            position: [cx, 1.38, tableZ + 1.2],
            target: [cx, 1.3, cz - 1],
        },
        {
            id: "frontRow",
            labelKey: "view3d.camera.frontRow",
            kind: "seat",
            position: [fx, lowerEye(0), fz],
            target: [cx - 1.8, 1.2, cz],
        },
        {
            id: "upperBowl",
            labelKey: "view3d.camera.upperBowl",
            kind: "seat",
            position: [ux, upperEye(7), uz],
            target: [cx, 0, cz],
            fovDeg: 40,
        },
        {
            id: "corner",
            labelKey: "view3d.camera.corner",
            kind: "aerial",
            position: [kx, upperEye(5), kz],
            target: [cx, 0, cz],
            fovDeg: 42,
        },
        {
            id: "floor",
            labelKey: "view3d.camera.floor",
            kind: "floor",
            position: [cx, 1.68, fp.minZ - 1.2],
            target: [cx, 2.2, fp.maxZ + 6.1],
        },
        {
            id: "topDown",
            labelKey: "view3d.camera.topDown",
            kind: "topDown",
            position: [cx, topY, cz + 0.06],
            target: [cx, 0, cz],
        },
    ];

    const lightingPresets: LightingPreset[] = ["house", "show"];
    const setLighting = (preset: LightingPreset): void => {
        if (preset !== "house" && preset !== "show") return;
        const k = lightingValues(preset).kit;
        const look = LOOKS[preset];
        fixtureMat.emissiveIntensity = k.panelEmissive * look.fixtures;
        setLightIntensity(overhead, k.overheadIntensity);
        showSpots.forEach((s) => setLightIntensity(s, k.showSpotIntensity));
        setLightIntensity(glow, look.glow * 90);
        setLightIntensity(bowlFill, look.bowl);
        screenMats.forEach((m) => (m.emissiveIntensity = look.screens));
        courtRibbonMat.emissiveIntensity = look.ribbon;
        upperRibbonMat.emissiveIntensity = look.ribbon;
        railMat.emissiveIntensity = look.rail;
        lampMat.color.setScalar(look.lamps);
        beamMat.opacity = look.beams;
        beams.visible = look.beams > 0;
    };
    setLighting("house");

    const pickTargets: Object3D[] = [lowerTreads, upperTreads];
    return {
        root,
        focus: [cx, 0, cz],
        cameras,
        seatRows,
        pickTargets,
        crowdDensity: 0.6,
        lightingPresets,
        defaultLighting: "house",
        setLighting,
        onFrame({ cameraPosition }: FrameContext) {
            ceiling.visible = cameraPosition[1] < ARENA_WALL_TOP - 1;
        },
        dispose() {
            geometries.forEach((g) => g.dispose());
            materials.forEach((m) => m.dispose());
            textures.forEach((t) => t.dispose());
            [table, chairs, laptops, lamps].forEach((m) => m.dispose());
            overhead.shadow.map?.dispose();
            shared.dispose();
            root.clear();
        },
    };
};
