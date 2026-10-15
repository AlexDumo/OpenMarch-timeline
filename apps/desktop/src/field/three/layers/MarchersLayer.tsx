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
import { DOT_RADIUS, OUTLINE_WIDTH } from "@/field/editor/hitTest";
import { rgba01 } from "../fieldGeometry";
import type { FieldMarchers } from "../fieldMarchers";
import { useFieldViewStore } from "../fieldView";
import { dotSizes, SELECTION_RGBA01 } from "../selectionRing";

/**
 * Every marcher's dot in one instanced draw, shaded in the fragment shader so
 * edges are smooth without MSAA (ADR 0005 D-2). Dots sit exactly on their
 * positions: no half-grid-line offset.
 */
const VERTEX = /* glsl */ `
attribute vec2 aPos;
attribute float aSelected;
uniform float uRadius;
uniform float uRingOuter;
varying vec2 vLocal;
varying float vRadius;
varying float vSelected;
void main() {
    vRadius = uRadius;
    vSelected = aSelected;
    // A margin around the dot, or its selection ring, for the antialiased edge.
    vLocal = position.xy * (aSelected > 0.5 ? uRingOuter : uRadius) * 1.25;
    gl_Position = projectionMatrix * viewMatrix * vec4(aPos + vLocal, 0.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform vec4 uFill;
uniform vec4 uOutline;
uniform float uOutlineWidth;
uniform vec4 uRing;
uniform float uRingInner;
uniform float uRingOuter;
varying vec2 vLocal;
varying float vRadius;
varying float vSelected;
void main() {
    float d = length(vLocal);
    float aa = fwidth(d);
    float inside = 1.0 - smoothstep(vRadius - aa, vRadius + aa, d);
    float edge = smoothstep(vRadius - uOutlineWidth - aa, vRadius - uOutlineWidth + aa, d);
    vec4 color = mix(uFill, uOutline, edge * uOutline.a);
    float dotA = inside * max(color.a, uFill.a);
    float ringA = vSelected * uRing.a
        * (smoothstep(uRingInner - aa, uRingInner + aa, d)
            - smoothstep(uRingOuter - aa, uRingOuter + aa, d));
    // The dot over its ring
    float a = dotA + ringA * (1.0 - dotA);
    if (a < 0.01) discard;
    vec3 rgb = (color.rgb * dotA + uRing.rgb * ringA * (1.0 - dotA)) / a;
    gl_FragColor = vec4(rgb, a);
}`;

/**
 * The marchers' dots, with a ring around each selected one (#193).
 * Appearance per marcher (#199) replaces the theme's default colors.
 */
export default function MarchersLayer({
    marchers,
    theme,
}: {
    marchers: FieldMarchers;
    theme: FieldTheme;
}) {
    const invalidate = useThree((s) => s.invalidate);
    const drawn = useRef({ version: -1, idsVersion: -1, selectionVersion: -1 });

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
                    uRadius: { value: DOT_RADIUS },
                    uFill: { value: [0, 0, 0, 1] },
                    uOutline: { value: [0, 0, 0, 0] },
                    uOutlineWidth: { value: OUTLINE_WIDTH },
                    uRing: { value: SELECTION_RGBA01 },
                    uRingInner: { value: DOT_RADIUS },
                    uRingOuter: { value: DOT_RADIUS },
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

    useEffect(() => {
        const { uniforms } = mesh.material;
        uniforms.uFill.value = rgba01(theme.defaultMarcher.fill);
        uniforms.uOutline.value = rgba01(theme.defaultMarcher.outline);
        invalidate();
    }, [mesh, theme, invalidate]);

    useEffect(
        () => () => {
            mesh.geometry.dispose();
            mesh.material.dispose();
        },
        [mesh],
    );

    useFrame(() => {
        const { zoom } = useFieldViewStore.getState();
        const { uniforms } = mesh.material;
        const sizes = dotSizes(zoom);
        uniforms.uRadius.value = sizes.radius;
        uniforms.uRingInner.value = sizes.ringInner;
        uniforms.uRingOuter.value = sizes.ringOuter;
        const geometry = mesh.geometry;
        let positions = geometry.getAttribute("aPos") as
            | InstancedBufferAttribute
            | undefined;
        let selected = geometry.getAttribute("aSelected") as
            | InstancedBufferAttribute
            | undefined;
        const resized =
            marchers.idsVersion !== drawn.current.idsVersion || !positions;
        if (resized) {
            // Frees the old buffers; three uploads the new ones on the next draw
            geometry.dispose();
            const count = marchers.ids.length;
            positions = new InstancedBufferAttribute(
                new Float32Array(count * 2),
                2,
            );
            positions.setUsage(DynamicDrawUsage);
            geometry.setAttribute("aPos", positions);
            selected = new InstancedBufferAttribute(new Float32Array(count), 1);
            selected.setUsage(DynamicDrawUsage);
            geometry.setAttribute("aSelected", selected);
            geometry.instanceCount = count;
        }
        if (resized || marchers.version !== drawn.current.version) {
            (positions!.array as Float32Array).set(marchers.positions);
            positions!.needsUpdate = true;
        }
        if (
            resized ||
            marchers.selectionVersion !== drawn.current.selectionVersion
        ) {
            (selected!.array as Float32Array).set(marchers.selected);
            selected!.needsUpdate = true;
        }
        drawn.current = {
            version: marchers.version,
            idsVersion: marchers.idsVersion,
            selectionVersion: marchers.selectionVersion,
        };
    });

    return <primitive object={mesh} />;
}
