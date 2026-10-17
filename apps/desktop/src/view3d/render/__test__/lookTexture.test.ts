// @vitest-environment node
// cspell:ignore highp skinbase skinnormal
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { sectionUniform, type UniformLook } from "@/view3d/core/marchers/looks";
import {
    LOOK_TEXELS,
    LookTexture,
    lookRow,
    perLookUniforms,
} from "../lookTexture";
import { createUniformMaterial, STYLES } from "../uniform-shader.js";
import { Composer, composedSkinning } from "../composer";

const texel = (row: Float32Array, i: number) =>
    Array.from(row.subarray(i * 4, i * 4 + 4));

const linear = (hex: number) => {
    const c = new THREE.Color(hex);
    return [c.r, c.g, c.b];
};

describe("lookRow", () => {
    it("puts the palette in linear color, one texel per slot", () => {
        const look = sectionUniform("Trumpet");
        const row = lookRow(look);
        expect(row.length).toBe(LOOK_TEXELS * 4);
        const near = (a: number[], b: number[]) =>
            a.forEach((v, k) => expect(v).toBeCloseTo(b[k], 6));
        near(texel(row, 0).slice(0, 3), linear(look.colors.primary));
        near(texel(row, 9).slice(0, 3), linear(look.colors.visor));
    });

    it("puts the style and options after the palette", () => {
        const look: UniformLook = {
            ...sectionUniform("Trumpet"),
            style: "cadet",
        };
        look.options = {
            ...look.options,
            stripe: false,
            collar: true,
            cuffs: false,
            gloves: false,
            hat: true,
        };
        const row = lookRow(look);
        // style, stripe, collar, cuffs
        expect(texel(row, 10)).toEqual([STYLES.cadet.id, 0, 1, 0]);
        // mirror, hat, hat type (shako), cape
        expect(texel(row, 11)).toEqual([0, 1, 0, 0]);
        // placeholder instrument (none), gloves
        expect(texel(row, 12)).toEqual([0, 0, 0, 0]);
    });
});

/** Sixteen looks that differ in what they draw on the body. */
function sixteenLooks(): UniformLook[] {
    return Array.from({ length: 16 }, (_, i) => {
        const look = sectionUniform(i % 2 ? "Trumpet" : "Color Guard");
        return {
            ...look,
            colors: { ...look.colors, primary: 0x101010 * (i + 1) },
        };
    });
}

describe("LookTexture", () => {
    it("gives looks that draw alike on the body one row", () => {
        const looks = new LookTexture([
            sectionUniform("Trumpet", "up"),
            sectionUniform("Trumpet", "carry"),
            sectionUniform("Snare Drum"),
            sectionUniform("Color Guard"),
        ]);
        expect(looks.count).toBe(2);
        expect(looks.indexOf(sectionUniform("Trumpet", "carry"))).toBe(0);
        expect(looks.indexOf(sectionUniform("Color Guard"))).toBe(1);
        looks.dispose();
    });

    it("holds one row per look in a float texture", () => {
        const looks = new LookTexture(sixteenLooks());
        expect(looks.count).toBe(16);
        const image = looks.texture.image as {
            width: number;
            height: number;
            data: Float32Array;
        };
        expect([image.width, image.height]).toEqual([LOOK_TEXELS, 16]);
        expect(looks.texture.type).toBe(THREE.FloatType);
        expect(
            Array.from(
                image.data.subarray(5 * LOOK_TEXELS * 4, 6 * LOOK_TEXELS * 4),
            ),
        ).toEqual(Array.from(lookRow(sixteenLooks()[5])));
        looks.dispose();
    });

    it("refuses a look it doesn't hold", () => {
        const looks = new LookTexture([sectionUniform("Trumpet")]);
        expect(() => looks.indexOf(sectionUniform("Color Guard"))).toThrow(
            /not in the look texture/,
        );
        looks.dispose();
    });
});

describe("perLookUniforms", () => {
    /** Runs a material's shader patches on the real uniform shader's source. */
    function compiled(m: THREE.Material) {
        const shader = {
            uniforms: {} as Record<string, THREE.IUniform>,
            vertexShader:
                "#include <begin_vertex>\n#include <skinbase_vertex>\n#include <skinnormal_vertex>\n#include <skinning_vertex>",
            fragmentShader: "vec4 diffuseColor = vec4( diffuse, opacity );",
        };
        m.onBeforeCompile(
            shader as unknown as THREE.WebGLProgramParametersWithUniforms,
            undefined as unknown as THREE.WebGLRenderer,
        );
        return shader;
    }

    function lookMaterial() {
        const composer = { uniform: { value: null } } as unknown as Composer;
        const looks = new LookTexture([sectionUniform("Trumpet")]);
        const m = perLookUniforms(
            composedSkinning(createUniformMaterial(THREE, {}), composer),
            looks,
        );
        return { m, looks };
    }

    it("reads the palette and options from the instance's look row", () => {
        const { m, looks } = lookMaterial();
        const shader = compiled(m);
        expect(shader.uniforms.uLooks.value).toBe(looks.texture);
        expect(shader.fragmentShader).not.toMatch(/uniform vec3 uPrimary/);
        expect(shader.fragmentShader).not.toMatch(/uniform int uStyle/);
        expect(shader.fragmentShader).toContain(
            "uniform highp sampler2D uLooks;",
        );
        expect(shader.fragmentShader).toMatch(
            /vec3 uniformColor\(\) \{\n {2}loadLook\(\);/,
        );
        expect(shader.vertexShader).toContain("vLook = aLook;");
        looks.dispose();
    });

    it("gives bare hands the instance's skin tone, by the look's gloves", () => {
        const { m, looks } = lookMaterial();
        expect(compiled(m).fragmentShader).toContain(
            "if (part == 5) return uShowGloves > 0.5 ? uGloves : vSkinTone;",
        );
        expect(m.customProgramCacheKey()).toContain("per-look");
        looks.dispose();
    });
});
