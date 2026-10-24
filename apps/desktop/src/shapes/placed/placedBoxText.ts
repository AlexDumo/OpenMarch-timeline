import {
    displayedBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { onField, shortBy } from "../box/boxGeometry";
import { formatSteps } from "../editor/format";
import type { PlacedBox } from "./placedBox";

/** "Page 3" for the page a box was placed at the end of, when that is before `beat` */
export function useDrawnOnPage(box: PlacedBox | null): string | null {
    const beat = useTimelineSelectionStore(displayedBeat);
    const pages = useTimelineSelectionStore((s) => s.pageBoxes);
    if (!box || box.endBeat >= beat - 1e-9) return null;
    const page = pages.find((p) => Math.abs(p.end - box.endBeat) < 1e-9);
    return page?.name ? `Page ${page.name}` : null;
}

/**
 * The numbers of a placed box: "5 × 4 · 2 steps · 1 short · 1 empty", across × deep (short: spots
 * the back rank never had; empty: holes members left)
 */
export function placedBoxSummary(box: PlacedBox, stepPx: number): string {
    // As the field shows it, like the floating editor: across is side to side
    const field = onField(box.params, box.spots);
    const across = formatSteps(field.acrossSpacing / stepPx);
    const deep = formatSteps(field.deepSpacing / stepPx);
    const empty = box.spots - box.recipe.members.length;
    const short = shortBy(box.params, box.spots);
    return [
        `${field.across} × ${field.deep}`,
        `${across === deep ? across : `${across} × ${deep}`} steps`,
        ...(short > 0 ? [`${short} short`] : []),
        ...(empty > 0 ? [`${empty} empty`] : []),
    ].join(" · ");
}
