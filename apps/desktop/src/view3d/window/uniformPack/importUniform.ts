// cspell:words omasset
/**
 * Turns a picked file into a uniform pack (fork #1257; docs/3d/uniform-artwork.md, "Ways in"):
 *
 * - **PNG:** a transparent page at the template's size (3360 × 2816). Checked, scaled if it's
 *   another size, and re-encoded in the uniform pack worker; the window never decodes it.
 * - **SVG:** a page whose viewBox is the page in inches (`0 0 105 88`). A worker can't draw SVG,
 *   so the window draws it as an image at the template's size: image mode runs no scripts and
 *   fetches nothing, but the drawing itself, and any `data:` images inside the SVG, are decoded
 *   in the window, and drawing has no timeout. The worker then checks and encodes the pixels
 *   like a PNG's.
 * - **Pack file** (`.omasset`): read and checked in the worker, and stored as it is, so a pack
 *   that left a show comes back unchanged.
 *
 * PDF isn't read: the app doesn't render PDFs anywhere yet.
 */
import type { PresetLook } from "@/view3d/core/marchers/uniformPresets";
import {
    ASSET_FILE_EXTENSION,
    FLATS_PAGE_IN,
    FLATS_PAGE_PX,
    UNIFORM_PACK_MAX_BYTES,
    singleLayerManifest,
    uniformNameFromFile,
    writeUniformPack,
} from "@/view3d/core/uniformPack/format";
import type {
    PageNote,
    PageRegions,
} from "@/view3d/core/uniformPack/pageChecks";
import {
    UniformPackJobError,
    runUniformPackJob,
} from "@/view3d/uniformPack/runUniformPackJob";

/** A note about an import, worded where it's shown */
export type UniformImportNote =
    | PageNote
    /** The image wasn't the template's size; it was scaled to it */
    | "scaled"
    /** The SVG's viewBox isn't the page in inches; it was fitted to the page */
    | "svgViewBox"
    /** What the art leaves clear takes the band preset's colors (a PNG or SVG, not a pack) */
    | "palette";

/** Why a file can't become a uniform */
export type UniformImportRefusal =
    | "unsupported"
    | "pdf"
    | "notPng"
    | "notSvg"
    | "tooLarge"
    | "unreadable"
    | "notPack"
    | "newer"
    | "damaged"
    | "timedOut";

export class UniformImportError extends Error {
    constructor(
        readonly code: UniformImportRefusal,
        message: string,
    ) {
        super(message);
        this.name = "UniformImportError";
    }
}

export interface UniformImport {
    name: string;
    /** The pack file to store */
    pack: Uint8Array;
    notes: UniformImportNote[];
    /** With `scaled`: the picked image's size */
    scaledFrom: { width: number; height: number } | null;
}

/** An SVG larger than this isn't drawn */
export const UNIFORM_SVG_MAX_BYTES = 16 * 1024 * 1024;

/** What a picked file is, by its name, then its first bytes */
export function uniformFileKind(
    name: string,
    head: Uint8Array,
): "png" | "svg" | "pack" | "pdf" | null {
    const lower = name.toLowerCase();
    if (lower.endsWith(".png")) return "png";
    if (lower.endsWith(".svg")) return "svg";
    if (lower.endsWith(ASSET_FILE_EXTENSION) || lower.endsWith(".zip"))
        return "pack";
    if (lower.endsWith(".pdf")) return "pdf";
    if (head[0] === 0x89 && head[1] === 0x50) return "png";
    if (head[0] === 0x50 && head[1] === 0x4b) return "pack";
    if (head[0] === 0x25 && head[1] === 0x50) return "pdf";
    return null;
}

/**
 * The viewBox of an SVG's root element, as four numbers, or null when it has none. Read from
 * the text, never parsed as a document in the window.
 */
export function svgViewBox(
    text: string,
): [number, number, number, number] | null {
    const root = /<svg\b[^>]*>/i.exec(text);
    if (!root) return null;
    const match = /\bviewBox\s*=\s*["']([^"']*)["']/i.exec(root[0]);
    if (!match) return null;
    const nums = match[1]
        .trim()
        .split(/[\s,]+/)
        .map(Number);
    return nums.length === 4 && nums.every(Number.isFinite)
        ? (nums as [number, number, number, number])
        : null;
}

/** True when a viewBox is the template's page in inches, give or take a hundredth */
export const isPageViewBox = (box: readonly number[] | null): boolean =>
    !!box &&
    Math.abs(box[0]) < 0.01 &&
    Math.abs(box[1]) < 0.01 &&
    Math.abs(box[2] - FLATS_PAGE_IN.width) < 0.01 &&
    Math.abs(box[3] - FLATS_PAGE_IN.height) < 0.01;

/** An SVG whose root says it is `width` × `height` pixels, in place of any size it gave */
export function sizedSvg(text: string, width: number, height: number): string {
    return text.replace(/<svg\b[^>]*>/i, (tag) =>
        tag
            .replace(/\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*')/gi, "")
            .replace(/^<svg\b/i, `<svg width="${width}" height="${height}"`),
    );
}

/**
 * Draws an SVG at the template's size as an image: the browser's image mode runs no scripts and
 * fetches nothing, so the SVG can only draw itself. It draws in the window, with no timeout (see
 * the module comment). Returns RGBA pixels, not premultiplied.
 */
async function drawSvgPage(text: string): Promise<Uint8ClampedArray> {
    const { width, height } = FLATS_PAGE_PX;
    // the page size in the root, so the browser draws it at the template's resolution
    const sized = sizedSvg(text, width, height);
    const url = URL.createObjectURL(
        new Blob([sized], { type: "image/svg+xml" }),
    );
    try {
        const img = new Image();
        img.decoding = "async";
        img.src = url;
        await img.decode().catch(() => {
            throw new UniformImportError(
                "unreadable",
                "the SVG couldn't be drawn",
            );
        });
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, width, height);
        const pixels = ctx.getImageData(0, 0, width, height).data;
        canvas.width = 0;
        return pixels;
    } finally {
        URL.revokeObjectURL(url);
    }
}

const fromJob = (error: unknown): never => {
    if (error instanceof UniformPackJobError)
        throw new UniformImportError(error.code, error.message);
    throw error;
};

/** A uniform file saved from a show: read and its first layer checked in the worker, kept as it is */
async function importPackFile(
    bytes: Uint8Array,
    regions: PageRegions,
    runJob: typeof runUniformPackJob,
): Promise<UniformImport> {
    if (bytes.byteLength > UNIFORM_PACK_MAX_BYTES)
        throw new UniformImportError("tooLarge", `${bytes.byteLength} bytes`);
    try {
        // a copy goes to the worker: these bytes are what the show will store
        const result = await runJob({
            type: "pack",
            bytes: bytes.slice(),
            regions,
        });
        if (result.type !== "pack")
            throw new UniformImportError("unreadable", "no pack");
        return {
            name: result.manifest.name,
            pack: bytes,
            notes: result.notes,
            scaledFrom: null,
        };
    } catch (error) {
        if (error instanceof UniformImportError) throw error;
        return fromJob(error);
    }
}

/** A picked PNG or SVG page, checked and encoded as the pack stores a layer */
export interface ImportedPage {
    name: string;
    /** The page PNG at the template's size */
    png: Uint8Array;
    notes: UniformImportNote[];
    scaledFrom: { width: number; height: number } | null;
}

interface ImportDeps {
    /** Runs a worker job; tests stand in for the worker */
    runJob?: typeof runUniformPackJob;
    /** Draws an SVG page; tests stand in for the browser */
    drawSvg?: (text: string) => Promise<Uint8ClampedArray>;
}

type PickedFile = {
    name: string;
    size: number;
    arrayBuffer(): Promise<ArrayBuffer>;
};

/** What a picked file is, refusing PDFs and files that are none of the kinds read */
function kindOf(file: PickedFile, bytes: Uint8Array) {
    const kind = uniformFileKind(file.name, bytes.subarray(0, 4));
    if (kind === "pdf")
        throw new UniformImportError("pdf", "PDFs aren't read yet");
    if (!kind) {
        // an SVG without its extension still starts like one
        const head = new TextDecoder().decode(bytes.subarray(0, 512));
        if (!/<svg\b/i.test(head))
            throw new UniformImportError("unsupported", file.name);
    }
    return kind;
}

/** A PNG's or SVG's bytes as a page, decoded in the worker (an SVG drawn in the window first) */
async function pageOf(
    bytes: Uint8Array,
    kind: "png" | "svg" | null,
    fileName: string,
    regions: PageRegions,
    { runJob = runUniformPackJob, drawSvg = drawSvgPage }: ImportDeps,
): Promise<Omit<ImportedPage, "name">> {
    const notes: UniformImportNote[] = [];
    try {
        if (kind === "png") {
            const result = await runJob({ type: "png", bytes, regions }, [
                bytes.buffer,
            ]);
            if (result.type !== "page")
                throw new UniformImportError("unreadable", "no page");
            if (result.scaledFrom) notes.push("scaled");
            notes.push(...result.notes);
            return { png: result.png, notes, scaledFrom: result.scaledFrom };
        }
        if (bytes.byteLength > UNIFORM_SVG_MAX_BYTES)
            throw new UniformImportError(
                "tooLarge",
                `${bytes.byteLength} bytes`,
            );
        const text = new TextDecoder().decode(bytes);
        if (!/<svg\b/i.test(text))
            throw new UniformImportError("notSvg", fileName);
        if (!isPageViewBox(svgViewBox(text))) notes.push("svgViewBox");
        const pixels = await drawSvg(text);
        const result = await runJob(
            {
                type: "pixels",
                width: FLATS_PAGE_PX.width,
                height: FLATS_PAGE_PX.height,
                pixels,
                regions,
            },
            [pixels.buffer],
        );
        if (result.type !== "page")
            throw new UniformImportError("unreadable", "no page");
        notes.push(...result.notes);
        return { png: result.png, notes, scaledFrom: null };
    } catch (error) {
        if (error instanceof UniformImportError) throw error;
        return fromJob(error);
    }
}

/**
 * A picked PNG or SVG as an overlay layer for a mode (step 5 of fork #1257): checked and encoded
 * like a uniform's page. An overlay holds only what changes, so the notes about clear parts of
 * the page are left out; only `scaled` and `svgViewBox` are kept. A uniform file or a PDF is
 * refused (`unsupported`, `pdf`). Throws {@link UniformImportError}.
 */
export async function importLayerFile(
    file: PickedFile,
    regions: PageRegions,
    deps: ImportDeps = {},
): Promise<ImportedPage> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = kindOf(file, bytes);
    if (kind === "pack") throw new UniformImportError("unsupported", file.name);
    const page = await pageOf(bytes, kind, file.name, regions, deps);
    return {
        ...page,
        name: uniformNameFromFile(file.name),
        notes: page.notes.filter((n) => n === "scaled" || n === "svgViewBox"),
    };
}

/**
 * The pack for a picked file. A PNG or SVG becomes a one-layer pack named after the file,
 * dressed around its art in `look` (the band's preset, so the hat, gloves and shoes keep their
 * colors). Throws {@link UniformImportError}.
 */
export async function importUniformFile(
    file: PickedFile,
    look: PresetLook,
    regions: PageRegions,
    deps: ImportDeps = {},
): Promise<UniformImport> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = kindOf(file, bytes);
    if (kind === "pack")
        return await importPackFile(
            bytes,
            regions,
            deps.runJob ?? runUniformPackJob,
        );
    const name = uniformNameFromFile(file.name);
    const { png, notes, scaledFrom } = await pageOf(
        bytes,
        kind,
        file.name,
        regions,
        deps,
    );
    // the parts the art leaves clear wear `look`'s colors: say so
    notes.push("palette");
    const manifest = singleLayerManifest({ name, look });
    const pack = writeUniformPack(manifest, { [manifest.layers[0].file]: png });
    return { name, pack, notes, scaledFrom };
}
