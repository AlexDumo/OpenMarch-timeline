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
import { useFieldViewStore } from "../fieldView";
import { writeMarcherLooks } from "../marcherLooks";

/**
 * Every marcher's dot in one instanced draw, shaded in the fragment shader so
 * edges are smooth without MSAA (ADR 0005 D-2). Each instance carries its look
 * (fill, outline, shape; `marcherLooks.ts`). Dots sit exactly on their
 * positions: no half-grid-line offset.
 *
 * Shapes are signed distances in field units, sized as `CanvasMarcher` and the
 * drill-chart export draw them (`drillChartSvg.ts`'s `dotSvg`): a circle of
 * radius 5, a square of side 5·√π·1.2, an equilateral triangle 12 wide, and an
 * X of two 2-wide lines out to ±6. The 1-unit outline straddles the edge, and
 * corners are mitered, as Fabric strokes them.
 */
const VERTEX = /* glsl */ `
attribute vec2 aPos;
attribute vec4 aFill;
attribute vec4 aOutline;
attribute float aShape;
uniform float uScale;
uniform float uMargin;
varying vec2 vLocal;
varying vec4 vFill;
varying vec4 vOutline;
varying float vShape;
void main() {
    vFill = aFill;
    vOutline = aOutline;
    vShape = aShape;
    if (aShape < -0.5) {
        // Hidden: every corner on one point outside the view draws nothing
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    // The largest shape (the X's line ends), plus a margin for the antialiased edge
    vLocal = position.xy * (7.0 + uMargin);
    gl_Position = projectionMatrix * viewMatrix * vec4(aPos + vLocal * uScale, 0.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `
#define DOT_R 5.0
varying vec2 vLocal;
varying vec4 vFill;
varying vec4 vOutline;
varying float vShape;

float square(vec2 p) {
    vec2 q = abs(p);
    return max(q.x, q.y) - DOT_R * sqrt(3.14159265) * 0.6;
}
float triangle(vec2 p) {
    // Corners (-hw, hh), (0, -hh), (hw, hh), y down
    float hw = DOT_R * 1.2;
    float hh = hw * sqrt(3.0) * 0.5;
    float side = dot(vec2(abs(p.x), p.y + hh), normalize(vec2(2.0 * hh, -hw)));
    return max(side, p.y - hh);
}
float xMark(vec2 p) {
    // Both lines folded onto one: from the center out to (s, s), 1 unit either side
    vec2 q = abs(p);
    float s = DOT_R * 1.2;
    float along = (q.x + q.y) * 0.70710678;
    float across = abs(q.x - q.y) * 0.70710678;
    return max(along - s * 1.41421356, across - 1.0);
}

void main() {
    float d;
    if (vShape < 0.5) d = length(vLocal) - DOT_R;
    else if (vShape < 1.5) d = square(vLocal);
    else if (vShape < 2.5) d = triangle(vLocal);
    else d = xMark(vLocal);
    float aa = 0.5 * fwidth(d);
    float fill = 1.0 - smoothstep(-aa, aa, d);
    // An X is its lines only; the others are a fill with the outline drawn over it
    float stroke = vShape > 2.5 ? 0.0 : 1.0 - smoothstep(0.5 - aa, 0.5 + aa, abs(d));
    float fillA = vFill.a * fill;
    float strokeA = vOutline.a * stroke;
    float a = strokeA + fillA * (1.0 - strokeA);
    if (a < 0.004) discard;
    vec3 rgb = vOutline.rgb * strokeA + vFill.rgb * fillA * (1.0 - strokeA);
    gl_FragColor = vec4(rgb / a, a);
}`;

/** A dot's radius in field units, as fabric's `DOT_RADIUS`. */
const DOT_RADIUS = 5;
/** A dot never gets smaller than this on screen, in CSS pixels, so a zoomed-out show stays visible. */
const MIN_SCREEN_RADIUS = 1.5;

type Drawn = {
    version: number;
    idsVersion: number;
    appearanceVersion: number;
    theme: FieldTheme | null;
};

/** The marchers' dots, each in its appearance at the beat drawn. */
export default function MarchersLayer({
    marchers,
    theme,
}: {
    marchers: FieldMarchers;
    theme: FieldTheme;
}) {
    const invalidate = useThree((s) => s.invalidate);
    const drawn = useRef<Drawn>({
        version: -1,
        idsVersion: -1,
        appearanceVersion: -1,
        theme: null,
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
        const dots = new Mesh(
            geometry,
            new ShaderMaterial({
                vertexShader: VERTEX,
                fragmentShader: FRAGMENT,
                uniforms: {
                    uScale: { value: 1 },
                    uMargin: { value: 1 },
                },
                transparent: true,
                depthTest: false,
                depthWrite: false,
                side: DoubleSide,
            }),
        );
        dots.frustumCulled = false;
        dots.renderOrder = 2;
        return dots;
    }, []);

    // A new theme restyles the dots on the next frame
    useEffect(() => invalidate(), [theme, invalidate]);

    useEffect(
        () => () => {
            mesh.geometry.dispose();
            mesh.material.dispose();
        },
        [mesh],
    );

    useFrame(() => {
        const { zoom } = useFieldViewStore.getState();
        const scale = Math.max(1, MIN_SCREEN_RADIUS / (DOT_RADIUS * zoom));
        const { uniforms } = mesh.material;
        uniforms.uScale.value = scale;
        // One CSS pixel, in the shape's own units
        uniforms.uMargin.value = 1 / (zoom * scale);

        const last = drawn.current;
        const resized = marchers.idsVersion !== last.idsVersion;
        const restyled =
            resized ||
            marchers.appearanceVersion !== last.appearanceVersion ||
            theme !== last.theme;
        if (!resized && !restyled && marchers.version === last.version) return;
        const geometry = mesh.geometry;
        if (resized || !geometry.getAttribute("aPos")) {
            // Frees the old buffers; three uploads the new ones on the next draw
            geometry.dispose();
            const n = marchers.ids.length;
            const dynamic = (array: Float32Array, size: number) => {
                const a = new InstancedBufferAttribute(array, size);
                a.setUsage(DynamicDrawUsage);
                return a;
            };
            geometry.setAttribute("aPos", dynamic(new Float32Array(n * 2), 2));
            geometry.setAttribute("aFill", dynamic(new Float32Array(n * 4), 4));
            geometry.setAttribute(
                "aOutline",
                dynamic(new Float32Array(n * 4), 4),
            );
            geometry.setAttribute("aShape", dynamic(new Float32Array(n), 1));
            geometry.instanceCount = n;
        }
        const instanced = (name: string) =>
            geometry.getAttribute(name) as InstancedBufferAttribute;
        if (restyled) {
            const fill = instanced("aFill");
            const outline = instanced("aOutline");
            const shape = instanced("aShape");
            writeMarcherLooks(marchers.stacks, theme, {
                fill: fill.array as Float32Array,
                outline: outline.array as Float32Array,
                shape: shape.array as Float32Array,
            });
            fill.needsUpdate = true;
            outline.needsUpdate = true;
            shape.needsUpdate = true;
        }
        const positions = instanced("aPos");
        (positions.array as Float32Array).set(marchers.positions);
        positions.needsUpdate = true;
        drawn.current = {
            version: marchers.version,
            idsVersion: marchers.idsVersion,
            appearanceVersion: marchers.appearanceVersion,
            theme,
        };
    });

    return <primitive object={mesh} />;
}
