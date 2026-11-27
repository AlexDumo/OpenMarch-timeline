/**
 * The show's own performer figures (ADR 0019): read from the show file, the missing ones baked
 * in a worker (`figureBake.worker.ts`; on the main thread where a worker can't draw) and written
 * back quietly (not an edit), then packed into
 * one texture for the field. Until every performer's figure is there, the field keeps the
 * figures that ship with the app (`figureAtlas.ts`).
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LinearFilter, LinearMipmapLinearFilter, Texture } from "three";
import { useVenueSettings } from "@/hooks/queries/useVenueSettings";
import { allSectionAppearancesQueryOptions } from "@/hooks/queries/useSectionAppearances";
import type { PerformerFigureRow } from "@om-electron/database/performerFigures";
import { UNITS_PER_METER, type Figure, type FigureAtlas } from "./figureAtlas";
import {
    showFigureLooks,
    type FigurePerformer,
    type ShowFigureLooks,
} from "./figureLooks";
import type { BakedFigure, FigureLayout } from "./bakeFigures";
import type { FigureBakeReply } from "./figureBakeProtocol";
import FigureBakeWorker from "./figureBake.worker.ts?worker";
import { fillToNumber, type UniformLook } from "@/view3d/core/marchers/looks";

/** A figure as the show file keeps it. */
interface StoredFigure {
    image: Uint8Array;
    layout: FigureLayout;
}

const FIGURES_KEY = ["performerFigures"] as const;

/** How long the looks hold still before a bake starts, ms: a run of edits bakes once. */
const SETTLE_MS = 600;

/** The atlas's width, px, and the gap around each figure (mipmaps bleed into it). */
const ATLAS_WIDTH = 2048;
const PAD = 8;

const api = () => (typeof window !== "undefined" ? window.electron : undefined);

function parseLayout(text: string): FigureLayout | null {
    try {
        const l = JSON.parse(text) as Partial<FigureLayout>;
        const ok = (v: unknown) => typeof v === "number" && Number.isFinite(v);
        return ok(l.w) &&
            ok(l.h) &&
            ok(l.cx) &&
            ok(l.cy) &&
            ok(l.pxPerMeter) &&
            l.w! > 0 &&
            l.h! > 0 &&
            l.pxPerMeter! > 0
            ? (l as FigureLayout)
            : null;
    } catch {
        return null;
    }
}

/** The file's figures by fingerprint; a row whose layout can't be read is left out. */
async function readStored(): Promise<Map<string, StoredFigure>> {
    const rows: PerformerFigureRow[] =
        (await api()?.readPerformerFigures?.()) ?? [];
    const out = new Map<string, StoredFigure>();
    for (const row of rows) {
        const layout = parseLayout(row.layout);
        if (layout) out.set(row.fingerprint, { image: row.image, layout });
    }
    return out;
}

/** False once a worker couldn't bake this session: later bakes run on the main thread. */
let workerBakes = typeof Worker !== "undefined";

// eslint-disable-next-line no-console -- where a bake's time goes
const logReport = (text: string) => console.info(text);

/** Bakes `looks` in a worker of its own, ended after; null when the worker couldn't. */
function bakeInWorker(
    looks: readonly UniformLook[],
): Promise<(BakedFigure | null)[] | null> {
    return new Promise((resolve) => {
        let worker: Worker;
        try {
            worker = new FigureBakeWorker();
        } catch (error) {
            console.warn("Performer figures: no bake worker", error);
            resolve(null);
            return;
        }
        const done = (result: (BakedFigure | null)[] | null) => {
            worker.terminate();
            resolve(result);
        };
        worker.onmessage = ({ data }: MessageEvent<FigureBakeReply>) => {
            if (data.type !== "unsupported") data.reports.forEach(logReport);
            if (data.type === "baked") done(data.figures);
            else {
                if (data.type === "error")
                    console.warn(
                        "Performer figures: the bake worker failed",
                        data.message,
                    );
                done(null);
            }
        };
        worker.onerror = (event) => {
            console.warn("Performer figures: the bake worker failed", event);
            done(null);
        };
        worker.postMessage({ looks });
    });
}

/** Bakes `looks` in a worker, or on the main thread when a worker can't. */
async function bakeLooks(
    looks: readonly UniformLook[],
): Promise<(BakedFigure | null)[]> {
    if (workerBakes) {
        const baked = await bakeInWorker(looks);
        if (baked) return baked;
        workerBakes = false;
    }
    const { bakeFigures } = await import("./bakeFigures");
    return bakeFigures(looks);
}

/** Looks whose bake failed this session: not tried again until the app restarts. */
const failed = new Set<string>();
/** Looks being baked now, by any field. */
const baking = new Set<string>();

/**
 * Bakes the looks `needed` names that the file lacks, writes them with every look still used
 * (the rest drop), and hands the new figures back.
 */
async function bakeMissing(
    figures: ShowFigureLooks,
    missing: readonly string[],
): Promise<Map<string, StoredFigure>> {
    for (const f of missing) baking.add(f);
    try {
        const t0 = performance.now();
        const baked = await bakeLooks(
            missing.map((f) => figures.looks.get(f)!),
        );
        const out = new Map<string, StoredFigure>();
        baked.forEach((b, i) => {
            if (b) out.set(missing[i], b);
            else failed.add(missing[i]);
        });
        logReport(
            `Performer figures: baked ${out.size} in ${(performance.now() - t0).toFixed(0)} ms` +
                (workerBakes ? " (worker)" : " (main thread)"),
        );
        const write = api()?.writePerformerFigures;
        if (write && out.size > 0)
            await write({
                put: [...out].map(([fingerprint, f]) => ({
                    fingerprint,
                    image: f.image,
                    layout: JSON.stringify(f.layout),
                })),
                keep: [...figures.looks.keys()],
            }).catch((error: unknown) =>
                // kept for this session; written again with the next bake
                console.warn("Performer figures: couldn't save", error),
            );
        return out;
    } catch (error) {
        for (const f of missing) failed.add(f);
        console.warn("Performer figures: couldn't bake", error);
        return new Map();
    } finally {
        for (const f of missing) baking.delete(f);
    }
}

/** Packs `figures` into one texture: shelves, tallest first. */
async function packAtlas(
    figures: ReadonlyMap<string, StoredFigure>,
): Promise<{ atlas: FigureAtlas; broken: string[] }> {
    const broken: string[] = [];
    const decoded: {
        key: string;
        bitmap: ImageBitmap;
        layout: FigureLayout;
    }[] = [];
    await Promise.all(
        [...figures].map(async ([key, f]) => {
            try {
                const bitmap = await createImageBitmap(
                    new Blob([f.image as Uint8Array<ArrayBuffer>]),
                );
                decoded.push({ key, bitmap, layout: f.layout });
            } catch {
                broken.push(key);
            }
        }),
    );
    decoded.sort(
        (a, b) => b.bitmap.height - a.bitmap.height || (a.key < b.key ? -1 : 1),
    );
    let x = 0;
    let y = 0;
    let shelf = 0;
    const placed = decoded.map((d) => {
        const w = d.bitmap.width + PAD * 2;
        const h = d.bitmap.height + PAD * 2;
        if (x + w > ATLAS_WIDTH) {
            x = 0;
            y += shelf;
            shelf = 0;
        }
        const at = { ...d, ax: x + PAD, ay: y + PAD };
        x += w;
        shelf = Math.max(shelf, h);
        return at;
    });
    const height = Math.max(1, y + shelf);
    const canvas = document.createElement("canvas");
    canvas.width = ATLAS_WIDTH;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    const out = new Map<string, Figure>();
    for (const p of placed) {
        ctx.drawImage(p.bitmap, p.ax, p.ay);
        p.bitmap.close();
        const unitsPerPx = UNITS_PER_METER / p.layout.pxPerMeter;
        out.set(p.key, {
            uv: [
                p.ax / ATLAS_WIDTH,
                p.ay / height,
                (p.ax + p.layout.w) / ATLAS_WIDTH,
                (p.ay + p.layout.h) / height,
            ],
            size: [p.layout.w * unitsPerPx, p.layout.h * unitsPerPx],
            anchor: [p.layout.cx * unitsPerPx, p.layout.cy * unitsPerPx],
        });
    }
    const texture = new Texture(canvas);
    texture.flipY = false;
    // the field draws in its colors' own values (a linear, flat canvas), unconverted
    texture.generateMipmaps = true;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return { atlas: { texture, figures: out }, broken };
}

export interface ShowFigures {
    atlas: FigureAtlas;
    /** Each performer's figure in `atlas` */
    keys: ReadonlyMap<number, string>;
}

/**
 * The show's figures for `performers` once every one of them has one, or null until then (the
 * field keeps the shipped figures). Reads, bakes and writes only while `wanted`.
 */
// eslint-disable-next-line max-lines-per-function -- read, bake and pack, one figure set
export function useShowFigures(
    performers: readonly FigurePerformer[] | undefined,
    wanted: boolean,
): ShowFigures | null {
    const queryClient = useQueryClient();
    const { data: venue } = useVenueSettings();
    const { uniforms, guardUniforms, brassFinish, tuba } = venue ?? {};
    const hasVenue = !!venue;
    // a section's fill colors its drum shells and flag silks, as in the 3D View
    const { data: sectionAppearances } = useQuery(
        allSectionAppearancesQueryOptions(),
    );
    const performersKey = useMemo(() => {
        const fillOf = new Map(
            (sectionAppearances ?? []).flatMap((a) =>
                a.fill_color
                    ? [[a.section, fillToNumber(a.fill_color)] as const]
                    : [],
            ),
        );
        return JSON.stringify(
            (performers ?? []).map((p) => [
                p.id,
                p.section ?? "",
                fillOf.get(p.section ?? "") ?? null,
            ]),
        );
    }, [performers, sectionAppearances]);
    const ready = hasVenue && !!sectionAppearances;
    const figures = useMemo(
        () =>
            ready
                ? showFigureLooks(
                      (
                          JSON.parse(performersKey) as [
                              number,
                              string,
                              number | null,
                          ][]
                      ).map(([id, section, fill]) => ({ id, section, fill })),
                      { uniforms, guardUniforms, brassFinish, tuba },
                  )
                : null,
        [performersKey, ready, uniforms, guardUniforms, brassFinish, tuba],
    );
    const { data: stored } = useQuery({
        queryKey: FIGURES_KEY,
        queryFn: readStored,
        enabled: wanted,
        staleTime: Infinity,
    });

    // bake what's missing once the looks hold still
    useEffect(() => {
        if (!wanted || !figures || !stored) return;
        const missing = [...figures.looks.keys()].filter(
            (f) => !stored.has(f) && !failed.has(f) && !baking.has(f),
        );
        if (missing.length === 0) return;
        const timer = setTimeout(() => {
            void bakeMissing(figures, missing).then((baked) => {
                if (baked.size === 0) return;
                queryClient.setQueryData<Map<string, StoredFigure>>(
                    FIGURES_KEY,
                    (previous) => new Map([...(previous ?? []), ...baked]),
                );
            });
        }, SETTLE_MS);
        return () => clearTimeout(timer);
    }, [wanted, figures, stored, queryClient]);

    // pack the show's figures once every performer has one
    const [packed, setPacked] = useState<{
        key: string;
        atlas: FigureAtlas;
    } | null>(null);
    const neededKey = figures ? [...figures.looks.keys()].sort().join(",") : "";
    const complete =
        !!figures &&
        !!stored &&
        figures.looks.size > 0 &&
        [...figures.looks.keys()].every((f) => stored.has(f));
    useEffect(() => {
        if (!wanted || !complete || !stored || packed?.key === neededKey)
            return;
        let live = true;
        const needed = new Map(
            neededKey.split(",").map((f) => [f, stored.get(f)!]),
        );
        void packAtlas(needed).then(({ atlas, broken }) => {
            if (!live) {
                atlas.texture.dispose();
                return;
            }
            if (broken.length > 0) {
                // a picture that can't be read is baked again
                atlas.texture.dispose();
                queryClient.setQueryData<Map<string, StoredFigure>>(
                    FIGURES_KEY,
                    (previous) => {
                        const next = new Map(previous);
                        for (const f of broken) next.delete(f);
                        return next;
                    },
                );
                return;
            }
            setPacked({ key: neededKey, atlas });
        });
        return () => {
            live = false;
        };
    }, [wanted, complete, stored, neededKey, packed?.key, queryClient]);
    useEffect(() => () => packed?.atlas.texture.dispose(), [packed]);

    // the last atlas serves while it has every performer's figure, so a repack doesn't flicker
    return useMemo(
        () =>
            wanted &&
            figures &&
            packed &&
            [...figures.looks.keys()].every((f) => packed.atlas.figures.has(f))
                ? { atlas: packed.atlas, keys: figures.byPerformer }
                : null,
        [wanted, figures, packed],
    );
}
