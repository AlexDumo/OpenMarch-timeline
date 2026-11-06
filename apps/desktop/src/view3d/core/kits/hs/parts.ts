import {
    BoxGeometry,
    BufferGeometry,
    Color,
    Euler,
    Float32BufferAttribute,
    InstancedMesh,
    Matrix4,
    Quaternion,
    Vector2,
    Vector3,
    type Material,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Small building blocks for the stadium kits: an instanced box batch (one
 * draw call per material), UV-scaled boxes for tiling facades, and path
 * helpers for fences and curbs.
 */

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpE = new Euler();
const tmpC = new Color();

/**
 * Collects boxes and builds one `InstancedMesh` from them. Each box has its
 * own color (instance color), so one white material serves many parts.
 * Rotation is by yaw, pitch (about X) and roll, in that Euler order "YXZ".
 */
export class BoxBatch {
    private readonly items: {
        m: Matrix4;
        color: number;
    }[] = [];

    constructor(private readonly unitBox: BoxGeometry) {}

    get count() {
        return this.items.length;
    }

    add(
        x: number,
        y: number,
        z: number,
        sx: number,
        sy: number,
        sz: number,
        color = 0xffffff,
        yaw = 0,
        pitch = 0,
        roll = 0,
    ) {
        tmpQ.setFromEuler(tmpE.set(pitch, yaw, roll, "YXZ"));
        const m = new Matrix4().compose(
            new Vector3(x, y, z),
            tmpQ.clone(),
            new Vector3(sx, sy, sz),
        );
        this.items.push({ m, color });
    }

    /** A box between two points with square section `t` (rails, braces). */
    beam(a: Vector3, b: Vector3, t: number, thick = t, color = 0xffffff) {
        const d = new Vector3().subVectors(b, a);
        const len = d.length();
        const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
        const q = new Quaternion().setFromUnitVectors(
            new Vector3(0, 0, 1),
            d.clone().normalize(),
        );
        const m = new Matrix4().compose(mid, q, new Vector3(t, thick, len));
        this.items.push({ m, color });
    }

    build(
        material: Material,
        name: string,
        shadows: boolean,
    ): InstancedMesh | null {
        if (this.items.length === 0) return null;
        const mesh = new InstancedMesh(
            this.unitBox,
            material,
            this.items.length,
        );
        mesh.name = name;
        this.items.forEach((it, i) => {
            mesh.setMatrixAt(i, it.m);
            mesh.setColorAt(i, tmpC.setHex(it.color));
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = shadows;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        return mesh;
    }
}

/**
 * A box whose UVs tile every `tileW` x `tileH` meters (sides) or `tileW` x
 * `tileW` (top and bottom), so a brick or facade texture keeps its scale.
 */
export function texturedBox(
    w: number,
    h: number,
    d: number,
    tileW: number,
    tileH: number,
): BoxGeometry {
    const g = new BoxGeometry(w, h, d);
    const uv = g.getAttribute("uv");
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z; four vertices each.
    const faces: [number, number][] = [
        [d / tileW, h / tileH],
        [d / tileW, h / tileH],
        [w / tileW, d / tileW],
        [w / tileW, d / tileW],
        [w / tileW, h / tileH],
        [w / tileW, h / tileH],
    ];
    faces.forEach(([su, sv], f) => {
        for (let i = 0; i < 4; i++) {
            const k = f * 4 + i;
            uv.setXY(k, uv.getX(k) * su, uv.getY(k) * sv);
        }
    });
    uv.needsUpdate = true;
    return g;
}

/** Merges geometries that share one material into a single draw call. */
export function merge(parts: BufferGeometry[]): BufferGeometry {
    const out = mergeGeometries(
        parts.map((p) => (p.index ? p.toNonIndexed() : p)),
    );
    parts.forEach((p) => p.dispose());
    return out;
}

export interface Pt {
    x: number;
    z: number;
}

/** Points every `spacing` meters along a closed or open path. */
export function resample(
    path: Vector2[],
    spacing: number,
    closed = true,
): Pt[] {
    const pts = closed ? [...path, path[0]] : path;
    const out: Pt[] = [];
    let carry = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const len = a.distanceTo(b);
        let t = carry;
        while (t < len) {
            const k = t / len;
            out.push({ x: a.x + (b.x - a.x) * k, z: a.y + (b.y - a.y) * k });
            t += spacing;
        }
        carry = t - len;
    }
    return out;
}

/**
 * A vertical strip along a closed path (a fence). The path is in world x, z
 * (Vector2 x, y -> x, z). u runs along the path, one repeat per `tile` meters.
 */
export function wallStrip(
    path: Vector2[],
    y0: number,
    height: number,
    tile: number,
    vRepeat = 1,
): BufferGeometry {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const pts = [...path, path[0]];
    let u = 0;
    pts.forEach((p, i) => {
        if (i > 0) u += p.distanceTo(pts[i - 1]) / tile;
        pos.push(p.x, y0, p.y, p.x, y0 + height, p.y);
        uv.push(u, 0, u, vRepeat);
        if (i > 0) {
            const a = (i - 1) * 2;
            idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
    });
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
}
