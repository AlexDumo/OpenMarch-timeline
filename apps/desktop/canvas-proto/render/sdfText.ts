/**
 * PROTOTYPE. Labels as signed-distance-field glyphs: one glyph atlas, and one
 * instanced draw call for every label in a batch. SDF glyphs stay sharp at
 * any zoom, which is the main text risk of a WebGL field (rasterized text
 * blurs when zoomed in).
 *
 * The SDF is computed in the browser with the Felzenszwalb distance
 * transform (the TinySDF approach), so there is no font build step.
 */
import {
    DataTexture,
    DoubleSide,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    BufferAttribute,
    LinearFilter,
    LinearMipmapLinearFilter,
    Mesh,
    RedFormat,
    ShaderMaterial,
    UnsignedByteType,
    Color,
} from "three";

const FONT_PX = 48;
const BUFFER = 8;
const RADIUS = 12;
const CUTOFF = 0.25;
const CELL = FONT_PX + BUFFER * 2;
const COLS = 16;

export interface Glyph {
    /** Cell origin in the atlas, pixels. */
    x: number;
    y: number;
    /** Advance in em. */
    advance: number;
    /** The ink box plus the SDF margin, in cell pixels (y down). Empty for a space. */
    rx: number;
    ry: number;
    rw: number;
    rh: number;
}

/** Distance-field margin kept around the ink, in atlas pixels (covers the halo). */
const INK_MARGIN = 5;

export class GlyphAtlas {
    readonly texture: DataTexture;
    readonly glyphs = new Map<string, Glyph>();
    readonly width: number;
    readonly height: number;
    /** Baseline from the top of a cell, pixels. */
    readonly baseline = BUFFER + Math.round(FONT_PX * 0.8);

    constructor(font = `bold ${FONT_PX}px "Courier New", ui-monospace, monospace`) {
        const chars: string[] = [];
        for (let c = 32; c < 127; c++) chars.push(String.fromCharCode(c));
        const rows = Math.ceil(chars.length / COLS);
        this.width = COLS * CELL;
        this.height = 1 << Math.ceil(Math.log2(rows * CELL));
        const data = new Uint8Array(this.width * this.height);

        const canvas = document.createElement("canvas");
        canvas.width = CELL;
        canvas.height = CELL;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.font = font;
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "black";

        const n = CELL * CELL;
        const outer = new Float64Array(n);
        const inner = new Float64Array(n);
        const f = new Float64Array(CELL);
        const z = new Float64Array(CELL + 1);
        const v = new Uint16Array(CELL);

        chars.forEach((ch, i) => {
            const cx = (i % COLS) * CELL;
            const cy = Math.floor(i / COLS) * CELL;
            ctx.clearRect(0, 0, CELL, CELL);
            ctx.fillText(ch, BUFFER, this.baseline);
            const advance = ctx.measureText(ch).width / FONT_PX;
            const img = ctx.getImageData(0, 0, CELL, CELL).data;
            let ix0 = CELL,
                iy0 = CELL,
                ix1 = -1,
                iy1 = -1;
            for (let p = 0; p < n; p++) {
                const a = img[p * 4 + 3] / 255;
                if (a > 0) {
                    const px = p % CELL;
                    const py = (p / CELL) | 0;
                    if (px < ix0) ix0 = px;
                    if (px > ix1) ix1 = px;
                    if (py < iy0) iy0 = py;
                    if (py > iy1) iy1 = py;
                }
                if (a === 1) {
                    outer[p] = 0;
                    inner[p] = 1e20;
                } else if (a === 0) {
                    outer[p] = 1e20;
                    inner[p] = 0;
                } else {
                    const d = 0.5 - a;
                    outer[p] = d > 0 ? d * d : 0;
                    inner[p] = d < 0 ? d * d : 0;
                }
            }
            edt(outer, CELL, CELL, f, v, z);
            edt(inner, CELL, CELL, f, v, z);
            for (let y = 0; y < CELL; y++) {
                for (let x = 0; x < CELL; x++) {
                    const p = y * CELL + x;
                    const d = Math.sqrt(outer[p]) - Math.sqrt(inner[p]);
                    const value = Math.round(255 - 255 * (d / RADIUS + CUTOFF));
                    data[(cy + y) * this.width + cx + x] = Math.max(
                        0,
                        Math.min(255, value),
                    );
                }
            }
            const rx = Math.max(0, ix0 - INK_MARGIN);
            const ry = Math.max(0, iy0 - INK_MARGIN);
            const rw = ix1 < 0 ? 0 : Math.min(CELL, ix1 + 1 + INK_MARGIN) - rx;
            const rh = iy1 < 0 ? 0 : Math.min(CELL, iy1 + 1 + INK_MARGIN) - ry;
            this.glyphs.set(ch, { x: cx, y: cy, advance, rx, ry, rw, rh });
        });

        this.texture = new DataTexture(
            data,
            this.width,
            this.height,
            RedFormat,
            UnsignedByteType,
        );
        this.texture.magFilter = LinearFilter;
        this.texture.minFilter = LinearMipmapLinearFilter;
        this.texture.generateMipmaps = true;
        this.texture.needsUpdate = true;
    }
}

/** 2D Euclidean distance transform (Felzenszwalb & Huttenlocher), in place. */
function edt(
    data: Float64Array,
    width: number,
    height: number,
    f: Float64Array,
    v: Uint16Array,
    z: Float64Array,
) {
    for (let x = 0; x < width; x++) edt1d(data, x, width, height, f, v, z);
    for (let y = 0; y < height; y++) edt1d(data, y * width, 1, width, f, v, z);
}

function edt1d(
    grid: Float64Array,
    offset: number,
    stride: number,
    length: number,
    f: Float64Array,
    v: Uint16Array,
    z: Float64Array,
) {
    v[0] = 0;
    z[0] = -1e20;
    z[1] = 1e20;
    f[0] = grid[offset];
    for (let q = 1, k = 0, s = 0; q < length; q++) {
        f[q] = grid[offset + q * stride];
        const q2 = q * q;
        do {
            const r = v[k];
            s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2;
        } while (s <= z[k] && --k > -1);
        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = 1e20;
    }
    for (let q = 0, k = 0; q < length; q++) {
        while (z[k + 1] < q) k++;
        const r = v[k];
        const qr = q - r;
        grid[offset + q * stride] = f[r] + qr * qr;
    }
}

const VERTEX = /* glsl */ `
attribute vec2 aAnchor;
attribute vec4 aGlyph;   // x, y, w, h in em, relative to the anchor, +y up
attribute vec4 aUv;      // u0, vBottom, u1, vTop
attribute vec2 aScaleRot;
uniform float uEmToWorld;
varying vec2 vUv;
void main() {
    vec2 local = (aGlyph.xy + position.xy * aGlyph.zw) * aScaleRot.x;
    float c = cos(aScaleRot.y), s = sin(aScaleRot.y);
    local = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
    vec2 world = aAnchor + local * uEmToWorld;
    vUv = mix(aUv.xy, aUv.zw, position.xy);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 0.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uColor;
uniform vec3 uHalo;
uniform float uHaloWidth;
uniform float uOpacity;
varying vec2 vUv;
void main() {
    float d = texture2D(uAtlas, vUv).r;
    float w = max(fwidth(d) * 0.7, 0.002);
    float edge = ${(1 - CUTOFF).toFixed(3)};
    float fill = smoothstep(edge - w, edge + w, d);
    float halo = uHaloWidth > 0.0
        ? smoothstep(edge - uHaloWidth - w, edge - uHaloWidth + w, d)
        : fill;
    float a = max(fill, halo) * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(uHalo, uColor, fill / max(halo, 1e-4)), a);
}`;

export interface TextBatchLabel {
    text: string;
    /** Per-label scale (em → world before uEmToWorld), default 1. */
    scale?: number;
    /** Rotation in radians, default 0. */
    rotation?: number;
    /** Horizontal alignment, default center. */
    align?: "left" | "center" | "right";
    /** Vertical offset of the baseline from the anchor, in em. */
    baselineEm?: number;
}

/**
 * Many labels in one draw call. Each glyph is one instance; a glyph's anchor
 * is its label's anchor, so moving labels means rewriting one vec2 per glyph.
 */
export class TextBatch {
    readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
    private anchors: Float32Array = new Float32Array(0);
    private anchorAttr: InstancedBufferAttribute | null = null;
    /** Label index per glyph. */
    private owner: Int32Array = new Int32Array(0);
    glyphCount = 0;

    constructor(
        private readonly atlas: GlyphAtlas,
        color: string,
        halo: string | null,
    ) {
        const geometry = new InstancedBufferGeometry();
        geometry.setAttribute(
            "position",
            new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3),
        );
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        const material = new ShaderMaterial({
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            uniforms: {
                uAtlas: { value: atlas.texture },
                uColor: { value: new Color(color) },
                uHalo: { value: new Color(halo ?? color) },
                uHaloWidth: { value: halo ? 0.18 : 0 },
                uOpacity: { value: 1 },
                uEmToWorld: { value: 1 },
            },
            transparent: true,
            depthTest: false,
            depthWrite: false,
            side: DoubleSide,
        });
        this.mesh = new Mesh(geometry, material);
        this.mesh.frustumCulled = false;
    }

    setLabels(labels: TextBatchLabel[]) {
        const a = this.atlas;
        let count = 0;
        for (const l of labels) count += l.text.length;
        const glyph = new Float32Array(count * 4);
        const uv = new Float32Array(count * 4);
        const scaleRot = new Float32Array(count * 2);
        this.owner = new Int32Array(count);
        this.anchors = new Float32Array(count * 2);
        let g = 0;
        labels.forEach((label, li) => {
            let width = 0;
            for (const ch of label.text) width += a.glyphs.get(ch)?.advance ?? 0.6;
            let pen =
                label.align === "left"
                    ? 0
                    : label.align === "right"
                      ? -width
                      : -width / 2;
            const base = label.baselineEm ?? 0;
            for (const ch of label.text) {
                const gl = a.glyphs.get(ch) ?? a.glyphs.get("?")!;
                // The quad covers only the glyph's ink (plus margin), not the
                // whole atlas cell: much less fill on software renderers.
                glyph.set(
                    [
                        pen + (gl.rx - BUFFER) / FONT_PX,
                        base + (a.baseline - (gl.ry + gl.rh)) / FONT_PX,
                        gl.rw / FONT_PX,
                        gl.rh / FONT_PX,
                    ],
                    g * 4,
                );
                uv.set(
                    [
                        (gl.x + gl.rx) / a.width,
                        (gl.y + gl.ry + gl.rh) / a.height,
                        (gl.x + gl.rx + gl.rw) / a.width,
                        (gl.y + gl.ry) / a.height,
                    ],
                    g * 4,
                );
                scaleRot[g * 2] = label.scale ?? 1;
                scaleRot[g * 2 + 1] = label.rotation ?? 0;
                this.owner[g] = li;
                pen += gl.advance;
                g++;
            }
        });
        const geo = this.mesh.geometry;
        geo.setAttribute("aGlyph", new InstancedBufferAttribute(glyph, 4));
        geo.setAttribute("aUv", new InstancedBufferAttribute(uv, 4));
        geo.setAttribute("aScaleRot", new InstancedBufferAttribute(scaleRot, 2));
        this.anchorAttr = new InstancedBufferAttribute(this.anchors, 2);
        this.anchorAttr.setUsage(35048 /* DynamicDrawUsage */);
        geo.setAttribute("aAnchor", this.anchorAttr);
        geo.instanceCount = count;
        this.glyphCount = count;
    }

    /**
     * Moves every label. `xy` holds one world-space anchor per label
     * (x0, y0, x1, y1, ...). Allocates nothing.
     */
    setAnchors(xy: ArrayLike<number>) {
        const owner = this.owner;
        const out = this.anchors;
        for (let g = 0; g < owner.length; g++) {
            const li = owner[g] * 2;
            out[g * 2] = xy[li];
            out[g * 2 + 1] = xy[li + 1];
        }
        if (this.anchorAttr) this.anchorAttr.needsUpdate = true;
    }

    set emToWorld(value: number) {
        this.mesh.material.uniforms.uEmToWorld.value = value;
    }

    set opacity(value: number) {
        this.mesh.material.uniforms.uOpacity.value = value;
    }
}
