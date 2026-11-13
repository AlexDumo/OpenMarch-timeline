// cspell:words fulgur fulgur's ironpress dompdf fontkit krilla stylo nosplit asis breakbefore
/**
 * Header and footer for every page, drawn onto finished PDF pages with
 * pdf-lib, in the layout of export-service's printToPDF templates:
 *   header: logo (left), show name (centre, bold)
 *   footer: "Exported <date>" (left), logo + "Made with OpenMarch" (centre),
 *           "Page X of Y" (right)
 * The logo stays vector (its SVG paths are drawn as PDF paths). Text uses the
 * same bundled font as the sheets, subset, so any show name prints.
 */
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export interface StampOptions {
    showName: string;
    exportedDate: string;
    logoSvg: string;
    regularFont: Uint8Array;
    boldFont: Uint8Array;
}

const GREY = rgb(0x99 / 255, 0x99 / 255, 0x99 / 255);
const PX = 0.75; // 1 CSS px in PDF points

function logoPaths(svg: string): { d: string; w: number; h: number } {
    const vb = /viewBox="([\d.\s-]+)"/
        .exec(svg)?.[1]
        .split(/\s+/)
        .map(Number) ?? [0, 0, 54, 32];
    const ds = [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
    return { d: ds.join(" "), w: vb[2], h: vb[3] };
}

function drawLogo(
    page: PDFPage,
    logo: ReturnType<typeof logoPaths>,
    x: number,
    yTop: number,
    heightPt: number,
    opacity: number,
) {
    const scale = heightPt / logo.h;
    // drawSvgPath puts the SVG origin at (x, y) with y pointing down.
    page.drawSvgPath(logo.d, {
        x,
        y: yTop,
        scale,
        color: rgb(0, 0, 0),
        opacity,
    });
    return logo.w * scale;
}

function centredText(
    page: PDFPage,
    text: string,
    font: PDFFont,
    size: number,
    cx: number,
    y: number,
) {
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: cx - w / 2, y, size, font, color: GREY });
}

/** Merges documents in order, then stamps header/footer with "Page X of Y" across the whole result. */
export async function mergeAndStamp(
    parts: Uint8Array[],
    o: StampOptions,
): Promise<Uint8Array> {
    const out = await PDFDocument.create();
    out.registerFontkit(fontkit);
    for (const part of parts) {
        const src = await PDFDocument.load(part);
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
    }
    const regular = await out.embedFont(o.regularFont, { subset: true });
    const bold = await out.embedFont(o.boldFont, { subset: true });
    const logo = logoPaths(o.logoSvg);
    const pages = out.getPages();
    const total = pages.length;
    pages.forEach((page, i) => {
        const { width, height } = page.getSize();
        const pad = 16 * PX;
        // Header band: top 0.5in; content centred around 0.25in from the top edge.
        const headerMid = height - 18;
        drawLogo(page, logo, pad, headerMid + 8, 16, 1);
        centredText(
            page,
            o.showName,
            bold,
            8 * PX * 1.33,
            width / 2,
            headerMid - 3,
        );
        // Footer band: bottom 0.5in.
        const footerMid = 18;
        const fs = 8 * PX * 1.33;
        page.drawText(`Exported ${o.exportedDate}`, {
            x: pad,
            y: footerMid - 3,
            size: fs,
            font: regular,
            color: GREY,
        });
        const brand = "Made with OpenMarch";
        const brandW = regular.widthOfTextAtSize(brand, fs);
        const logoW = (logo.w * 10) / logo.h;
        const startX = width / 2 - (logoW + 3 + brandW) / 2;
        drawLogo(page, logo, startX, footerMid + 5, 10, 0.55);
        page.drawText(brand, {
            x: startX + logoW + 3,
            y: footerMid - 3,
            size: fs,
            font: regular,
            color: GREY,
        });
        const pageText = `Page ${i + 1} of ${total}`;
        const pw = regular.widthOfTextAtSize(pageText, fs);
        page.drawText(pageText, {
            x: width - pad - pw,
            y: footerMid - 3,
            size: fs,
            font: regular,
            color: GREY,
        });
    });
    out.setTitle(
        o.showName ? `${o.showName} coordinate sheets` : "Coordinate sheets",
    );
    out.setCreator("OpenMarch");
    return out.save();
}
