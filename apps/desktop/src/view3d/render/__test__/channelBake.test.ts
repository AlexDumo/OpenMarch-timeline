import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { bakeClips } from "../instanced-marchers.js";
import { bakeChannels } from "../channelBake";
import { rowTexel } from "../bakeLayout";
import { hold } from "@/view3d/core/instruments/holds";
import {
    armHold,
    holdRowName,
} from "@/view3d/window/performers/marchers/hornRows";

const root = path.resolve(__dirname, "../../assets/om-pose");

async function gltf(file: string) {
    const b = fs.readFileSync(path.join(root, file));
    const ab = new ArrayBuffer(b.byteLength);
    new Uint8Array(ab).set(b);
    return new GLTFLoader().parseAsync(ab, "");
}

async function fixture() {
    const body = await gltf("bodies/neutral-average.glb");
    let mesh: THREE.SkinnedMesh | null = null;
    body.scene.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh)
            mesh = o as THREE.SkinnedMesh;
    });
    const clips = new Map<string, THREE.AnimationClip>();
    for (const c of (await gltf("clips/clips-h100.glb")).animations)
        clips.set(c.name, c);
    return { scene: body.scene, mesh: mesh! as THREE.SkinnedMesh, clips };
}

/** Bone `bone`'s matrix in row `row` of a bake laid out `bones` wide. */
function boneAt(
    data: Float32Array,
    width: number,
    layout: { rowsPerColumn: number; bones: number },
    row: number,
    bone: number,
) {
    const [x, y] = rowTexel(layout, row, bone);
    return new THREE.Matrix4().fromArray(data, (y * width + x) * 4);
}

describe("bakeChannels", () => {
    it("samples a Feet row as om-pose's bakeClips does, bone for bone", async () => {
        const f = await fixture();
        const feet = {
            attention: f.clips.get("attention")!,
            "8to5": f.clips.get("8to5")!,
        };
        const ours = bakeChannels(f.scene, { feet });
        const theirs = bakeClips(THREE, f.scene, feet);
        const a = ours.texture.image.data as Float32Array;
        const b = theirs.texture.image.data as Float32Array;
        let worst = 0;
        for (const name of Object.keys(feet)) {
            expect(ours.rows[name].frames).toBe(theirs.rows[name].frames);
            for (let i = 0; i <= ours.rows[name].frames; i++)
                for (let bone = 0; bone < theirs.bones; bone++) {
                    const m = boneAt(
                        a,
                        ours.layout.width,
                        ours.layout,
                        ours.rows[name].row + i,
                        bone,
                    ).elements;
                    const n = boneAt(
                        b,
                        theirs.texture.image.width,
                        {
                            rowsPerColumn: theirs.rowsPerColumn,
                            bones: theirs.bones,
                        },
                        theirs.rows[name].row + i,
                        bone,
                    ).elements;
                    for (let k = 0; k < 16; k++)
                        worst = Math.max(worst, Math.abs(m[k] - n[k]));
                }
        }
        // the root's bottom row holds the leg turn's data in both
        expect(worst).toBeLessThan(1e-6);
    });

    it("bakes a hold as one Horn row whose prop bone holds the instrument where the hold places it", async () => {
        const f = await fixture();
        const h = hold("brass", "carry");
        const bake = bakeChannels(f.scene, {
            feet: { attention: f.clips.get("attention")! },
            horn: [
                {
                    name: holdRowName("brass:carry"),
                    from: armHold(f.mesh.skeleton, "brass", "carry"),
                },
            ],
        });
        const row = bake.rows[holdRowName("brass:carry")];
        expect(row).toMatchObject({ frames: 1, channel: "horn" });
        const prop = boneAt(
            bake.texture.image.data as Float32Array,
            bake.layout.width,
            bake.layout,
            row.row,
            bake.propBone,
        );
        // holds.ts: the instrument's origin, its bell along bellAxis
        const origin = new THREE.Vector3().applyMatrix4(prop);
        expect(
            origin.distanceTo(new THREE.Vector3(...h.instrument.origin)),
        ).toBeLessThan(1e-4);
        const bell = new THREE.Vector3(0, 0, 1).applyMatrix4(prop).sub(origin);
        expect(
            bell.distanceTo(new THREE.Vector3(...h.instrument.bellAxis)),
        ).toBeLessThan(1e-4);
    });

    it("gives a Feet row's prop bone the right hand's matrix", async () => {
        const f = await fixture();
        const bake = bakeChannels(f.scene, {
            feet: { "8to5": f.clips.get("8to5")! },
        });
        const handR = bake.boneNames.indexOf("DEF-handR");
        const data = bake.texture.image.data as Float32Array;
        for (const i of [0, 7, 30]) {
            const r = bake.rows["8to5"].row + i;
            expect(
                boneAt(data, bake.layout.width, bake.layout, r, bake.propBone)
                    .elements,
            ).toEqual(
                boneAt(data, bake.layout.width, bake.layout, r, handR).elements,
            );
        }
    });
});
