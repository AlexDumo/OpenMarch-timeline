import { BackSide, Color, ShaderMaterial, Vector3 } from "three";
import type { LightingPreset } from "../types";
import { lightingValues } from "./lighting";

/**
 * The procedural sky, shared by the visible dome (`sky.ts`) and the
 * environment map (`envMap.ts`). Everything is a function of the view
 * direction, so it needs no texture and no network:
 *
 * - a three-stop gradient (zenith, mid, horizon) with a thin haze band;
 * - a glow and a disk for the sun, banded warm at dusk;
 * - fbm clouds on a flat layer, shaded on the side away from the sun;
 * - stars and a cratered moon at night;
 * - a faint ground color below the horizon so the dome never shows a seam.
 */
export interface SkyMaterialOptions {
    /** "low" uses fewer cloud octaves and no craters. Default "high". */
    quality?: "low" | "high";
    /** Scales the sun disk and glow. Reflections use more than the dome. */
    sunBoost?: number;
}

const VERTEX = /* glsl */ `
varying vec3 vP;
void main() {
    vP = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragment = (octaves: number, craters: boolean) => /* glsl */ `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSunColor;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uGlowStrength;
uniform float uCover;
uniform float uStars;
uniform float uMoon;
uniform float uBoost;
varying vec3 vP;

float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
        mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x),
        f.y);
}
float fbm(vec2 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < ${octaves}; i++) {
        s += a * vnoise(p);
        p = p * 2.03 + vec2(17.1, 9.2);
        a *= 0.5;
    }
    return s;
}

void main() {
    vec3 d = normalize(vP);
    float h = d.y;
    float up = max(h, 0.0);

    // Gradient: horizon -> mid -> zenith.
    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.32, up));
    col = mix(col, uTop, smoothstep(0.18, 0.95, up));
    // Thin haze right at the horizon, brighter than the gradient.
    col = mix(col, uHorizon * 1.06, exp(-up * 22.0) * 0.55);

    float sd = dot(d, uSunDir);
    // Wide glow, tight at the horizon on the sun's side (dusk bands).
    float wide = pow(max(sd, 0.0), 5.0);
    float tight = pow(max(sd, 0.0), 60.0);
    float lowBand = exp(-up * 7.0);
    col += uGlow * (wide * 0.35 + tight * 0.55) * uGlowStrength * (0.35 + lowBand) * uBoost;
    // Cooler band opposite the sun at dusk (Belt of Venus).
    float anti = pow(max(-sd, 0.0), 3.0) * exp(-up * 9.0);
    col = mix(col, uMid * 1.15, anti * 0.25 * uGlowStrength);

    // Clouds on a flat layer: the nearer the horizon, the smaller they get.
    float ch = h + 0.14;
    if (uCover > 0.01 && ch > 0.0) {
        vec2 p = d.xz / ch * 1.15 + vec2(3.7, 1.3);
        float n = fbm(p);
        float lo = 0.62 - uCover * 0.5;
        float c = smoothstep(lo, lo + 0.22, n);
        // Fade toward the horizon and thin at the zenith.
        c *= smoothstep(0.015, 0.2, h) * (1.0 - 0.35 * smoothstep(0.6, 1.0, h));
        // Light from the sun's side: compare density a step toward the sun.
        float n2 = fbm(p + uSunDir.xz * 0.12 / max(ch, 0.2));
        float lit = clamp(0.55 + (n - n2) * 5.5, 0.0, 1.0);
        float edge = smoothstep(lo, lo + 0.05, n) - smoothstep(lo + 0.05, lo + 0.3, n);
        vec3 cc = mix(uCloudShade, uCloudLit, lit);
        cc += uCloudLit * edge * 0.18 * smoothstep(-0.2, 0.7, sd);
        col = mix(col, cc, c * 0.92);
    }

    // Sun disk, with a soft rim.
    float disk = smoothstep(0.99985, 0.99995, sd);
    col += uSunColor * disk * 2.5 * uBoost * (1.0 - 0.0);

    // Stars: random points in cells of direction space.
    if (uStars > 0.01 && h > 0.0) {
        vec3 q = d * 170.0;
        vec3 id = floor(q);
        float r = hash13(id);
        if (r > 0.965) {
            vec3 f = fract(q) - 0.5;
            float m = 0.5 + 0.5 * hash13(id + 7.7);
            float s = smoothstep(0.34, 0.0, length(f)) * m;
            vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), hash13(id + 3.1));
            col += tint * s * uStars * smoothstep(0.02, 0.3, h) * (1.0 - pow(max(dot(d, uMoonDir), 0.0), 40.0) * 0.8);
        }
    }

    // Moon: disk, a lit side, craters and a halo.
    if (uMoon > 0.01) {
        float md = dot(d, uMoonDir);
        float halo = pow(max(md, 0.0), 120.0) * 0.35 + pow(max(md, 0.0), 14.0) * 0.12;
        col += uGlow * halo * uMoon;
        float edge = smoothstep(0.99955, 0.99965, md);
        if (edge > 0.0) {
            vec3 t1 = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
            vec3 t2 = cross(t1, uMoonDir);
            vec2 uv = vec2(dot(d, t1), dot(d, t2)) / 0.0280;
            float phase = smoothstep(-0.55, 0.15, uv.x * 0.9 + 0.35 - length(uv) * 0.0);
            float tex = 0.78 + 0.22 * vnoise(uv * 5.0 + 4.0) ${craters ? "- 0.18 * smoothstep(0.55, 0.8, vnoise(uv * 9.0))" : ""};
            col = mix(col, vec3(0.92, 0.93, 0.88) * tex * mix(0.12, 1.0, phase), edge * uMoon);
        }
    }

    // Below the horizon: fade to the horizon color so land meets the sky.
    col = mix(col, uHorizon * 0.9, smoothstep(0.0, -0.12, h));

    // Dither against banding in the gradients.
    col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(col, 1.0);
#include <colorspace_fragment>
}`;

export type SkyMaterial = ShaderMaterial;

/** Builds the sky shader material. Call `setSkyPreset` to apply a preset. */
export function createSkyMaterial(
    options: SkyMaterialOptions = {},
): SkyMaterial {
    const low = options.quality === "low";
    return new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
            uTop: { value: new Color() },
            uMid: { value: new Color() },
            uHorizon: { value: new Color() },
            uGlow: { value: new Color() },
            uSunColor: { value: new Color() },
            uCloudLit: { value: new Color() },
            uCloudShade: { value: new Color() },
            uSunDir: { value: new Vector3(0, 1, 0) },
            uMoonDir: { value: new Vector3(0, 1, 0) },
            uGlowStrength: { value: 0 },
            uCover: { value: 0 },
            uStars: { value: 0 },
            uMoon: { value: 0 },
            uBoost: { value: options.sunBoost ?? 1 },
        },
        vertexShader: VERTEX,
        fragmentShader: fragment(low ? 3 : 5, !low),
    });
}

/** Sets every uniform from a lighting preset. */
export function setSkyPreset(
    material: SkyMaterial,
    preset: LightingPreset,
): void {
    const v = lightingValues(preset);
    const a = v.atmosphere;
    const u = material.uniforms;
    u.uTop.value.setHex(v.skyTop);
    u.uMid.value.setHex(a.mid);
    u.uHorizon.value.setHex(a.horizon);
    u.uGlow.value.setHex(a.glow);
    u.uSunColor.value.setHex(a.sunColor);
    u.uCloudLit.value.setHex(a.cloudLit);
    u.uCloudShade.value.setHex(a.cloudShade);
    u.uSunDir.value.set(...a.sunDir);
    u.uMoonDir.value.set(...a.moonDir);
    u.uGlowStrength.value = a.glowStrength;
    u.uCover.value = a.cloudCover;
    u.uStars.value = a.stars;
    u.uMoon.value = a.moon;
}
