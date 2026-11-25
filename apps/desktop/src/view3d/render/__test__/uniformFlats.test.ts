/**
 * The flats patch on the uniform shader (render/uniform-flats.js): it finds
 * the lines it replaces in the real shader, and a look without flats keeps
 * its program.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { createUniformMaterial } from "../uniform-shader.js";
import { withFlats } from "../uniform-flats.js";
import type { FlatsLayout } from "@/view3d/core/marchers/uniformArtwork";

const layout = JSON.parse(
    fs.readFileSync(
        path.resolve(__dirname, "../../assets/uniform-flats/layout.json"),
        "utf8",
    ),
) as FlatsLayout;

/** Runs a material's onBeforeCompile on three's standard shader. */
function compile(material: THREE.Material) {
    const shader = {
        uniforms: {} as Record<string, { value: unknown }>,
        vertexShader: THREE.ShaderLib.standard.vertexShader,
        fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    material.onBeforeCompile(
        shader as unknown as THREE.WebGLProgramParametersWithUniforms,
        {} as THREE.WebGLRenderer,
    );
    return shader;
}

describe("withFlats", () => {
    const params = {
        layout,
        body: "neutral-average",
        lut: new THREE.DataTexture(),
        atlas: new THREE.Texture(),
        atlasRect: {
            w: 68,
            h: 61,
            front: [0, -16] as const,
            back: [34, -16] as const,
            cape: null,
            dpi: 16,
        },
    };

    it("mixes the art over the palette and draws the arm wedge and glove slivers as sleeve", () => {
        const shader = compile(
            withFlats(THREE, createUniformMaterial(THREE), params),
        );
        const fs = shader.fragmentShader;
        expect(fs).toContain("vec4 omArt = omFlatArt();");
        expect(fs).toContain("uniformColor() * (1.0 - omArt.a) + omArt.rgb");
        // uniformColor() takes its part from omFlatPart(), declared before it
        const body = fs.slice(fs.indexOf("vec3 uniformColor() {"));
        expect(body).toContain("int part = omFlatPart();");
        expect(fs.indexOf("int omFlatPart()")).toBeLessThan(
            fs.indexOf("vec3 uniformColor() {"),
        );
        // the palette collar only on the neck: the yoke takes art
        expect(body).toContain("c = mix(c, uTrim, omFlatNeck() * uCollar);");
        // the neck's antialiasing (fwidth) runs in uniform control flow, before uniformColor(): never
        // inside its part branches
        const neck = fs.slice(
            fs.indexOf("float omFlatNeck() {"),
            fs.indexOf("}", fs.indexOf("float omFlatNeck() {")),
        );
        expect(neck).not.toContain("fwidth");
        expect(neck).not.toContain("return 0.0");
        const main = fs.slice(fs.indexOf("void main()"));
        expect(
            main.indexOf("omFlatNeckW = omFlatNeckWeight();"),
        ).toBeGreaterThan(-1);
        expect(main.indexOf("omFlatNeckW = omFlatNeckWeight();")).toBeLessThan(
            main.indexOf("uniformColor()"),
        );
        expect(body).not.toMatch(/over\(p\.y - [0-9.]+\) \* uCollar/);
        expect(shader.uniforms.uFlatNeckR.value).toBe(
            layout.neckR["neutral-average"],
        );
        expect(shader.uniforms.uFlatLut.value).toBe(params.lut);
        // one atlas pixel, for the hem's inset
        expect(shader.uniforms.uFlatPx.value).toBe(1 / 16);
        expect(fs).toContain("max(OM_FLAT_HEM_INSET, 1.5 * uFlatPx)");
        // and its lookup's footprint shrunk near it, so a coarser mip level doesn't reach across
        expect(fs).toContain("float reach = omFlatHemReach(gx, gy);");
        expect(shader.uniforms.uFlatArt.value).toBe(params.atlas);
        expect((shader.uniforms.uFlatSeg.value as THREE.Vector4[]).length).toBe(
            10,
        );
    });

    it("leaves a look without flats on its own program", () => {
        const plain = createUniformMaterial(THREE);
        const flats = withFlats(THREE, createUniformMaterial(THREE), params);
        expect(plain.customProgramCacheKey()).toBe("om-uniform-v1");
        expect(flats.customProgramCacheKey()).toBe("om-uniform-v1|flats");
        const fs = compile(plain).fragmentShader;
        expect(fs).not.toContain("omFlat");
        expect(fs).toContain("int part = int(vPart + 0.5);");
    });
});
