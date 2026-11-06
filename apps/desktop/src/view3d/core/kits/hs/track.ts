import {
    CylinderGeometry,
    DoubleSide,
    Matrix4,
    Mesh,
    MeshStandardMaterial,
    PlaneGeometry,
    Quaternion,
    Vector2,
    Vector3,
    type BufferGeometry,
    type Object3D,
} from "three";
import { ft } from "../../environment";
import { mergeGeometries, QuadBuilder } from "./geometry";
import {
    chainLinkTexture,
    FENCE_TILE,
    finishTexture,
    rgbOf,
    TRACK_TILE,
    trackTexture,
} from "./textures";

/**
 * The track oval, the chain-link fence around it and the goal posts. All are
 * placed from the field frame (center and half sizes in world meters).
 */

export interface TrackFrame {
    cx: number;
    cz: number;
    halfW: number;
    halfD: number;
    minX: number;
    maxX: number;
}

export interface Built {
    objects: Object3D[];
    dispose(): void;
}

export const TRACK_INNER_GAP = ft(15);
export const TRACK_WIDTH = ft(30);
export const TRACK_LANES = 6;
const TRACK_Y = 0.015;
const DECAL_Y = 0.02;

/** Track geometry: straight half length and the inner and outer radii. */
export function trackShape(f: TrackFrame): {
    straight: number;
    inner: number;
    outer: number;
} {
    const straight = Math.max(f.halfW - ft(30), ft(30));
    const inner = f.halfD + TRACK_INNER_GAP;
    return { straight, inner, outer: inner + TRACK_WIDTH };
}

/**
 * Point and outward normal on a stadium outline (two straights joined by
 * semicircles) at parameter `t` in [0, 1), counter-clockwise seen from above
 * starting at the side-1 end of the back straight. World x, z.
 */
export function stadiumAt(
    cx: number,
    cz: number,
    straight: number,
    r: number,
    t: number,
): { p: Vector2; n: Vector2 } {
    const L = 2 * straight;
    const arc = Math.PI * r;
    const total = 2 * L + 2 * arc;
    let s = (((t % 1) + 1) % 1) * total;
    // back straight (z = cz - r), toward +x
    if (s < L) return { p: new Vector2(cx - straight + s, cz - r), n: new Vector2(0, -1) };
    s -= L;
    if (s < arc) {
        const a = -Math.PI / 2 + (s / arc) * Math.PI;
        const n = new Vector2(Math.cos(a), Math.sin(a));
        return { p: new Vector2(cx + straight, cz).addScaledVector(n, r), n };
    }
    s -= arc;
    if (s < L) return { p: new Vector2(cx + straight - s, cz + r), n: new Vector2(0, 1) };
    s -= L;
    const a = Math.PI / 2 + (s / arc) * Math.PI;
    const n = new Vector2(Math.cos(a), Math.sin(a));
    return { p: new Vector2(cx - straight, cz).addScaledVector(n, r), n };
}

/** Parameter samples: straights split every `step` meters, arcs every few degrees. */
function samples(straight: number, r: number, step: number): number[] {
    const L = 2 * straight;
    const arc = Math.PI * r;
    const total = 2 * L + 2 * arc;
    const out: number[] = [];
    const nStraight = Math.max(1, Math.ceil(L / step));
    const nArc = 48;
    const push = (s: number) => out.push(s / total);
    for (let i = 0; i < nStraight; i++) push((L * i) / nStraight);
    for (let i = 0; i < nArc; i++) push(L + (arc * i) / nArc);
    for (let i = 0; i < nStraight; i++) push(L + arc + (L * i) / nStraight);
    for (let i = 0; i < nArc; i++) push(2 * L + arc + (arc * i) / nArc);
    return out;
}

/** The six-lane track as one textured ribbon, plus a finish line decal. */
export function buildTrackRibbon(f: TrackFrame): Built {
    const { straight, inner, outer } = trackShape(f);
    const q = new QuadBuilder();
    const ts = samples(straight, inner, 6);
    const mid = (inner + outer) / 2;
    const total = 4 * straight + 2 * Math.PI * mid;
    const up = new Vector3(0, 1, 0);
    for (let i = 0; i < ts.length; i++) {
        const t0 = ts[i];
        const t1 = i + 1 < ts.length ? ts[i + 1] : 1;
        const a0 = stadiumAt(f.cx, f.cz, straight, inner, t0).p;
        const a1 = stadiumAt(f.cx, f.cz, straight, inner, t1).p;
        const b0 = stadiumAt(f.cx, f.cz, straight, outer, t0).p;
        const b1 = stadiumAt(f.cx, f.cz, straight, outer, t1).p;
        const u0 = (t0 * total) / TRACK_TILE;
        const u1 = (t1 * total) / TRACK_TILE;
        q.quad(
            new Vector3(a0.x, TRACK_Y, a0.y),
            new Vector3(a1.x, TRACK_Y, a1.y),
            new Vector3(b1.x, TRACK_Y, b1.y),
            new Vector3(b0.x, TRACK_Y, b0.y),
            [u0, 0],
            [u1, 0],
            [u1, 1],
            [u0, 1],
            undefined,
            up,
        );
    }
    const geometry = q.build();
    const map = trackTexture(TRACK_LANES);
    const material = new MeshStandardMaterial({ map, roughness: 0.92 });
    const track = new Mesh(geometry, material);
    track.name = "track";
    track.receiveShadow = true;

    // Finish line at the side-2 end of the home straight, numbers before it.
    const finishMap = finishTexture(TRACK_LANES);
    const finishMat = new MeshStandardMaterial({
        map: finishMap,
        transparent: true,
        roughness: 0.9,
        depthWrite: false,
    });
    const finishGeo = new PlaneGeometry(3.2, TRACK_WIDTH);
    const finish = new Mesh(finishGeo, finishMat);
    finish.name = "finishLine";
    finish.rotation.x = -Math.PI / 2;
    finish.position.set(f.cx + straight - 1.6, DECAL_Y, f.cz + (inner + outer) / 2);
    finish.receiveShadow = true;

    return {
        objects: [track, finish],
        dispose() {
            geometry.dispose();
            map.dispose();
            material.dispose();
            finishGeo.dispose();
            finishMap.dispose();
            finishMat.dispose();
        },
    };
}

/**
 * Chain-link fence a meter outside the track, 1.2 m tall, with gates at the
 * center of each straight so the band can march on.
 */
export function buildFence(f: TrackFrame, gate = 4.5): Built {
    const { straight, outer } = trackShape(f);
    const r = outer + 1;
    const h = 1.22;
    const q = new QuadBuilder();
    const ts = samples(straight, r, 3);
    const total = 4 * straight + 2 * Math.PI * r;
    for (let i = 0; i < ts.length; i++) {
        const t0 = ts[i];
        const t1 = i + 1 < ts.length ? ts[i + 1] : 1;
        const a = stadiumAt(f.cx, f.cz, straight, r, t0).p;
        const b = stadiumAt(f.cx, f.cz, straight, r, t1).p;
        const mx = (a.x + b.x) / 2;
        const straightPart = Math.abs(a.y - b.y) < 1e-6 && Math.abs(Math.abs(a.y - f.cz) - r) < 1e-6;
        if (straightPart && Math.abs(mx - f.cx) < gate) continue;
        const u0 = (t0 * total) / FENCE_TILE;
        const u1 = (t1 * total) / FENCE_TILE;
        q.quad(
            new Vector3(a.x, 0, a.y),
            new Vector3(b.x, 0, b.y),
            new Vector3(b.x, h, b.y),
            new Vector3(a.x, h, a.y),
            [u0, 0],
            [u1, 0],
            [u1, 1],
            [u0, 1],
        );
    }
    const geometry = q.build();
    const map = chainLinkTexture();
    const material = new MeshStandardMaterial({
        map,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        metalness: 0.4,
        roughness: 0.5,
        alphaTest: 0.01,
    });
    const fence = new Mesh(geometry, material);
    fence.name = "fence";
    return {
        objects: [fence],
        dispose() {
            geometry.dispose();
            map.dispose();
            material.dispose();
        },
    };
}

/** High school goal posts: 23 ft 4 in wide, 10 ft crossbar, slingshot base. */
export function buildGoalPosts(f: TrackFrame, padColor: string): Built | null {
    // Only for football-length surfaces.
    if (f.halfW * 2 < 95) return null;
    const yellow = 0xf3c623;
    const [r, g, b] = rgbOf(padColor);
    const pad = (r << 16) | (g << 8) | b;
    const parts: { geometry: BufferGeometry; matrix?: Matrix4; tint?: number }[] = [];
    const cyl = (
        radius: number,
        from: Vector3,
        to: Vector3,
        tint: number,
    ) => {
        const dir = to.clone().sub(from);
        const len = dir.length();
        const geo = new CylinderGeometry(radius, radius, len, 10, 1, false);
        const m = new Matrix4().compose(
            from.clone().add(to).multiplyScalar(0.5),
            new Quaternion().setFromUnitVectors(
                new Vector3(0, 1, 0),
                dir.normalize(),
            ),
            new Vector3(1, 1, 1),
        );
        parts.push({ geometry: geo, matrix: m, tint });
    };
    const crossY = 3.05;
    const half = 7.11 / 2;
    const upright = 6.1;
    for (const sx of [-1, 1]) {
        const xEnd = sx > 0 ? f.maxX : f.minX;
        const xBase = xEnd + sx * 1.83;
        const z = f.cz;
        cyl(0.12, new Vector3(xBase, 0, z), new Vector3(xBase, crossY - 0.6, z), yellow);
        // gooseneck: up, then forward to the end line
        cyl(0.11, new Vector3(xBase, crossY - 0.6, z), new Vector3(xEnd, crossY, z), yellow);
        cyl(0.08, new Vector3(xEnd, crossY, z - half), new Vector3(xEnd, crossY, z + half), yellow);
        for (const sz of [-1, 1]) {
            cyl(0.06, new Vector3(xEnd, crossY, z + sz * half), new Vector3(xEnd, crossY + upright, z + sz * half), yellow);
        }
        cyl(0.3, new Vector3(xBase, 0, z), new Vector3(xBase, 1.9, z), pad);
    }
    const geometry = mergeGeometries(parts, true);
    const material = new MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.5,
        metalness: 0.1,
    });
    const mesh = new Mesh(geometry, material);
    mesh.name = "goalPosts";
    mesh.castShadow = true;
    return {
        objects: [mesh],
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

