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
import { caretSizes, ICON_DOT_REACH } from "../facingCaret";

/**
 * Facing carets (fork #1316): a small chevron just in front of every performer's dot, pointing
 * where they face, in one instanced draw, shaded in the fragment shader so edges are smooth
 * without MSAA (as the dots). Each instance is a quad laid along its facing; the shape is a signed
 * distance (two strokes meeting at a point, `facingCaret.ts`'s sizes) in the theme's label ink,
 * edged with a halo of the field's background so it reads over yard lines and paths.
 *
 * Drawn under the dots (a neighbor's dot covers a caret that reaches it) and over the labels,
 * which move off it. A selected performer's caret starts past their selection ring, which the dots
 * draw opaque: drawn over the dots instead, the caret's halo would cut the ring and the caret
 * would cover close neighbors' dots.
 */
const VERTEX = /* glsl */ `
attribute vec2 aPos;
attribute vec2 aDir;
attribute vec3 aStyle;
uniform float uStart;
uniform float uSelectedStart;
uniform float uTip;
uniform float uHalf;
varying vec2 vLocal;
varying float vOpacity;
varying float vStart;
void main() {
    vOpacity = aStyle.x;
    // Past the dot (or an icon in its place, aStyle.y dot radii), and a selection ring (aStyle.z):
    // facingCaret.ts's caretStart
    vStart = max(uStart * aStyle.y, aStyle.z * uSelectedStart);
    if (dot(aDir, aDir) == 0.0 || aStyle.x <= 0.0) {
        // No caret: off screen
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
uniform float uHalfWidth;
uniform float uStroke;
uniform float uHalo;
uniform vec3 uInk;
uniform vec3 uHaloColor;
varying vec2 vLocal;
varying float vOpacity;
varying float vStart;

float segment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

void main() {
    // A caret: two strokes from its arms, beside the dot, to its point, the way they face
    vec2 point = vec2(vStart + uTip, 0.0);
    float d = min(
        segment(vLocal, vec2(vStart, uHalfWidth), point),
        segment(vLocal, vec2(vStart, -uHalfWidth), point)
    ) - uStroke;
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
    selectionVersion: number;
    facing: FieldFacing | null;
    iconDotsKey: string;
};

const rgb01 = (c: { r: number; g: number; b: number }) =>
    [c.r / 255, c.g / 255, c.b / 255] as const;

/** Each performer's facing caret at the beat drawn, while Show facing is on (`facing` not null). */
export default function FacingCaretsLayer({
    marchers,
    dimming,
    theme,
    facing,
    icons = null,
    iconPlace = "beside",
}: {
    marchers: FieldMarchers;
    /** Marchers drawn dimmed (#201): their carets fade as their dots do */
    dimming: FieldDimming;
    theme: FieldTheme;
    /** Which way each performer faces at the beat drawn; null draws no carets */
    facing: FieldFacing | null;
    /** In place of the dot, an equipment icon stands on the spot: the caret starts past it */
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
        selectionVersion: -1,
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
        const carets = new Mesh(
            geometry,
            new ShaderMaterial({
                vertexShader: VERTEX,
                fragmentShader: FRAGMENT,
                uniforms: {
                    uStart: { value: 0 },
                    uSelectedStart: { value: 0 },
                    uTip: { value: 0 },
                    uHalf: { value: 0 },
                    uHalfWidth: { value: 0 },
                    uStroke: { value: 0 },
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
        carets.frustumCulled = false;
        // Over the labels (1.9), which move off carets, and under the dots (2)
        carets.renderOrder = 1.95;
        return carets;
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
        const sizes = caretSizes(zoom);
        const { uniforms } = mesh.material;
        uniforms.uStart.value = sizes.start;
        uniforms.uSelectedStart.value = sizes.selectedStart;
        uniforms.uTip.value = sizes.depth;
        uniforms.uHalf.value =
            sizes.halfWidth + sizes.strokeHalfWidth + sizes.halo + 1 / zoom;
        uniforms.uHalfWidth.value = sizes.halfWidth;
        uniforms.uStroke.value = sizes.strokeHalfWidth;
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
            dimming.version !== last.dimVersion ||
            marchers.selectionVersion !== last.selectionVersion;
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
                dynamic(new Float32Array(n * 3), 3),
            );
            geometry.instanceCount = n;
        }
        const instanced = (name: string) =>
            geometry.getAttribute(name) as InstancedBufferAttribute;
        if (restyled) {
            // Opacity (hidden marchers and items have none), and where the arms start: past an
            // icon in place of the dot, and past the selection ring
            const style = instanced("aStyle");
            const styles = style.array as Float32Array;
            marchers.ids.forEach((id, i) => {
                const shown = !marchers.hidden[i] && !marchers.isItem[i];
                styles[i * 3] = shown ? dimming.opacityOf(id) : 0;
                styles[i * 3 + 1] = iconDots?.icons.has(id)
                    ? ICON_DOT_REACH
                    : 1;
                styles[i * 3 + 2] = marchers.selected[i] ?? 0;
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
            (directions.array as Float32Array).set(
                facing.directions(marchers.ids, marchers.drawnBeat),
            );
        directions.needsUpdate = true;
        drawn.current = {
            version: marchers.version,
            idsVersion: marchers.idsVersion,
            appearanceVersion: marchers.appearanceVersion,
            dimVersion: dimming.version,
            selectionVersion: marchers.selectionVersion,
            facing,
            iconDotsKey,
        };
    });

    return <primitive object={mesh} />;
}
