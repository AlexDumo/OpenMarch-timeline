import clsx from "clsx";
import { BoundingBoxIcon } from "@phosphor-icons/react";
import { getButtonClassName } from "@openmarch/ui";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import {
    displayedBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import { currentCanvas } from "../canvas/shapeCanvasContext";
import { useBoxSelectionStore } from "./boxSelectionStore";
import { placedBoxSummary, useDrawnOnPage } from "./PlacedBoxReadout";
import { placedBoxesAt, usePlacedBoxStore } from "./placedBoxStore";
import { selectOnCanvas } from "./useBoxSelection";
import { setInsideBox } from "./boxSelectionStore";

/**
 * The inspector's view of placed boxes (07-placed-boxes.md): the selected box's numbers, or
 * **Select box** when some of a box's marchers are selected but not all of it.
 */
export function PlacedBoxSection() {
    const box = useBoxSelectionStore((s) => s.selected);
    const drawnOn = useDrawnOnPage(box);
    const selected = useSelectedMarchers()?.selectedMarchers ?? [];
    // Re-read when the boxes or the moment change
    usePlacedBoxStore((s) => s.recipes);
    useTimelineResolverStore((s) => s.version);
    const beat = useTimelineSelectionStore(displayedBeat);
    const canvas = currentCanvas();
    if (!canvas) return null;

    if (box)
        return (
            <p
                className="text-sub text-text/80 w-full"
                data-testid="placed-box-summary"
            >
                Box ·{" "}
                {placedBoxSummary(box, canvas.fieldProperties.pixelsPerStep)}
                {drawnOn && (
                    <span className="text-text/50"> · from {drawnOn}</span>
                )}
            </p>
        );

    const ids = new Set(selected.map((m) => m.id));
    const partOf = placedBoxesAt(beat).find((b) =>
        b.recipe.members.some((m) => ids.has(m.marcherId)),
    );
    if (!partOf) return null;
    return (
        <button
            type="button"
            className={clsx(
                getButtonClassName({ variant: "secondary", size: "compact" }),
                "flex items-center gap-6",
            )}
            onClick={() => {
                selectOnCanvas(
                    canvas,
                    partOf.recipe.members.map((m) => m.marcherId),
                );
                setInsideBox(null);
            }}
            data-testid="placed-box-select"
        >
            <BoundingBoxIcon size={16} weight="bold" />
            Select box
        </button>
    );
}
