/**
 * Writes the uniform template drawing as a one-page vector PDF at size
 * (105 × 88 in is 7560 × 6336 points, inside PDF's page limit). The text is
 * set in the standard Helvetica fonts; centred and right-aligned text is
 * placed with Helvetica's character widths.
 *
 * Plain TypeScript only: this module lives under `view3d/core/`, so it must
 * not import React, React Three Fiber, drei, Electron or the database.
 */
// cspell:words startxref nendobj
import type { Point } from "./regions";
import type { DrawNode, UniformTemplateDrawing } from "./drawing";
import { textWidthEm } from "./textWidth";

const num = (v: number) => String(Number(v.toFixed(3)));

function rgb(hex: string): string {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
        .map((c) => num(c / 255))
        .join(" ");
}

/** Text in a PDF literal string, folded to printable ASCII. */
function pdfString(value: string): string {
    const ascii = value
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/×/g, "x")
        .replace(/[^\x20-\x7e]/g, "?");
    return `(${ascii.replace(/([\\()])/g, "\\$1")})`;
}

export function uniformTemplatePdf(d: UniformTemplateDrawing): Uint8Array {
    const pt = (inches: number) => inches * 72;
    const pageW = pt(d.width);
    const pageH = pt(d.height);
    const ops: string[] = [];

    const walk = (node: DrawNode, ox: number, oy: number) => {
        const X = (x: number) => num(pt(x + ox));
        const Y = (y: number) => num(pageH - pt(y + oy));
        const path = (ps: readonly Point[]) =>
            ps
                .map(([x, y], i) => `${X(x)} ${Y(y)} ${i === 0 ? "m" : "l"}`)
                .join("\n");
        switch (node.kind) {
            case "group":
                for (const child of node.children)
                    walk(child, ox + (node.dx ?? 0), oy + (node.dy ?? 0));
                return;
            case "shape": {
                if (node.fill)
                    ops.push(
                        `${rgb(node.fill)} rg`,
                        path(node.points),
                        node.closed ? "h f" : "f",
                    );
                if (node.stroke)
                    ops.push(
                        `${rgb(node.stroke)} RG`,
                        `${num(pt(node.width ?? 0.05))} w 1 j`,
                        node.dash ? `[${num(pt(node.dash))}] 0 d` : "[] 0 d",
                        path(node.points),
                        node.closed ? "s" : "S",
                    );
                return;
            }
            case "text": {
                const size = pt(node.size);
                const width = textWidthEm(node.text, node.bold) * size;
                const shift =
                    node.anchor === "middle"
                        ? width / 2
                        : node.anchor === "end"
                          ? width
                          : 0;
                // PDF turns counter-clockwise with y up; the drawing turns clockwise with y down
                const a = (-(node.rotate ?? 0) * Math.PI) / 180;
                const cos = Math.cos(a);
                const sin = Math.sin(a);
                const x = pt(node.x + ox) - shift * cos;
                const y = pageH - pt(node.y + oy) - shift * sin;
                ops.push(
                    `${rgb(node.color)} rg`,
                    `BT /${node.bold ? "F2" : "F1"} ${num(size)} Tf ${num(cos)} ${num(sin)} ${num(-sin)} ${num(cos)} ${num(x)} ${num(y)} Tm ${pdfString(node.text)} Tj ET`,
                );
                return;
            }
        }
    };
    for (const group of d.root) walk(group, 0, 0);
    const content = ops.join("\n");

    const box = `0 0 ${num(pageW)} ${num(pageH)}`;
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        `<< /Type /Page /Parent 2 0 R /MediaBox [${box}] /TrimBox [${box}]` +
            " /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
        `<< /Title ${pdfString(d.title)} /Subject (Released under CC0 1.0) >>`,
    ];

    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((body, i) => {
        offsets.push(out.length);
        out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets)
        out += `${String(offset).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i);
    return bytes;
}
