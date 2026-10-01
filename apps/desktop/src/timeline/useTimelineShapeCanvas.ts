import { useEffect, useRef } from "react";
import type { fabric } from "fabric";
import { rgbaToString, type FieldTheme } from "@openmarch/core";
import TimelineShapeOverlay from "@/global/classes/canvasObjects/TimelineShapeOverlay";
import { useTimelineShapeCanvasStore } from "./timelineShapeCanvas";

/** The canvas fields this hook uses. `OpenMarchCanvas` satisfies it. */
export type ShapeOverlayCanvas = fabric.Canvas & {
    fieldProperties: { theme: FieldTheme };
    /** Set while an overlay is drawn, so the canvas keeps its handles on top */
    timelineShapeOverlay?: TimelineShapeOverlay | null;
};

/**
 * Draws the shape picked in the inspector's shape editor on the canvas in timeline mode (P7.11),
 * with handles to drag. A drag redraws locally and commits once, on release, through the editor
 * (`useTimelineShapeCanvasStore`'s `commit`). While that edit is pending the drawn shape stays as
 * dragged and takes no drags; once it settles, the shape is drawn again from the editor's rows:
 * the new geometry, or the old one when the edit was refused.
 *
 * Does nothing while `enabled` is false (page mode, or the resolver isn't ready) and nothing while
 * playing; it removes what it drew then.
 */
export function useTimelineShapeCanvas({
    canvas,
    enabled,
    isPlaying,
}: {
    canvas: ShapeOverlayCanvas | null;
    enabled: boolean;
    isPlaying: boolean;
}): void {
    const target = useTimelineShapeCanvasStore((s) => s.target);
    const pending = useTimelineShapeCanvasStore((s) => s.pending);
    const overlayRef = useRef<TimelineShapeOverlay | null>(null);
    const active = enabled && !isPlaying && canvas !== null;

    // One overlay per canvas; removed when the canvas changes or the hook stops drawing
    useEffect(() => {
        if (!active || !canvas) return;
        const theme = canvas.fieldProperties.theme;
        const overlay = new TimelineShapeOverlay(
            canvas,
            {
                shape: rgbaToString(theme.shape),
                handleFill: "#fff",
            },
            (shape) => {
                const { commit, pending: busy } =
                    useTimelineShapeCanvasStore.getState();
                if (busy || !commit) return;
                commit(shape);
            },
        );
        overlayRef.current = overlay;
        canvas.timelineShapeOverlay = overlay;
        return () => {
            overlay.clear();
            if (canvas.timelineShapeOverlay === overlay)
                canvas.timelineShapeOverlay = null;
            overlayRef.current = null;
        };
    }, [active, canvas]);

    useEffect(() => {
        const overlay = overlayRef.current;
        if (!active || !overlay) return;
        if (!target) {
            overlay.clear();
            return;
        }
        // Keep the dragged shape until the edit settles, so it doesn't jump back meanwhile
        if (pending && overlay.shown) {
            overlay.setInteractive(false);
            return;
        }
        overlay.show(target.shape, !pending);
    }, [active, canvas, target, pending]);
}
