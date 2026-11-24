/**
 * STAND-IN until fork #1255: the uniform outlines from the design study's
 * render harness (its `templates/flats/regions.json`, outside the repo),
 * copied verbatim into `fixtures/harness-flats-regions.json`. #1255 ports the
 * geometry tool and generates the outlines from the body models; swapping its
 * outlines in is the one line in `./index.ts` that picks the source, and this
 * file and the fixture are then deleted.
 *
 * The harness's regions overlap where the torso meets the hips and the hips
 * meet the legs, and the design says no two regions touch. So here the torso
 * ends at the jacket hem line, the hips run from there to the crotch line,
 * and the legs start at the crotch line: neighbours share a line but never
 * overlap. The neck and the harness's `collar` shapes are left to
 * `flatsRegions`, which takes the neck out of any torso and ignores shapes
 * that aren't paintable parts.
 *
 * Plain TypeScript only: this module lives under `view3d/core/`, so it must
 * not import React, React Three Fiber, drei, Electron or the database.
 */
// cspell:words paintable
import harness from "./fixtures/harness-flats-regions.json";
import {
    FLATS_LAYOUT,
    cutAbove,
    cutBelow,
    type FlatsGuides,
    type FlatsRegionsSource,
    type Point,
} from "./regions";

interface HarnessRegions {
    readonly median: string;
    readonly dpi: number;
    readonly sheet: { readonly w: number; readonly h: number };
    readonly panels: Readonly<
        Record<string, { x: number; y: number; w: number; h: number }>
    >;
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

function guide(h: HarnessRegions, prefix: string): number {
    const found = h.guides.find((g) => g.label.startsWith(prefix));
    if (!found) throw new Error(`Harness regions: no ${prefix} guide`);
    return found.y;
}

/** The harness file must be drawn on the template's own layout. */
function checkLayout(h: HarnessRegions): void {
    const L = FLATS_LAYOUT;
    const same =
        h.median === L.body &&
        h.dpi === L.dpi &&
        h.sheet.w === L.page.w &&
        h.sheet.h === L.page.h &&
        h.centreX === L.centreX &&
        (["front", "back", "cape"] as const).every((id) =>
            (["x", "y", "w", "h"] as const).every(
                (k) => h.panels[id]?.[k] === L.panels[id][k],
            ),
        );
    if (!same) throw new Error("Harness regions: not the template's layout");
}

/** A part's outline trimmed so it doesn't overlap its neighbours. */
function trimmed(
    part: string,
    polygon: readonly Point[],
    g: FlatsGuides,
): readonly Point[] {
    if (part === "torso") return cutBelow(polygon, g.jacketHem);
    if (part === "hips")
        return cutBelow(cutAbove(polygon, g.jacketHem), g.crotch);
    if (part.startsWith("leg-")) return cutAbove(polygon, g.crotch);
    return polygon;
}

export function fromHarness(h: HarnessRegions): FlatsRegionsSource {
    checkLayout(h);
    const guides: FlatsGuides = {
        collar: guide(h, "collar"),
        chest: guide(h, "chest"),
        jacketHem: guide(h, "jacket hem"),
        crotch: guide(h, "crotch"),
        knee: guide(h, "knee"),
        elbow: guide(h, "elbow"),
    };
    const regions: FlatsRegionsSource["regions"][number][] = [];
    for (const r of h.regions) {
        if (r.panel !== "front" && r.panel !== "back") continue;
        const part = r.id.slice(r.panel.length + 1);
        const polygon = r.polygon.map(([x, y]): Point => [x, y]);
        regions.push({
            panel: r.panel,
            part,
            polygon: trimmed(part, polygon, guides),
        });
    }
    const chest = h.landmarks["chest centre"];
    const back = h.landmarks["back number centre"];
    return {
        regions,
        guides,
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
