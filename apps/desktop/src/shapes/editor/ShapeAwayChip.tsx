import { ArrowUUpLeftIcon } from "@phosphor-icons/react";
import { getButtonClassName } from "@openmarch/ui";
import { useShapeToolStore } from "../tool/shapeToolStore";
import { goBackTo, momentLabel } from "../tool/shapeMoment";
import { keepFocus } from "./keepFocus";

/**
 * Shown at the top of the field while the playhead is away from the open shape's moment (#416):
 * the shape and its editor are hidden until the timeline comes back, by Go back or any other way.
 */
export function ShapeAwayChip() {
    const moment = useShapeToolStore((s) => s.moment);
    if (!moment) return null;
    return (
        <div
            className="rounded-6 border-stroke bg-modal text-body text-text shadow-modal absolute top-12 left-1/2 z-10 flex -translate-x-1/2 items-center gap-8 border py-4 pr-4 pl-12 whitespace-nowrap"
            data-testid="shape-away-chip"
            onPointerDown={(e) => e.stopPropagation()}
        >
            <span data-testid="shape-away-chip-text">
                Shape open at {momentLabel(moment)}
            </span>
            <button
                type="button"
                className={getButtonClassName({
                    variant: "secondary",
                    size: "compact",
                    className: "flex items-center gap-4",
                })}
                onPointerDown={keepFocus}
                onClick={() => goBackTo(moment)}
            >
                <ArrowUUpLeftIcon size={14} />
                Go back
            </button>
        </div>
    );
}
