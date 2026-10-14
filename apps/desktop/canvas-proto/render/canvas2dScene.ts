/**
 * PROTOTYPE. The fallback for machines with no usable GPU (WebGL running in
 * software: SwiftShader, llvmpipe). Same interface as FieldScene, drawn with
 * Canvas2D, which browsers rasterize efficiently on the CPU.
 *
 * Unlike Fabric it keeps no object per marcher: each frame is a few batched
 * paths (one per dot color, one for all pathways, one for the rings) straight
 * from the position arrays. The editor and the SVG overlay don't change.
 */
import type { FieldProperties, RgbaColor } from "@openmarch/core";
import type { ShowSource } from "../source";
import { sectionColors } from "../source";
import type { LayerToggles } from "./scene";
import { View } from "./view";

const DOT_RADIUS = 5;
const LABEL_SIZE = 14;
const LABEL_SCREEN_PX = 11;
const css = (c: RgbaColor, a = c.a) => `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;

export class Canvas2DScene {
    readonly view = new View();
    private readonly ctx: CanvasRenderingContext2D;
    toggles: LayerToggles = {
        labels: true,
        screenSizedLabels: false,
        ghosts: true,
        pathways: true,
        grid: true,
    };
    source: ShowSource | null = null;
    gpuMs: number | null = null;
    drawCalls = 0;
    readonly pixelRatio: number;

    private pos: Float64Array = new Float64Array(0);
    private ghosts: Float64Array | null = null;
    private pathFrom: Float64Array | null = null;
    private pathTo: Float64Array | null = null;
    private selected: Uint8Array = new Uint8Array(0);
    /** Marcher indices grouped by fill color, so each color is one path. */
    private colorGroups: [string, number[]][] = [];

    constructor(
        readonly canvas: HTMLCanvasElement,
        opts: { dprCap: number },
    ) {
        this.ctx = canvas.getContext("2d", { alpha: false })!;
        this.pixelRatio = Math.min(window.devicePixelRatio, opts.dprCap);
    }

    rendererName() {
        return "Canvas2D (fallback)";
    }

    setShow(source: ShowSource) {
        this.source = source;
        this.pos = new Float64Array(source.count * 2);
        this.selected = new Uint8Array(source.count);
        const groups = new Map<string, number[]>();
        sectionColors(source.sections).forEach((c, i) => {
            if (!groups.has(c)) groups.set(c, []);
            groups.get(c)!.push(i);
        });
        this.colorGroups = [...groups.entries()];
    }

    setGrid(on: boolean) {
        this.toggles.grid = on;
    }

    applyToggles() {}

    resize(width: number, height: number) {
        this.canvas.width = Math.round(width * this.pixelRatio);
        this.canvas.height = Math.round(height * this.pixelRatio);
        this.view.resize(width, height);
    }

    setPositions(xy: Float64Array) {
        this.pos = xy;
    }

    setGhostPositions(xy: Float64Array | null) {
        this.ghosts = xy;
    }

    setPathways(from: Float64Array | null, to: Float64Array | null) {
        this.pathFrom = from;
        this.pathTo = to;
    }

    setSelected(selected: Uint8Array) {
        this.selected = selected;
    }

    render() {
        const src = this.source;
        if (!src) return;
        const ctx = this.ctx;
        const v = this.view;
        const dpr = this.pixelRatio;
        const z = v.zoom;
        let calls = 0;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#2a2a2e";
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        // Field pixels → device pixels
        ctx.setTransform(
            z * dpr,
            0,
            0,
            z * dpr,
            (v.width / 2 - v.cx * z) * dpr,
            (v.height / 2 - v.cy * z) * dpr,
        );
        calls += this.drawField(src.field, z);

        const n = src.count;
        const p = this.pos;
        const r = Math.max(DOT_RADIUS, 2 / z);

        if (this.toggles.pathways && this.pathFrom && this.pathTo) {
            const a = this.pathFrom;
            const b = this.pathTo;
            ctx.beginPath();
            for (let i = 0; i < n * 2; i += 2) {
                if ((b[i] - a[i]) ** 2 + (b[i + 1] - a[i + 1]) ** 2 < 0.01) continue;
                ctx.moveTo(a[i], a[i + 1]);
                ctx.lineTo(b[i], b[i + 1]);
            }
            ctx.strokeStyle = "rgba(107, 107, 107, 0.9)";
            ctx.lineWidth = 1.25 / z;
            ctx.stroke();
            calls++;
        }
        if (this.toggles.ghosts && this.ghosts) {
            const g = this.ghosts;
            ctx.beginPath();
            for (let i = 0; i < n * 2; i += 2) {
                ctx.moveTo(g[i] + r, g[i + 1]);
                ctx.arc(g[i], g[i + 1], r, 0, Math.PI * 2);
            }
            ctx.fillStyle = "rgba(122, 122, 122, 0.28)";
            ctx.fill();
            calls++;
        }
        // Dots: one path per color, then one outline path for all.
        ctx.lineWidth = r * 0.36;
        for (const [color, idx] of this.colorGroups) {
            ctx.beginPath();
            for (const i of idx) {
                const x = p[i * 2];
                const y = p[i * 2 + 1];
                ctx.moveTo(x + r, y);
                ctx.arc(x, y, r, 0, Math.PI * 2);
            }
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = "#1d1d1f";
            ctx.stroke();
            calls += 2;
        }
        // Selection rings
        ctx.beginPath();
        let any = false;
        for (let i = 0; i < n; i++) {
            if (!this.selected[i]) continue;
            any = true;
            const x = p[i * 2];
            const y = p[i * 2 + 1];
            ctx.moveTo(x + r * 1.7, y);
            ctx.arc(x, y, r * 1.7, 0, Math.PI * 2);
        }
        if (any) {
            ctx.strokeStyle = "#7c5cff";
            ctx.lineWidth = r * 0.44;
            ctx.stroke();
            calls++;
        }
        // Labels (skipped when they'd be too small to read, like the WebGL path)
        const theme = src.field.theme;
        const sizeWorld = this.toggles.screenSizedLabels ? LABEL_SCREEN_PX / z : LABEL_SIZE;
        if (this.toggles.labels && sizeWorld * z >= 5) {
            ctx.font = `bold ${sizeWorld}px "Courier New", ui-monospace, monospace`;
            ctx.textAlign = "center";
            ctx.textBaseline = "alphabetic";
            ctx.fillStyle = css(theme.defaultMarcher.label, 1);
            const lift = DOT_RADIUS * 1.6;
            for (let i = 0; i < n; i++) ctx.fillText(src.labels[i], p[i * 2], p[i * 2 + 1] - lift);
            calls += n;
        }
        this.drawCalls = calls;
    }

    private drawField(field: FieldProperties, z: number): number {
        const ctx = this.ctx;
        const W = field.width;
        const H = field.height;
        const step = field.pixelsPerStep;
        const cf = field.centerFrontPoint;
        const theme = field.theme;
        let calls = 0;
        ctx.fillStyle = css(theme.background, 1);
        ctx.fillRect(0, 0, W, H);
        const lines = (pts: number[], color: RgbaColor, worldWidth: number) => {
            const px = worldWidth * z;
            ctx.beginPath();
            for (let i = 0; i < pts.length; i += 4) {
                ctx.moveTo(pts[i], pts[i + 1]);
                ctx.lineTo(pts[i + 2], pts[i + 3]);
            }
            ctx.strokeStyle = css(color, color.a * Math.min(1, px));
            ctx.lineWidth = Math.max(px, 1) / z;
            ctx.stroke();
            calls++;
        };
        if (this.toggles.grid) {
            const g: number[] = [];
            for (let x = cf.xPixels % step; x < W; x += step) g.push(x, 0, x, H);
            for (let y = cf.yPixels % step; y < H; y += step) g.push(0, y, W, y);
            lines(g, theme.tertiaryStroke, 1);
        }
        const half: number[] = [];
        if (field.halfLineXInterval) {
            const d = step * field.halfLineXInterval;
            for (let x = cf.xPixels % d; x < W; x += d) half.push(x, 0, x, H);
        }
        if (field.halfLineYInterval) {
            const d = step * field.halfLineYInterval;
            for (let y = cf.yPixels % d; y < H; y += d) half.push(0, y, W, y);
        }
        lines(half, theme.secondaryStroke, 1);
        const yard: number[] = [];
        const hashes: number[] = [];
        for (const xc of field.xCheckpoints) {
            if (!xc.visible) continue;
            const x = cf.xPixels + xc.stepsFromCenterFront * step;
            yard.push(x, 0, x, H);
            if (field.useHashes)
                for (const yc of field.yCheckpoints) {
                    if (!yc.visible) continue;
                    const y = cf.yPixels + yc.stepsFromCenterFront * step - 1;
                    hashes.push(Math.max(0, x - 10), y, Math.min(W, x + 10), y);
                }
        }
        lines(yard, theme.primaryStroke, 1);
        lines(hashes, theme.primaryStroke, 3);
        // Yard numbers
        const yn = field.yardNumberCoordinates;
        if (yn.homeStepsFromFrontToInside !== undefined && yn.homeStepsFromFrontToOutside !== undefined) {
            const h = (yn.homeStepsFromFrontToInside - yn.homeStepsFromFrontToOutside) * step;
            ctx.font = `bold ${h * 1.25}px "Courier New", ui-monospace, monospace`;
            ctx.textAlign = "center";
            ctx.fillStyle = css(theme.fieldLabel);
            for (const xc of field.xCheckpoints) {
                if (!xc.fieldLabel) continue;
                const x = cf.xPixels + xc.stepsFromCenterFront * step;
                ctx.fillText(xc.fieldLabel, x, cf.yPixels - yn.homeStepsFromFrontToOutside * step);
                calls++;
            }
        }
        return calls;
    }

    dispose() {}
}
