// cspell:words omasset
/**
 * Builds a pack folder into a `.omasset` (README.md, "uniform:build"): checks `uniform.json`
 * against the app's own schema, draws the art with the app's import in the tool page, runs
 * the app's quiet notes, and writes the file with the app's writer. Refuses with every problem it
 * found, each a sentence.
 */
import fs from "node:fs";
import path from "node:path";
import regionsJson from "@/view3d/assets/uniform-flats/regions.json";
import type { FlatsRegions } from "@/view3d/core/marchers/uniformArtwork";
import {
    readUniformPack,
    type UniformPackManifest,
} from "@/view3d/core/uniformPack/format";
import type { ToolPage } from "./browser";
import { itemChecks, layerNotes } from "./packChecks";
import {
    PackSourceError,
    assemblePack,
    layerFileProblem,
    pageSvgFromPanels,
    parsePackSource,
    planPack,
    type FlatsPanelName,
    type PackPlan,
    type PanelRects,
} from "./packSource";

const regions = regionsJson as unknown as FlatsRegions & {
    panels: PanelRects;
};

/** The largest source file read, bytes (the app's own SVG and item limits) */
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

export interface BuiltPack {
    bytes: Uint8Array;
    manifest: UniformPackManifest;
    warnings: string[];
}

/** A file the source names, read from inside the folder; never a path that leaves it */
function readSource(dir: string, file: string): Uint8Array {
    const root = fs.realpathSync(dir);
    const full = path.resolve(root, file);
    const real = fs.realpathSync(full);
    if (path.isAbsolute(file) || !real.startsWith(root + path.sep))
        throw new PackSourceError([
            `${file}: must be a path inside the pack folder`,
        ]);
    const size = fs.statSync(real).size;
    if (size > MAX_SOURCE_BYTES)
        throw new PackSourceError([
            `${file}: ${(size / 1e6).toFixed(1)} MB is over the 16 MB the app reads`,
        ]);
    return new Uint8Array(fs.readFileSync(real));
}

function existsInside(dir: string, file: string): boolean {
    if (path.isAbsolute(file)) return false;
    const root = fs.realpathSync(dir);
    const full = path.resolve(root, file);
    if (!full.startsWith(root + path.sep)) return false;
    return fs.existsSync(full) && fs.statSync(full).isFile();
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

/** Reads and plans a folder's `uniform.json`; throws {@link PackSourceError} */
export function planFolder(dir: string): PackPlan {
    const jsonPath = path.join(dir, "uniform.json");
    if (!fs.existsSync(jsonPath))
        throw new PackSourceError([`${jsonPath} doesn't exist`]);
    let json: unknown;
    try {
        json = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    } catch (error) {
        throw new PackSourceError([
            `uniform.json isn't JSON: ${(error as Error).message}`,
        ]);
    }
    return planPack(parsePackSource(json), (f) => existsInside(dir, f));
}

/** The first layer each mode draws (or the pack's first): what must cover the garment */
function baseLayers(manifest: UniformPackManifest): Set<string> {
    const modes = manifest.modes;
    return new Set(
        modes?.length ? modes.map((m) => m.layers[0]) : [manifest.layers[0].id],
    );
}

/** Builds the pack in `dir` with the tool page; throws {@link PackSourceError} */
export async function buildFolder(
    dir: string,
    page: Pick<ToolPage, "rasterLayer" | "rasterItem">,
): Promise<BuiltPack> {
    const plan = planFolder(dir);
    const errors: string[] = [];
    const warnings: string[] = [];
    const layerImages: Record<string, Uint8Array> = {};
    const itemImageFiles: Record<string, Uint8Array> = {};
    const aspects: Record<string, number> = {};
    const bases = baseLayers(plan.manifest);

    // every file's size first, so nothing is drawn while any is wrong
    const sources = new Map<string, Uint8Array>();
    for (const job of plan.rasters) {
        if (job.kind !== "layer") continue;
        const where = `layer "${job.id}"`;
        const parts: [string, "page" | FlatsPanelName][] = job.page
            ? [[job.page, "page"]]
            : Object.entries(job.panels ?? {}).map(
                  ([p, f]) =>
                      [f, p as FlatsPanelName] as [string, FlatsPanelName],
              );
        for (const [file, target] of parts) {
            const bytes = readSource(dir, file);
            sources.set(file, bytes);
            const problem = layerFileProblem(
                where,
                file,
                bytes,
                target,
                regions.panels,
            );
            if (problem) errors.push(problem);
        }
    }
    if (errors.length) throw new PackSourceError(errors);

    for (const job of plan.rasters) {
        if (job.kind === "layer") {
            const [name, data] = job.page
                ? [job.page, sources.get(job.page)!]
                : [
                      `${job.id}.svg`,
                      new TextEncoder().encode(
                          pageSvgFromPanels(
                              Object.fromEntries(
                                  Object.entries(job.panels ?? {}).map(
                                      ([p, f]) => [
                                          p,
                                          { file: f, bytes: sources.get(f)! },
                                      ],
                                  ),
                              ),
                              regions.panels,
                          ),
                      ),
                  ];
            const r = await page.rasterLayer(path.basename(name), b64(data));
            if ("error" in r) {
                errors.push(
                    `layer "${job.id}": the app's import refused it (${r.error})`,
                );
                continue;
            }
            layerImages[job.id] = unb64(r.png);
            const n = layerNotes(
                job.id,
                r.notes as Parameters<typeof layerNotes>[1],
                bases.has(job.id),
            );
            errors.push(...n.errors);
            warnings.push(...n.warnings);
        } else {
            const bytes = readSource(dir, job.file);
            const r = await page.rasterItem(
                path.basename(job.file),
                b64(bytes),
            );
            if ("error" in r) {
                errors.push(
                    `${job.file}: the app's item import refused it (${r.error})`,
                );
                continue;
            }
            itemImageFiles[job.packFile] = unb64(r.png);
            aspects[job.packFile] = r.width / r.height;
        }
    }
    const ic = itemChecks(plan.manifest.items ?? [], aspects, regions);
    errors.push(...ic.errors);
    warnings.push(...ic.warnings);
    if (errors.length) throw new PackSourceError(errors);

    const bytes = assemblePack(plan, layerImages, itemImageFiles);
    // what the app will read: the same checks it runs on import
    const read = readUniformPack(bytes);
    return { bytes, manifest: read.manifest, warnings };
}
