// cspell:words fflate
/**
 * A picked `.zip`, opened into the files inside it (#1168): Sketchfab and most model sites hand
 * out a glTF as a zip of `scene.gltf`, `scene.bin` and a `textures/` folder, which a file picker
 * can't select in one go. Each entry becomes a picked file named by its path in the zip, so
 * `textures/wood.png` resolves exactly.
 *
 * Bytes in, bytes out, like the rest of the import (ADR 0010 amendment 2026-11-15): nothing is
 * written anywhere. fflate decodes each entry into a buffer of the size its header declares and
 * never past it, so adding up the declared sizes before decoding bounds what a zip can cost
 * however it lies (a zip bomb gets cut short and then fails to read as a model).
 */
import { unzipSync } from "fflate";
import { RefusedError } from "./files";
import { MAX_IMPORT_BYTES } from "./rules";
import type { PickedFile } from "./types";

/** More entries than this is no model download */
export const MAX_ZIP_ENTRIES = 5_000;

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\3\4"

export function isZip(file: PickedFile): boolean {
    if (/\.zip$/i.test(file.name)) return true;
    return ZIP_MAGIC.every((byte, i) => file.bytes[i] === byte);
}

/** Entries that are never part of a model: folders, macOS metadata and hidden files */
function skipped(path: string): boolean {
    if (path.endsWith("/")) return true;
    const parts = path.split("/");
    return (
        parts[0] === "__MACOSX" || parts.some((part) => part.startsWith("."))
    );
}

/**
 * The picked files with every zip opened in place, and the name of the zip the model came from
 * (for a title better than `scene`). Throws `RefusedError` for a zip that's too large once
 * opened, or that can't be read.
 */
export function openZips(files: readonly PickedFile[]): {
    files: PickedFile[];
    zipName: string | null;
} {
    if (!files.some(isZip)) return { files: [...files], zipName: null };
    let bytes = files
        .filter((f) => !isZip(f))
        .reduce((n, f) => n + f.bytes.byteLength, 0);
    let entries = 0;
    const out: PickedFile[] = [];
    let zipName: string | null = null;
    for (const file of files) {
        if (!isZip(file)) {
            out.push(file);
            continue;
        }
        zipName ??= file.name.replace(/\.zip$/i, "");
        let opened: Record<string, Uint8Array>;
        try {
            opened = unzipSync(file.bytes, {
                filter: (entry) => {
                    if (skipped(entry.name)) return false;
                    entries += 1;
                    bytes += entry.originalSize;
                    if (entries > MAX_ZIP_ENTRIES || bytes > MAX_IMPORT_BYTES)
                        throw new RefusedError({
                            code: "tooLarge",
                            bytes,
                            limit: MAX_IMPORT_BYTES,
                        });
                    return true;
                },
            });
        } catch (error) {
            if (error instanceof RefusedError) throw error;
            throw new RefusedError({
                code: "unreadable",
                reason: `the zip can't be opened (${error instanceof Error ? error.message : String(error)})`,
            });
        }
        for (const [name, data] of Object.entries(opened))
            out.push({ name, bytes: data });
    }
    return { files: out, zipName };
}
