import { useEffect, useRef } from "react";
import { rgbaToString, type FieldTheme } from "@openmarch/core";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import {
    previewSession,
    type ShapePreview,
    type ShapeSession,
} from "../session";
import type { Spacing, XY } from "../types";
import { useShapeToolStore } from "../shapeToolStore";
import { offerBringBack } from "./unplacedToast";
import { GESTURES } from "../draw/gestures";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { resolveShapeView, tightSpacing } from "./previewView";
import ShapeToolOverlay, {
    type ShapeToolOverlayColors,
} from "./ShapeToolOverlay";
import { marchersOnCanvas, shapeContextFor } from "./shapeCanvasContext";
import {
    marcherLooks,
    originsAtStart,
    setMarchersHidden,
    shapePreviewStyle,
} from "./previewContext";

const colorsOf = (theme: FieldTheme): ShapeToolOverlayColors => ({
    shape: rgbaToString(theme.shape),
    travel: rgbaToString({ ...theme.shape, a: 0.35 }),
    strongTravel: rgbaToString({ ...theme.shape, a: 0.85 }),
    ghost: rgbaToString({ ...theme.shape, a: 0.55 }),
    label: rgbaToString(theme.defaultMarcher.label),
    replaced: "rgba(120, 120, 120, 0.55)",
    issue: "#e5484d",
    bigSteps: "#f59e0b",
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
    // Once the shape is edited, the one it replaces has done its job (Marco, round 5)
    const edited = useShapeToolStore((s) => s.past.length > 0);
    const view = useUiSettingsStore((s) => s.uiSettings.shapePreview);
    const fieldLabels = useUiSettingsStore((s) => s.uiSettings.marcherLabels);
    const fieldLabelSize = useUiSettingsStore(
        (s) => s.uiSettings.marcherLabelSize,
    );
    const fieldLabelPosition = useUiSettingsStore(
        (s) => s.uiSettings.marcherLabelPosition,
    );
    const highlight = useShapeToolStore((s) => s.highlight);
    const clicked = useShapeToolStore((s) => s.clicked);
    const overlayRef = useRef<ShapeToolOverlay | null>(null);
    const lastHold = useRef<ReturnType<typeof holdFeedback>>(null);
    /** Marchers whose own dots the result preview hides, to show again when it closes */
    const hidden = useRef<number[]>([]);

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
                drawStart: (at) => {
                    // The earlier panel-only tool doesn't draw
                    if (
                        useUiSettingsStore.getState().uiSettings.shapeUi ===
                        "panel"
                    )
                        return null;
                    const store = useShapeToolStore.getState();
                    const kind = store.session?.kindId;
                    const gesture = kind ? GESTURES[kind] : undefined;
                    if (!gesture) return null;
                    const ctx = shapeContextFor(canvas);
                    const point = ctx.snapPoint(at);
                    if (gesture === "drag")
                        return store.beginDraw(point) ? "drag" : null;
                    return "clicks";
                },
                drawMove: (at, { alt }) =>
                    useShapeToolStore
                        .getState()
                        .drawTo(
                            shapeContextFor(canvas, !alt).snapPoint(at),
                            shapeContextFor(canvas, !alt),
                        ),
                drawEnd: () => useShapeToolStore.getState().endDraw(),
                drawClick: (at) => {
                    const ctx = shapeContextFor(canvas);
                    useShapeToolStore
                        .getState()
                        .clickPoint(ctx.snapPoint(at), ctx);
                },
                drawFinish: () => useShapeToolStore.getState().finishClicks(),
                clicking: () => useShapeToolStore.getState().clicked !== null,
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

    // The selection's box doesn't follow marchers as they play: hide it until playback stops
    // (sims, round 6: "the box stayed circle-sized over the block")
    useEffect(() => {
        canvas?.setSelectionLocked(isPlaying, "playback");
    }, [canvas, isPlaying]);

    useShapeToolSelection(canvas, session !== null);

    useEffect(() => {
        const overlay = overlayRef.current;
        if (!overlay || !canvas) return;
        if (!session) {
            overlay.clear();
            setMarchersHidden(canvas, hidden.current, false);
            hidden.current = [];
            return;
        }
        const preview = previewSession(session, shapeContextFor(canvas));
        const ids = session.marchers.map((m) => m.id);
        const style = shapePreviewStyle();
        overlay.show(preview, {
            style,
            origins: originsAtStart(ids),
            looks: marcherLooks(canvas, ids),
            view: resolveShapeView(view, {
                count: ids.length,
                tight: tightSpacing(
                    preview,
                    canvas.fieldProperties.pixelsPerStep,
                ),
                edited,
                fieldLabels,
                fieldLabelSize,
                fieldLabelPosition,
            }),
            highlight: highlight ?? undefined,
            clicked: clicked ?? undefined,
        });
        // The result preview stands in for the marchers' own dots, at their old spots
        setMarchersHidden(canvas, ids, style === "result");
        hidden.current = style === "result" ? ids : [];
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
    }, [
        canvas,
        session,
        dragging,
        edited,
        view,
        fieldLabels,
        fieldLabelSize,
        fieldLabelPosition,
        highlight,
        clicked,
        theme,
    ]);
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

    // The shape is about one moment: moving the edit window (a scrub, another set) closes it,
    // rather than leave a preview of the old moment over marchers drawn at the new one
    const windowKey = useTimelineSelectionStore((s) => {
        const sel = s.selection;
        const iso = s.isolation;
        return [
            sel.kind,
            sel.kind === "range" ? `${sel.start}-${sel.end}` : "",
            iso ? `${iso.timelineId}:${iso.start}-${iso.end}` : "",
        ].join("|");
    });
    const firstWindow = useRef(windowKey);
    // The window the open shape belongs to, to go back to if leaving it drops the shape
    const lastWindow = useRef(windowOf(useTimelineSelectionStore.getState()));
    useEffect(() => {
        if (windowKey === firstWindow.current) {
            lastWindow.current = windowOf(useTimelineSelectionStore.getState());
            return;
        }
        firstWindow.current = windowKey;
        if (pendingRestore?.key === windowKey) {
            // Back where a dropped shape was: open it again as it was
            useShapeToolStore.getState().restore(pendingRestore.session);
            pendingRestore = null;
            return;
        }
        // Any shape left open gets a way back: one just opened can look like work lost too
        // (sims, round 9)
        const left = useShapeToolStore.getState().session;
        const from = lastWindow.current;
        lastWindow.current = windowOf(useTimelineSelectionStore.getState());
        useShapeToolStore.getState().close();
        if (left && from) offerGoBack(left, from);
    }, [windowKey]);

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

/** Above this many marchers the preview draws only the paths with a problem */

/** An edit window to go back to: home, or a range of beats */
type Window = { kind: "home" } | { kind: "range"; start: number; end: number };

function windowOf(state: {
    selection: { kind: string; start?: number; end?: number };
    isolation: unknown;
}): Window | null {
    // An isolated move has no plain way back; nothing is offered there
    if (state.isolation) return null;
    const sel = state.selection;
    if (sel.kind === "home") return { kind: "home" };
    if (
        sel.kind === "range" &&
        sel.start !== undefined &&
        sel.end !== undefined
    )
        return { kind: "range", start: sel.start, end: sel.end };
    return null;
}

/** A shape to open again once the window it belongs to is back (see `offerGoBack`) */
let pendingRestore: { key: string; session: ShapeSession } | null = null;

/**
 * Going to another set closes an unplaced shape; say so, with a way back to it (sims, round 8:
 * "my circle was just gone, no warning").
 */
function offerGoBack(session: ShapeSession, from: Window): void {
    offerBringBack(session, () => {
        const store = useTimelineSelectionStore.getState();
        pendingRestore = {
            key:
                from.kind === "home"
                    ? "home||"
                    : `range|${from.start}-${from.end}|`,
            session,
        };
        if (from.kind === "home") store.selectHome();
        else store.selectRange(from.start, from.end);
    });
}
