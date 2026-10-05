// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
    AnimationMixer,
    type AnimationClip,
    type Group,
    Matrix4,
    Vector3,
    Vector4,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
    TEXELS_PER_BONE,
    bakeFigure,
    clipKeyRange,
    findSkinnedMesh,
    type BakedFigure,
} from "../bake";

const MARCH_SAMPLES = 48;

function load(name: string): Promise<{
    scene: Group;
    animations: AnimationClip[];
}> {
    const path = resolve(__dirname, "../../../assets/figures", name);
    const file = readFileSync(path);
    const buffer = file.buffer.slice(
        file.byteOffset,
        file.byteOffset + file.byteLength,
    );
    return new Promise((resolve, reject) =>
        new GLTFLoader().parse(buffer, "", resolve, reject),
    );
}

/** The bone matrix the shader would read for a row and bone. */
function tableMatrix(figure: BakedFigure, row: number, bone: number): Matrix4 {
    const width = figure.boneCount * TEXELS_PER_BONE;
    return new Matrix4().fromArray(
        figure.bones,
        (row * width + bone * TEXELS_PER_BONE) * 4,
    );
}

/** Skins one vertex the way the shader does, from the table. */
function skinFromTable(
    figure: BakedFigure,
    row: number,
    position: Vector3,
    index: Vector4,
    weight: Vector4,
): Vector3 {
    const sum = new Vector3();
    const indices = index.toArray();
    const weights = weight.toArray();
    for (let k = 0; k < 4; k++) {
        if (weights[k] === 0) continue;
        sum.addScaledVector(
            position.clone().applyMatrix4(tableMatrix(figure, row, indices[k])),
            weights[k],
        );
    }
    return sum;
}

describe("bakeFigure", () => {
    let body: Awaited<ReturnType<typeof load>>;
    let hold: AnimationClip;
    let march: AnimationClip;
    let figure: BakedFigure;

    beforeAll(async () => {
        const [b, h, m] = await Promise.all([
            load("body-neutral-average.glb"),
            load("clip-attention.glb"),
            load("clip-walk-in-place.glb"),
        ]);
        body = b;
        hold = h.animations[0];
        march = m.animations[0];
        figure = bakeFigure(body.scene, [
            { name: "hold", clip: hold, samples: 1 },
            { name: "march", clip: march, samples: MARCH_SAMPLES },
        ]);
    });

    it("lays the clips out row by row", () => {
        expect(figure.boneCount).toBe(23);
        expect(figure.rows).toBe(1 + MARCH_SAMPLES);
        expect(figure.clips.hold).toMatchObject({ row: 0, samples: 1 });
        expect(figure.clips.march).toMatchObject({
            row: 1,
            samples: MARCH_SAMPLES,
        });
        // Keyed from Blender frame 1 to 25 at 24 fps: a one-second loop.
        expect(figure.clips.march.period).toBeCloseTo(1, 5);
        expect(figure.bones.length).toBe(
            figure.boneCount * TEXELS_PER_BONE * figure.rows * 4,
        );
    });

    it("keeps only what the shader reads, with corners merged", () => {
        const source = findSkinnedMesh(body.scene).geometry;
        const { geometry } = figure;
        expect(Object.keys(geometry.attributes).sort()).toEqual([
            "position",
            "skinIndex",
            "skinWeight",
        ]);
        expect(geometry.attributes.position.count).toBeLessThan(
            source.attributes.position.count / 3,
        );
        // Same triangles.
        expect(geometry.index!.count).toBe(
            source.index?.count ?? source.attributes.position.count,
        );
        expect(figure.height).toBeGreaterThan(1.7);
        expect(figure.height).toBeLessThan(1.9);
    });

    it("matches three.js skinning at every sampled march pose", () => {
        const mesh = findSkinnedMesh(body.scene);
        const geometry = mesh.geometry;
        const position = geometry.attributes.position;
        const skinIndex = geometry.attributes.skinIndex;
        const skinWeight = geometry.attributes.skinWeight;
        const mixer = new AnimationMixer(body.scene);
        mixer.clipAction(march).play();
        const { start } = clipKeyRange(march);
        const { period } = figure.clips.march;

        let maxError = 0;
        for (const sample of [0, 7, 12, 25, 36, 47]) {
            mixer.setTime(start + (period * sample) / MARCH_SAMPLES);
            body.scene.updateMatrixWorld(true);
            for (let v = 0; v < position.count; v += 17) {
                const rest = new Vector3().fromBufferAttribute(position, v);
                const expected = mesh
                    .applyBoneTransform(v, rest.clone())
                    .applyMatrix4(mesh.matrixWorld);
                const actual = skinFromTable(
                    figure,
                    figure.clips.march.row + sample,
                    rest,
                    new Vector4().fromBufferAttribute(skinIndex, v),
                    new Vector4().fromBufferAttribute(skinWeight, v),
                );
                maxError = Math.max(maxError, actual.distanceTo(expected));
            }
        }
        expect(maxError).toBeLessThan(1e-5);
    });

    it("bakes a march that actually moves the feet", () => {
        const mesh = findSkinnedMesh(body.scene);
        const foot = mesh.skeleton.bones.findIndex(
            (b) => b.name === "DEF-footL",
        );
        expect(foot).toBeGreaterThan(0);
        // The left foot is highest a quarter of the way through the loop.
        const lifted = tableMatrix(
            figure,
            figure.clips.march.row + MARCH_SAMPLES / 4,
            foot,
        );
        const planted = tableMatrix(figure, figure.clips.march.row, foot);
        expect(lifted.equals(planted)).toBe(false);
    });
});
