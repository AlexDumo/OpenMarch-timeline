// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { BufferGeometry, SkinnedMesh } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { sectionUniform } from "@/view3d/core/marchers/looks";
import { visibleIndex } from "../marchers/marcherBodies";

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

describe("part-filtered index", () => {
    it("draws only the parts a look wears", async () => {
        const geo = await body();
        expect(geo.index!.count / 3).toBe(1796);
        const triangles = (section: string) =>
            visibleIndex(geo, sectionUniform(section, null))!.count / 3;
        // no aussie hat (64), no cape (116), two of three instruments (240)
        expect(triangles("Trumpet")).toBe(1376);
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
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 14,
        ]);
    });
});
