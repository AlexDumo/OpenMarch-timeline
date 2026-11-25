/**
 * A JS port of the flats shader's lookup (render/uniform-flats.js `omFlatArt`), for tests without a GPU:
 * which flat a rest-pose point samples and where, with the table read as the GPU reads it (half floats,
 * linear filtering, S repeating round the body, T clamped to the rows). Keep in step with the GLSL.
 */
import * as THREE from "three";
import type { FlatsLayout } from "@/view3d/core/marchers/uniformArtwork";

type V3 = [number, number, number];
const IN = 0.0254;
/** As OM_FLAT_HEM_INSET in uniform-flats.js, inches. */
const HEM_INSET = 0.05;
/** As omFlatHemInset() in uniform-flats.js: how far (in) the torso's end and the hips' start keep off the hem. */
export const hemInset = (dpi: number) => Math.max(HEM_INSET, 1 / dpi);
const PI = Math.PI;
const sub = (a: V3, b: number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: number[], b: number[]) =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const smoothstep = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

export interface FlatSample {
    panel: "front" | "back";
    /** Panel inches. */
    q: [number, number];
    /** The segment that drew it (0 torso, 1 hips, 2.. limbs as `layout.limbs`). */
    seg: number;
    /** False on the neck. */
    valid: boolean;
}

export class FlatsSampler {
    private readonly lut: Float32Array;
    private readonly rows: number;
    private readonly cols: number;
    private readonly seg: FlatsLayout["segments"];

    constructor(
        private readonly layout: FlatsLayout,
        bytes: Uint8Array,
        private readonly body: string,
        /** How the table wraps round the body; the app uses "repeat". */
        private readonly wrapS: "repeat" | "clamp" = "repeat",
        /** The atlas's pixels per inch (uFlatPx is 1 / dpi); 16 is Low quality. */
        private readonly dpi = 16,
    ) {
        const h = new Uint16Array(
            bytes.buffer,
            bytes.byteOffset,
            bytes.byteLength / 2,
        );
        this.lut = Float32Array.from(h, (v) =>
            THREE.DataUtils.fromHalfFloat(v),
        );
        this.rows = layout.rows;
        this.cols = layout.angles;
        const order = ["torso", "hips", ...layout.limbs.map((l) => l.id)];
        this.seg = order.map((id) => layout.segments.find((s) => s.id === id)!);
    }

    private texel(r: number, c: number): number[] {
        const o = (r * this.cols + c) * 4;
        return [this.lut[o], this.lut[o + 1], this.lut[o + 2], this.lut[o + 3]];
    }

    /** texture(uFlatLut, (u, v)) with linear filtering. */
    lookup(u: number, v: number): number[] {
        const x = u * this.cols - 0.5;
        const y = Math.min(this.rows - 1, Math.max(0, v * this.rows - 0.5));
        const x0 = Math.floor(x);
        const fx = x - x0;
        const y0 = Math.floor(y);
        const fy = y - y0;
        const col = (c: number) =>
            this.wrapS === "repeat"
                ? ((c % this.cols) + this.cols) % this.cols
                : Math.min(this.cols - 1, Math.max(0, c));
        const y1 = Math.min(this.rows - 1, y0 + 1);
        const a = this.texel(y0, col(x0));
        const b = this.texel(y0, col(x0 + 1));
        const c = this.texel(y1, col(x0));
        const d = this.texel(y1, col(x0 + 1));
        return a.map(
            (_, k) =>
                (a[k] * (1 - fx) + b[k] * fx) * (1 - fy) +
                (c[k] * (1 - fx) + d[k] * fx) * fy,
        );
    }

    row(s: number, t: number): number {
        const g = this.seg[s];
        const f = Math.min(
            1,
            Math.max(0, (t - g.tStart) / (g.tEnd - g.tStart)),
        );
        return (g.rowStart + 0.5 + f * (g.rows - 1)) / this.rows;
    }

    lutAt(psi: number, row: number) {
        return this.lookup((psi + PI) / (2 * PI), row);
    }

    /** The table at angle psi of segment s, t (for tests of the raw lookup). */
    at(s: number, t: number, psi: number) {
        return this.lutAt(psi, this.row(s, t));
    }

    private spine(s: number, p: V3, t: number) {
        const g = this.seg[s];
        const row = this.row(s, t);
        const zc = this.lutAt(0, row)[2];
        const psi = Math.atan2(p[0], p[2] - zc);
        const lut = this.lutAt(psi, row);
        const front = Math.abs(psi) <= PI / 2;
        const y0 = g.y0 + Math.min(g.tEnd, Math.max(g.tStart, t)) / IN + lut[3];
        // the torso's end and the hips' start keep off the hem, as the shader does
        const hem = this.seg[1].y0;
        const inset = hemInset(this.dpi);
        const y =
            s === 0 ? Math.min(y0, hem - inset) : Math.max(y0, hem + inset);
        return {
            q: [this.layout.centreX + (front ? lut[0] : -lut[1]), y] as [
                number,
                number,
            ],
            front,
            psi,
        };
    }

    private limb(i: number, p: V3) {
        const s = 2 + i;
        const g = this.seg[s];
        const L = this.layout.limbs[i];
        const d = sub(p, L.head);
        const t = dot(d, L.dir);
        const row = this.row(s, t);
        const off = this.lutAt(0, row)[2];
        const r = [0, 1, 2].map((k) => d[k] - L.dir[k] * t - L.fwd[k] * off);
        const psi = Math.atan2(dot(r, L.side), dot(r, L.fwd));
        const lut = this.lutAt(psi, row);
        const front = Math.abs(psi) <= PI / 2;
        const y = g.y0 + Math.min(g.tEnd, Math.max(g.tStart, t)) / IN + lut[3];
        return {
            q: [this.layout.centreX + (front ? lut[0] : -lut[1]), y] as [
                number,
                number,
            ],
            front,
            t,
            psi,
        };
    }

    neckDist(p: V3) {
        const zc = this.lutAt(0, this.row(0, this.layout.tops.torso - p[1]))[2];
        return Math.hypot(p[0], p[2] - zc);
    }

    /**
     * Where a rest-pose point of body part `part` (1 jacket, 2 sleeves, 3 pants) samples the flats. The arm
     * wedge and glove reclassification (`omFlatPart`) is left out: give the part the shader would use.
     */
    sample(p: V3, part: 1 | 2 | 3): FlatSample {
        const { tops, planes } = this.layout;
        if (part === 1 || (part === 3 && p[1] > tops.crotch)) {
            const s = part === 1 ? 0 : 1;
            const r = this.spine(
                s,
                p,
                (part === 1 ? tops.torso : tops.hips) - p[1],
            );
            const valid =
                part !== 1 || this.neckDist(p) >= this.layout.neckR[this.body];
            return { panel: r.front ? "front" : "back", q: r.q, seg: s, valid };
        }
        const side = p[0] >= 0 ? 0 : 1;
        const pl = planes[(part === 2 ? 0 : 2) + side];
        const i =
            (part === 2 ? 0 : 4) +
            side * 2 +
            (dot(sub(p, pl.at), pl.n) > 0 ? 1 : 0);
        const r = this.limb(i, p);
        let q = r.q;
        let front = r.front;
        let seg = 2 + i;
        if (i === 4 || i === 6) {
            const lateral = Math.sin(r.psi) * (i === 4 ? 1 : -1);
            const hw =
                (1 - smoothstep(0, tops.legEase, tops.crotch - p[1])) *
                smoothstep(0, 0.5, lateral);
            if (hw > 0) {
                const th = tops.hips - p[1];
                const h = this.spine(1, p, th);
                const qh: [number, number] = [h.q[0], this.seg[1].y0 + th / IN];
                if (h.front === front)
                    q = [
                        q[0] + (qh[0] - q[0]) * hw,
                        q[1] + (qh[1] - q[1]) * hw,
                    ];
                else if (hw > 0.5) {
                    q = qh;
                    front = h.front;
                }
                if (hw > 0.5) seg = 1;
            }
        }
        return { panel: front ? "front" : "back", q, seg, valid: true };
    }
}
