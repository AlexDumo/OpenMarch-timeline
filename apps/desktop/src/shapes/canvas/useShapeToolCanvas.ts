import { useEffect, useRef } from "react";
import { rgbaToString, type FieldTheme } from "@openmarch/core";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { previewSession } from "../session";
import { useShapeToolStore } from "../shapeToolStore";
import ShapeToolOverlay, {
    type ShapeToolOverlayColors,
} from "./ShapeToolOverlay";
import { marchersOnCanvas, shapeContextFor } from "./shapeCanvasContext";

const colorsOf = (theme: FieldTheme): ShapeToolOverlayColors => ({
    shape: rgbaToString(theme.shape),
    travel: rgbaToString({ ...theme.shape, a: 0.35 }),
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
    const overlayRef = useRef<ShapeToolOverlay | null>(null);

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
        overlay.show(previewSession(session, shapeContextFor(canvas)));
    }, [canvas, session, theme]);
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
