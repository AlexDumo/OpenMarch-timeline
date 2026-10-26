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
import { toolEnvFor } from "../tool/toolEnv";
import { useBoxSelectionStore } from "./boxSelectionStore";
import { placedBoxSummary, useDrawnOnPage } from "./placedBoxText";
import { placedBoxesAt, usePlacedBoxStore } from "./placedBoxStore";
import { selectOnField } from "./boxSelection";
import { stepPlacedBoxFiles, steppedParam } from "./PlacedBoxKeys";
import { setInsideBox } from "./boxSelectionStore";
import { Tip } from "../editor/Tip";

/**
 * The inspector's view of placed shapes (07-placed-boxes.md): the selected shape's numbers, with
 * − and + for the number its kind steps (a box: one fewer or more across), or **Select box**
 * (**Select circle**…) when some of a shape's marchers are selected but not all of it.
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
        const stepper = steppedParam(box.kind)?.stepper;
        const env = toolEnvFor(field, { shift: false, alt: false });
        const can = (by: -1 | 1) =>
            stepper?.by(box.params, box.spots, by, env) != null;
        const button = getButtonClassName({
            variant: "secondary",
            size: "compact",
        });
        return (
            <div
                className="flex w-full items-center gap-8"
                data-testid="placed-box-summary"
            >
                {stepper && (
                    <Tip label={stepper.less}>
                        <button
                            type="button"
                            aria-label={stepper.less}
                            className={button}
                            disabled={!can(-1)}
                            onClick={() => stepPlacedBoxFiles(-1, queryClient)}
                        >
                            <MinusIcon size={14} />
                        </button>
                    </Tip>
                )}
                <p className="text-sub text-text/80">
                    {box.kind.shape.label} ·{" "}
                    {placedBoxSummary(box, field.fieldProperties.pixelsPerStep)}
                    {drawnOn && (
                        <span className="text-text/50"> · from {drawnOn}</span>
                    )}
                </p>
                {stepper && (
                    <Tip label={stepper.more}>
                        <button
                            type="button"
                            aria-label={stepper.more}
                            className={button}
                            disabled={!can(1)}
                            onClick={() => stepPlacedBoxFiles(1, queryClient)}
                        >
                            <PlusIcon size={14} />
                        </button>
                    </Tip>
                )}
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
            Select {partOf.kind.shape.label.toLowerCase()}
        </button>
    );
}
