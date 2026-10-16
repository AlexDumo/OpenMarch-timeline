/**
 * Makes a show's legacy field image into its floor (ADR 0002 D-23, convert on open): the bytes
 * go through the Artwork pipeline (D-13) as a Base floor, sized to where the image sits on the
 * field (fill or fit), into a throwaway store in the temp folder. The Version is read back ready
 * to embed in the show, and the store is deleted: opening a show never writes to the local
 * Library (D-12).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FieldProperties } from "@openmarch/core";
import { floorSizeForImage } from "../../../src/view3d/core/field/floorSize";
import { versionToEmbed } from "../../../src/view3d/library/showLibraryEmbed";
import type { EmbedLibraryVersion } from "../../../src/db-functions/showLibrary";
import { importArtwork, inspectArtwork } from "../artwork-import";
import type { PdfRenderer } from "../artwork-import/pdf";
import { sniffArtworkFormat } from "../artwork-import/formats";
import { openLibraryStore } from "../library/store";

/** Temp folders this module makes start with this. */
export const FLOOR_TEMP_PREFIX = "openmarch-floor-";

const FLOOR_NAME = "Field image";

/** Formats the Artwork pipeline reads itself; anything else sharp reads (GIF, WebP) becomes PNG. */
async function pipelineInput(
    image: Uint8Array,
): Promise<{ bytes: Uint8Array; extension: string }> {
    const format = sniffArtworkFormat(image);
    if (format)
        return { bytes: image, extension: format === "jpeg" ? "jpg" : format };
    const sharp = (await import("sharp")).default;
    return {
        bytes: new Uint8Array(await sharp(image).png().toBuffer()),
        extension: "png",
    };
}

export interface FloorFromFieldImageOptions {
    /** Renders a PDF original; defaults to pdf.js in a hidden window, made only for a PDF. */
    pdfRenderer?: () => PdfRenderer;
}

const appPdfRenderer = async (): Promise<PdfRenderer> =>
    (await import("../artwork-import")).createElectronPdfRenderer();

export async function floorFromFieldImage(
    image: Uint8Array,
    fieldProperties: FieldProperties,
    options: FloorFromFieldImageOptions = {},
): Promise<EmbedLibraryVersion> {
    const { bytes, extension } = await pipelineInput(image);
    const file = { filename: `${FLOOR_NAME}.${extension}`, bytes };
    const pdfRenderer =
        extension === "pdf"
            ? (options.pdfRenderer?.() ?? (await appPdfRenderer()))
            : null;

    // The first page's shape, from the pipeline, sizes the floor (a PDF's later pages don't)
    const inspection = await inspectArtwork(file, { pdfRenderer });
    if (!inspection.ok) {
        throw new Error(
            `The field image couldn't be read: ${inspection.notes.map((n) => n.message).join("; ")}`,
        );
    }
    const first = inspection.pages[0];
    if (!first) throw new Error("The field image has no pages");
    const size = floorSizeForImage(fieldProperties, {
        width: first.aspect,
        height: 1,
    });

    const root = await mkdtemp(path.join(tmpdir(), FLOOR_TEMP_PREFIX));
    try {
        const store = await openLibraryStore({ root });
        const report = await importArtwork(
            store,
            {
                file,
                surface: "baseFloor",
                pages: [first.index],
                size: {
                    width: { m: size.widthM },
                    height: { m: size.heightM },
                    source: "slot",
                    templateId: null,
                },
                name: FLOOR_NAME,
            },
            { pdfRenderer },
        );
        const page = report.imported[0];
        if (!page) {
            const notes = report.notImported.flatMap((n) => n.notes);
            throw new Error(
                `The field image couldn't be imported: ${notes.map((n) => n.message).join("; ") || "no page"}`,
            );
        }
        return await versionToEmbed({
            item: page.item,
            versionHash: page.version.hash,
            readParts: async ({ roles }) => ({
                ok: true,
                value: Object.fromEntries(
                    await Promise.all(
                        roles.map(async (role) => [
                            role,
                            await store.readBlob(page.version.parts[role]!),
                        ]),
                    ),
                ),
            }),
        });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}
