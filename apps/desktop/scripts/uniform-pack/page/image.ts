/**
 * Photo helpers for the agent skill (README.md, "uniform:image"), and the app's own template
 * downloads. A photo is decoded by the browser, so any format Chromium reads works.
 */
import {
    uniformTemplateFile,
    type UniformCanvas,
} from "@/view3d/core/artworkTemplates/uniform";
import { fromBase64, toBase64 } from "./bytes";

async function decode(data: string): Promise<ImageBitmap> {
    return createImageBitmap(
        new Blob([fromBase64(data) as Uint8Array<ArrayBuffer>]),
    );
}

async function png(c: OffscreenCanvas): Promise<string> {
    const blob = await c.convertToBlob({ type: "image/png" });
    return toBase64(new Uint8Array(await blob.arrayBuffer()));
}

/** The photo with a labelled pixel grid every `step` px, so points can be read off it */
export async function grid(data: string, step: number) {
    const img = await decode(data);
    const c = new OffscreenCanvas(img.width, img.height);
    const x = c.getContext("2d")!;
    x.drawImage(img, 0, 0);
    const font = Math.max(11, Math.round(Math.min(img.width, img.height) / 70));
    x.font = `bold ${font}px sans-serif`;
    x.lineWidth = 1;
    for (let v = 0; v <= Math.max(img.width, img.height); v += step) {
        const major = v % (step * 5) === 0;
        x.strokeStyle = major ? "rgba(255,0,255,0.9)" : "rgba(0,255,255,0.55)";
        if (v <= img.width) {
            x.beginPath();
            x.moveTo(v + 0.5, 0);
            x.lineTo(v + 0.5, img.height);
            x.stroke();
        }
        if (v <= img.height) {
            x.beginPath();
            x.moveTo(0, v + 0.5);
            x.lineTo(img.width, v + 0.5);
            x.stroke();
        }
        for (const [tx, ty] of [
            [v + 2, font + 2],
            [2, v + font + 2],
        ]) {
            x.fillStyle = "#000";
            x.fillText(String(v), tx + 1, ty + 1);
            x.fillStyle = "#ff0";
            x.fillText(String(v), tx, ty);
        }
    }
    return { png: await png(c), width: img.width, height: img.height };
}

/**
 * Each box's mean and median color as hex, and how much it varies (0 to 255). With `mark`, also
 * the part of the photo round the boxes, enlarged, with each box outlined and numbered, to check
 * the boxes landed where meant.
 */
export async function sample(data: string, boxes: number[][], mark = false) {
    const img = await decode(data);
    const c = new OffscreenCanvas(img.width, img.height);
    const x = c.getContext("2d", { willReadFrequently: true })!;
    x.drawImage(img, 0, 0);
    const hex = (r: number, g: number, b: number) =>
        `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
    const results = boxes.map(([bx, by, bw = 1, bh = 1]) => {
        const x0 = Math.max(0, Math.min(img.width - 1, Math.round(bx)));
        const y0 = Math.max(0, Math.min(img.height - 1, Math.round(by)));
        const w = Math.max(1, Math.min(img.width - x0, Math.round(bw)));
        const h = Math.max(1, Math.min(img.height - y0, Math.round(bh)));
        const d = x.getImageData(x0, y0, w, h).data;
        const ch: number[][] = [[], [], []];
        for (let i = 0; i < d.length; i += 4)
            for (let k = 0; k < 3; k++) ch[k].push(d[i + k]);
        const mean = ch.map((a) => a.reduce((s, v) => s + v, 0) / a.length);
        const median = ch.map((a) => a.sort((p, q) => p - q)[a.length >> 1]);
        const spread = Math.max(
            ...ch.map((a, k) =>
                Math.sqrt(
                    a.reduce((s, v) => s + (v - mean[k]) ** 2, 0) / a.length,
                ),
            ),
        );
        return {
            box: [x0, y0, w, h],
            mean: hex(mean[0], mean[1], mean[2]),
            median: hex(median[0], median[1], median[2]),
            spread: Math.round(spread),
        };
    });
    if (!mark) return { boxes: results };
    // the part of the photo round the boxes (a margin of a quarter of their spread, at least
    // 40 px), on a copy at least 900 px wide, each box outlined in magenta over a dark rim and
    // numbered from 1
    const xs = results.flatMap(({ box: [bx, , bw] }) => [bx, bx + bw]);
    const ys = results.flatMap(({ box: [, by, , bh] }) => [by, by + bh]);
    const margin = Math.max(
        40,
        Math.round(
            0.25 *
                Math.max(
                    Math.max(...xs) - Math.min(...xs),
                    Math.max(...ys) - Math.min(...ys),
                ),
        ),
    );
    const cx0 = Math.max(0, Math.min(...xs) - margin);
    const cy0 = Math.max(0, Math.min(...ys) - margin);
    const cw = Math.min(img.width, Math.max(...xs) + margin) - cx0;
    const chh = Math.min(img.height, Math.max(...ys) + margin) - cy0;
    const scale = Math.max(1, Math.ceil(900 / cw));
    const m = new OffscreenCanvas(cw * scale, chh * scale);
    const mx = m.getContext("2d")!;
    mx.imageSmoothingEnabled = false;
    mx.drawImage(img, cx0, cy0, cw, chh, 0, 0, m.width, m.height);
    mx.font = "bold 16px sans-serif";
    results.forEach(({ box: [bx, by, bw, bh] }, i) => {
        const X = (bx - cx0) * scale;
        const Y = (by - cy0) * scale;
        for (const [color, width] of [
            ["#000", 3],
            ["#f0f", 1],
        ] as const) {
            mx.strokeStyle = color;
            mx.lineWidth = width;
            mx.strokeRect(X - 1, Y - 1, bw * scale + 2, bh * scale + 2);
        }
        mx.fillStyle = "#000";
        mx.fillText(String(i + 1), X + bw * scale + 5, Y + 14);
        mx.fillStyle = "#ff0";
        mx.fillText(String(i + 1), X + bw * scale + 4, Y + 13);
    });
    return { boxes: results, marked: await png(m) };
}

/** A box of the photo, optionally scaled to `size` (for a tile's texture) */
export async function crop(data: string, box: number[], size?: number[]) {
    const img = await decode(data);
    const [bx, by, bw, bh] = box.map(Math.round);
    const [w, h] = size ?? [bw, bh];
    const c = new OffscreenCanvas(w, h);
    const x = c.getContext("2d")!;
    x.imageSmoothingQuality = "high";
    x.drawImage(img, bx, by, bw, bh, 0, 0, w, h);
    return { png: await png(c), width: w, height: h };
}

/** The app's template downloads: uniform-template.png/.svg/.pdf and uniform-regions.json */
export async function template() {
    const out: Record<string, string> = {};
    for (const format of ["png", "svg", "pdf", "json"] as const) {
        const file = await uniformTemplateFile(
            format,
            (w, h): UniformCanvas => {
                const c = new OffscreenCanvas(w, h);
                return {
                    getContext: () =>
                        c.getContext("2d") as unknown as ReturnType<
                            UniformCanvas["getContext"]
                        >,
                    encodePng: async () =>
                        new Uint8Array(
                            await (
                                await c.convertToBlob({ type: "image/png" })
                            ).arrayBuffer(),
                        ),
                };
            },
        );
        out[file.name] =
            typeof file.data === "string"
                ? toBase64(new TextEncoder().encode(file.data))
                : toBase64(file.data);
    }
    return out;
}
