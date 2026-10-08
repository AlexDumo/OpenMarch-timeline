/**
 * The 3D View's marchers drawn with om-pose's instanced renderer (ADR 0002
 * D-7): one `InstancedMesh` per (body, uniform), skinned on the GPU from one
 * texture of baked clips.
 *
 * - `high` quality draws the seven v4u bodies; `low` draws om-pose's block
 *   bodies (264 triangles against 1,796), which play the same clips.
 * - Built once per marcher set, look set, clip set and quality; per frame
 *   the caller writes positions and the count clock.
 * - Dispose with {@link MarcherBodies.dispose}: the instanced geometries
 *   share the bodies' vertex buffers, so they go through
 *   `disposeInstancedGeometry`, never `geometry.dispose()`.
 */
import * as THREE from "three";
import {
    bakeClips,
    blockGeometry,
    disposeInstancedGeometry,
    instancedGeometry,
    instancedSkinning,
    writeMarcher,
    writeMatrix,
    type Bake,
    type MarcherClip,
} from "@/view3d/vendor/om-pose/instanced-marchers.js";
import { createUniformMaterial } from "@/view3d/vendor/om-pose/uniform-shader.js";
import {
    uniformKey,
    type BodyType,
    type PerformerBody,
    type UniformLook,
} from "@/view3d/core/marchers/looks";
import type { LoadedBody } from "./marcherAssets";

/** One marcher's instance: which body it wears and in which uniform. */
export interface MarcherSlotLook {
    body: PerformerBody;
    uniform: UniformLook;
}

export type MarcherQuality = "low" | "high";

interface MeshEntry {
    mesh: THREE.InstancedMesh;
    /** Slot index per instance. */
    slots: number[];
}

/** Every v4u body shares one skeleton, so any of them bakes for all. */
export function bakeForBodies(
    bodies: ReadonlyMap<BodyType, LoadedBody>,
    clips: Record<string, THREE.AnimationClip>,
): Bake {
    const first = bodies.values().next().value;
    if (!first) throw new Error("3D View: no bodies to bake on");
    return bakeClips(THREE, first.scene, clips);
}

export class MarcherBodies {
    readonly group = new THREE.Group();
    readonly bake: Bake;
    private readonly entries: MeshEntry[] = [];
    private readonly materials: THREE.Material[] = [];
    private readonly blockSource: THREE.BufferGeometry | null = null;
    /** Mesh entry and instance index per slot. */
    private readonly meshOf: Int32Array;
    private readonly instanceOf: Int32Array;
    private readonly scaleOf: Float32Array;

    constructor(
        bodies: ReadonlyMap<BodyType, LoadedBody>,
        bake: Bake,
        looks: readonly MarcherSlotLook[],
        quality: MarcherQuality,
    ) {
        this.bake = bake;
        this.group.name = "view3d-marchers";
        this.meshOf = new Int32Array(looks.length).fill(-1);
        this.instanceOf = new Int32Array(looks.length);
        this.scaleOf = new Float32Array(looks.length);

        if (quality === "low") {
            const anyBody = bodies.values().next().value!;
            this.blockSource = blockGeometry(THREE, anyBody.mesh.skeleton);
        }
        // Group the slots by mesh: (body type, uniform) at high, uniform at low.
        const groups = new Map<
            string,
            { type: BodyType; look: UniformLook; slots: number[] }
        >();
        looks.forEach((l, i) => {
            const u = uniformKey(l.uniform);
            const key = quality === "low" ? u : `${l.body.bodyType}|${u}`;
            let g = groups.get(key);
            if (!g) {
                g = { type: l.body.bodyType, look: l.uniform, slots: [] };
                groups.set(key, g);
            }
            g.slots.push(i);
            this.scaleOf[i] = l.body.heightClass;
        });
        const materialByLook = new Map<string, THREE.Material>();
        for (const g of groups.values()) {
            const u = uniformKey(g.look);
            let material = materialByLook.get(u);
            if (!material) {
                material = instancedSkinning(
                    THREE,
                    createUniformMaterial(THREE, {
                        style: g.look.style,
                        colors: g.look.colors,
                        options: g.look.options,
                    }),
                    bake,
                );
                materialByLook.set(u, material);
                this.materials.push(material);
            }
            const source =
                this.blockSource ?? bodies.get(g.type)!.mesh.geometry;
            const geometry = instancedGeometry(THREE, source, g.slots.length);
            const mesh = new THREE.InstancedMesh(
                geometry,
                material,
                g.slots.length,
            );
            mesh.name = `view3d-marchers-${g.type}`;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            // The bounds are computed once and don't follow the instances.
            mesh.frustumCulled = false;
            // No shadows: om-pose's depth pass isn't patched, so a shadow
            // would show the rest pose (openmarch-3d.md, "Not done yet").
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            const entry = this.entries.length;
            g.slots.forEach((slot, k) => {
                this.meshOf[slot] = entry;
                this.instanceOf[slot] = k;
                writeMarcher(mesh, k, {
                    row: this.firstRow(),
                    skin: looks[slot].body.skinTone,
                });
            });
            this.entries.push({ mesh, slots: g.slots });
            this.group.add(mesh);
        }
    }

    private firstRow() {
        const row = Object.values(this.bake.rows)[0];
        if (!row) throw new Error("3D View: empty bake");
        return row;
    }

    /** Draw calls this set issues per frame. */
    get drawCalls(): number {
        return this.entries.length;
    }

    /** Sets what slot `slot` plays; call when its clip changes. */
    setClip(slot: number, clip: MarcherClip): void {
        const e = this.meshOf[slot];
        if (e < 0) return;
        writeMarcher(this.entries[e].mesh, this.instanceOf[slot], clip);
    }

    /**
     * Places every slot: at (x, z) facing `heading` when placed, collapsed
     * (not drawn) otherwise. `count` is the show's count clock.
     */
    writeFrame(
        xz: Float32Array,
        heading: Float32Array,
        placed: Uint8Array,
        count: number,
    ): void {
        for (const { mesh, slots } of this.entries) {
            const array = mesh.instanceMatrix.array as Float32Array;
            for (let k = 0; k < slots.length; k++) {
                const i = slots[k];
                writeMatrix(
                    array,
                    k,
                    xz[i * 2],
                    xz[i * 2 + 1],
                    heading[i],
                    placed[i] ? this.scaleOf[i] : 0,
                );
            }
            mesh.instanceMatrix.needsUpdate = true;
        }
        for (const m of this.materials)
            (
                m.userData.uniforms as { uCount: { value: number } }
            ).uCount.value = count;
    }

    dispose(): void {
        for (const { mesh } of this.entries) {
            disposeInstancedGeometry(mesh.geometry);
            mesh.dispose();
        }
        for (const m of this.materials) m.dispose();
        this.blockSource?.dispose();
        this.entries.length = 0;
        this.group.clear();
    }
}
