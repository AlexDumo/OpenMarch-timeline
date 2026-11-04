import { useEffect, useRef } from "react";
import { toast } from "sonner";
import tolgee from "@/global/singletons/Tolgee";
import { db } from "@/global/database/db";
import { performersOnly } from "@/global/classes/Marcher";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useActionHandler } from "@/shortcuts/useActionHandler";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import {
    closeShapeTool,
    useShapeToolStore,
} from "@/shapes/tool/shapeToolStore";
import { findPathTarget } from "./pathTarget";
import {
    clearPath,
    closePath,
    deleteCorner,
    finishDrawing,
    openPath,
    removeLastCorner,
    removePath,
    selectCorner,
    showPath,
    startDrawing,
    usePathPenStore,
} from "./pathPenStore";

/** Why the pen can't start for this selection, or null when it can (one performer). */
export function penRefusal(selectedCount: number): string | null {
    if (selectedCount === 0)
        return tolgee.t(
            "pathways.refusals.selectOne",
            "Select a marcher to draw a path for",
        );
    if (selectedCount > 1)
        return tolgee.t(
            "pathways.refusals.oneMarcher",
            "One marcher for now: select just one to draw its path",
        );
    return null;
}

/**
 * The Path pen's command (P), the path shown and its commands (pathways step 1). P with one
 * marcher selected starts drawing its move at the playhead; with several, it refuses ("one marcher
 * for now"). With one marcher selected whose move at the playhead has a path, the path is drawn on
 * the field, closed: nothing to grab, no floating editor. A double-click on it, its right-click
 * menu or Edit path opens it for editing (owner, 2026-11-04), until Escape, a click on empty field
 * or a selection change, or a move of the playhead off the move. Remove path works open or closed.
 */
export function usePathPenActions(): void {
    const selected = useSelectedMarchers()?.selectedMarchers;
    const isPlaying = useIsPlaying()?.isPlaying ?? false;
    const performers = performersOnly(selected ?? []);
    const one = performers.length === 1 ? performers[0]! : null;
    const playheadBeat = useTimelineSelectionStore((s) => s.playheadBeat);
    const version = useTimelineResolverStore((s) => s.version);
    const ready = useTimelineResolverStore((s) => s.status === "ready");
    const saved = usePathPenStore((s) => s.saved);
    const phase = usePathPenStore((s) => s.session?.phase ?? null);
    const hasRoute = usePathPenStore(
        (s) => (s.session?.target.routeId ?? null) !== null,
    );

    useActionHandler("pathPen", () => {
        const refusal = penRefusal(performers.length);
        if (refusal) {
            toast.error(refusal, { id: "path-pen" });
            return;
        }
        if (isPlaying) {
            toast.error(
                tolgee.t(
                    "pathways.refusals.playing",
                    "Stop playback to draw a path",
                ),
                { id: "path-pen" },
            );
            return;
        }
        const resolver = useTimelineResolverStore.getState().resolver;
        if (!resolver) return;
        const marcher = one!;
        const beat = useTimelineSelectionStore.getState().playheadBeat;
        void findPathTarget(db, resolver, marcher.id, beat).then((target) => {
            if (!target) {
                toast.error(
                    tolgee.t(
                        "pathways.refusals.noMove",
                        "{marcher} has no move at the playhead to draw a path on",
                        { marcher: marcher.drill_number },
                    ),
                    { id: "path-pen" },
                );
                return;
            }
            if (useShapeToolStore.getState().tool) closeShapeTool();
            startDrawing(target, marcher.drill_number);
        });
    });

    // Edit path: opens the selected marcher's path at the playhead, as a double-click on it does.
    // No key of its own: the shape tool has none for editing points (Enter places a shape)
    useActionHandler("editPath", () => void openPath(), {
        enabled: phase === "closed",
    });
    // Remove path (AP-R2), open or closed, not while a new one is drawn
    useActionHandler("removePath", () => void removePath(), {
        enabled: hasRoute && phase !== "drawing",
    });

    // The path shown follows the selection, the playhead and each committed edit; a path opened
    // stays open while it's the same marcher's same move
    const asked = useRef(0);
    const selectedId = one?.id ?? null;
    useEffect(() => {
        const { session } = usePathPenStore.getState();
        const resolver = useTimelineResolverStore.getState().resolver;
        if (isPlaying) {
            clearPath();
            return;
        }
        if (session?.phase === "drawing") {
            // The marcher drawn for is let go of: the drawing goes
            if (selectedId !== session.target.marcherId) clearPath();
            return;
        }
        if (selectedId === null || !ready || !resolver) {
            clearPath();
            return;
        }
        // Another marcher: whatever was open closes, before its path is read
        if (session && session.target.marcherId !== selectedId) clearPath();
        const ask = ++asked.current;
        const drill = one!.drill_number;
        void findPathTarget(db, resolver, selectedId, playheadBeat).then(
            (target) => {
                if (ask !== asked.current) return;
                const now = usePathPenStore.getState();
                if (now.session?.phase === "drawing") return;
                if (!target || target.routeId === null) clearPath();
                else showPath(target, drill);
            },
        );
        // The marcher's id, not its row: a row read again is the same selection
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId, playheadBeat, version, ready, isPlaying, saved]);
}

/**
 * The keys the pen takes over while it draws or a path is open (not while it's only shown,
 * closed), mounted after the editor's own handlers (as the shape tool's are), so they sit on top
 * and go back when the pen closes. They are the Line's keys (`ShapeToolKeys`):
 *
 * - Drawing: Enter (applyShape) finishes, Backspace or Delete (shapeRemoveLastPoint) and undo take
 *   the last corner back, Escape (cancelAlignmentUpdates) cancels.
 * - Open: Escape clears the selected corner, then closes the path (it stays drawn); Backspace
 *   deletes the selected corner (its last removes the path). Shift+Backspace (Remove path) is
 *   `usePathPenActions`', open or closed.
 */
export function PathPenKeys(): null {
    const phase = usePathPenStore((s) => s.session?.phase ?? null);
    const picked = usePathPenStore((s) => s.session?.selected ?? null);
    const drawing = phase === "drawing";
    useActionHandler(
        "cancelAlignmentUpdates",
        () => {
            if (!drawing && picked !== null) selectCorner(null);
            else closePath();
        },
        {
            label: drawing
                ? tolgee.t("actions.path.cancel", "Cancel path")
                : picked !== null
                  ? tolgee.t("actions.path.deselect", "Deselect corner")
                  : tolgee.t("actions.path.close", "Close path"),
        },
    );
    useActionHandler(
        "applyShape",
        () => void finishDrawing(),
        {
            label: tolgee.t("actions.path.finish", "Finish path"),
        },
        drawing,
    );
    useActionHandler(
        "shapeRemoveLastPoint",
        () => {
            if (drawing) removeLastCorner();
            else if (picked !== null) {
                const index = Number(picked.slice(1));
                if (Number.isInteger(index)) void deleteCorner(index);
            }
        },
        {
            label: drawing
                ? tolgee.t(
                      "actions.path.removeLastCorner",
                      "Remove last corner",
                  )
                : tolgee.t("actions.path.deleteCorner", "Delete corner"),
        },
        drawing || picked !== null,
    );
    // While drawing, undo takes corners back first, as a Line's points are; with none left it
    // cancels
    useActionHandler(
        "performUndo",
        () => {
            const s = usePathPenStore.getState().session;
            if (s && s.corners.length > 0) removeLastCorner();
            else closePath();
        },
        {},
        drawing,
    );
    return null;
}
