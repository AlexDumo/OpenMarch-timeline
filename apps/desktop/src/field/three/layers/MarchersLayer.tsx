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
import {
    FOLLOWING_OPACITY,
    followingLook,
    marcherHollow,
    marcherOpacity,
    type FieldFollowing,
    type FollowingLook,
} from "../fieldFollowing";
import { useFieldDraw } from "../fieldDrawContext";
import { writeMarcherLooks } from "../marcherLooks";
import { dotSizes, SELECTION_RGBA01 } from "../selectionRing";

/**
 * Every marcher's dot in one instanced draw, shaded in the fragment shader so
 * edges are smooth without MSAA (ADR 0005 D-2). Each instance carries its look
 * (fill, outline, shape; `marcherLooks.ts`). Dots sit exactly on their
 * positions: no half-grid-line offset.
 *
 * Shapes are signed distances in field units, sized as the drill-chart export
 * draws them (`drillChartSvg.ts`'s `dotSvg`): a circle of
 * radius 5, a square of side 5·√π·1.2, an equilateral triangle 12 wide, and an
 * X of two 2-wide lines out to ±6. The 1-unit outline straddles the edge, and
 * corners are mitered.
 *
 * A selected marcher (#193) gets a ring a little outside its shape's edge, in
 * the same draw.
 *
 * In the hollow Following look (#308) a Following marcher's fill is cut out
 * inside a band along its edge, so it reads as a ring in its own color. An X
 * has no fill to cut, so it fades instead.
 */
const VERTEX = /* glsl */ `
attribute vec2 aPos;
attribute vec4 aFill;
attribute vec4 aOutline;
attribute float aShape;
attribute float aOpacity;
attribute float aHollow;
attribute float aSelected;
uniform float uScale;
uniform float uMargin;
uniform float uRingOuter;
varying vec2 vLocal;
varying vec4 vFill;
varying vec4 vOutline;
varying float vShape;
varying float vOpacity;
varying float vHollow;
varying float vSelected;
void main() {
    vSelected = aSelected;
    vHollow = aHollow;
    vFill = aFill;
    vOutline = aOutline;
    vOpacity = aOpacity;
    vShape = aShape;
    if (aShape < -0.5) {
        // Hidden: every corner on one point outside the view draws nothing
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    // The largest shape (the X's line ends) and its ring, plus a margin for the antialiased edge
    vLocal = position.xy * (7.0 + aSelected * uRingOuter + uMargin);
    gl_Position = projectionMatrix * viewMatrix * vec4(aPos + vLocal * uScale, 0.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `
#define DOT_R 5.0
#define HOLLOW_RING 2.2
#define FOLLOWING_OPACITY ${FOLLOWING_OPACITY.toFixed(3)}
varying vec2 vLocal;
varying vec4 vFill;
varying vec4 vOutline;
varying float vShape;
varying float vOpacity;
varying float vHollow;
varying float vSelected;
uniform float uMargin;
uniform vec4 uRing;
uniform float uRingInner;
uniform float uRingOuter;

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
    bool cross = vShape > 2.5;
    // A hollow Following marcher (#308): no fill inside a band along the edge, at least 2 CSS px wide
    float band = max(HOLLOW_RING, 2.0 * uMargin);
    float hollow = cross ? 0.0 : vHollow;
    fill *= 1.0 - hollow * (1.0 - smoothstep(-band - aa, -band + aa, d));
    // An X is its lines only; the others are a fill with the outline drawn over it
    float stroke = cross ? 0.0 : 1.0 - smoothstep(0.5 - aa, 0.5 + aa, abs(d));
    float fillA = vFill.a * fill;
    float strokeA = vOutline.a * stroke;
    float dotA = strokeA + fillA * (1.0 - strokeA);
    vec3 dotRgb = vOutline.rgb * strokeA + vFill.rgb * fillA * (1.0 - strokeA);
    // The selection ring, between uRingInner and uRingOuter outside the shape's edge
    float ringA = vSelected * uRing.a
        * (smoothstep(uRingInner - aa, uRingInner + aa, d)
            - smoothstep(uRingOuter - aa, uRingOuter + aa, d));
    // A dimmed (#201) or Following (#300) marcher's dot fades; its ring stays full strength
    float opacity = cross ? vOpacity * (1.0 - (1.0 - FOLLOWING_OPACITY) * vHollow) : vOpacity;
    dotA *= opacity;
    dotRgb *= opacity;
    float a = dotA + ringA * (1.0 - dotA);
    if (a < 0.004) discard;
    vec3 rgb = dotRgb + uRing.rgb * ringA * (1.0 - dotA);
    gl_FragColor = vec4(rgb / a, a);
}`;

type Drawn = {
    version: number;
    idsVersion: number;
    appearanceVersion: number;
    dimVersion: number;
    followingVersion: number;
    look: FollowingLook | null;
    selectionVersion: number;
    theme: FieldTheme | null;
};

/** The marchers' dots, each in its appearance at the beat drawn, with a ring on each selected one. */
export default function MarchersLayer({
    marchers,
    dimming,
    following,
    theme,
}: {
    marchers: FieldMarchers;
    /** Marchers drawn dimmed (#201). */
    dimming: FieldDimming;
    /** Marchers drawn faded as Following (#300); dimming wins. */
    following: FieldFollowing;
    theme: FieldTheme;
}) {
    const invalidate = useThree((s) => s.invalidate);
    const draw = useFieldDraw();
    const drawn = useRef<Drawn>({
        version: -1,
        idsVersion: -1,
        appearanceVersion: -1,
        dimVersion: -1,
        followingVersion: -1,
        look: null,
        selectionVersion: -1,
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
                    uRing: { value: SELECTION_RGBA01 },
                    uRingInner: { value: 1 },
                    uRingOuter: { value: 2 },
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
    // New dimming redraws them on the next frame
    useEffect(() => dimming.subscribe(invalidate), [dimming, invalidate]);
    useEffect(() => following.subscribe(invalidate), [following, invalidate]);

    useEffect(
        () => () => {
            mesh.geometry.dispose();
            mesh.material.dispose();
        },
        [mesh],
    );

    useFrame(() => {
        const { zoom } = draw.view.getState();
        const { scale, ringGap, ringWidth } = dotSizes(zoom);
        const { uniforms } = mesh.material;
        uniforms.uScale.value = scale;
        // In the shape's own units, as the edge distance `d`
        uniforms.uRingInner.value = ringGap / scale;
        uniforms.uRingOuter.value = (ringGap + ringWidth) / scale;
        // One CSS pixel, in the shape's own units
        uniforms.uMargin.value = 1 / (zoom * scale);

        const last = drawn.current;
        const resized = marchers.idsVersion !== last.idsVersion;
        const restyled =
            resized ||
            marchers.appearanceVersion !== last.appearanceVersion ||
            theme !== last.theme;
        const look = followingLook();
        const dimChanged =
            resized ||
            dimming.version !== last.dimVersion ||
            following.version !== last.followingVersion ||
            look !== last.look;
        const reselected =
            resized || marchers.selectionVersion !== last.selectionVersion;
        if (
            !resized &&
            !restyled &&
            !dimChanged &&
            !reselected &&
            marchers.version === last.version
        )
            return;
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
            geometry.setAttribute("aOpacity", dynamic(new Float32Array(n), 1));
            geometry.setAttribute("aHollow", dynamic(new Float32Array(n), 1));
            geometry.setAttribute("aSelected", dynamic(new Float32Array(n), 1));
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
        if (dimChanged) {
            const opacity = instanced("aOpacity");
            const array = opacity.array as Float32Array;
            const hollow = instanced("aHollow");
            const hollows = hollow.array as Float32Array;
            marchers.ids.forEach((id, i) => {
                array[i] = marcherOpacity(dimming, following, id, look);
                hollows[i] = marcherHollow(dimming, following, id, look);
            });
            opacity.needsUpdate = true;
            hollow.needsUpdate = true;
        }
        if (reselected) {
            const selected = instanced("aSelected");
            (selected.array as Float32Array).set(marchers.selected);
            selected.needsUpdate = true;
        }
        const positions = instanced("aPos");
        (positions.array as Float32Array).set(marchers.positions);
        positions.needsUpdate = true;
        drawn.current = {
            version: marchers.version,
            idsVersion: marchers.idsVersion,
            appearanceVersion: marchers.appearanceVersion,
            dimVersion: dimming.version,
            followingVersion: following.version,
            look,
            selectionVersion: marchers.selectionVersion,
            theme,
        };
    });

    return <primitive object={mesh} />;
}
