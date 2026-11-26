/**
 * Paints the uniform template drawing on a 2D canvas at its DPI, for the PNG.
 * Unlike the silk templates' PNG, this one carries its labels: an artist in
 * Procreate or Photoshop sees only the PNG, so the canvas's own fonts set the
 * text. The canvas is passed in (the renderer's `OffscreenCanvas`), so this
 * stays platform-free.
 *
 * Plain TypeScript only: this module lives under `view3d/core/`, so it must
 * not import React, React Three Fiber, drei, Electron or the database.
 */
// cspell:words IHDR
import { METERS_PER_INCH } from "../../sizes/units";
import { pngChunk } from "../png";
import {
    FONT_FAMILY,
    type DrawNode,
    type UniformTemplateDrawing,
} from "./drawing";

/** The 2D canvas calls the painter uses. */
export type UniformCanvasContext = Pick<
    CanvasRenderingContext2D,
    | "beginPath"
    | "moveTo"
    | "lineTo"
    | "closePath"
    | "fill"
    | "stroke"
    | "fillText"
    | "setLineDash"
    | "save"
    | "restore"
    | "translate"
    | "rotate"
    | "fillStyle"
    | "strokeStyle"
    | "lineWidth"
    | "lineJoin"
    | "lineCap"
    | "font"
    | "textAlign"
    | "textBaseline"
>;

export interface UniformCanvas {
    getContext(kind: "2d"): UniformCanvasContext | null;
    /** The canvas as PNG bytes. */
    encodePng(): Promise<Uint8Array>;
}

/** The PNG's pixel size. */
export function uniformTemplatePngSize(d: UniformTemplateDrawing): {
    width: number;
    height: number;
} {
    return {
        width: Math.round(d.width * d.dpi),
        height: Math.round(d.height * d.dpi),
    };
}

export function paintUniformTemplate(
    ctx: UniformCanvasContext,
    d: UniformTemplateDrawing,
): void {
    const k = d.dpi;
    ctx.lineJoin = "round";
    ctx.lineCap = "butt";
    ctx.textBaseline = "alphabetic";
    const walk = (node: DrawNode, ox: number, oy: number) => {
        switch (node.kind) {
            case "group":
                for (const child of node.children)
                    walk(child, ox + (node.dx ?? 0), oy + (node.dy ?? 0));
                return;
            case "shape": {
                ctx.beginPath();
                node.points.forEach(([x, y], i) => {
                    const px = (x + ox) * k;
                    const py = (y + oy) * k;
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                });
                if (node.closed) ctx.closePath();
                if (node.fill) {
                    ctx.fillStyle = node.fill;
                    ctx.fill("evenodd");
                }
                if (node.stroke) {
                    ctx.strokeStyle = node.stroke;
                    ctx.lineWidth = Math.max(1, (node.width ?? 0.05) * k);
                    ctx.setLineDash(
                        node.dash ? [node.dash * k, node.dash * k] : [],
                    );
                    ctx.stroke();
                }
                return;
            }
            case "text": {
                ctx.save();
                ctx.translate((node.x + ox) * k, (node.y + oy) * k);
                if (node.rotate) ctx.rotate((node.rotate * Math.PI) / 180);
                ctx.font = `${node.bold ? "bold " : ""}${Math.round(node.size * k)}px ${FONT_FAMILY}`;
                ctx.textAlign =
                    node.anchor === "middle" ? "center" : node.anchor;
                ctx.fillStyle = node.color;
                ctx.fillText(node.text, 0, 0);
                ctx.restore();
                return;
            }
        }
    };
    for (const group of d.root) walk(group, 0, 0);
}

/**
 * A PNG with a `pHYs` chunk for its DPI, so image editors read the physical
 * size back. Any `pHYs` already there is replaced.
 */
export function withPngDpi(png: Uint8Array, dpi: number): Uint8Array {
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const parts: Uint8Array[] = [png.subarray(0, 8)];
    const ppm = Math.round(dpi / METERS_PER_INCH);
    const phys = new Uint8Array(9);
    const pv = new DataView(phys.buffer);
    pv.setUint32(0, ppm);
    pv.setUint32(4, ppm);
    phys[8] = 1; // unit: meter
    let at = 8;
    while (at + 8 <= png.length) {
        const length = view.getUint32(at);
        const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
        const end = at + 12 + length;
        if (type !== "pHYs") parts.push(png.subarray(at, end));
        if (type === "IHDR") parts.push(pngChunk("pHYs", phys));
        at = end;
    }
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

/** The template as PNG bytes, painted on a canvas from `makeCanvas`. */
export async function uniformTemplatePng(
    d: UniformTemplateDrawing,
    makeCanvas: (width: number, height: number) => UniformCanvas,
): Promise<Uint8Array> {
    const { width, height } = uniformTemplatePngSize(d);
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Uniform template: no 2D canvas");
    paintUniformTemplate(ctx, d);
    return withPngDpi(await canvas.encodePng(), d.dpi);
}
