import { MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import {
    displayedBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { filesOf, ranksOf, shortBy } from "../box/boxGeometry";
import { formatSteps, useReadoutPoint } from "../tool/ShapeToolReadout";
import { useBoxSelectionStore } from "./boxSelectionStore";
import type { PlacedBox } from "./placedBox";
import { stepPlacedBoxFiles } from "./PlacedBoxKeys";

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
    const across = formatSteps(box.params.across / stepPx);
    const deep = formatSteps(box.params.deep / stepPx);
    const empty = box.spots - box.recipe.members.length;
    const short = shortBy(box.params, box.spots);
    return [
        `${filesOf(box.params)} × ${ranksOf(box.params, box.spots)}`,
        `${across === deep ? across : `${across} × ${deep}`} steps`,
        ...(short > 0 ? [`${short} short`] : []),
        ...(empty > 0 ? [`${empty} empty`] : []),
    ].join(" · ");
}

/**
 * The selected placed box's numbers, just under it, with one fewer or more across (also `[` and
 * `]`), saved at once. Says which page the box was drawn on when that's an earlier one.
 */
export function PlacedBoxReadout({ stepPx }: { stepPx: number }) {
    const box = useBoxSelectionStore((s) => s.selected);
    const queryClient = useQueryClient();
    const drawnOn = useDrawnOnPage(box);
    const at = useReadoutPoint(box?.params ?? null, box?.spots ?? 0);

    if (!box) return null;
    const files = filesOf(box.params);
    return (
        <div
            className="rounded-6 border-stroke bg-modal text-sub text-text shadow-modal absolute z-10 flex -translate-x-1/2 items-center gap-8 border px-8 py-4 whitespace-nowrap"
            style={
                at ? { left: at.x, top: at.y + 10 } : { visibility: "hidden" }
            }
            data-testid="placed-box-readout"
        >
            <button
                type="button"
                aria-label="One fewer across"
                title="One fewer across ( [ )"
                className="hover:text-accent disabled:opacity-40"
                disabled={files <= 1}
                onClick={() => stepPlacedBoxFiles(-1, queryClient)}
            >
                <MinusIcon size={14} />
            </button>
            <span data-testid="placed-box-readout-text">
                Box · {placedBoxSummary(box, stepPx)}
                {drawnOn && (
                    <span className="text-text/50"> · from {drawnOn}</span>
                )}
            </span>
            <button
                type="button"
                aria-label="One more across"
                title="One more across ( ] )"
                className="hover:text-accent disabled:opacity-40"
                disabled={files >= box.spots}
                onClick={() => stepPlacedBoxFiles(1, queryClient)}
            >
                <PlusIcon size={14} />
            </button>
        </div>
    );
}
