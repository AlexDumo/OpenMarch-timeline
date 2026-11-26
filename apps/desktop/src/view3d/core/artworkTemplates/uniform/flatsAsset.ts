/**
 * Reads the uniform outlines that `scripts/view3d-assets/uniform-flats.mjs`
 * generates from the body models (`assets/uniform-flats/regions.json`, fork
 * #1255) as the template's source.
 *
 * That file is the template's own `uniform-regions.json`: the script writes
 * it with `regionsJson` (`regions.ts`), then adds the grey figure and `generatedBy`.
 * So it uses the download's names, and reading it back only picks out the
 * template's input (outlines, seam rows, guide heights, two landmarks and
 * the figure).
 *
 * Plain TypeScript only: this module lives under `view3d/core/`, so it must
 * not import React, React Three Fiber, drei, Electron or the database.
 */
import {
    FLATS_LAYOUT,
    FLATS_REGIONS_FORMAT,
    FLATS_REGIONS_VERSION,
    type FlatsGuides,
    type FlatsRegionsSource,
    type Point,
    type SeamRow,
} from "./regions";

/** The parts of the generated file the template reads. */
export interface FlatsAsset {
    readonly format: string;
    readonly version: number;
    readonly body: string;
    readonly dpi: number;
    readonly page: { readonly w: number; readonly h: number };
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
        readonly panel: string;
        readonly part: string;
        readonly polygon: readonly Point[];
        readonly seams?: readonly SeamRow[];
    }[];
    readonly guides: readonly { readonly id: string; readonly y: number }[];
    readonly landmarks: {
        readonly chestCentre: { readonly x: number; readonly y: number };
        readonly backNumberCentre: { readonly x: number; readonly y: number };
    };
    /** Only in the asset: the download leaves the figure out. */
    readonly figure?: FlatsRegionsSource["figure"];
}

/** The template's guides, by the id they have in the file. */
const GUIDE_IDS: readonly (keyof FlatsGuides)[] = [
    "collar",
    "chest",
    "jacketHem",
    "crotch",
    "knee",
    "elbow",
];

/** The file must be this format, drawn on the template's own page layout. */
function checkLayout(a: FlatsAsset): void {
    const L = FLATS_LAYOUT;
    const same =
        a.format === FLATS_REGIONS_FORMAT &&
        a.version === FLATS_REGIONS_VERSION &&
        a.body === L.body &&
        a.dpi === L.dpi &&
        a.page.w === L.page.w &&
        a.page.h === L.page.h &&
        a.centreX === L.centreX &&
        (["front", "back", "cape"] as const).every((id) =>
            (["x", "y", "w", "h"] as const).every(
                (k) => a.panels[id]?.[k] === L.panels[id][k],
            ),
        );
    if (!same)
        throw new Error("Uniform flats regions: not the template's layout");
}

const point = ({ x, y }: { x: number; y: number }): Point => [x, y];

export function fromFlatsAsset(a: FlatsAsset): FlatsRegionsSource {
    checkLayout(a);
    const guides = Object.fromEntries(
        GUIDE_IDS.map((id) => {
            const found = a.guides.find((g) => g.id === id);
            if (!found)
                throw new Error(`Uniform flats regions: no ${id} guide`);
            return [id, found.y];
        }),
    ) as unknown as FlatsGuides;
    const regions: FlatsRegionsSource["regions"][number][] = [];
    for (const r of a.regions) {
        // the cape is the template's own rectangle
        if (r.panel !== "front" && r.panel !== "back") continue;
        regions.push({
            panel: r.panel,
            part: r.part,
            polygon: r.polygon,
            ...(r.seams ? { seams: r.seams } : {}),
        });
    }
    return {
        regions,
        guides,
        landmarks: {
            chestCentre: point(a.landmarks.chestCentre),
            backNumberCentre: point(a.landmarks.backNumberCentre),
        },
        ...(a.figure ? { figure: a.figure } : {}),
    };
}
