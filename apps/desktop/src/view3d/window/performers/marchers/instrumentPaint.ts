/**
 * Paints the instrument parts (docs/3d/instruments.md §4) on om-pose's
 * uniform material without editing the vendored shader: part 16 takes the
 * look's finish (`uMetal`: gold or silver lacquer), 18 chrome, 22 black
 * hardware. Wraps the material's own `onBeforeCompile`.
 */
import type * as THREE from "three";

export const CHROME = 0xd9dde2;
export const HARDWARE_BLACK = 0x141416;

const hex = (c: number) => {
    const r = ((c >> 16) & 255) / 255;
    const g = ((c >> 8) & 255) / 255;
    const b = (c & 255) / 255;
    return `vec3(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)})`;
};

const CASES =
    `  if (part == 16) return uMetal;\n` +
    `  if (part == 18) return ${hex(CHROME)};\n` +
    `  if (part == 22) return ${hex(HARDWARE_BLACK)};\n`;

const ANCHOR = "  if (part == 0) return uSkin;";

export function paintInstruments(
    material: THREE.MeshStandardMaterial,
): THREE.MeshStandardMaterial {
    const inner = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
        inner.call(material, shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace(
            ANCHOR,
            CASES + ANCHOR,
        );
    };
    material.customProgramCacheKey = () => "om-uniform-v1+instruments";
    return material;
}
