import {
    InstancedMesh,
    Matrix4,
    Quaternion,
    Vector3,
    type BufferGeometry,
    type Material,
} from "three";

/**
 * Collects box members (chords, posts, diagonals, cables, lamps) as instance
 * matrices, so a whole roof of steel is one draw call per material.
 */
export class MemberSet {
    readonly matrices: Matrix4[] = [];
    private readonly q = new Quaternion();
    private readonly v = new Vector3();
    private readonly s = new Vector3();

    get count(): number {
        return this.matrices.length;
    }

    /** An axis-aligned box centered at `c` with full size `size`. */
    box(c: Vector3, size: Vector3): void {
        this.matrices.push(new Matrix4().compose(c, this.q.identity(), size));
    }

    /** A square-section member of thickness `t` between two points. */
    bar(a: Vector3, b: Vector3, t: number, t2 = t): void {
        const len = a.distanceTo(b);
        if (len < 1e-6) return;
        this.v.copy(b).sub(a).normalize();
        // Box length runs along local X; twist about the bar keeps Y up.
        const x = this.v.clone();
        const up =
            Math.abs(x.y) > 0.99 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
        const z = new Vector3().crossVectors(x, up).normalize();
        const y = new Vector3().crossVectors(z, x).normalize();
        const m = new Matrix4().makeBasis(x, y, z);
        const q = new Quaternion().setFromRotationMatrix(m);
        this.s.set(len, t, t2);
        this.matrices.push(
            new Matrix4().compose(
                new Vector3().addVectors(a, b).multiplyScalar(0.5),
                q,
                this.s.clone(),
            ),
        );
    }

    /**
     * A planar lattice truss between two points on the same level: top and
     * bottom chords, posts every bay and alternating diagonals.
     */
    truss(a: Vector3, b: Vector3, depth: number, bay: number, t: number): void {
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const bays = Math.max(1, Math.round(len / bay));
        const dir = new Vector3(b.x - a.x, 0, b.z - a.z).normalize();
        const at = (k: number, down: number) =>
            new Vector3(
                a.x + (dir.x * len * k) / bays,
                a.y - down,
                a.z + (dir.z * len * k) / bays,
            );
        this.bar(at(0, 0), at(bays, 0), t * 1.4);
        this.bar(at(0, depth), at(bays, depth), t * 1.4);
        for (let k = 0; k <= bays; k++) this.bar(at(k, 0), at(k, depth), t);
        for (let k = 0; k < bays; k++)
            if (k % 2) this.bar(at(k, 0), at(k + 1, depth), t * 0.8);
            else this.bar(at(k, depth), at(k + 1, 0), t * 0.8);
    }

    /** Builds one instanced mesh over `geometry` (which the caller owns). */
    mesh(
        geometry: BufferGeometry,
        material: Material,
        name: string,
    ): InstancedMesh {
        const m = new InstancedMesh(
            geometry,
            material,
            Math.max(1, this.count),
        );
        m.name = name;
        this.matrices.forEach((mat, i) => m.setMatrixAt(i, mat));
        m.count = this.count;
        m.instanceMatrix.needsUpdate = true;
        m.computeBoundingSphere();
        return m;
    }
}
