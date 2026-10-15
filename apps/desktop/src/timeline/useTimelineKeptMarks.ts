import { useEffect, useRef, useState } from "react";
import type { fabric } from "fabric";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import type { TimelineKeptMark } from "./timelineKeptMarks";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import {
    KEPT_MARK_TOOLTIP_DELAY,
    useKeptMarks,
    type KeptMarkTooltip,
    type NamedPage,
} from "./useKeptMarks";

// Moved to `useKeptMarks.ts`, which both fields use; kept here so callers don't change
export {
    KEPT_MARK_TOOLTIP_DELAY,
    useKeptMarks,
    type KeptMarkTooltip,
} from "./useKeptMarks";

/**
 * Draws the kept marks on the canvas (docs/timeline/ui.md UI-18, kept marchers on the field):
 * a broken chain beside each marcher kept on the current page, in timeline mode only. Hidden while
 * playing, while a scrub is down and while a move is isolated (its members are drawn where its
 * plan puts them). Returns the tooltip for the mark the pointer rests on, if any: the canvas has
 * no hover of its own, so the hook hit-tests the marks on the canvas's mouse moves while they show.
 */
export function useTimelineKeptMarks({
    canvas,
    enabled,
    isPlaying,
    pages,
    pageId,
    marcherIds,
}: {
    canvas: OpenMarchCanvas | null;
    enabled: boolean;
    isPlaying: boolean;
    pages: readonly NamedPage[];
    pageId: number | null | undefined;
    marcherIds: readonly number[] | undefined;
}): KeptMarkTooltip | null {
    const scrubbing = useTimelineSelectionStore((s) => s.scrubbing);
    const isolating = useTimelineSelectionStore((s) => s.isolation !== null);
    const marks = useKeptMarks(pages, enabled ? pageId : null, marcherIds);
    const shown = enabled && !isPlaying && !scrubbing && !isolating;
    const [tooltip, setTooltip] = useState<KeptMarkTooltip | null>(null);
    const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!canvas) return;
        if (!shown || marks.length === 0) canvas.clearTimelineKeptMarks();
        else canvas.renderTimelineKeptMarks(marks);
    }, [canvas, shown, marks]);
    useEffect(() => () => canvas?.clearTimelineKeptMarks(), [canvas]);

    const active = !!canvas && shown && marks.length > 0;
    useEffect(() => {
        const cancel = () => {
            if (pending.current) clearTimeout(pending.current);
            pending.current = null;
        };
        const hide = () => {
            cancel();
            setTooltip(null);
        };
        if (!canvas || !active) {
            hide();
            return;
        }
        let over: TimelineKeptMark | null = null;
        const onMove = (opt: fabric.IEvent<MouseEvent>) => {
            const e = opt.e;
            const layer = canvas.timelineKeptLayer;
            const pointer = e && canvas.getPointer(e);
            const mark =
                layer && pointer && !(e.buttons > 0)
                    ? layer.markAt(pointer.x, pointer.y)
                    : null;
            if (mark === over) return;
            over = mark;
            hide();
            if (!mark) return;
            const { clientX, clientY } = e;
            pending.current = setTimeout(() => {
                pending.current = null;
                setTooltip({ text: mark.text, clientX, clientY });
            }, KEPT_MARK_TOOLTIP_DELAY);
        };
        const onLeave = () => {
            over = null;
            hide();
        };
        // Fired when the pointer leaves an object too; only leaving the canvas has no target
        const onOut = (opt: fabric.IEvent) => {
            if (!opt.target) onLeave();
        };
        canvas.on("mouse:move", onMove as (e: fabric.IEvent) => void);
        canvas.on("mouse:down", onLeave);
        canvas.on("mouse:out", onOut);
        return () => {
            canvas.off("mouse:move", onMove as (e: fabric.IEvent) => void);
            canvas.off("mouse:down", onLeave);
            canvas.off("mouse:out", onOut);
            hide();
        };
    }, [canvas, active]);

    return tooltip;
}
