// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { brassModel } from "@/view3d/core/instruments/brass";
import { hold } from "@/view3d/core/instruments/holds";
import { sectionUniform } from "@/view3d/core/marchers/looks";
import { poseArms } from "../marchers/armPose";
import {
    instrumentGeometry,
    withInstrument,
} from "../marchers/instrumentGeometry";
import { visibleIndex } from "../marchers/marcherBodies";

async function body() {
    const b = fs.readFileSync(
        path.resolve(
            __dirname,
            "../../../assets/om-pose/bodies/neutral-average.glb",
        ),
    );
    const gltf = await new GLTFLoader().parseAsync(
        b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        "",
    );
    let mesh: THREE.SkinnedMesh | null = null;
    gltf.scene.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh)
            mesh = o as THREE.SkinnedMesh;
    });
    return mesh!;
}

describe("instrumentGeometry", () => {
    it("weights every vertex to the right hand and keeps the parts", async () => {
        const mesh = await body();
        const h = hold("brass", "up");
        const g = instrumentGeometry(
            mesh.skeleton,
            poseArms(mesh.skeleton, h),
            h,
            brassModel("trumpet"),
        );
        const handR = mesh.skeleton.bones.findIndex(
            (b) => b.name === "DEF-handR",
        );
        const si = g.getAttribute("skinIndex");
        const sw = g.getAttribute("skinWeight");
        for (let i = 0; i < si.count; i++) {
            expect(si.getX(i)).toBe(handR);
            expect(sw.getX(i)).toBe(1);
        }
        const parts = new Set<number>();
        const part = g.getAttribute("_part");
        for (let i = 0; i < part.count; i++) parts.add(part.getX(i));
        expect([...parts].sort()).toEqual([16, 18, 22]);
    });

    it("lands on the hold's placement once skinned with the posed hand", async () => {
        const mesh = await body();
        const h = hold("brass", "up");
        const pose = poseArms(mesh.skeleton, h);
        const g = instrumentGeometry(
            mesh.skeleton,
            pose,
            h,
            brassModel("trumpet"),
        );
        const handR = mesh.skeleton.bones.findIndex(
            (b) => b.name === "DEF-handR",
        );
        // what the skinning does: bindInv * handWorld(posed) * boneInverse * bind, with bind = identity here
        const skin = pose.handR
            .clone()
            .multiply(mesh.skeleton.boneInverses[handR]);
        const box = new THREE.Box3();
        const v = new THREE.Vector3();
        const pos = g.getAttribute("position");
        for (let i = 0; i < pos.count; i++)
            box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(skin));
        const c = box.getCenter(new THREE.Vector3());
        // the trumpet runs forward from the grip: its center is ahead of the origin, near face height
        expect(c.z).toBeGreaterThan(h.instrument.origin[2]);
        expect(Math.abs(c.y - h.instrument.origin[1])).toBeLessThan(0.1);
        expect(box.max.z - box.min.z).toBeCloseTo(0.48, 1);
    });
});

describe("withInstrument", () => {
    it("appends the instrument after the look's visible body triangles", async () => {
        const mesh = await body();
        const look = sectionUniform("Trumpet", null);
        const index = visibleIndex(mesh.geometry, look);
        const h = hold("brass", "up");
        const horn = instrumentGeometry(
            mesh.skeleton,
            poseArms(mesh.skeleton, h),
            h,
            brassModel("trumpet"),
        );
        const merged = withInstrument(mesh.geometry, index, horn);
        const bodyTriangles = index!.count / 3;
        const hornTriangles = horn.index!.count / 3;
        expect(merged.index!.count / 3).toBe(bodyTriangles + hornTriangles);
        expect(merged.getAttribute("position").count).toBe(
            mesh.geometry.getAttribute("position").count +
                horn.getAttribute("position").count,
        );
        for (const name of [
            "position",
            "normal",
            "skinIndex",
            "skinWeight",
            "_part",
        ])
            expect(merged.getAttribute(name)).toBeDefined();
        // the body's own buffers are not shared with the merge: disposing the merge is safe
        expect(merged.getAttribute("position")).not.toBe(
            mesh.geometry.getAttribute("position"),
        );
    });
});
