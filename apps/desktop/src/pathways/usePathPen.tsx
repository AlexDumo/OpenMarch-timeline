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
    closePath,
    deleteCorner,
    finishDrawing,
    openPath,
    pathKey,
    removeLastCorner,
    removeOpenPath,
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
 * The Path pen's command (P) and the open path (pathways step 1). P with one marcher selected
 * starts drawing its move at the playhead; with several, it refuses ("one marcher for now"). With
 * one marcher selected whose move at the playhead has a path, the path opens on the field with
 * its floating editor, until the selection or the move changes, playback starts or Escape closes
 * it.
 */
export function usePathPenActions(): void {
    const selected = useSelectedMarchers()?.selectedMarchers;
    const isPlaying = useIsPlaying()?.isPlaying ?? false;
    const performers = performersOnly(selected ?? []);
    const one = performers.length === 1 ? performers[0]! : null;
    const playheadBeat = useTimelineSelectionStore((s) => s.playheadBeat);
    const version = useTimelineResolverStore((s) => s.version);
    const ready = useTimelineResolverStore((s) => s.status === "ready");

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

    // The open path follows the selection, the playhead and each committed edit
    const asked = useRef(0);
    useEffect(() => {
        const { session } = usePathPenStore.getState();
        const resolver = useTimelineResolverStore.getState().resolver;
        if (isPlaying) {
            if (session) closePath();
            return;
        }
        if (session?.phase === "drawing") {
            // The marcher drawn for is let go of: the drawing goes
            if (!one || one.id !== session.target.marcherId) closePath();
            return;
        }
        if (!one || !ready || !resolver) {
            if (session) closePath();
            return;
        }
        const ask = ++asked.current;
        void findPathTarget(db, resolver, one.id, playheadBeat).then(
            (target) => {
                if (ask !== asked.current) return;
                const now = usePathPenStore.getState();
                if (now.session?.phase === "drawing") return;
                if (!target || target.routeId === null) {
                    if (now.session) closePath();
                    if (
                        now.dismissed &&
                        target &&
                        pathKey(target) !== now.dismissed
                    )
                        usePathPenStore.setState({ dismissed: null });
                    return;
                }
                if (now.dismissed === pathKey(target)) return;
                openPath(target, one.drill_number);
            },
        );
    }, [one, playheadBeat, version, ready, isPlaying]);

    // A new selection forgets an Escape
    useEffect(() => {
        usePathPenStore.setState({ dismissed: null });
    }, [one?.id]);
}

/**
 * The keys the pen takes over while it draws or a path is open, mounted after the editor's own
 * handlers (as the shape tool's are), so they sit on top and go back when the pen closes.
 *
 * - Drawing: Enter (applyShape) finishes, Backspace or Delete (shapeRemoveLastPoint) and undo take
 *   the last corner back, Escape (cancelAlignmentUpdates) cancels.
 * - Open: Escape closes it, Backspace deletes the picked corner, Shift+Backspace removes the path.
 */
export function PathPenKeys(): null {
    const phase = usePathPenStore((s) => s.session?.phase ?? null);
    const picked = usePathPenStore((s) => s.session?.selected ?? null);
    const hasRoute = usePathPenStore(
        (s) => (s.session?.target.routeId ?? null) !== null,
    );
    const drawing = phase === "drawing";
    useActionHandler("cancelAlignmentUpdates", () => closePath(!drawing), {
        label: drawing
            ? tolgee.t("actions.path.cancel", "Cancel path")
            : tolgee.t("actions.path.close", "Close path"),
    });
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
            else if (picked !== null) void deleteCorner(picked);
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
    // While drawing, undo takes corners back first, as the shape tool's points do
    useActionHandler(
        "performUndo",
        () => {
            if (!removeLastCorner()) closePath();
        },
        {},
        drawing,
    );
    useActionHandler(
        "removePath",
        () => void removeOpenPath(),
        {},
        !drawing && hasRoute,
    );
    return null;
}
