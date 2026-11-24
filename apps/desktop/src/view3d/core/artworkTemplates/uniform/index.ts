/**
 * The uniform flats template downloads (docs/3d/uniform-artwork.md, "Flats
 * template"): PNG, SVG and PDF of the page, and `uniform-regions.json` for
 * agents. Safe to import from the renderer and from main.
 *
 * Plain TypeScript only: this module lives under `view3d/core/`, so it must
 * not import React, React Three Fiber, drei, Electron or the database.
 */
import { uniformTemplateDrawing, type UniformTemplateDrawing } from "./drawing";
import { fromFlatsAsset, type FlatsAsset } from "./flatsAsset";
import { uniformTemplatePdf } from "./pdf";
import { uniformTemplatePng, type UniformCanvas } from "./png";
import {
    UNIFORM_TEMPLATE_FILES,
    flatsRegions,
    regionsJson,
    type FlatsRegions,
    type FlatsRegionsSource,
} from "./regions";
import { uniformTemplateSvg } from "./svg";

export * from "./regions";
export * from "./drawing";
export * from "./svg";
export * from "./pdf";
export * from "./png";
export * from "./flatsAsset";

let loading: Promise<FlatsRegionsSource> | undefined;

/**
 * The outlines every uniform template is drawn from: the ones generated from
 * the body models (fork #1255). The file is about 160 KB, so it loads on
 * the first download rather than with the settings panel, as the renderer
 * fetches it on demand too.
 */
export function loadUniformFlatsSource(): Promise<FlatsRegionsSource> {
    loading ??= import("../../../assets/uniform-flats/regions.json").then((m) =>
        fromFlatsAsset(m.default as unknown as FlatsAsset),
    );
    return loading;
}

export type UniformTemplateFormat = keyof typeof UNIFORM_TEMPLATE_FILES;

export const UNIFORM_TEMPLATE_FORMATS: readonly UniformTemplateFormat[] = [
    "png",
    "svg",
    "pdf",
    "json",
];

const MIME: Readonly<Record<UniformTemplateFormat, string>> = {
    png: "image/png",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    json: "application/json",
};

/**
 * JSON with each innermost array or object (a point, a seam row, a box) on
 * one line, so the file stays readable at about one line per point.
 */
export function formatJson(value: unknown): string {
    return `${JSON.stringify(value, null, 1).replace(
        /[[{][^[\]{}]*[\]}]/g,
        (leaf) =>
            leaf
                .replace(/\s*\n\s*/g, " ")
                .replace(/([[{]) /, "$1")
                .replace(/ ([\]}])$/, "$1"),
    )}\n`;
}

export interface UniformTemplateFile {
    readonly name: string;
    readonly mimeType: string;
    readonly data: string | Uint8Array;
}

export function uniformTemplate(source: FlatsRegionsSource): {
    model: FlatsRegions;
    drawing: UniformTemplateDrawing;
} {
    const model = flatsRegions(source);
    return { model, drawing: uniformTemplateDrawing(model) };
}

/**
 * One of the template's files. The PNG needs a canvas (the renderer's
 * `OffscreenCanvas`); the others are plain text or bytes.
 */
export async function uniformTemplateFile(
    format: UniformTemplateFormat,
    makeCanvas: (width: number, height: number) => UniformCanvas,
    source?: FlatsRegionsSource,
): Promise<UniformTemplateFile> {
    const { model, drawing } = uniformTemplate(
        source ?? (await loadUniformFlatsSource()),
    );
    const name = UNIFORM_TEMPLATE_FILES[format];
    const mimeType = MIME[format];
    switch (format) {
        case "svg":
            return { name, mimeType, data: uniformTemplateSvg(drawing) };
        case "pdf":
            return { name, mimeType, data: uniformTemplatePdf(drawing) };
        case "json":
            return {
                name,
                mimeType,
                data: formatJson(regionsJson(model)),
            };
        case "png":
            return {
                name,
                mimeType,
                data: await uniformTemplatePng(drawing, makeCanvas),
            };
    }
}
