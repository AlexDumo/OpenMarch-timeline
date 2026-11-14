import { MinusIcon, PlusIcon } from "@phosphor-icons/react";
import clsx from "clsx";
import ActionButton from "@/shortcuts/ActionButton";

const BUTTON_CLASS =
    "rounded-4 text-text flex size-44 touch-none items-center justify-center select-none enabled:active:bg-fg-2";

/**
 * Zoom out and Zoom in over the timeline in the touch layout (tablet 3.2, #885), for when a pinch
 * is awkward: one hand on the tablet, or a precise step. They run the `timelineZoomOut` and
 * `timelineZoomIn` actions, so each greys out at its zoom limit. They float at the timeline's
 * bottom right, where a right thumb reaches; the compact touch transport (3.5, #888) may take
 * them in later, so they stand alone and only need `className` to move.
 */
export function TimelineTouchZoom({ className }: { className?: string }) {
    return (
        <div
            data-testid="timeline-touch-zoom"
            className={clsx(
                "border-stroke bg-modal shadow-modal rounded-6 pointer-events-auto absolute z-[70] flex items-center gap-2 border p-2",
                className,
            )}
        >
            <ActionButton
                action="timelineZoomOut"
                data-testid="timeline-touch-zoom-out"
                className={BUTTON_CLASS}
            >
                <MinusIcon size={20} weight="bold" />
            </ActionButton>
            <ActionButton
                action="timelineZoomIn"
                data-testid="timeline-touch-zoom-in"
                className={BUTTON_CLASS}
            >
                <PlusIcon size={20} weight="bold" />
            </ActionButton>
        </div>
    );
}
