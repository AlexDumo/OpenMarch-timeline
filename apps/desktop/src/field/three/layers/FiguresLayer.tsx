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
import { resolveMarcherLook } from "@/entity-components/appearance";
import type { FieldMarchers } from "../fieldMarchers";
import type { FieldDimming } from "../fieldDimming";
import { notDefinedAmount, type FieldNotDefined } from "../fieldNotDefined";
import { useFieldDraw } from "../fieldDrawContext";
import {
    figureOf,
    figuresDrawnAt,
    type FigureAtlas,
} from "../figures/figureAtlas";

/**
 * Every performer's figure (fork #1319) in one instanced draw: a square of the figure atlas per
 * performer, to scale, its performer's spot on their position. Nothing 3D: one texture, one draw,
 * as cheap as the dots. Under the dots, which draw on top or give way (`MarchersLayer`).
 * Everyone faces the front until the 2D field knows facing (#1316).
 */
const VERTEX = /* glsl */ `
attribute vec2 aPos;
attribute vec4 aUv;
attribute vec2 aSize;
attribute vec2 aAnchor;
attribute float aOpacity;
varying vec2 vUv;
varying float vOpacity;
void main() {
    vOpacity = aOpacity;
    if (aOpacity <= 0.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    // position runs 0..1 across the picture, y down as on the field
    vUv = mix(aUv.xy, aUv.zw, position.xy);
    vec2 local = position.xy * aSize - aAnchor;
    gl_Position = projectionMatrix * viewMatrix * vec4(aPos + local, 0.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying float vOpacity;
void main() {
    vec4 c = texture2D(uAtlas, vUv);
    float a = c.a * vOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(c.rgb, a);
}`;

/** A Not defined performer's figure is this faint at full strength (#478). */
const NOT_DEFINED_OPACITY = 0.45;

type Drawn = {
    version: number;
    idsVersion: number;
    appearanceVersion: number;
    dimVersion: number;
    lookVersion: number;
    theme: FieldTheme | null;
    keys: ReadonlyMap<number, string> | null;
};

/** The performers as figures, while `atlas` is loaded; the dots stand in when zoomed far out. */
export default function FiguresLayer({
    marchers,
    dimming,
    look,
    theme,
    atlas,
    figureKeys,
    renderOrder,
}: {
    marchers: FieldMarchers;
    dimming: FieldDimming;
    look: FieldNotDefined;
    theme: FieldTheme;
    atlas: FigureAtlas;
    /** Each performer's figure (`figureKeyOf`), by marcher id */
    figureKeys: ReadonlyMap<number, string>;
    renderOrder: number;
}) {
    const invalidate = useThree((s) => s.invalidate);
    const draw = useFieldDraw();
    const drawn = useRef<Drawn>({
        version: -1,
        idsVersion: -1,
        appearanceVersion: -1,
        dimVersion: -1,
        lookVersion: -1,
        theme: null,
        keys: null,
    });

    const mesh = useMemo(() => {
        const geometry = new InstancedBufferGeometry();
        geometry.setAttribute(
            "position",
            new BufferAttribute(
                new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
                3,
            ),
        );
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        geometry.instanceCount = 0;
        const figures = new Mesh(
            geometry,
            new ShaderMaterial({
                vertexShader: VERTEX,
                fragmentShader: FRAGMENT,
                uniforms: { uAtlas: { value: atlas.texture } },
                transparent: true,
                depthTest: false,
                depthWrite: false,
                side: DoubleSide,
            }),
        );
        figures.frustumCulled = false;
        return figures;
    }, [atlas]);
    mesh.renderOrder = renderOrder;

    useEffect(() => invalidate(), [theme, figureKeys, mesh, invalidate]);
    useEffect(() => dimming.subscribe(invalidate), [dimming, invalidate]);
    useEffect(() => look.subscribe(invalidate), [look, invalidate]);
    useEffect(
        () => () => {
            mesh.geometry.dispose();
            mesh.material.dispose();
        },
        [mesh],
    );

    useFrame(() => {
        mesh.visible = figuresDrawnAt(draw.view.getState().zoom);
        if (!mesh.visible) return;
        const last = drawn.current;
        const geometry = mesh.geometry;
        const resized =
            marchers.idsVersion !== last.idsVersion ||
            !geometry.getAttribute("aPos");
        const restyled =
            resized ||
            figureKeys !== last.keys ||
            marchers.appearanceVersion !== last.appearanceVersion ||
            dimming.version !== last.dimVersion ||
            look.version !== last.lookVersion ||
            theme !== last.theme;
        if (!restyled && marchers.version === last.version) return;
        const n = marchers.ids.length;
        if (resized) {
            geometry.dispose();
            const dynamic = (array: Float32Array, size: number) => {
                const a = new InstancedBufferAttribute(array, size);
                a.setUsage(DynamicDrawUsage);
                return a;
            };
            geometry.setAttribute("aPos", dynamic(new Float32Array(n * 2), 2));
            geometry.setAttribute("aUv", dynamic(new Float32Array(n * 4), 4));
            geometry.setAttribute("aSize", dynamic(new Float32Array(n * 2), 2));
            geometry.setAttribute(
                "aAnchor",
                dynamic(new Float32Array(n * 2), 2),
            );
            geometry.setAttribute("aOpacity", dynamic(new Float32Array(n), 1));
            geometry.instanceCount = n;
        }
        const instanced = (name: string) =>
            geometry.getAttribute(name) as InstancedBufferAttribute;
        if (restyled) {
            const uv = instanced("aUv");
            const size = instanced("aSize");
            const anchor = instanced("aAnchor");
            const opacity = instanced("aOpacity");
            const uvs = uv.array as Float32Array;
            const sizes = size.array as Float32Array;
            const anchors = anchor.array as Float32Array;
            const opacities = opacity.array as Float32Array;
            marchers.ids.forEach((id, i) => {
                const shown =
                    !marchers.isItem[i] &&
                    resolveMarcherLook(marchers.stacks[i] ?? [], theme).visible;
                const amount = notDefinedAmount(dimming, look, id);
                opacities[i] = shown
                    ? dimming.opacityOf(id) *
                      (1 - (1 - NOT_DEFINED_OPACITY) * amount)
                    : 0;
                const figure = figureOf(atlas, figureKeys.get(id) ?? "none");
                uvs.set(figure.uv, i * 4);
                sizes.set(figure.size, i * 2);
                anchors.set(figure.anchor, i * 2);
            });
            uv.needsUpdate = true;
            size.needsUpdate = true;
            anchor.needsUpdate = true;
            opacity.needsUpdate = true;
        }
        const positions = instanced("aPos");
        (positions.array as Float32Array).set(marchers.positions);
        positions.needsUpdate = true;
        drawn.current = {
            version: marchers.version,
            idsVersion: marchers.idsVersion,
            appearanceVersion: marchers.appearanceVersion,
            dimVersion: dimming.version,
            lookVersion: look.version,
            theme,
            keys: figureKeys,
        };
    });

    return <primitive object={mesh} />;
}
