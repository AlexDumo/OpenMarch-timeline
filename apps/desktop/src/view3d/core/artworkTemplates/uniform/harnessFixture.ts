/**
 * STAND-IN until fork #1255: the uniform outlines from the design study's
 * render harness (its `templates/flats/regions.json`, outside the repo),
 * copied verbatim into `fixtures/harness-flats-regions.json`. #1255 ports the
 * geometry tool and generates the outlines from the body models; swapping its
 * file in is the one line in `./index.ts` that picks the source.
 *
 * Two changes from the harness file, both to meet the design:
 *
 * - The harness torso still includes the neck. The design keeps the neck out
 *   of every region (the palette collar covers it), so the torso is cut at
 *   the collar line here. #1255 takes the neck out of the geometry itself.
 * - The harness's `collar` sub-regions are reference shapes, not paintable
 *   regions, so they are dropped.
 *
 * Plain TypeScript only: this module lives under `view3d/core/`, so it must
 * not import React, React Three Fiber, drei, Electron or the database.
 */
// cspell:words paintable Hodgman
import harness from "./fixtures/harness-flats-regions.json";
import {
    FLATS_PARTS,
    type FlatsPart,
    type FlatsRegionsSource,
    type Point,
} from "./regions";

interface HarnessRegions {
    readonly median: string;
    readonly dpi: number;
    readonly sheet: { readonly w: number; readonly h: number };
    readonly panels: FlatsRegionsSource["panels"];
    readonly centreX: number;
    readonly regions: readonly {
        readonly id: string;
        readonly panel: string;
        readonly polygon: readonly (readonly number[])[];
    }[];
    readonly guides: readonly { readonly y: number; readonly label: string }[];
    readonly landmarks: {
        readonly "chest centre": { readonly x: number; readonly y: number };
        readonly "back number centre": {
            readonly x: number;
            readonly y: number;
        };
    };
}

/** The part of a polygon at or below the height `y` (Sutherland–Hodgman against one line). */
export function cutAbove(polygon: readonly Point[], y: number): Point[] {
    const out: Point[] = [];
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        const aIn = a[1] >= y;
        const bIn = b[1] >= y;
        if (aIn) out.push(a);
        if (aIn !== bIn) {
            const f = (y - a[1]) / (b[1] - a[1]);
            out.push([Math.round((a[0] + f * (b[0] - a[0])) * 100) / 100, y]);
        }
    }
    return out;
}

function guide(h: HarnessRegions, prefix: string): number {
    const found = h.guides.find((g) => g.label.startsWith(prefix));
    if (!found) throw new Error(`Harness regions: no ${prefix} guide`);
    return found.y;
}

export function fromHarness(h: HarnessRegions): FlatsRegionsSource {
    const collar = guide(h, "collar");
    const regions: FlatsRegionsSource["regions"][number][] = [];
    for (const r of h.regions) {
        if (r.panel !== "front" && r.panel !== "back") continue;
        const part = r.id.slice(r.panel.length + 1) as FlatsPart;
        if (!FLATS_PARTS.includes(part)) continue; // the collar sub-shapes
        const polygon = r.polygon.map(([x, y]): Point => [x, y]);
        regions.push({
            panel: r.panel,
            part,
            polygon: part === "torso" ? cutAbove(polygon, collar) : polygon,
        });
    }
    const chest = h.landmarks["chest centre"];
    const back = h.landmarks["back number centre"];
    return {
        body: h.median,
        page: h.sheet,
        dpi: h.dpi,
        panels: h.panels,
        centreX: h.centreX,
        regions,
        guides: {
            collar,
            chest: guide(h, "chest"),
            hem: guide(h, "jacket hem"),
            crotch: guide(h, "crotch"),
            knee: guide(h, "knee"),
            elbow: guide(h, "elbow"),
        },
        landmarks: {
            chestCentre: [chest.x, chest.y],
            backNumberCentre: [back.x, back.y],
        },
    };
}

/** The stand-in source, until #1255's generated outlines replace it. */
export const HARNESS_FLATS_SOURCE: FlatsRegionsSource = fromHarness(
    harness as unknown as HarnessRegions,
);
