import { useEffect, useRef } from "react";
import { rgbaToString, type FieldTheme } from "@openmarch/core";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import {
    previewSession,
    type ShapePreview,
    type ShapeSession,
} from "../session";
import type { Spacing, XY } from "../types";
import { useShapeToolStore } from "../shapeToolStore";
import ShapeToolOverlay, {
    type ShapeToolOverlayColors,
} from "./ShapeToolOverlay";
import { marchersOnCanvas, shapeContextFor } from "./shapeCanvasContext";

const colorsOf = (theme: FieldTheme): ShapeToolOverlayColors => ({
    shape: rgbaToString(theme.shape),
    travel: rgbaToString({ ...theme.shape, a: 0.35 }),
    ghost: rgbaToString({ ...theme.shape, a: 0.55 }),
    issue: "#e5484d",
    handleFill: "#fff",
});

/**
 * Draws the open shape tool session on the canvas and turns handle drags into param changes.
 *
 * The session follows the selection: selecting other marchers restarts it on them with the same
 * kind and settings. Clicking empty field keeps the tool's marchers selected; Escape or
 * playback closes it. The marchers' own selection is locked meanwhile, so only the handles move.
 */
export function useShapeToolCanvas({
    canvas,
    isPlaying,
    theme,
}: {
    canvas: OpenMarchCanvas | null;
    isPlaying: boolean;
    theme?: FieldTheme;
}): void {
    const session = useShapeToolStore((s) => s.session);
    const dragging = useShapeToolStore((s) => s.dragging);
    const overlayRef = useRef<ShapeToolOverlay | null>(null);
    const lastHold = useRef<ReturnType<typeof holdFeedback>>(null);

    useEffect(() => {
        if (!canvas) return;
        const overlay = new ShapeToolOverlay(
            canvas,
            colorsOf(canvas.fieldProperties.theme),
            {
                start: (key) => useShapeToolStore.getState().startDrag(key),
                move: (_key, to, { shift, alt }) =>
                    useShapeToolStore
                        .getState()
                        .drag(to, shift, shapeContextFor(canvas, !alt)),
                end: () => useShapeToolStore.getState().endDrag(),
                doubleClick: (at, key) => {
                    const store = useShapeToolStore.getState();
                    const ctx = shapeContextFor(canvas);
                    if (key) store.removePoint(key, ctx);
                    else store.insertPoint(at, ctx);
                },
            },
        );
        overlayRef.current = overlay;
        canvas.shapeToolOverlay = overlay;
        return () => {
            overlay.dispose();
            if (canvas.shapeToolOverlay === overlay)
                canvas.shapeToolOverlay = null;
            overlayRef.current = null;
        };
    }, [canvas]);

    useEffect(() => {
        if (theme) overlayRef.current?.setColors(colorsOf(theme));
    }, [theme]);

    // Playback closes the tool: the shape is about one moment
    useEffect(() => {
        if (isPlaying) useShapeToolStore.getState().close();
    }, [isPlaying]);

    useShapeToolSelection(canvas, session !== null);

    useEffect(() => {
        const overlay = overlayRef.current;
        if (!overlay || !canvas) return;
        if (!session) {
            overlay.clear();
            return;
        }
        const preview = previewSession(session, shapeContextFor(canvas));
        overlay.show(preview);
        const hold = holdFeedback(session, preview, dragging, canvas);
        if (hold) {
            lastHold.current = hold;
            overlay.showHold(hold);
            return;
        }
        // Let go while a lock was holding the handle back: leave the reason on screen a moment,
        // by the handle, so it doesn't vanish with the drag
        const held = lastHold.current;
        lastHold.current = null;
        if (!dragging && held) {
            overlay.showHold({
                from: held.from,
                to: held.from,
                label: held.after,
            });
            const timer = window.setTimeout(() => overlay.showHold(null), 3000);
            return () => window.clearTimeout(timer);
        }
        overlay.showHold(null);
    }, [canvas, session, dragging, theme]);
}

/**
 * The session follows the selection: selecting other marchers restarts it on them with the same
 * kind and settings, and clicking empty field keeps the tool's marchers selected. The marchers'
 * own selection is locked while the tool is open, so only the handles move.
 */
function useShapeToolSelection(
    canvas: OpenMarchCanvas | null,
    isOpen: boolean,
): void {
    const selectedContext = useSelectedMarchers();
    const selectedMarchers = selectedContext?.selectedMarchers;
    const setSelectedMarchers = selectedContext?.setSelectedMarchers;

    // Follow the selection
    useEffect(() => {
        if (!canvas || !selectedMarchers) return;
        const { session: open, open: restart } = useShapeToolStore.getState();
        if (!open) return;
        const ids = selectedMarchers.map((m) => m.id);
        // The same marchers in another order (after restoring them below) are the same session
        const inSession = new Set(open.marchers.map((m) => m.id));
        const same =
            ids.length === inSession.size &&
            ids.every((id) => inSession.has(id));
        if (same) return;
        // A click on empty field doesn't drop a shape being tuned: keep its marchers selected.
        // Escape closes the tool.
        if (ids.length === 0) {
            setSelectedMarchers?.(
                canvas
                    .getCanvasMarchers()
                    .filter((m) => inSession.has(m.id))
                    .map((m) => m.marcherObj),
            );
            return;
        }
        restart(
            open.kindId,
            marchersOnCanvas(canvas, ids),
            shapeContextFor(canvas),
        );
    }, [canvas, selectedMarchers, setSelectedMarchers]);

    // The selection stays put while the tool is open; the handles move the shape
    useEffect(() => {
        canvas?.setSelectionLocked(isOpen);
    }, [canvas, isOpen]);
}

/**
 * While a handle is dragged with a lock holding it back from the cursor (a locked interval or
 * kept block intervals), what to show: the handle, the cursor and which lock it is.
 */
function holdFeedback(
    session: ShapeSession,
    preview: ShapePreview,
    dragging: { key: string; cursor?: XY } | null,
    canvas: OpenMarchCanvas,
) {
    if (!dragging?.cursor) return null;
    const handle = preview.handles.find((h) => h.key === dragging.key);
    if (!handle || handle.role === "move") return null;
    const gap = Math.hypot(
        handle.at.x - dragging.cursor.x,
        handle.at.y - dragging.cursor.y,
    );
    if (gap < canvas.fieldProperties.pixelsPerStep / 2) return null;
    const params = session.params as {
        spacing?: Spacing;
        keepIntervals?: boolean;
    };
    const label = holdReason(params);
    return label
        ? {
              from: handle.at,
              to: dragging.cursor,
              label: label.short,
              after: label.long,
          }
        : null;
}

/** Which lock holds a handle back, in a short form for during the drag and a longer one after */
function holdReason(params: {
    spacing?: Spacing;
    keepIntervals?: boolean;
}): { short: string; long: string } | null {
    const spacing = params.spacing;
    if (spacing?.mode === "interval")
        return {
            short: "Interval locked",
            long: "Interval locked: open its padlock to resize freely",
        };
    if (spacing?.mode === "fit" && spacing.sizeLocked)
        return {
            short: "Size locked",
            long: "Size locked: open its padlock to resize",
        };
    if (params.keepIntervals)
        return {
            short: "Intervals locked",
            long: "Intervals locked: open their padlock to stretch them",
        };
    return null;
}
