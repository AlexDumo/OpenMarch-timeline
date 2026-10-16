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
import { importArtwork } from "../artwork-import";
import { sniffArtworkFormat } from "../artwork-import/formats";
import { openLibraryStore } from "../library/store";

/** Temp folders this module makes start with this. */
export const FLOOR_TEMP_PREFIX = "openmarch-floor-";

const FLOOR_NAME = "Field image";

/** PNG and JPEG go in as they are; anything else sharp reads (GIF, WebP) becomes a PNG. */
async function pipelineInput(image: Uint8Array): Promise<Uint8Array> {
    const format = sniffArtworkFormat(image);
    if (format === "png" || format === "jpeg") return image;
    const sharp = (await import("sharp")).default;
    return new Uint8Array(await sharp(image).png().toBuffer());
}

export async function floorFromFieldImage(
    image: Uint8Array,
    fieldProperties: FieldProperties,
): Promise<EmbedLibraryVersion> {
    const bytes = await pipelineInput(image);
    const sharp = (await import("sharp")).default;
    const { width, height } = await sharp(bytes).metadata();
    if (!width || !height) throw new Error("The field image has no size");
    const size = floorSizeForImage(fieldProperties, { width, height });

    const root = await mkdtemp(path.join(tmpdir(), FLOOR_TEMP_PREFIX));
    try {
        const store = await openLibraryStore({ root });
        const report = await importArtwork(store, {
            file: { filename: `${FLOOR_NAME}.png`, bytes },
            surface: "baseFloor",
            size: {
                width: { m: size.widthM },
                height: { m: size.heightM },
                source: "slot",
                templateId: null,
            },
            name: FLOOR_NAME,
        });
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
