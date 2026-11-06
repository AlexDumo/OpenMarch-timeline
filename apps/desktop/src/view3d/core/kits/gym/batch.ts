import {
    BufferAttribute,
    BufferGeometry,
    Color,
    InstancedMesh,
    Matrix4,
    Quaternion,
    Vector3,
    type ColorRepresentation,
    type Material,
    type Vector3Tuple,
} from "three";

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const IDENTITY = new Quaternion();

interface Item {
    matrix: Matrix4;
    color: Color;
}

/**
 * Collects instances of one geometry and material, then builds a single
 * `InstancedMesh` (one draw call) with per-instance colors. The material's
 * own color should be white so instance colors come through unchanged.
 */
export class InstanceBatch {
    private readonly items: Item[] = [];

    get count(): number {
        return this.items.length;
    }

    /** Adds an instance at `p`, scaled by `s`, optionally rotated by `q`. */
    add(
        p: Vector3Tuple,
        s: Vector3Tuple,
        color: ColorRepresentation,
        q: Quaternion = IDENTITY,
    ): this {
        this.items.push({
            matrix: new Matrix4().compose(
                new Vector3(...p),
                q,
                new Vector3(...s),
            ),
            color: new Color(color),
        });
        return this;
    }

    /**
     * Adds a box-shaped member from `a` to `b` (for a unit box) with a
     * `w` x `h` cross-section. Use square sections for members that aren't
     * horizontal, since the roll around the member's axis is arbitrary.
     */
    beam(
        a: Vector3Tuple,
        b: Vector3Tuple,
        w: number,
        h: number,
        color: ColorRepresentation,
    ): this {
        const va = new Vector3(...a);
        const dir = new Vector3(...b).sub(va);
        const len = dir.length();
        if (len < 1e-6) return this;
        const q = new Quaternion().setFromUnitVectors(
            X_AXIS,
            dir.clone().divideScalar(len),
        );
        const mid = va.addScaledVector(dir, 0.5);
        return this.add([mid.x, mid.y, mid.z], [len, w, h], color, q);
    }

    /**
     * Adds a round member from `a` to `b` with diameter `d`, for a unit
     * cylinder (radius 0.5, height 1, along Y).
     */
    pipe(
        a: Vector3Tuple,
        b: Vector3Tuple,
        d: number,
        color: ColorRepresentation,
    ): this {
        const va = new Vector3(...a);
        const dir = new Vector3(...b).sub(va);
        const len = dir.length();
        if (len < 1e-6) return this;
        const q = new Quaternion().setFromUnitVectors(
            Y_AXIS,
            dir.clone().divideScalar(len),
        );
        const mid = va.addScaledVector(dir, 0.5);
        return this.add([mid.x, mid.y, mid.z], [d, len, d], color, q);
    }

    /** Builds the mesh. Returns `null` when the batch is empty. */
    build(
        name: string,
        geometry: BufferGeometry,
        material: Material,
    ): InstancedMesh | null {
        if (this.items.length === 0) return null;
        const mesh = new InstancedMesh(geometry, material, this.items.length);
        mesh.name = name;
        this.items.forEach((it, i) => {
            mesh.setMatrixAt(i, it.matrix);
            mesh.setColorAt(i, it.color);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        return mesh;
    }
}

/** A quaternion turning +Y onto the direction from `a` to `b`. */
export function aimY(a: Vector3Tuple, b: Vector3Tuple): Quaternion {
    const dir = new Vector3(...b).sub(new Vector3(...a)).normalize();
    return new Quaternion().setFromUnitVectors(Y_AXIS, dir);
}

/** A rotation of `angle` radians about +Y. */
export function yaw(angle: number): Quaternion {
    return new Quaternion().setFromAxisAngle(Y_AXIS, angle);
}

/** A flat rectangle for `quadsGeometry`. */
export interface Quad {
    center: Vector3Tuple;
    /** Half the width, pointing to the quad's right as seen from the front. */
    right: Vector3Tuple;
    /** Half the height, pointing up the quad. */
    up: Vector3Tuple;
    /** Texture rectangle `[u0, v0, u1, v1]`; default the whole texture. */
    uv?: [number, number, number, number];
}

/**
 * Merges flat rectangles into one geometry, so several decals sharing a
 * texture (an atlas, a repeating curtain) cost one draw call.
 */
export function quadsGeometry(quads: Quad[]): BufferGeometry {
    const position = new Float32Array(quads.length * 12);
    const normal = new Float32Array(quads.length * 12);
    const uv = new Float32Array(quads.length * 8);
    const index: number[] = [];
    const c = new Vector3();
    const r = new Vector3();
    const u = new Vector3();
    const n = new Vector3();
    quads.forEach((q, i) => {
        c.set(...q.center);
        r.set(...q.right);
        u.set(...q.up);
        n.crossVectors(r, u).normalize();
        const [u0, v0, u1, v1] = q.uv ?? [0, 0, 1, 1];
        const corners: [number, number, number, number][] = [
            [-1, -1, u0, v0],
            [1, -1, u1, v0],
            [1, 1, u1, v1],
            [-1, 1, u0, v1],
        ];
        corners.forEach(([a, b, tu, tv], k) => {
            const j = i * 4 + k;
            position[j * 3] = c.x + r.x * a + u.x * b;
            position[j * 3 + 1] = c.y + r.y * a + u.y * b;
            position[j * 3 + 2] = c.z + r.z * a + u.z * b;
            normal.set([n.x, n.y, n.z], j * 3);
            uv[j * 2] = tu;
            uv[j * 2 + 1] = tv;
        });
        const b = i * 4;
        index.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(position, 3));
    g.setAttribute("normal", new BufferAttribute(normal, 3));
    g.setAttribute("uv", new BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeBoundingSphere();
    return g;
}
