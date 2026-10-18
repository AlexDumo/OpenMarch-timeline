// cspell:ignore highp nvec
/**
 * Per-look uniform data (package C4.3, ADR 0004 step 6): each look's palette,
 * style and options in one row of a float `DataTexture`, which the uniform
 * shader reads by each instance's `aLook` instead of from material uniforms.
 * Every look then shares one material and one mesh per body type, so a band
 * of 16 uniforms draws with the same calls as one. Parts a look doesn't wear
 * are discarded per instance by the shader's own rules (`partVisible`).
 *
 * A row is LOOK_TEXELS RGBA texels:
 *
 * - 0 to 9: the palette (`PALETTE_SLOTS`), linear RGB;
 * - 10: style id, stripe, collar, cuffs;
 * - 11: mirror, hat, hat type (`HAT_TYPES` index), cape;
 * - 12: placeholder instrument (`INSTRUMENTS` index), gloves.
 */
import * as THREE from "three";
import { bodyKey, type UniformLook } from "@/view3d/core/marchers/looks";
import {
    DEFAULT_OPTIONS,
    HAT_TYPES,
    INSTRUMENTS,
    PALETTE_SLOTS,
    STYLES,
} from "./uniform-shader.js";

/** RGBA texels per look row. */
export const LOOK_TEXELS = 16;

const flag = (v: unknown) => (v ? 1 : 0);

/** One look's row: the palette in linear color, then its style and options. */
export function lookRow(look: UniformLook): Float32Array {
    const row = new Float32Array(LOOK_TEXELS * 4);
    const color = new THREE.Color();
    PALETTE_SLOTS.forEach((slot, i) => {
        color.set(look.colors[slot as keyof UniformLook["colors"]] ?? 0x888888);
        row.set([color.r, color.g, color.b, 1], i * 4);
    });
    const style = STYLES[look.style] ?? STYLES.classic;
    // the same merge as `createUniformMaterial`
    const o: Record<string, unknown> = {
        ...DEFAULT_OPTIONS,
        ...(style.defaults ?? {}),
        ...look.options,
    };
    row.set([style.id, flag(o.stripe), flag(o.collar), flag(o.cuffs)], 10 * 4);
    row.set(
        [
            flag(o.mirror),
            flag(o.hat),
            Math.max(0, HAT_TYPES.indexOf(o.hatType as string)),
            flag(o.cape),
        ],
        11 * 4,
    );
    row.set(
        [
            Math.max(0, INSTRUMENTS.indexOf(o.instrument as string)),
            flag(o.gloves ?? true),
            0,
            0,
        ],
        12 * 4,
    );
    return row;
}

/** The distinct body looks of a marcher set, one texture row each (`bodyKey`). */
export class LookTexture {
    readonly texture: THREE.DataTexture;
    private readonly rows = new Map<string, number>();

    constructor(looks: readonly UniformLook[]) {
        const distinct: UniformLook[] = [];
        for (const look of looks) {
            const key = bodyKey(look);
            if (this.rows.has(key)) continue;
            this.rows.set(key, distinct.length);
            distinct.push(look);
        }
        const data = new Float32Array(
            Math.max(distinct.length, 1) * LOOK_TEXELS * 4,
        );
        distinct.forEach((look, i) =>
            data.set(lookRow(look), i * LOOK_TEXELS * 4),
        );
        this.texture = new THREE.DataTexture(
            data,
            LOOK_TEXELS,
            Math.max(distinct.length, 1),
            THREE.RGBAFormat,
            THREE.FloatType,
        );
        this.texture.minFilter = THREE.NearestFilter;
        this.texture.magFilter = THREE.NearestFilter;
        this.texture.needsUpdate = true;
    }

    /** How many rows: the set's distinct body looks. */
    get count(): number {
        return this.rows.size;
    }

    /** The row of a look in this set. */
    indexOf(look: UniformLook): number {
        const row = this.rows.get(bodyKey(look));
        if (row === undefined)
            throw new Error("3D View: look is not in the look texture");
        return row;
    }

    dispose(): void {
        this.texture.dispose();
    }
}

/** The uniform shader's declarations the look row replaces (`uniform-shader.js`). */
const DECLARATIONS: readonly [string, string][] = [
    [
        "uniform vec3 uPrimary, uSecondary, uAccent, uTrim, uPants, uShoes, uGloves, uHat, uPlume, uVisor, uSkin;",
        "uniform vec3 uSkin;\nvec3 uPrimary, uSecondary, uAccent, uTrim, uPants, uShoes, uGloves, uHat, uPlume, uVisor;",
    ],
    ["uniform int uStyle;", "int uStyle;"],
    [
        "uniform float uStripe, uCollar, uCuffs, uMirror, uShowHat, uHatType, uCape, uInstrument;",
        "float uStripe, uCollar, uCuffs, uMirror, uShowHat, uHatType, uCape, uInstrument, uShowGloves;",
    ],
    ["vec3 uniformColor() {", "vec3 uniformColor() {\n  loadLook();"],
    [
        "if (part == 5) return uGloves;",
        "if (part == 5) return uShowGloves > 0.5 ? uGloves : vSkinTone;",
    ],
];

const LOAD_LOOK = /* glsl */ `
uniform highp sampler2D uLooks;
varying float vLook;
vec4 lookTexel(int i) { return texelFetch(uLooks, ivec2(i, int(vLook + 0.5)), 0); }
void loadLook() {
  uPrimary = lookTexel(0).rgb; uSecondary = lookTexel(1).rgb; uAccent = lookTexel(2).rgb;
  uTrim = lookTexel(3).rgb; uPants = lookTexel(4).rgb; uShoes = lookTexel(5).rgb;
  uGloves = lookTexel(6).rgb; uHat = lookTexel(7).rgb; uPlume = lookTexel(8).rgb;
  uVisor = lookTexel(9).rgb;
  vec4 a = lookTexel(10), b = lookTexel(11), c = lookTexel(12);
  uStyle = int(a.x + 0.5); uStripe = a.y; uCollar = a.z; uCuffs = a.w;
  uMirror = b.x; uShowHat = b.y; uHatType = b.z; uCape = b.w;
  uInstrument = c.x; uShowGloves = c.y;
}
`;

/**
 * Patches a uniform material that `composedSkinning` already skins so its
 * palette and options come from each instance's row in `looks`, and bare
 * hands take the instance's skin tone. Instances need an `aLook` attribute
 * (their row). Returns the same material.
 */
export function perLookUniforms<M extends THREE.Material>(
    material: M,
    looks: LookTexture,
): M {
    const base = material.onBeforeCompile;
    const key = material.customProgramCacheKey();
    const uniform = { value: looks.texture };
    material.onBeforeCompile = (shader, renderer) => {
        base.call(material, shader, renderer);
        shader.uniforms.uLooks = uniform;
        let fragment = shader.fragmentShader;
        for (const [from, to] of DECLARATIONS) {
            if (!fragment.includes(from))
                throw new Error(
                    `perLookUniforms: the uniform shader no longer has "${from}"`,
                );
            fragment = fragment.replace(from, to);
        }
        // after the declarations, before uniformColor()
        shader.fragmentShader = fragment.replace(
            "vec3 uniformColor() {",
            `${LOAD_LOOK}\nvec3 uniformColor() {`,
        );
        shader.vertexShader =
            "attribute float aLook;\nvarying float vLook;\n" +
            shader.vertexShader.replace(
                "#include <begin_vertex>",
                "#include <begin_vertex>\n  vLook = aLook;",
            );
    };
    material.customProgramCacheKey = () => key + "|per-look";
    return material;
}
