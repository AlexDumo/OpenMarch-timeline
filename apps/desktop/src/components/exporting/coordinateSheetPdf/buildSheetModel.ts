/**
 * Derives the coordinate sheet data (./model.ts) from the show, the same way
 * the React templates do: ReadableCoords for the coordinates,
 * `measureRangeString` for measures (quarter pages shorten it to "12A-14"
 * when drawing), and the modal's order and fallback names. The modal would
 * call this instead of `ReactDOMServer.renderToString`.
 */
import type Marcher from "@/global/classes/Marcher";
import type MarcherPage from "@/global/classes/MarcherPage";
import type Page from "@/global/classes/Page";
import { measureRangeString } from "@/global/classes/Page";
import { ReadableCoords } from "@/global/classes/ReadableCoords";
import type { FieldProperties } from "@openmarch/core";
import type { SheetModel, SheetRow } from "./model";

/** The modal's fallback display name for a marcher with no name. */
export function displayNameFor(marcher: Marcher): string {
    return (
        marcher.name ||
        `${marcher.section} ${
            marcher.drill_number.match(/\d+/)?.[0] ||
            String(marcher.drill_order)
        }`
    );
}

/**
 * Build the sheet data from the show, in the modal's order (section, then
 * drill number) with each marcher's rows in page order.
 */
export function buildSheetModel({
    showName,
    marchers,
    pages,
    marcherPagesByMarcher,
    fieldProperties,
    roundingDenominator,
    unsortedSection,
}: {
    showName: string;
    marchers: Marcher[];
    pages: Page[];
    marcherPagesByMarcher: (marcherId: number) => MarcherPage[];
    fieldProperties: FieldProperties;
    roundingDenominator: number;
    unsortedSection: string;
}): SheetModel {
    if (!ReadableCoords.getFieldProperties())
        ReadableCoords.setFieldProperties(fieldProperties);
    const pageById = new Map(pages.map((p) => [p.id, p]));
    const sorted = [...marchers].sort((a, b) => {
        const s = (a.section || "").localeCompare(b.section || "");
        if (s !== 0) return s;
        return a.drill_number.localeCompare(b.drill_number, undefined, {
            numeric: true,
        });
    });
    return {
        showName,
        marchers: sorted.map((marcher) => {
            const rows: SheetRow[] = [];
            const mps = [...marcherPagesByMarcher(marcher.id)].sort(
                (a, b) =>
                    (pageById.get(a.page_id)?.order ?? 0) -
                    (pageById.get(b.page_id)?.order ?? 0),
            );
            for (const mp of mps) {
                const page = pageById.get(mp.page_id);
                if (!page) continue;
                const rc = new ReadableCoords({
                    x: mp.x,
                    y: mp.y,
                    roundingDenominator,
                });
                rows.push({
                    set: page.name,
                    counts: page.counts,
                    measures: measureRangeString(page),
                    sideToSide: rc.toVerboseStringX(),
                    frontToBack: rc.toVerboseStringY(),
                    sideToSideTerse: rc.toTerseStringX(),
                    frontToBackTerse: rc.toTerseStringY(),
                });
            }
            return {
                name: marcher.name ?? "",
                displayName: displayNameFor(marcher),
                drillNumber: marcher.drill_number,
                section: marcher.section || unsortedSection,
                rows,
            };
        }),
    };
}
