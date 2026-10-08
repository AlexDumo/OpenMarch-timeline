// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createUniformMaterial } from "@/view3d/vendor/om-pose/uniform-shader.js";
import { paintInstruments } from "../marchers/instrumentPaint";

function compiled(material: THREE.MeshStandardMaterial) {
    const shader = {
        uniforms: {} as Record<string, unknown>,
        vertexShader: "#include <begin_vertex>",
        fragmentShader:
            "vec4 diffuseColor = vec4( diffuse, opacity );\n  if (part == 0) return uSkin;",
    };
    material.onBeforeCompile(shader as never, null as never);
    return shader;
}

describe("paintInstruments", () => {
    it("adds the instrument part cases ahead of the vendored ones", () => {
        const m = paintInstruments(
            createUniformMaterial(THREE, { options: { finish: "silver" } }),
        );
        const s = compiled(m);
        const i16 = s.fragmentShader.indexOf("part == 16");
        const i0 = s.fragmentShader.indexOf("part == 0");
        expect(i16).toBeGreaterThan(-1);
        expect(i16).toBeLessThan(i0);
        expect(s.fragmentShader).toContain("part == 18");
        expect(s.fragmentShader).toContain("part == 22");
        expect(s.fragmentShader).toContain("uniformColor()");
        expect(m.customProgramCacheKey()).toBe("om-uniform-v1+instruments");
    });

    it("keeps the vendored finish uniform for the metal", () => {
        const m = paintInstruments(
            createUniformMaterial(THREE, { options: { finish: "silver" } }),
        );
        const u = m.userData.uniforms as { uMetal: { value: THREE.Color } };
        expect(u.uMetal.value.getHex()).toBe(0xd4d8de);
    });
});
