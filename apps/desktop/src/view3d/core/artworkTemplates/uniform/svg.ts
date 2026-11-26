/**
 * Writes the uniform template drawing as SVG at size: `width` and `height`
 * are in inches and the view box is in inches, so one user unit is one inch.
 * Region shapes keep their ids; each panel's group is moved to its panel, so
 * the points inside are panel inches, as in `uniform-regions.json`.
 *
 * Plain TypeScript only: this module lives under `view3d/core/`, so it must
 * not import React, React Three Fiber, drei, Electron or the database.
 */
import type { Point } from "./regions";
import {
    FONT_FAMILY,
    type DrawNode,
    type UniformTemplateDrawing,
} from "./drawing";

const n = (v: number) => String(Number(v.toFixed(3)));

function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

const points = (ps: readonly Point[]) =>
    ps.map(([x, y]) => `${n(x)},${n(y)}`).join(" ");

function node(d: DrawNode, indent: string): string {
    switch (d.kind) {
        case "group": {
            const id = d.id ? ` id="${d.id}"` : "";
            const move =
                d.dx || d.dy
                    ? ` transform="translate(${n(d.dx ?? 0)} ${n(d.dy ?? 0)})"`
                    : "";
            const inner = d.children
                .map((c) => node(c, `${indent}  `))
                .join("\n");
            return `${indent}<g${id}${move}>\n${inner}\n${indent}</g>`;
        }
        case "shape": {
            const tag = d.closed ? "polygon" : "polyline";
            const attrs = [
                d.id ? `id="${d.id}"` : "",
                ...Object.entries(d.attrs ?? {}).map(
                    ([k, v]) => `${k}="${escapeXml(v)}"`,
                ),
                `points="${points(d.points)}"`,
                `fill="${d.fill ?? "none"}"`,
                d.stroke
                    ? `stroke="${d.stroke}" stroke-width="${n(d.width ?? 0.05)}" stroke-linejoin="round"`
                    : "",
                d.dash ? `stroke-dasharray="${n(d.dash)} ${n(d.dash)}"` : "",
            ].filter(Boolean);
            return `${indent}<${tag} ${attrs.join(" ")}/>`;
        }
        case "text": {
            const anchor =
                d.anchor === "start" ? "" : ` text-anchor="${d.anchor}"`;
            const weight = d.bold ? ` font-weight="bold"` : "";
            const rotate = d.rotate
                ? ` transform="rotate(${n(d.rotate)} ${n(d.x)} ${n(d.y)})"`
                : "";
            return `${indent}<text x="${n(d.x)}" y="${n(d.y)}" font-size="${n(d.size)}" fill="${d.color}"${anchor}${weight}${rotate}>${escapeXml(d.text)}</text>`;
        }
    }
}

export function uniformTemplateSvg(d: UniformTemplateDrawing): string {
    return [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<svg xmlns="http://www.w3.org/2000/svg" width="${n(d.width)}in" height="${n(d.height)}in" viewBox="0 0 ${n(d.width)} ${n(d.height)}" font-family="${FONT_FAMILY}">`,
        `<title>${escapeXml(d.title)}</title>`,
        `<desc>${escapeXml(d.description)}</desc>`,
        ...d.root.map((g) => node(g, "")),
        `</svg>`,
        ``,
    ].join("\n");
}
