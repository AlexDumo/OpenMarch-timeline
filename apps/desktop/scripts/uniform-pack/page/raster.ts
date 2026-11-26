/**
 * Draws a pack source's art exactly as the app's import does: a layer page through
 * `importUniformFile` (an SVG drawn as an image at 32 px/in in the window, then checked and
 * encoded in the uniform pack worker; a PNG decoded and encoded in the worker), an item through
 * `importItemFile` (trimmed to its art, at most 1024 px on its long side). Nothing here draws
 * on its own.
 */
import regions from "@/view3d/assets/uniform-flats/regions.json";
import {
    DEFAULT_UNIFORM_PRESET,
    UNIFORM_PRESETS,
} from "@/view3d/core/marchers/uniformPresets";
import { readUniformPack } from "@/view3d/core/uniformPack/format";
import type { PageRegions } from "@/view3d/core/uniformPack/pageChecks";
import { importItemFile } from "@/view3d/window/uniformPack/importItem";
import {
    UniformImportError,
    importUniformFile,
} from "@/view3d/window/uniformPack/importUniform";
import { fromBase64, toBase64 } from "./bytes";

const pageRegions = regions as unknown as PageRegions;

const fileOf = (name: string, bytes: Uint8Array) => ({
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer,
});

const refusal = (error: unknown) =>
    error instanceof UniformImportError
        ? { error: `${error.code}: ${error.message}` }
        : { error: error instanceof Error ? error.message : String(error) };

/** A layer page (`name` ends .svg or .png) as the pack's PNG, with the import's notes */
export async function rasterLayer(name: string, data: string) {
    try {
        const imported = await importUniformFile(
            fileOf(name, fromBase64(data)),
            UNIFORM_PRESETS[DEFAULT_UNIFORM_PRESET].band,
            pageRegions,
        );
        const pack = readUniformPack(imported.pack);
        return { png: toBase64(pack.layers[0].png), notes: imported.notes };
    } catch (error) {
        return refusal(error);
    }
}

/** An item's art as the pack's PNG, and its size in pixels */
export async function rasterItem(name: string, data: string) {
    try {
        const item = await importItemFile(fileOf(name, fromBase64(data)));
        const { width, height } = item.image.bitmap;
        item.image.bitmap.close();
        return { png: toBase64(item.image.png), width, height };
    } catch (error) {
        return refusal(error);
    }
}

/**
 * What the app's own import makes of a file, untouched: the whole pack file for a page, the
 * stored PNG for an item. Only the smoke test calls it, to check the builder against the app.
 */
export async function appImport(
    kind: "page" | "item",
    name: string,
    data: string,
) {
    const file = fileOf(name, fromBase64(data));
    if (kind === "page") {
        const imported = await importUniformFile(
            file,
            UNIFORM_PRESETS[DEFAULT_UNIFORM_PRESET].band,
            pageRegions,
        );
        return toBase64(imported.pack);
    }
    const item = await importItemFile(file);
    item.image.bitmap.close();
    return toBase64(item.image.png);
}
