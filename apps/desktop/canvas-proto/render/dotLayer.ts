/**
 * PROTOTYPE. Every marcher dot in one instanced draw call. Dots are drawn as
 * a distance field in the fragment shader, so edges are smooth without MSAA
 * (the potato-machine mode turns MSAA off). The selection ring is part of the
 * same draw: no extra objects per selected marcher.
 */
import {
    BufferAttribute,
    Color,
    DoubleSide,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    Mesh,
    ShaderMaterial,
} from "three";

const VERTEX = /* glsl */ `
attribute vec2 aPos;
attribute vec3 aColor;
attribute float aSelected;
uniform float uRadius;
uniform float uMinRadius;
varying vec2 vLocal;
varying vec3 vColor;
varying float vSelected;
varying float vRadius;
void main() {
    float r = max(uRadius, uMinRadius);
    float extent = r * 2.2;
    vLocal = position.xy * extent;
    vColor = aColor;
    vSelected = aSelected;
    vRadius = r;
    gl_Position = projectionMatrix * viewMatrix * vec4(aPos + vLocal, 0.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uOutline;
uniform vec3 uRing;
uniform float uOpacity;
varying vec2 vLocal;
varying vec3 vColor;
varying float vSelected;
varying float vRadius;
void main() {
    float d = length(vLocal);
    float aa = fwidth(d);
    float r = vRadius;
    float fillA = 1.0 - smoothstep(r - aa, r + aa, d);
    // A thin dark outline inside the edge, like the 2D canvas's dots.
    float outlineW = max(r * 0.18, aa);
    float outline = smoothstep(r - outlineW - aa, r - outlineW + aa, d);
    vec3 col = mix(vColor, uOutline, outline);
    float a = fillA;
    if (vSelected > 0.5) {
        float ringR = r * 1.7;
        float ringW = max(r * 0.22, aa * 1.2);
        float ring = 1.0 - smoothstep(ringW - aa, ringW + aa, abs(d - ringR));
        col = mix(col, uRing, ring * (1.0 - fillA));
        a = max(a, ring);
    }
    a *= uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
}`;

export class DotLayer {
    readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
    readonly positions: Float32Array;
    private readonly posAttr: InstancedBufferAttribute;
    private readonly selAttr: InstancedBufferAttribute;
    private readonly colorAttr: InstancedBufferAttribute;

    constructor(count: number, opts: { opacity?: number } = {}) {
        const geometry = new InstancedBufferGeometry();
        geometry.setAttribute(
            "position",
            new BufferAttribute(
                new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
                3,
            ),
        );
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        this.positions = new Float32Array(count * 2);
        this.posAttr = new InstancedBufferAttribute(this.positions, 2);
        this.posAttr.setUsage(35048);
        this.colorAttr = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
        this.selAttr = new InstancedBufferAttribute(new Float32Array(count), 1);
        geometry.setAttribute("aPos", this.posAttr);
        geometry.setAttribute("aColor", this.colorAttr);
        geometry.setAttribute("aSelected", this.selAttr);
        geometry.instanceCount = count;
        const material = new ShaderMaterial({
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            uniforms: {
                uRadius: { value: 5 },
                uMinRadius: { value: 0 },
                uOutline: { value: new Color("#1d1d1f") },
                uRing: { value: new Color("#7c5cff") },
                uOpacity: { value: opts.opacity ?? 1 },
            },
            transparent: true,
            depthTest: false,
            depthWrite: false,
            side: DoubleSide,
        });
        this.mesh = new Mesh(geometry, material);
        this.mesh.frustumCulled = false;
    }

    setColors(colors: string[]) {
        const c = new Color();
        const arr = this.colorAttr.array as Float32Array;
        colors.forEach((hex, i) => {
            c.set(hex);
            arr[i * 3] = c.r;
            arr[i * 3 + 1] = c.g;
            arr[i * 3 + 2] = c.b;
        });
        this.colorAttr.needsUpdate = true;
    }

    setSelected(selected: Uint8Array) {
        const arr = this.selAttr.array as Float32Array;
        for (let i = 0; i < selected.length; i++) arr[i] = selected[i];
        this.selAttr.needsUpdate = true;
    }

    /** Positions are written into `positions` (world coordinates) by the caller. */
    commitPositions() {
        this.posAttr.needsUpdate = true;
    }

    setRadius(worldRadius: number, minWorldRadius: number) {
        this.mesh.material.uniforms.uRadius.value = worldRadius;
        this.mesh.material.uniforms.uMinRadius.value = minWorldRadius;
    }
}
