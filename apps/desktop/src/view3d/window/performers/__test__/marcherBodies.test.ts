// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { BufferGeometry, SkinnedMesh } from "three";
import type * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { sectionUniform, type BodyType } from "@/view3d/core/marchers/looks";
import type { LoadedBody } from "../marchers/marcherAssets";
import { defaultPerformerBody } from "@/view3d/core/marchers/looks";
import {
    MarcherBodies,
    NO_HOLD,
    bakeForBodies,
    rowKey,
    slotHoldId,
    visibleIndex,
} from "../marchers/marcherBodies";

async function body(): Promise<BufferGeometry> {
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
    let geo: BufferGeometry | null = null;
    gltf.scene.traverse((o) => {
        if ((o as SkinnedMesh).isSkinnedMesh) geo = (o as SkinnedMesh).geometry;
    });
    return geo!;
}

async function loadedBodies() {
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
    let mesh: SkinnedMesh | null = null;
    gltf.scene.traverse((o) => {
        if ((o as SkinnedMesh).isSkinnedMesh) mesh = o as SkinnedMesh;
    });
    return new Map([
        ["neutral-average", { scene: gltf.scene, mesh: mesh! }],
    ]) as Map<BodyType, LoadedBody>;
}

async function clip8to5() {
    const b = fs.readFileSync(
        path.resolve(__dirname, "../../../assets/om-pose/clips/clips-h100.glb"),
    );
    const gltf = await new GLTFLoader().parseAsync(
        b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        "",
    );
    return gltf.animations.find((c) => c.name === "8to5")!;
}

describe("rows per hold", () => {
    it("names rows by clip and hold, bare for no hold", () => {
        expect(rowKey("8to5", NO_HOLD)).toBe("8to5");
        expect(rowKey("8to5-h105", "brass:up")).toBe("8to5-h105@brass:up");
        expect(slotHoldId(sectionUniform("Trumpet", null, "carry"))).toBe(
            "brass:carry",
        );
        expect(slotHoldId(sectionUniform("Flute", null))).toBe(NO_HOLD);
    });

    it("bakes one row set per hold", async () => {
        const bodies = await loadedBodies();
        const clip = await clip8to5();
        const bake = bakeForBodies(bodies, { "8to5": clip }, [
            NO_HOLD,
            "brass:up",
            "brass:carry",
        ]);
        expect(Object.keys(bake.rows).sort()).toEqual([
            "8to5",
            "8to5@brass:carry",
            "8to5@brass:up",
        ]);
        expect(bake.rows["8to5@brass:up"].frames).toBe(
            bake.rows["8to5"].frames,
        );
    });
});

describe("the low tier", () => {
    it("draws the horn on the block body too", async () => {
        const bodies = await loadedBodies();
        const clip = await clip8to5();
        const bake = bakeForBodies(bodies, { "8to5": clip }, [
            "brass:up",
            NO_HOLD,
        ]);
        const looks = [
            {
                body: defaultPerformerBody(1),
                uniform: sectionUniform("Trumpet", null),
            },
            {
                body: defaultPerformerBody(2),
                uniform: sectionUniform("Flute", null),
            },
        ];
        const set = new MarcherBodies(bodies, bake, looks, "low");
        const meshes = set.group.children.filter((o) =>
            o.name.startsWith("view3d-marchers-"),
        ) as THREE.InstancedMesh[];
        expect(meshes.length).toBe(2);
        const triangles = meshes
            .map((m) => m.geometry.index!.count / 3)
            .sort((a, b) => a - b);
        // the block body alone is 264 triangles; the trumpet adds its 576
        expect(triangles[0]).toBe(264);
        expect(triangles[1]).toBe(264 + 576);
        set.dispose();
    });
});

describe("part-filtered index", () => {
    it("draws only the parts a look wears", async () => {
        const geo = await body();
        expect(geo.index!.count / 3).toBe(1796);
        const triangles = (section: string) =>
            visibleIndex(geo, sectionUniform(section, null))!.count / 3;
        // no aussie hat (64), no cape (116), no placeholder instruments (360)
        expect(triangles("Trumpet")).toBe(1256);
        // no instrument at all (360)
        expect(triangles("Flute")).toBe(1256);
        // and no shako (80)
        expect(triangles("Color Guard")).toBe(1176);
    });

    it("keeps whole triangles of visible parts only", async () => {
        const geo = await body();
        const part = geo.getAttribute("_part");
        const index = visibleIndex(geo, sectionUniform("Mellophone", null))!;
        const parts = new Set<number>();
        for (let i = 0; i < index.count; i++)
            parts.add(Math.round(part.getX(index.getX(i))));
        expect([...parts].sort((a, b) => a - b)).toEqual([
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
        ]);
    });
});
