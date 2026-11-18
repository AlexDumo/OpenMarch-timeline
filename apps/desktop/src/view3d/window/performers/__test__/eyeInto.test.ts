// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
    defaultPerformerBody,
    sectionUniform,
    type BodyType,
} from "@/view3d/core/marchers/looks";
import type { LoadedBody } from "../marchers/marcherAssets";
import {
    EYE_AT_REST,
    MarcherBodies,
    bakeForBodies,
} from "../marchers/marcherBodies";
import { STAND_Y } from "../performerData";

const root = path.resolve(__dirname, "../../../assets/om-pose");

async function parse(file: string) {
    const b = fs.readFileSync(path.join(root, file));
    return new GLTFLoader().parseAsync(
        b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        "",
    );
}

async function band(): Promise<MarcherBodies> {
    const gltf = await parse("bodies/neutral-average.glb");
    let mesh: THREE.SkinnedMesh | null = null;
    gltf.scene.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh)
            mesh = o as THREE.SkinnedMesh;
    });
    const bodies = new Map([
        ["neutral-average", { scene: gltf.scene, mesh: mesh! }],
    ]) as Map<BodyType, LoadedBody>;
    const clips = await parse("clips/clips-h100.glb");
    const bake = bakeForBodies(bodies, {
        "8to5": clips.animations.find((c) => c.name === "8to5")!,
    });
    return new MarcherBodies(
        bodies,
        bake,
        [1, 2].map((id) => ({
            body: {
                ...defaultPerformerBody(id),
                bodyType: "neutral-average" as const,
                heightClass: 1 as const,
            },
            uniform: sectionUniform("Trumpet"),
        })),
        "high",
    );
}

describe("MarcherBodies.eyeInto", () => {
    it("finds the eyes in the head, wherever the performer stands and faces", async () => {
        const bodies = await band();
        const xz = new Float32Array([3, -2, -10, 4]);
        const heading = new Float32Array([0, Math.PI / 2]);
        bodies.writeFrame(xz, heading, new Uint8Array([1, 1]), 0);
        const eye: [number, number, number] = [0, 0, 0];

        expect(bodies.eyeInto(0, 3, -2, 0, 0, eye)).toBe(true);
        // standing, the eyes are near where they are at rest
        expect(eye[0]).toBeCloseTo(3, 1);
        expect(eye[1]).toBeCloseTo(STAND_Y + EYE_AT_REST[1], 1);
        expect(eye[2] - -2).toBeGreaterThan(-0.15);
        expect(eye[2] - -2).toBeLessThan(0.3);

        // facing +x, the face is on the +x side of the axis, raised by a platform
        expect(bodies.eyeInto(1, -10, 4, Math.PI / 2, 1.5, eye)).toBe(true);
        expect(eye[0] - -10).toBeGreaterThan(-0.15);
        expect(eye[0] - -10).toBeLessThan(0.3);
        expect(eye[2]).toBeCloseTo(4, 1);
        expect(eye[1]).toBeCloseTo(STAND_Y + 1.5 + EYE_AT_REST[1], 1);
        bodies.dispose();
    });
});
