import clsx from "clsx";
import { BoundingBoxIcon, MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
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
import { stepPlacedBoxFiles } from "./PlacedBoxKeys";
import { filesOf } from "../box/boxGeometry";
import { setInsideBox } from "./boxSelectionStore";

/**
 * The inspector's view of placed boxes (07-placed-boxes.md): the selected box's numbers with one
 * file fewer or more, or
 * **Select box** when some of a box's marchers are selected but not all of it.
 */
export function PlacedBoxSection() {
    const box = useBoxSelectionStore((s) => s.selected);
    const drawnOn = useDrawnOnPage(box);
    const queryClient = useQueryClient();
    const selected = useSelectedMarchers()?.selectedMarchers ?? [];
    // Re-read when the boxes or the moment change
    usePlacedBoxStore((s) => s.recipes);
    useTimelineResolverStore((s) => s.version);
    const beat = useTimelineSelectionStore(displayedBeat);
    const canvas = currentCanvas();
    if (!canvas) return null;

    if (box) {
        const files = filesOf(box.params);
        const button = getButtonClassName({
            variant: "secondary",
            size: "compact",
        });
        return (
            <div
                className="flex w-full items-center gap-8"
                data-testid="placed-box-summary"
            >
                <button
                    type="button"
                    aria-label="One file fewer"
                    title="One file fewer ( [ )"
                    className={button}
                    disabled={files <= 1}
                    onClick={() => stepPlacedBoxFiles(-1, queryClient)}
                >
                    <MinusIcon size={14} />
                </button>
                <p className="text-sub text-text/80">
                    Box ·{" "}
                    {placedBoxSummary(
                        box,
                        canvas.fieldProperties.pixelsPerStep,
                    )}
                    {drawnOn && (
                        <span className="text-text/50"> · from {drawnOn}</span>
                    )}
                </p>
                <button
                    type="button"
                    aria-label="One file more"
                    title="One file more ( ] )"
                    className={button}
                    disabled={files >= box.spots}
                    onClick={() => stepPlacedBoxFiles(1, queryClient)}
                >
                    <PlusIcon size={14} />
                </button>
            </div>
        );
    }

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
