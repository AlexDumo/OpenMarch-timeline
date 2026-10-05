/**
 * Bakes a rigged figure for instanced GPU skinning.
 *
 * Every performer shares one skeleton and one geometry, so the whole band is
 * one `InstancedMesh` (one draw call, plus one per shadow pass). Instead of a
 * `SkinnedMesh` per performer, the clips are sampled once here into a table
 * of bone matrices; each instance picks its row in the vertex shader
 * (`material.ts`).
 *
 * The table is a float RGBA texture: one row per sampled pose, four texels
 * (one `mat4`, column by column) per bone. Matrices are in figure space (the
 * glTF scene root), so an instance matrix places the figure directly.
 *
 * Framework-free: it uses only three.js, so it runs in tests.
 */
import {
    AnimationMixer,
    type AnimationClip,
    type BufferGeometry,
    Matrix4,
    type Object3D,
    type SkinnedMesh,
} from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** One clip to bake. */
export interface FigureClipSpec {
    /** Key the clip is looked up by in {@link BakedFigure.clips}. */
    name: string;
    clip: AnimationClip;
    /**
     * Poses sampled over one loop. Use 1 for a held pose. Samples are spread
     * evenly over the clip's keyed range, end excluded, so a loop whose last
     * key repeats its first is sampled without a duplicate pose.
     */
    samples: number;
}

/** Where a baked clip sits in the bone table. */
export interface BakedClip {
    /** First row of the clip. */
    row: number;
    /** Rows (poses) in the clip. */
    samples: number;
    /** Seconds the clip loops over, from its first key to its last. */
    period: number;
}

export interface BakedFigure {
    /**
     * Positions, `skinIndex` and `skinWeight` only, with shared corners
     * merged. Normals are dropped: the material shades flat from screen-space
     * derivatives, so a corner needs only one vertex.
     */
    geometry: BufferGeometry;
    boneCount: number;
    /** Bone table, `boneCount * 4` texels wide and `rows` tall, RGBA. */
    bones: Float32Array;
    rows: number;
    clips: Record<string, BakedClip>;
    /** Height of the figure's rest pose, in meters. */
    height: number;
}

/** Texels per bone matrix in the table. */
export const TEXELS_PER_BONE = 4;

/** Finds the one skinned mesh in a loaded figure. */
export function findSkinnedMesh(root: Object3D): SkinnedMesh {
    let found: SkinnedMesh | null = null;
    root.traverse((object) => {
        if ((object as SkinnedMesh).isSkinnedMesh && !found)
            found = object as SkinnedMesh;
    });
    if (!found) throw new Error("Figure has no skinned mesh");
    return found;
}

/** The time range a clip is keyed over. */
export function clipKeyRange(clip: AnimationClip): {
    start: number;
    end: number;
} {
    let start = Infinity;
    let end = -Infinity;
    for (const track of clip.tracks) {
        if (track.times.length === 0) continue;
        start = Math.min(start, track.times[0]);
        end = Math.max(end, track.times[track.times.length - 1]);
    }
    if (!Number.isFinite(start)) return { start: 0, end: 0 };
    return { start, end };
}

/**
 * Samples each clip on the figure and writes the bone table.
 *
 * The figure is posed in place and left in the last sampled pose; pass a
 * figure that isn't in a scene.
 */
export function bakeFigure(
    root: Object3D,
    clips: readonly FigureClipSpec[],
): BakedFigure {
    const mesh = findSkinnedMesh(root);
    const { skeleton } = mesh;
    const boneCount = skeleton.bones.length;
    const rows = clips.reduce((sum, c) => sum + Math.max(1, c.samples), 0);
    const width = boneCount * TEXELS_PER_BONE;
    const bones = new Float32Array(width * rows * 4);

    root.updateMatrixWorld(true);
    const height = restHeight(mesh);

    // Skinned vertex in figure space:
    //   rootInverse * meshWorld * bindInverse * (bone * boneInverse) * bind
    const rootInverse = new Matrix4().copy(root.matrixWorld).invert();
    const prefix = new Matrix4();
    const offset = new Matrix4();
    const out = new Matrix4();

    const mixer = new AnimationMixer(root);
    const baked: Record<string, BakedClip> = {};
    let row = 0;
    for (const spec of clips) {
        const samples = Math.max(1, spec.samples);
        const { start, end } = clipKeyRange(spec.clip);
        const period = end - start;
        const action = mixer.clipAction(spec.clip);
        action.play();
        for (let s = 0; s < samples; s++) {
            mixer.setTime(start + (period * s) / samples);
            root.updateMatrixWorld(true);
            prefix
                .copy(rootInverse)
                .multiply(mesh.matrixWorld)
                .multiply(mesh.bindMatrixInverse);
            for (let b = 0; b < boneCount; b++) {
                offset.multiplyMatrices(
                    skeleton.bones[b].matrixWorld,
                    skeleton.boneInverses[b],
                );
                out.copy(prefix).multiply(offset).multiply(mesh.bindMatrix);
                out.toArray(bones, (row * width + b * TEXELS_PER_BONE) * 4);
            }
            row++;
        }
        action.stop();
        baked[spec.name] = { row: row - samples, samples, period };
    }
    mixer.uncacheRoot(root);

    return {
        geometry: figureGeometry(mesh.geometry),
        boneCount,
        bones,
        rows,
        clips: baked,
        height,
    };
}

/** Keeps what the skinning shader reads and merges the split corners. */
function figureGeometry(source: BufferGeometry): BufferGeometry {
    const geometry = source.clone();
    for (const name of Object.keys(geometry.attributes)) {
        if (
            name !== "position" &&
            name !== "skinIndex" &&
            name !== "skinWeight"
        )
            geometry.deleteAttribute(name);
    }
    const merged = mergeVertices(geometry);
    geometry.dispose();
    return merged;
}

function restHeight(mesh: SkinnedMesh): number {
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    return box.max.y - box.min.y;
}
