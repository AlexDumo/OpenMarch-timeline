import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { allMarchersQueryOptions } from "@/hooks/queries";
import { readGroupPaths } from "@/db-functions/timelineGroupRoutes";
import tolgee from "@/global/singletons/Tolgee";
import { db } from "@/global/database/db";
import { performersOnly } from "@/global/classes/Marcher";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useActionHandler } from "@/shortcuts/useActionHandler";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { useStartFlagLevelsInEffect } from "@/stores/StartFlagKeyStore";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import {
    closeShapeTool,
    useShapeToolStore,
} from "@/shapes/tool/shapeToolStore";
import {
    findGroupDrawTarget,
    findGroupTarget,
    findPathTarget,
    groupMoveAt,
} from "./pathTarget";
import {
    setGroupCommands,
    type RejoinTarget,
    clearPath,
    closePath,
    deletePoint,
    finishDrawing,
    openPath,
    ownPathFor,
    rejoinFor,
    removeLastPoint,
    removePath,
    selectPoint,
    setPathHidden,
    setPointSmooth,
    showPath,
    startDrawing,
    usePathPenStore,
} from "./pathPenStore";

/**
 * Why the pen can't start for this selection, or null when it can: one performer draws its own
 * path, two or more a group path (step 15).
 */
export function penRefusal(selectedCount: number): string | null {
    if (selectedCount === 0)
        return tolgee.t(
            "pathways.refusals.selectOne",
            "Select a marcher to draw a path for",
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
    // Every marcher's drill number, as a group path's members are named
    const { data: allMarchers } = useQuery(allMarchersQueryOptions());
    const drills = useMemo(
        () => new Map((allMarchers ?? []).map((m) => [m.id, m.drill_number])),
        [allMarchers],
    );
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
        const beat = useTimelineSelectionStore.getState().playheadBeat;
        if (!one) {
            // Two or more: one group path for them all (AP-R8), from the middle of their starts
            const ids = performers.map((m) => m.id);
            void findGroupDrawTarget(db, resolver, ids, drills, beat).then(
                (target) => {
                    if ("kind" in target) {
                        const who = performers.find(
                            (m) =>
                                target.kind === "noMove" &&
                                m.id === target.marcherId,
                        );
                        toast.error(
                            target.kind === "noMove"
                                ? tolgee.t(
                                      "pathways.refusals.noMove",
                                      "{marcher} has no move at the playhead to draw a path on",
                                      { marcher: who?.drill_number ?? "" },
                                  )
                                : tolgee.t(
                                      "pathways.refusals.twoMoves",
                                      "These marchers are in different moves at the playhead: select marchers of one move to draw a group path",
                                  ),
                            { id: "path-pen" },
                        );
                        return;
                    }
                    if (useShapeToolStore.getState().tool) closeShapeTool();
                    startDrawing(target, `${ids.length}`);
                },
            );
            return;
        }
        const marcher = one;
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

    // The closed path shows by start flag positions' paths level in effect, as the straight paths
    // do: the setting, and N held or tapped (owner, 2026-11-04). The marcher is selected, so
    // Selected and All both show it. Edit path still opens a hidden one
    const pathsLevel = useStartFlagLevelsInEffect().paths;
    useEffect(() => setPathHidden(pathsLevel === "off"), [pathsLevel]);

    // Edit path: opens the selected marcher's path at the playhead, as a double-click on it does.
    // No key of its own: the shape tool has none for editing points (Enter places a shape)
    useActionHandler("editPath", () => void openPath(), {
        enabled: phase === "closed",
    });
    // Remove path (AP-R2), open or closed, not while a new one is drawn
    useActionHandler("removePath", () => void removePath(), {
        enabled: hasRoute && phase !== "drawing",
    });
    // Own path and Rejoin (step 15), enabled whenever a group path is shown, closed too
    const ownIds = usePathPenStore((s) => s.ownable);
    const rejoin = usePathPenStore((s) => s.rejoin);
    useActionHandler("ownPath", () => void ownPathFor(ownIds), {
        enabled: ownIds.length > 0 && phase !== "drawing",
    });
    useActionHandler("rejoinPath", () => void rejoinFor(rejoin), {
        enabled: rejoin !== null && phase !== "drawing",
    });

    // The path shown follows the selection, the playhead and each committed edit; a path opened
    // stays open while it's the same marcher's same move
    const asked = useRef(0);
    const selectedIds = performers.map((m) => m.id).sort((a, b) => a - b);
    const selectionKey = selectedIds.join(",");
    useEffect(() => {
        const { session } = usePathPenStore.getState();
        const resolver = useTimelineResolverStore.getState().resolver;
        const clear = () => {
            clearPath();
            setGroupCommands([], null);
        };
        if (isPlaying) {
            clear();
            return;
        }
        if (session?.phase === "drawing") {
            // The marchers drawn for are let go of: the drawing goes
            const drawnFor = session.target.group
                ? session.target.group.members.map((m) => m.marcherId)
                : [session.target.marcherId];
            if (drawnFor.join(",") !== selectionKey) clearPath();
            return;
        }
        if (selectedIds.length === 0 || !ready || !resolver) {
            clear();
            return;
        }
        const ask = ++asked.current;
        const beat = playheadBeat;
        void (async () => {
            // A group path when any selected marcher walks one (step 15), else one marcher's own
            const group = await findGroupTarget(
                db,
                resolver,
                selectedIds,
                drills,
                beat,
            );
            const own =
                group === null && one
                    ? await findPathTarget(db, resolver, one.id, beat)
                    : null;
            // Rejoin onto the move's only group path, with only marchers off it selected
            let rejoinTarget: RejoinTarget | null = null;
            if (group === null) {
                const move = await groupMoveAt(db, selectedIds, beat);
                if (move.kind === "move") {
                    const groups = await readGroupPaths(db, move.timelineId);
                    if (groups.length === 1)
                        rejoinTarget = {
                            timelineId: move.timelineId,
                            routeId: groups[0]!.routeId,
                            marcherIds: selectedIds,
                        };
                }
            }
            if (ask !== asked.current) return;
            const now = usePathPenStore.getState();
            if (now.session?.phase === "drawing") return;
            if (group) {
                const members = new Set(
                    group.group!.members.map((m) => m.marcherId),
                );
                showPath(group, `${members.size}`);
                const outside = group.group!.outside.map((m) => m.marcherId);
                setGroupCommands(
                    selectedIds.filter((id) => members.has(id)),
                    outside.length > 0
                        ? {
                              timelineId: group.timelineId,
                              routeId: group.routeId!,
                              marcherIds: outside,
                          }
                        : null,
                );
                return;
            }
            setGroupCommands([], rejoinTarget);
            if (!own || own.routeId === null) clearPath();
            else showPath(own, one!.drill_number);
        })();
        // The marchers' ids, not their rows: a row read again is the same selection
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectionKey, playheadBeat, version, ready, isPlaying, saved, drills]);
}

/**
 * The keys the pen takes over while it draws or a path is open (not while it's only shown,
 * closed), mounted after the editor's own handlers (as the shape tool's are), so they sit on top
 * and go back when the pen closes. They are the Line's keys (`ShapeToolKeys`):
 *
 * - Drawing: Enter (applyShape) finishes, Backspace or Delete (shapeRemoveLastPoint) and undo take
 *   the last point back, Escape (cancelAlignmentUpdates) cancels.
 * - Open: Escape clears the selected point, then closes the path (it stays drawn); Backspace
 *   deletes the selected point (its last removes the path). Remove path has no key (the
 *   path's menu and bar have it), open or closed, in `usePathPenActions`.
 */
export function PathPenKeys(): null {
    const phase = usePathPenStore((s) => s.session?.phase ?? null);
    const picked = usePathPenStore((s) => s.session?.selected ?? null);
    const drawing = phase === "drawing";
    useActionHandler(
        "cancelAlignmentUpdates",
        () => {
            if (!drawing && picked !== null) selectPoint(null);
            else closePath();
        },
        {
            label: drawing
                ? tolgee.t("actions.path.cancel", "Cancel path")
                : picked !== null
                  ? tolgee.t("actions.path.deselectPoint", "Deselect point")
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
            if (drawing) removeLastPoint();
            else if (picked !== null) {
                const index = Number(picked.slice(1));
                if (Number.isInteger(index))
                    void deletePoint(index, { selectNeighbor: true });
            }
            // The open path with no point selected: the path goes (owner, 2026-11-04), one undo
            // step. Only once it's open, so a stray key on a closed path removes nothing
            else void removePath();
        },
        {
            label: drawing
                ? tolgee.t("actions.path.removeLastPoint", "Remove last point")
                : picked !== null
                  ? tolgee.t("actions.path.deletePoint", "Delete point")
                  : tolgee.t("actions.path.remove", "Remove path"),
        },
        drawing || phase === "open",
    );
    // While drawing, undo takes points back first, as a Line's points are; with none left it
    // cancels
    useActionHandler(
        "performUndo",
        () => {
            const s = usePathPenStore.getState().session;
            if (s && s.points.length > 0) removeLastPoint();
            else closePath();
        },
        {},
        drawing,
    );
    // Corner and Smooth for the selected point of the open path (the editor bar's either/or, the
    // palette); no keys of their own, as a Line's corner type has none
    const pickedIndex =
        !drawing && picked !== null ? Number(picked.slice(1)) : -1;
    const pointPicked = phase === "open" && pickedIndex >= 0;
    useActionHandler(
        "pathPointCorner",
        () => void setPointSmooth(pickedIndex, false),
        {},
        pointPicked,
    );
    useActionHandler(
        "pathPointSmooth",
        () => void setPointSmooth(pickedIndex, true),
        {},
        pointPicked,
    );
    return null;
}
