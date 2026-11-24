/**
 * Reads the uniform outlines that `scripts/view3d-assets/uniform-flats.mjs`
 * generates from the body models (`assets/uniform-flats/regions.json`, fork
 * #1255) as the template's source. This is the one place where that file's
 * names meet the template's:
 *
 * | `assets/uniform-flats/regions.json`  | template source / `uniform-regions.json` |
 * | ------------------------------------ | ---------------------------------------- |
 * | `guides[id = "hem"]`                 | `guides.jacketHem`                       |
 * | `landmarks["chest centre"]`          | `landmarks.chestCentre`                  |
 * | `landmarks["back number centre"]`    | `landmarks.backNumberCentre`             |
 * | `landmarks.cuff`, `landmarks.hem`    | `landmarks.sleeveCuff`, `landmarks.legHem` (measured from the outlines) |
 * | `seams.rows: [y, left, right]`       | `seams: { y, left, right }`              |
 * | `figure.parts` (flat triangles)      | `figure.shapes` (triangles as points)    |
 *
 * Plain TypeScript only: this module lives under `view3d/core/`, so it must
 * not import React, React Three Fiber, drei, Electron or the database.
 */
import {
    FLATS_LAYOUT,
    type FlatsGuides,
    type FlatsRegionsSource,
    type Point,
} from "./regions";

/** The parts of the generated file the template reads. */
export interface FlatsAsset {
    readonly median: string;
    readonly dpi: number;
    readonly sheet: { readonly w: number; readonly h: number };
    readonly panels: Readonly<
        Record<
            string,
            {
                readonly x: number;
                readonly y: number;
                readonly w: number;
                readonly h: number;
            }
        >
    >;
    readonly centreX: number;
    readonly regions: readonly {
        readonly id: string;
        readonly panel: string;
        readonly part: string;
        readonly polygon: readonly (readonly number[])[];
        readonly seams?: { readonly rows: readonly (readonly number[])[] };
    }[];
    readonly guides: readonly { readonly id: string; readonly y: number }[];
    readonly landmarks: Readonly<
        Record<string, { readonly x?: number; readonly y?: number } | number>
    >;
    readonly figure?: {
        readonly parts: Readonly<
            Record<string, readonly (readonly number[])[]>
        >;
        readonly hands: readonly {
            readonly cx: number;
            readonly cy: number;
            readonly rx: number;
            readonly ry: number;
        }[];
    };
}

/** The asset's guide ids for each of the template's guides. */
const GUIDE_IDS: Readonly<Record<keyof FlatsGuides, string>> = {
    collar: "collar",
    chest: "chest",
    jacketHem: "hem",
    crotch: "crotch",
    knee: "knee",
    elbow: "elbow",
};

/** The file must be drawn on the template's own page layout. */
function checkLayout(a: FlatsAsset): void {
    const L = FLATS_LAYOUT;
    const same =
        a.median === L.body &&
        a.dpi === L.dpi &&
        a.sheet.w === L.page.w &&
        a.sheet.h === L.page.h &&
        a.centreX === L.centreX &&
        (["front", "back", "cape"] as const).every((id) =>
            (["x", "y", "w", "h"] as const).every(
                (k) => a.panels[id]?.[k] === L.panels[id][k],
            ),
        );
    if (!same)
        throw new Error("Uniform flats regions: not the template's layout");
}

function point(a: FlatsAsset, name: string): Point {
    const found = a.landmarks[name];
    if (typeof found !== "object" || found.x == null || found.y == null)
        throw new Error(`Uniform flats regions: no ${name} landmark`);
    return [found.x, found.y];
}

export function fromFlatsAsset(a: FlatsAsset): FlatsRegionsSource {
    checkLayout(a);
    const guides = Object.fromEntries(
        Object.entries(GUIDE_IDS).map(([key, id]) => {
            const found = a.guides.find((g) => g.id === id);
            if (!found)
                throw new Error(`Uniform flats regions: no ${id} guide`);
            return [key, found.y];
        }),
    ) as unknown as FlatsGuides;
    const regions: FlatsRegionsSource["regions"][number][] = [];
    for (const r of a.regions) {
        if (r.panel !== "front" && r.panel !== "back") continue;
        regions.push({
            panel: r.panel,
            part: r.part,
            polygon: r.polygon.map(([x, y]): Point => [x, y]),
            ...(r.seams
                ? {
                      seams: r.seams.rows.map(([y, left, right]) => ({
                          y,
                          left,
                          right,
                      })),
                  }
                : {}),
        });
    }
    const figure = a.figure && {
        shapes: Object.values(a.figure.parts).flatMap((triangles) =>
            triangles.map((t): Point[] => [
                [t[0], t[1]],
                [t[2], t[3]],
                [t[4], t[5]],
            ]),
        ),
        hands: a.figure.hands.map(({ cx, cy, rx, ry }) => ({ cx, cy, rx, ry })),
    };
    return {
        regions,
        guides,
        landmarks: {
            chestCentre: point(a, "chest centre"),
            backNumberCentre: point(a, "back number centre"),
        },
        ...(figure ? { figure } : {}),
    };
}
