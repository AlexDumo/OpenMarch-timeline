// cspell:ignore metalness
import {
    BoxGeometry,
    Color,
    ConeGeometry,
    CylinderGeometry,
    IcosahedronGeometry,
    InstancedMesh,
    Matrix4,
    Mesh,
    MeshStandardMaterial,
    PlaneGeometry,
    Quaternion,
    Vector3,
    type BufferGeometry,
    type Object3D,
} from "three";
import {
    createRng,
    type SharedMaterials,
} from "../../environment";
import type { FieldFootprint, LightingPreset, VenueParams } from "../../types";
import { BoxBatch, mergeGeometries, QuadBuilder } from "./geometry";
import {
    BUILDING_BAND_HEIGHT,
    BUILDING_FACADE_BAND,
    BUILDING_ROOF_UV,
    BUILDING_TILE,
    buildingTextures,
    scoreboardTexture,
    siteTexture,
    type SiteRect,
} from "./textures";
import { buildFence, buildGoalPosts, type Built } from "./track";

/**
 * The world around a high school stadium: a painted site (grass, lots, a
 * practice field, a band lot, a ball diamond), trees in early fall color, the
 * school and field house, parked cars, a scoreboard and a flagpole, the
 * chain-link fence and goal posts. Everything is laid out from the field
 * center, so it follows the footprint.
 */

/** A rectangle relative to the field center: offsets and size, meters. */
export interface Rel {
    dx: number;
    dz: number;
    w: number;
    d: number;
}

export interface BuildingSpec extends Rel {
    h: number;
    /** Team-colored parapet band. */
    trim?: boolean;
    /** Serving window with a team-colored awning on this face (+z or -z). */
    awning?: 1 | -1;
}

export interface SiteLayout {
    /** Side of the painted square around the field center. */
    size: number;
    grass: string;
    lots: Rel[];
    pads: Rel[];
    fields: Rel[];
    bandLots: Rel[];
    walks: { points: [number, number][]; width: number }[];
    diamonds: { dx: number; dz: number; angle: number }[];
    buildings: BuildingSpec[];
    /** Where trees may not grow (besides lots, pads, fields and buildings). */
    clear: Rel[];
    trees: { ring: number; clusters: number; perCluster: number };
    scoreboard?: { dx: number; dz: number; yaw: number; w: number; bottom: number };
    flagpole?: { dx: number; dz: number };
    /** Fraction of parking stalls with a car. */
    cars: number;
    fence: boolean;
    goalPosts: boolean;
    seed: number;
}

const SITE_Y = -0.07;
const STALL_W = 2.75;
const STALL_D = 5.5;
const LOT_AISLE = 7;
const LOT_INSET = 1.5;

/** Half sizes of the football field the layouts are drawn around. */
const REF_HALF_W = 54.86;
const REF_HALF_D = 24.38;

/**
 * Moves a layout offset with the field's edges: offsets beyond the reference
 * field's edge keep their distance from the real edge, offsets inside it
 * scale with the field.
 */
function follow(v: number, half: number, ref: number): number {
    return Math.abs(v) > ref ? v + Math.sign(v) * (half - ref) : (v * half) / ref;
}

/** Stall centers of a lot, matching the painted stall lines. */
export function stallCenters(lot: SiteRect): { x: number; z: number; row: 0 | 1 }[] {
    const out: { x: number; z: number; row: 0 | 1 }[] = [];
    const x0 = lot.x - lot.w / 2 + LOT_INSET;
    const z0 = lot.z - lot.d / 2 + LOT_INSET;
    const w = lot.w - 2 * LOT_INSET;
    const d = lot.d - 2 * LOT_INSET;
    for (let z = z0 + LOT_AISLE; z + 2 * STALL_D <= z0 + d; z += 2 * STALL_D + LOT_AISLE) {
        for (let i = 0; x0 + STALL_W * (i + 1) <= x0 + w; i++) {
            const x = x0 + STALL_W * (i + 0.5);
            out.push({ x, z: z + STALL_D / 2, row: 0 });
            out.push({ x, z: z + STALL_D * 1.5, row: 1 });
        }
    }
    return out;
}

function inside(x: number, z: number, r: SiteRect, margin: number): boolean {
    return (
        Math.abs(x - r.x) < r.w / 2 + margin && Math.abs(z - r.z) < r.d / 2 + margin
    );
}

function treeGeometries(): { leafy: BufferGeometry; conifer: BufferGeometry } {
    const trunk = () => new CylinderGeometry(0.18, 0.28, 3, 6);
    const at = (x: number, y: number, z: number, s = 1) =>
        new Matrix4().compose(new Vector3(x, y, z), new Quaternion(), new Vector3(s, s, s));
    const trunkTint = 0x7a6450;
    const leafy = mergeGeometries(
        [
            { geometry: trunk(), matrix: at(0, 1.5, 0), tint: trunkTint },
            {
                geometry: new IcosahedronGeometry(1, 1),
                matrix: new Matrix4().compose(
                    new Vector3(0, 4.6, 0),
                    new Quaternion(),
                    new Vector3(2.6, 2.9, 2.6),
                ),
            },
            {
                geometry: new IcosahedronGeometry(1, 0),
                matrix: at(0.9, 5.6, 0.4, 1.7),
            },
        ],
        true,
    );
    const conifer = mergeGeometries(
        [
            { geometry: trunk(), matrix: at(0, 1.2, 0), tint: trunkTint },
            {
                geometry: new ConeGeometry(2.2, 7.5, 7),
                matrix: at(0, 5.6, 0),
            },
        ],
        true,
    );
    return { leafy, conifer };
}

const LEAF_COLORS = [0x4c6b2f, 0x3f5d29, 0x58743a, 0x46652c, 0x37522a];
const FALL_COLORS = [0xc0782e, 0xd2a23c, 0xa8492b];

export function buildSite(
    fp: FieldFootprint,
    layout: SiteLayout,
    params: VenueParams,
    shared: SharedMaterials,
    quality: "low" | "high",
): Built & { setLighting(preset: LightingPreset): void } {
    const cx = (fp.minX + fp.maxX) / 2;
    const cz = (fp.minZ + fp.maxZ) / 2;
    const frame = {
        cx,
        cz,
        halfW: (fp.maxX - fp.minX) / 2,
        halfD: (fp.maxZ - fp.minZ) / 2,
        minX: fp.minX,
        maxX: fp.maxX,
    };
    const objects: Object3D[] = [];
    const owned: { dispose(): void }[] = [];
    const rnd = createRng(layout.seed);
    const X = (dx: number) => cx + follow(dx, frame.halfW, REF_HALF_W);
    const Z = (dz: number) => cz + follow(dz, frame.halfD, REF_HALF_D);
    const A = (r: Rel): SiteRect => ({ x: X(r.dx), z: Z(r.dz), w: r.w, d: r.d });
    const lots = layout.lots.map(A);
    const buildings = layout.buildings.map((b) => ({ ...b, rect: A(b) }));

    // Painted ground.
    const ring = layout.size * 0.44;
    const treeSpots: { x: number; z: number; conifer: boolean; s: number }[] = [];
    const blocked = [
        ...lots,
        ...layout.pads.map(A),
        ...layout.fields.map(A),
        ...layout.bandLots.map(A),
        ...buildings.map((b) => b.rect),
        ...layout.clear.map(A),
    ];
    const free = (x: number, z: number) => !blocked.some((r) => inside(x, z, r, 4));
    const ringCount = quality === "low" ? Math.round(layout.trees.ring / 2) : layout.trees.ring;
    for (let i = 0; i < ringCount; i++) {
        // a loose tree line around the edge of the site
        const t = (i + rnd() * 0.8) / ringCount;
        const side = Math.floor(t * 4);
        const u = (t * 4 - side) * 2 - 1;
        const jitter = (rnd() - 0.5) * 30;
        const x = side % 2 === 0 ? u * ring : (side === 1 ? 1 : -1) * (ring + jitter);
        const z = side % 2 === 0 ? (side === 0 ? -1 : 1) * (ring + jitter) : u * ring;
        if (free(cx + x, cz + z)) {
            treeSpots.push({ x: cx + x, z: cz + z, conifer: rnd() < 0.25, s: 0.85 + rnd() * 0.6 });
        }
    }
    const clusters = quality === "low" ? Math.round(layout.trees.clusters / 2) : layout.trees.clusters;
    for (let c = 0; c < clusters; c++) {
        const ax = cx + (rnd() - 0.5) * layout.size * 0.85;
        const az = cz + (rnd() - 0.5) * layout.size * 0.85;
        const conifer = rnd() < 0.3;
        for (let k = 0; k < layout.trees.perCluster; k++) {
            const x = ax + (rnd() - 0.5) * 28;
            const z = az + (rnd() - 0.5) * 28;
            if (free(x, z)) treeSpots.push({ x, z, conifer, s: 0.8 + rnd() * 0.5 });
        }
    }

    const siteMap = siteTexture({
        cx,
        cz,
        size: layout.size,
        px: quality === "low" ? 1024 : 2048,
        grass: layout.grass,
        lots,
        pads: layout.pads.map(A),
        walks: layout.walks.map((w) => ({
            width: w.width,
            points: w.points.map(([x, z]) => [X(x), Z(z)] as [number, number]),
        })),
        fields: layout.fields.map(A),
        bandLots: layout.bandLots.map(A),
        diamonds: layout.diamonds.map((d) => ({ x: X(d.dx), z: Z(d.dz), angle: d.angle })),
        treeShade: treeSpots.filter((_, i) => i % 3 === 0).map((t) => ({ x: t.x, z: t.z, r: 9 })),
        seed: layout.seed,
    });
    const siteMat = new MeshStandardMaterial({ map: siteMap, roughness: 1 });
    const siteGeo = new PlaneGeometry(layout.size, layout.size);
    const site = new Mesh(siteGeo, siteMat);
    site.name = "site";
    site.rotation.x = -Math.PI / 2;
    site.position.set(cx, SITE_Y, cz);
    site.receiveShadow = true;
    site.userData.ground = true;
    objects.push(site);
    owned.push(siteMap, siteMat, siteGeo);

    // Trees: leafy ones with a few in fall color, and some conifers.
    const geos = treeGeometries();
    const treeMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    owned.push(geos.leafy, geos.conifer, treeMat);
    for (const conifer of [false, true]) {
        const spots = treeSpots.filter((t) => t.conifer === conifer);
        if (!spots.length) continue;
        const mesh = new InstancedMesh(conifer ? geos.conifer : geos.leafy, treeMat, spots.length);
        mesh.name = conifer ? "conifers" : "trees";
        const m = new Matrix4();
        const q = new Quaternion();
        const up = new Vector3(0, 1, 0);
        spots.forEach((t, i) => {
            q.setFromAxisAngle(up, rnd() * Math.PI * 2);
            const s = t.s * (conifer ? 1.3 : 1.6);
            m.compose(new Vector3(t.x, SITE_Y, t.z), q, new Vector3(s, s * (0.9 + rnd() * 0.3), s));
            mesh.setMatrixAt(i, m);
            const colors = conifer
                ? [0x2d4a2e, 0x34523a, 0x2a4328]
                : rnd() < 0.16
                  ? FALL_COLORS
                  : LEAF_COLORS;
            mesh.setColorAt(i, new Color(colors[Math.floor(rnd() * colors.length)]));
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = true;
        objects.push(mesh);
    }

    // Buildings: one merged mesh with the brick atlas, windows lit at night.
    const props = new BoxBatch();
    const team = parseInt(params.homeColor.replace("#", ""), 16) || 0x6442ff;
    const bq = new QuadBuilder();
    for (const b of buildings) {
        const r = b.rect;
        bq.box(
            new Vector3(r.x - r.w / 2, 0, r.z - r.d / 2),
            new Vector3(r.x + r.w / 2, b.h, r.z + r.d / 2),
            BUILDING_TILE,
            BUILDING_FACADE_BAND,
            BUILDING_ROOF_UV,
            BUILDING_BAND_HEIGHT,
        );
        // parapet cap, team trim, and roof units
        const cap = b.trim ? team : 0xbdb6a6;
        for (const sz of [-1, 1]) {
            props.add([r.x, b.h + 0.3, r.z + (sz * r.d) / 2], [r.w + 0.4, 0.6, 0.4], [0, 0, 0], cap);
            props.add([r.x + (sz * r.w) / 2, b.h + 0.3, r.z], [0.4, 0.6, r.d], [0, 0, 0], cap);
        }
        for (let k = 0; k < Math.max(1, Math.floor((r.w * r.d) / 900)); k++) {
            props.add(
                [r.x + (rnd() - 0.5) * r.w * 0.6, b.h + 0.9, r.z + (rnd() - 0.5) * r.d * 0.6],
                [2.4, 1.3, 1.6],
                [0, 0, 0],
                0x9a9da2,
            );
        }
        if (b.awning) {
            const z = r.z + (b.awning * r.d) / 2;
            props.add([r.x, b.h * 0.72, z + b.awning * 0.9], [r.w * 0.8, 0.18, 1.8], [b.awning * 0.25, 0, 0], team);
            props.add([r.x, b.h * 0.42, z + b.awning * 0.03], [r.w * 0.7, b.h * 0.32, 0.06], [0, 0, 0], 0x23262b);
        }
    }
    let buildingMat: MeshStandardMaterial | undefined;
    if (!bq.empty) {
        const tex = buildingTextures();
        const geo = bq.build();
        buildingMat = new MeshStandardMaterial({
            map: tex.map,
            emissive: 0xffffff,
            emissiveMap: tex.emissive,
            emissiveIntensity: 0,
            roughness: 0.9,
        });
        const mesh = new Mesh(geo, buildingMat);
        mesh.name = "buildings";
        mesh.castShadow = mesh.receiveShadow = true;
        objects.push(mesh);
        owned.push(tex.map, tex.emissive, geo, buildingMat);
    }

    // Parked cars, one instanced mesh.
    const carSpots = lots.flatMap((l) => stallCenters(l)).filter(() => rnd() < layout.cars);
    if (carSpots.length) {
        const body = new BoxGeometry(1.8, 0.8, 4.5);
        const cabin = new BoxGeometry(1.6, 0.62, 2.4);
        const carGeo = mergeGeometries(
            [
                { geometry: body, matrix: new Matrix4().makeTranslation(0, 0.62, 0) },
                {
                    geometry: cabin,
                    matrix: new Matrix4().makeTranslation(0, 1.3, -0.2),
                    tint: 0x9aa3ad,
                },
            ],
            true,
        );
        const carMat = new MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.35,
            metalness: 0.5,
        });
        const cars = new InstancedMesh(carGeo, carMat, carSpots.length);
        cars.name = "cars";
        const palette = [0xf2f2f2, 0xb8bcc2, 0x1d1f23, 0x5d636b, 0x24375e, 0x8c1f22, 0x6b1e2a, 0xd8d2c4, 0x2f4a3a];
        const m = new Matrix4();
        const q = new Quaternion();
        const up = new Vector3(0, 1, 0);
        carSpots.forEach((c, i) => {
            q.setFromAxisAngle(up, (c.row ? Math.PI : 0) + (rnd() - 0.5) * 0.12);
            m.compose(new Vector3(c.x + (rnd() - 0.5) * 0.3, SITE_Y, c.z), q, new Vector3(1, 1, 1));
            cars.setMatrixAt(i, m);
            cars.setColorAt(i, new Color(palette[Math.floor(rnd() * palette.length)]));
        });
        cars.instanceMatrix.needsUpdate = true;
        if (cars.instanceColor) cars.instanceColor.needsUpdate = true;
        cars.computeBoundingSphere();
        objects.push(cars);
        owned.push(carGeo, carMat, cars);
    }

    // Scoreboard on two posts, facing the field.
    let boardMat: MeshStandardMaterial | undefined;
    if (layout.scoreboard) {
        const sb = layout.scoreboard;
        const w = sb.w;
        const h = w / 2;
        const yaw = sb.yaw;
        const at = new Matrix4().compose(
            new Vector3(X(sb.dx), 0, Z(sb.dz)),
            new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw),
            new Vector3(1, 1, 1),
        );
        const local = new BoxBatch();
        local.add([0, sb.bottom + h / 2, -0.35], [w + 0.5, h + 0.5, 0.7], [0, 0, 0], 0x1e2025);
        for (const sx of [-1, 1]) {
            local.add([sx * w * 0.3, (sb.bottom + h) / 2, -0.9], [0.45, sb.bottom + h, 0.45], [0, 0, 0], 0x2a2d33);
        }
        local.transform(at);
        props.append(local);
        const map = scoreboardTexture(params.homeColor, params.endZoneText || "HOME");
        boardMat = new MeshStandardMaterial({
            color: 0x000000,
            emissive: 0xffffff,
            emissiveMap: map,
            emissiveIntensity: 1,
            roughness: 0.6,
        });
        const geo = new PlaneGeometry(w, h);
        const face = new Mesh(geo, boardMat);
        face.name = "scoreboard";
        face.position.set(0, sb.bottom + h / 2, 0.02);
        face.applyMatrix4(at);
        objects.push(face);
        owned.push(map, boardMat, geo);
    }

    if (layout.flagpole) {
        const x = X(layout.flagpole.dx);
        const z = Z(layout.flagpole.dz);
        props.add([x, 7.5, z], [0.16, 15, 0.16], [0, 0, 0], 0xe8e8e8);
        props.add([x + 1.1, 13.9, z], [2, 1.2, 0.04], [0, 0, 0], team);
        props.add([x, 15.05, z], [0.3, 0.3, 0.3], [0, 0, 0], 0xd9b440);
    }

    if (props.size) {
        const propMat = shared.std(0xffffff, { roughness: 0.7, metalness: 0.1 });
        const mesh = props.build(shared.unitBox, propMat, "siteProps");
        mesh.castShadow = true;
        objects.push(mesh);
        owned.push(mesh);
    }

    const parts: Built[] = [];
    if (layout.fence) parts.push(buildFence(frame));
    if (layout.goalPosts) {
        const g = buildGoalPosts(frame, params.homeColor);
        if (g) parts.push(g);
    }
    for (const p of parts) objects.push(...p.objects);

    if (quality === "low") {
        for (const o of objects) o.castShadow = false;
    }

    return {
        objects,
        setLighting(preset) {
            const k = preset === "night" ? 1 : preset === "dusk" ? 0.6 : 0;
            if (buildingMat) buildingMat.emissiveIntensity = k;
            if (boardMat) boardMat.emissiveIntensity = preset === "day" ? 1.15 : 0.9;
        },
        dispose() {
            owned.forEach((o) => o.dispose());
            parts.forEach((p) => p.dispose());
        },
    };
}
