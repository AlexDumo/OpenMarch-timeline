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
import { currentShapeField } from "../field/shapeFieldContext";
import { useBoxSelectionStore } from "./boxSelectionStore";
import { placedBoxSummary, useDrawnOnPage } from "./placedBoxText";
import { placedBoxesAt, usePlacedBoxStore } from "./placedBoxStore";
import { selectOnField } from "./boxSelection";
import { stepPlacedBoxFiles } from "./PlacedBoxKeys";
import { onField } from "../box/boxGeometry";
import { setInsideBox } from "./boxSelectionStore";

/**
 * The inspector's view of placed boxes (07-placed-boxes.md): the selected box's numbers with one
 * fewer or more across, or
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
    const field = currentShapeField();
    if (!field) return null;

    if (box) {
        // Across as the field shows it, like the floating editor
        const files = onField(box.params, box.spots).across;
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
                    aria-label="One fewer across"
                    title="One fewer across"
                    className={button}
                    disabled={files <= 1}
                    onClick={() => stepPlacedBoxFiles(-1, queryClient)}
                >
                    <MinusIcon size={14} />
                </button>
                <p className="text-sub text-text/80">
                    Box ·{" "}
                    {placedBoxSummary(box, field.fieldProperties.pixelsPerStep)}
                    {drawnOn && (
                        <span className="text-text/50"> · from {drawnOn}</span>
                    )}
                </p>
                <button
                    type="button"
                    aria-label="One more across"
                    title="One more across"
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
                selectOnField(partOf.recipe.members.map((m) => m.marcherId));
                setInsideBox(null);
            }}
            data-testid="placed-box-select"
        >
            <BoundingBoxIcon size={16} weight="bold" />
            Select box
        </button>
    );
}
