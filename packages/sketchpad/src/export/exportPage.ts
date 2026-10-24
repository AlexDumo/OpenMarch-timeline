import {
    convertToExcalidrawElements,
    exportToBlob,
    exportToSvg,
    getCommonBounds,
} from "@excalidraw/excalidraw";
import type {
    ExcalidrawElement,
    NonDeletedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import { fieldSceneBounds } from "../drill/coordinates";
import { thumbnailBounds } from "./thumbnailBounds";
import {
    fieldSvgDocument,
    fieldUnderlayMarkup,
    styledFieldProperties,
} from "../field/fieldStyle";
import type { FieldSnapshot, SketchPageRender } from "../types";

/**
 * Exports of a page with its field (ADR 0006 D-2). The field is not in the Excalidraw scene, so
 * an invisible rectangle pins Excalidraw's export bounds to a known area and the field is drawn
 * underneath with one translate (the spike's approach).
 */

export interface SceneBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

const live = (elements: readonly ExcalidrawElement[]) =>
    elements.filter((e) => !e.isDeleted) as NonDeletedExcalidrawElement[];

/** The drawing's bounds in scene units, or null when the page is empty */
export function drawingBounds(
    elements: readonly ExcalidrawElement[],
): SceneBounds | null {
    const els = live(elements);
    if (els.length === 0) return null;
    const [x1, y1, x2, y2] = getCommonBounds(els);
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** The field (with room for its labels) and the drawing together, padded, on whole units */
export function exportBounds(
    snapshot: FieldSnapshot,
    elements: readonly ExcalidrawElement[],
    pad = 24,
): SceneBounds {
    const f = fieldSceneBounds(styledFieldProperties(snapshot), 40);
    let x1 = f.x;
    let y1 = f.y;
    let x2 = f.x + f.width;
    let y2 = f.y + f.height;
    const d = drawingBounds(elements);
    if (d) {
        x1 = Math.min(x1, d.x);
        y1 = Math.min(y1, d.y);
        x2 = Math.max(x2, d.x + d.width);
        y2 = Math.max(y2, d.y + d.height);
    }
    const x = Math.floor(x1 - pad);
    const y = Math.floor(y1 - pad);
    return {
        x,
        y,
        width: Math.ceil(x2 + pad) - x,
        height: Math.ceil(y2 + pad) - y,
    };
}

function boundsElement(b: SceneBounds): ExcalidrawElement {
    return convertToExcalidrawElements([
        {
            type: "rectangle",
            x: b.x,
            y: b.y,
            width: b.width,
            height: b.height,
            strokeColor: "transparent",
            backgroundColor: "transparent",
            strokeWidth: 1,
            roughness: 0,
        },
    ])[0] as ExcalidrawElement;
}

interface SceneInput {
    elements: readonly ExcalidrawElement[];
    files: BinaryFiles;
    appState?: Partial<AppState>;
}

const exportAppState = (appState: Partial<AppState> = {}) =>
    ({
        ...appState,
        exportBackground: false,
        exportWithDarkMode: false,
        exportEmbedScene: false,
        viewBackgroundColor: "transparent",
    }) as AppState;

const SVG_NS = "http://www.w3.org/2000/svg";

/** The page and its field as one SVG element */
export async function exportPageSvgElement(
    snapshot: FieldSnapshot,
    scene: SceneInput,
): Promise<{ svg: SVGSVGElement; bounds: SceneBounds }> {
    const b = exportBounds(snapshot, scene.elements);
    const sceneSvg = await exportToSvg({
        elements: [
            boundsElement(b),
            ...live(scene.elements),
        ] as NonDeletedExcalidrawElement[],
        appState: exportAppState(scene.appState),
        files: scene.files,
        exportPadding: 0,
    });
    const out = document.createElementNS(SVG_NS, "svg");
    out.setAttribute("xmlns", SVG_NS);
    out.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    out.setAttribute("width", String(b.width));
    out.setAttribute("height", String(b.height));
    out.setAttribute("viewBox", `0 0 ${b.width} ${b.height}`);
    const field = document.createElementNS(SVG_NS, "g");
    field.setAttribute("data-om-layer", "field");
    field.setAttribute("transform", `translate(${-b.x} ${-b.y})`);
    field.innerHTML = fieldUnderlayMarkup(snapshot);
    out.appendChild(field);
    const drawing = document.createElementNS(SVG_NS, "g");
    drawing.setAttribute("data-om-layer", "sketch");
    while (sceneSvg.firstChild) drawing.appendChild(sceneSvg.firstChild);
    out.appendChild(drawing);
    return { svg: out, bounds: b };
}

export async function exportPageSvg(
    snapshot: FieldSnapshot,
    scene: SceneInput,
): Promise<Blob> {
    const { svg } = await exportPageSvgElement(snapshot, scene);
    const text = new XMLSerializer().serializeToString(svg);
    return new Blob([text], { type: "image/svg+xml" });
}

async function svgImage(markup: string): Promise<HTMLImageElement> {
    const img = new Image();
    img.src = URL.createObjectURL(
        new Blob([markup], { type: "image/svg+xml" }),
    );
    try {
        await img.decode();
    } finally {
        URL.revokeObjectURL(img.src);
    }
    return img;
}

/** The page and its field as a PNG, `scale` device pixels per scene unit */
export async function exportPagePng(
    snapshot: FieldSnapshot,
    scene: SceneInput,
    scale = 2,
    bounds?: SceneBounds,
): Promise<Blob> {
    const b = bounds ?? exportBounds(snapshot, scene.elements);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(b.width * scale));
    canvas.height = Math.max(1, Math.round(b.height * scale));
    const ctx = canvas.getContext("2d")!;
    const field = await svgImage(fieldSvgDocument(snapshot, b, scale));
    ctx.drawImage(field, 0, 0, canvas.width, canvas.height);
    const drawn = live(scene.elements);
    if (drawn.length > 0) {
        const blob = await exportToBlob({
            elements: [
                boundsElement(b),
                ...drawn,
            ] as NonDeletedExcalidrawElement[],
            appState: {
                ...exportAppState(scene.appState),
                exportScale: scale,
            } as AppState,
            files: scene.files,
            exportPadding: 0,
            mimeType: "image/png",
            getDimensions: () => ({
                width: canvas.width,
                height: canvas.height,
                scale,
            }),
        });
        const bitmap = await createImageBitmap(blob);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    }
    return new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
            (blob) =>
                blob ? resolve(blob) : reject(new Error("PNG export failed")),
            "image/png",
        ),
    );
}

/** The page and its field as a vector PDF. jsPDF and svg2pdf.js load only when this runs. */
export async function exportPagePdf(
    snapshot: FieldSnapshot,
    scene: SceneInput,
): Promise<Blob> {
    const [{ jsPDF }, { svg2pdf }] = await Promise.all([
        import("jspdf"),
        import("svg2pdf.js"),
    ]);
    const { svg, bounds: b } = await exportPageSvgElement(snapshot, scene);
    const doc = new jsPDF({
        orientation: b.width > b.height ? "landscape" : "portrait",
        unit: "pt",
        format: [b.width, b.height],
    });
    // svg2pdf measures through the DOM, so the SVG has to be in the document while it runs
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-100000px;top:0;";
    host.appendChild(svg);
    document.body.appendChild(host);
    try {
        await svg2pdf(svg, doc, {
            x: 0,
            y: 0,
            width: b.width,
            height: b.height,
        });
    } finally {
        host.remove();
    }
    return doc.output("blob");
}

/** A page's drawing alone, for overlays (ADR 0006 D-7) */
export async function renderPage(
    pageId: string,
    scene: SceneInput,
): Promise<SketchPageRender> {
    const drawn = live(scene.elements);
    const bounds = drawingBounds(drawn);
    if (!bounds) return { pageId, svg: "", bounds: null };
    const svg = await exportToSvg({
        elements: drawn,
        appState: exportAppState(scene.appState),
        files: scene.files,
        exportPadding: 0,
    });
    svg.setAttribute(
        "viewBox",
        `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`,
    );
    // Excalidraw draws the content translated to its own origin; move it back to scene units
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("transform", `translate(${bounds.x} ${bounds.y})`);
    const keep: Node[] = [];
    for (const child of [...svg.childNodes]) {
        const el = child as Element;
        if (el.tagName === "defs" || el.tagName === "metadata")
            keep.push(child);
        else g.appendChild(child);
    }
    svg.replaceChildren(...keep, g);
    return { pageId, svg: new XMLSerializer().serializeToString(svg), bounds };
}

/** A small PNG of a page on its field, `width` pixels wide */
export async function renderThumbnail(
    snapshot: FieldSnapshot,
    scene: SceneInput,
    width = 320,
): Promise<Blob> {
    // Cropped to the drawing; the field is drawn only within the crop (`exportPagePng`)
    const bounds = thumbnailBounds(
        drawingBounds(scene.elements),
        exportBounds(snapshot, scene.elements, 8),
    );
    return exportPagePng(snapshot, scene, width / bounds.width, bounds);
}
