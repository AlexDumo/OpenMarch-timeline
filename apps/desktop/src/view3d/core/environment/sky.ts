import { Mesh, SphereGeometry } from "three";
import type { LightingPreset } from "../types";
import { lightingValues } from "./lighting";
import { createSkyMaterial, setSkyPreset } from "./skyShader";
import { ft } from "./units";

/** Radius of the sky dome in meters. The camera's far plane must exceed it. */
export const SKY_RADIUS = ft(5000);

export interface SkyDome {
    mesh: Mesh;
    /** Overrides the zenith and horizon colors (clouds and sun stay). */
    setColors(top: number, bottom: number): void;
    /** Applies a preset: gradient, sun, clouds, stars and moon (and shows or hides the dome). */
    setPreset(preset: LightingPreset): void;
    dispose(): void;
}

/**
 * The procedural sky dome (see `skyShader.ts`): gradient, sun and glow,
 * clouds, stars and moon. One draw call, no textures. Ignores fog.
 */
export function createSkyDome(
    options: { quality?: "low" | "high" } = {},
): SkyDome {
    const material = createSkyMaterial({ quality: options.quality });
    const geometry = new SphereGeometry(SKY_RADIUS, 48, 24);
    const mesh = new Mesh(geometry, material);
    mesh.name = "sky";
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;

    return {
        mesh,
        setColors(top, bottom) {
            material.uniforms.uTop.value.setHex(top);
            material.uniforms.uHorizon.value.setHex(bottom);
        },
        setPreset(preset) {
            setSkyPreset(material, preset);
            mesh.visible = lightingValues(preset).skyVisible;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
