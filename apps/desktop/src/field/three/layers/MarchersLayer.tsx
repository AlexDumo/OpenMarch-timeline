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
import { rgba01 } from "../fieldGeometry";
import type { FieldMarchers } from "../fieldMarchers";
import { useFieldViewStore } from "../fieldView";

/**
 * Every marcher's dot in one instanced draw, shaded in the fragment shader so
 * edges are smooth without MSAA (ADR 0005 D-2). Dots sit exactly on their
 * positions: no half-grid-line offset.
 */
const VERTEX = /* glsl */ `
attribute vec2 aPos;
uniform float uRadius;
varying vec2 vLocal;
varying float vRadius;
void main() {
    vRadius = uRadius;
    // A margin around the dot for its antialiased edge.
    vLocal = position.xy * uRadius * 1.25;
    gl_Position = projectionMatrix * viewMatrix * vec4(aPos + vLocal, 0.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform vec4 uFill;
uniform vec4 uOutline;
uniform float uOutlineWidth;
varying vec2 vLocal;
varying float vRadius;
void main() {
    float d = length(vLocal);
    float aa = fwidth(d);
    float inside = 1.0 - smoothstep(vRadius - aa, vRadius + aa, d);
    float edge = smoothstep(vRadius - uOutlineWidth - aa, vRadius - uOutlineWidth + aa, d);
    vec4 color = mix(uFill, uOutline, edge * uOutline.a);
    float a = inside * max(color.a, uFill.a);
    if (a < 0.01) discard;
    gl_FragColor = vec4(color.rgb, a);
}`;

/** A dot's radius in field units, as fabric's `DOT_RADIUS`. */
const DOT_RADIUS = 5;
/** A dot never gets smaller than this on screen, in CSS pixels, so a zoomed-out show stays visible. */
const MIN_SCREEN_RADIUS = 1.5;
/** Fabric's dot outline width, in field units. */
const OUTLINE_WIDTH = 1;

/** The marchers' dots. Appearance per marcher (#199) replaces the theme's default colors. */
export default function MarchersLayer({
    marchers,
    theme,
}: {
    marchers: FieldMarchers;
    theme: FieldTheme;
}) {
    const invalidate = useThree((s) => s.invalidate);
    const drawn = useRef({ version: -1, idsVersion: -1 });

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
        mesh.material.uniforms.uRadius.value = Math.max(
            DOT_RADIUS,
            MIN_SCREEN_RADIUS / zoom,
        );
        if (marchers.version === drawn.current.version) return;
        const geometry = mesh.geometry;
        let attribute = geometry.getAttribute("aPos") as
            | InstancedBufferAttribute
            | undefined;
        if (marchers.idsVersion !== drawn.current.idsVersion || !attribute) {
            // Frees the old buffers; three uploads the new ones on the next draw
            geometry.dispose();
            attribute = new InstancedBufferAttribute(
                new Float32Array(marchers.ids.length * 2),
                2,
            );
            attribute.setUsage(DynamicDrawUsage);
            geometry.setAttribute("aPos", attribute);
            geometry.instanceCount = marchers.ids.length;
        }
        (attribute.array as Float32Array).set(marchers.positions);
        attribute.needsUpdate = true;
        drawn.current = {
            version: marchers.version,
            idsVersion: marchers.idsVersion,
        };
    });

    return <primitive object={mesh} />;
}
