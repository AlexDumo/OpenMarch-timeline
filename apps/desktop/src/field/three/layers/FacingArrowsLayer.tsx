import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
    BufferAttribute,
    DoubleSide,
    DynamicDrawUsage,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    Mesh,
    ShaderMaterial,
} from "three";
import type { FieldTheme } from "@openmarch/core";
import type { FieldMarchers } from "../fieldMarchers";
import type { FieldDimming } from "../fieldDimming";
import { useFieldDraw } from "../fieldDrawContext";
import type { LabelIcons } from "@/cues/useEquipmentIcons";
import type { EquipmentIconPlace } from "@/cues/equipmentIcons";
import type { FieldFacing } from "@/cues/useFieldFacing";
import { arrowSizes, ICON_DOT_REACH } from "../facingArrow";

/**
 * Facing arrows (fork #1316): every performer's arrow from their dot toward where they face, in
 * one instanced draw, shaded in the fragment shader so edges are smooth without MSAA (as the
 * dots). Each instance is a quad laid along its facing; the shape is a signed distance (a shaft
 * and a triangular head, `facingArrow.ts`'s sizes) in the theme's label ink, edged with a halo of
 * the field's background so it reads over yard lines, dots and paths in every field theme.
 *
 * Drawn under the dots (a neighbor's dot covers an arrow that reaches it) and over the labels,
 * which move off it.
 */
const VERTEX = /* glsl */ `
attribute vec2 aPos;
attribute vec2 aDir;
attribute vec2 aStyle;
uniform float uStart;
uniform float uTip;
uniform float uHalf;
varying vec2 vLocal;
varying float vOpacity;
varying float vStart;
void main() {
    vOpacity = aStyle.x;
    vStart = uStart * aStyle.y;
    if (dot(aDir, aDir) == 0.0 || aStyle.x <= 0.0) {
        // No arrow: off screen
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    // u along the facing from the dot's center, v across it; position is the unit quad
    float u = mix(vStart - uHalf, vStart + uTip + uHalf, position.x * 0.5 + 0.5);
    float v = position.y * uHalf;
    vLocal = vec2(u, v);
    vec2 across = vec2(-aDir.y, aDir.x);
    gl_Position = projectionMatrix * viewMatrix * vec4(aPos + aDir * u + across * v, 0.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform float uTip;
uniform float uHeadLength;
uniform float uHeadHalf;
uniform float uShaftHalf;
uniform float uHalo;
uniform vec3 uInk;
uniform vec3 uHaloColor;
varying vec2 vLocal;
varying float vOpacity;
varying float vStart;

float box(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

/** An isosceles triangle, its tip at the origin opening toward +y, q = (half base, height). */
float triangle(vec2 p, vec2 q) {
    p.x = abs(p.x);
    vec2 a = p - q * clamp(dot(p, q) / dot(q, q), 0.0, 1.0);
    vec2 b = p - q * vec2(clamp(p.x / q.x, 0.0, 1.0), 1.0);
    float s = -sign(q.y);
    vec2 d = min(vec2(dot(a, a), s * (p.x * q.y - p.y * q.x)), vec2(dot(b, b), s * (p.y - q.y)));
    return -sqrt(d.x) * sign(d.y);
}

void main() {
    float tip = vStart + uTip;
    float neck = tip - uHeadLength;
    // The shaft runs a little into the head so the two join without a seam
    float shaftEnd = neck + 0.5 * uHeadLength;
    float shaft = box(vLocal - vec2(0.5 * (vStart + shaftEnd), 0.0), vec2(0.5 * (shaftEnd - vStart), uShaftHalf));
    float head = triangle(vec2(vLocal.y, tip - vLocal.x), vec2(uHeadHalf, uHeadLength));
    float d = min(shaft, head);
    float aa = 0.5 * fwidth(d);
    float ink = 1.0 - smoothstep(-aa, aa, d);
    float edge = 1.0 - smoothstep(uHalo - aa, uHalo + aa, d);
    float a = edge * vOpacity;
    if (a < 0.004) discard;
    vec3 rgb = mix(uHaloColor, uInk, ink / max(edge, 1e-4));
    gl_FragColor = vec4(rgb, a);
}`;

type Drawn = {
    version: number;
    idsVersion: number;
    appearanceVersion: number;
    dimVersion: number;
    facing: FieldFacing | null;
    iconDotsKey: string;
};

const rgb01 = (c: { r: number; g: number; b: number }) =>
    [c.r / 255, c.g / 255, c.b / 255] as const;

/** Each performer's facing arrow at the beat drawn, while Show facing is on (`facing` not null). */
export default function FacingArrowsLayer({
    marchers,
    dimming,
    theme,
    facing,
    icons = null,
    iconPlace = "beside",
}: {
    marchers: FieldMarchers;
    /** Marchers drawn dimmed (#201): their arrows fade as their dots do */
    dimming: FieldDimming;
    theme: FieldTheme;
    /** Which way each performer faces at the beat drawn; null draws no arrows */
    facing: FieldFacing | null;
    /** In place of the dot, an equipment icon stands on the spot: the arrow starts past it */
    icons?: LabelIcons | null;
    iconPlace?: EquipmentIconPlace;
}) {
    const invalidate = useThree((s) => s.invalidate);
    const draw = useFieldDraw();
    const drawn = useRef<Drawn>({
        version: -1,
        idsVersion: -1,
        appearanceVersion: -1,
        dimVersion: -1,
        facing: null,
        iconDotsKey: "",
    });

    const mesh = useMemo(() => {
        const geometry = new InstancedBufferGeometry();
        geometry.setAttribute(
            "position",
            new BufferAttribute(
                new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
                3,
            ),
        );
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        geometry.instanceCount = 0;
        const arrows = new Mesh(
            geometry,
            new ShaderMaterial({
                vertexShader: VERTEX,
                fragmentShader: FRAGMENT,
                uniforms: {
                    uStart: { value: 0 },
                    uTip: { value: 0 },
                    uHalf: { value: 0 },
                    uHeadLength: { value: 0 },
                    uHeadHalf: { value: 0 },
                    uShaftHalf: { value: 0 },
                    uHalo: { value: 0 },
                    uInk: { value: [0, 0, 0] },
                    uHaloColor: { value: [1, 1, 1] },
                },
                transparent: true,
                depthTest: false,
                depthWrite: false,
                side: DoubleSide,
            }),
        );
        arrows.frustumCulled = false;
        // Over the labels (1.9), which move off arrows, and under the dots (2)
        arrows.renderOrder = 1.95;
        return arrows;
    }, []);

    useEffect(() => invalidate(), [theme, facing, icons, invalidate]);
    useEffect(() => dimming.subscribe(invalidate), [dimming, invalidate]);
    useEffect(
        () => () => {
            mesh.geometry.dispose();
            mesh.material.dispose();
        },
        [mesh],
    );

    useFrame(() => {
        mesh.visible = facing !== null;
        if (!facing) {
            drawn.current.facing = null;
            return;
        }
        const { zoom } = draw.view.getState();
        const sizes = arrowSizes(zoom);
        const { uniforms } = mesh.material;
        uniforms.uStart.value = sizes.start;
        uniforms.uTip.value = sizes.length;
        uniforms.uHalf.value = sizes.headHalfWidth + sizes.halo + 1 / zoom;
        uniforms.uHeadLength.value = sizes.headLength;
        uniforms.uHeadHalf.value = sizes.headHalfWidth;
        uniforms.uShaftHalf.value = sizes.shaftHalfWidth;
        uniforms.uHalo.value = sizes.halo;
        uniforms.uInk.value = rgb01(theme.defaultMarcher.label);
        uniforms.uHaloColor.value = rgb01(theme.background);

        const last = drawn.current;
        const resized = marchers.idsVersion !== last.idsVersion;
        const iconDots =
            iconPlace === "dot"
                ? (icons?.at(marchers.drawnBeat) ?? null)
                : null;
        const iconDotsKey = iconDots?.key ?? "";
        const restyled =
            resized ||
            facing !== last.facing ||
            iconDotsKey !== last.iconDotsKey ||
            marchers.appearanceVersion !== last.appearanceVersion ||
            dimming.version !== last.dimVersion;
        if (!restyled && marchers.version === last.version) return;
        const geometry = mesh.geometry;
        if (resized || !geometry.getAttribute("aPos")) {
            geometry.dispose();
            const n = marchers.ids.length;
            const dynamic = (array: Float32Array, size: number) => {
                const a = new InstancedBufferAttribute(array, size);
                a.setUsage(DynamicDrawUsage);
                return a;
            };
            geometry.setAttribute("aPos", dynamic(new Float32Array(n * 2), 2));
            geometry.setAttribute("aDir", dynamic(new Float32Array(n * 2), 2));
            geometry.setAttribute(
                "aStyle",
                dynamic(new Float32Array(n * 2), 2),
            );
            geometry.instanceCount = n;
        }
        const instanced = (name: string) =>
            geometry.getAttribute(name) as InstancedBufferAttribute;
        if (restyled) {
            // Opacity (hidden marchers and items have none), and where the tail starts
            const style = instanced("aStyle");
            const styles = style.array as Float32Array;
            marchers.ids.forEach((id, i) => {
                const shown = !marchers.hidden[i] && !marchers.isItem[i];
                styles[i * 2] = shown ? dimming.opacityOf(id) : 0;
                styles[i * 2 + 1] = iconDots?.icons.has(id)
                    ? ICON_DOT_REACH
                    : 1;
            });
            style.needsUpdate = true;
        }
        const positions = instanced("aPos");
        (positions.array as Float32Array).set(marchers.positions);
        positions.needsUpdate = true;
        // Facing turns with the beat: written on every fill
        const directions = instanced("aDir");
        if (marchers.drawnBeat === null)
            (directions.array as Float32Array).fill(0);
        else
            facing.write(
                marchers.ids,
                marchers.drawnBeat,
                directions.array as Float32Array,
            );
        directions.needsUpdate = true;
        drawn.current = {
            version: marchers.version,
            idsVersion: marchers.idsVersion,
            appearanceVersion: marchers.appearanceVersion,
            dimVersion: dimming.version,
            facing,
            iconDotsKey,
        };
    });

    return <primitive object={mesh} />;
}
