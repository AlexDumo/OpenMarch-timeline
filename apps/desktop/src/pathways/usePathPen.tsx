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
import {
    displayedBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { useStartFlagLevelsInEffect } from "@/stores/StartFlagKeyStore";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import {
    closeShapeTool,
    useShapeToolStore,
} from "@/shapes/tool/shapeToolStore";
import {
    findGroupDrawTarget,
    findGroupTarget,
    findPathObjects,
    findPathTarget,
    findRouteTarget,
    groupMoveAt,
    type PathTarget,
} from "./pathTarget";
import {
    setGroupCommands,
    setPathObjects,
    type PathObject,
    type RejoinTarget,
    clearPath,
    closePath,
    deletePoint,
    escapePathObject,
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
    const selectedContext = useSelectedMarchers();
    const selected = selectedContext?.selectedMarchers;
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
        // With a path selected as an object (or open from one) and no marcher, P draws that path
        // again: a path edit by its route, keeping its id (AP-O8)
        const now = usePathPenStore.getState().session;
        if (
            performers.length === 0 &&
            now?.object &&
            now.phase !== "drawing" &&
            !isPlaying
        ) {
            if (useShapeToolStore.getState().tool) closeShapeTool();
            startDrawing(now.target, now.drill, true);
            return;
        }
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
            // The marchers drawn for are let go of: the drawing goes. Drawing a selected path
            // again (AP-O8) has no marcher selected, and goes when one is
            const drawnFor = session.object
                ? []
                : session.target.group
                  ? session.target.group.members.map((m) => m.marcherId)
                  : [session.target.marcherId];
            if (drawnFor.join(",") !== selectionKey) clearPath();
            return;
        }
        // A path selected as an object (step 3a, AP-O1, AP-O4): read again by its route while no
        // marcher is selected; let go of once the playhead leaves its move or the route is gone
        if (session?.object && selectedIds.length === 0 && ready && resolver) {
            const ask = ++asked.current;
            const { routeId, start, end } = session.target;
            if (
                routeId === null ||
                playheadBeat < start - 1e-9 ||
                playheadBeat > end + 1e-9
            ) {
                clear();
                return;
            }
            void findRouteTarget(db, resolver, routeId, drills).then(
                (target) => {
                    if (ask !== asked.current) return;
                    const now = usePathPenStore.getState().session;
                    if (!now?.object || now.phase === "drawing") return;
                    // Own path and Rejoin act on selected marchers, and none are
                    setGroupCommands([], null);
                    if (target) showPath(target, drillOf(target, drills), true);
                    else clear();
                },
            );
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
            // A path selected as an object meanwhile (a click on its line) is the selection now
            if (now.session?.object && now.session !== session) return;
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

    // A path selected as an object is the selection (AP-O3): the marchers selected are let go of
    const objectSelected = usePathPenStore((s) => s.session?.object ?? false);
    useEffect(() => {
        if (objectSelected && (selected?.length ?? 0) > 0)
            selectedContext?.setSelectedMarchers([]);
        // Only when a path becomes the selection: a marcher selected afterwards replaces it
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [objectSelected]);

    usePathObjects(drills);
}

/** How a path target is named: its marcher's drill number, or its group's size */
const drillOf = (target: PathTarget, drills: ReadonlyMap<number, string>) =>
    target.group
        ? `${target.group.members.length}`
        : (drills.get(target.marcherId) ?? `${target.marcherId}`);

/** How many points an own path object's drawn walk is sampled at, for its click test */
const WALK_SAMPLES = 96;

/**
 * Paths All's path objects (step 3a, AP-O2): with start flag positions drawing every marcher's
 * path, every path in a move at the playhead is listed, so a click selects it with nothing
 * selected, and each group path is drawn as its one line with faint lanes (AP-O7). An own path's
 * line is the start flag positions' path, so its walk inside the window (from the start flag, or
 * the move's start, to the beat shown, or the move's end) is what a click tests. None otherwise.
 */
function usePathObjects(drills: ReadonlyMap<number, string>): void {
    const level = useStartFlagLevelsInEffect();
    const inRange = useTimelineSelectionStore(
        (s) => s.selection.kind === "range",
    );
    const isolating = useTimelineSelectionStore((s) => s.isolation !== null);
    const startHidden = useTimelineSelectionStore((s) => s.startHidden);
    const fromBeat = useTimelineSelectionStore((s) => s.startBeat);
    const toBeat = useTimelineSelectionStore(displayedBeat);
    const playheadBeat = useTimelineSelectionStore((s) => s.playheadBeat);
    const isPlaying = useIsPlaying()?.isPlaying ?? false;
    const version = useTimelineResolverStore((s) => s.version);
    const ready = useTimelineResolverStore((s) => s.status === "ready");
    const wanted =
        ready &&
        !isPlaying &&
        level.paths === "all" &&
        level.dots !== "off" &&
        inRange &&
        !isolating &&
        !startHidden &&
        toBeat > fromBeat;
    const asked = useRef(0);
    useEffect(() => {
        const resolver = useTimelineResolverStore.getState().resolver;
        const ask = ++asked.current;
        if (!wanted || !resolver) {
            setPathObjects([]);
            return;
        }
        void findPathObjects(db, resolver, playheadBeat, drills).then(
            (targets) => {
                if (ask !== asked.current) return;
                const objects: PathObject[] = targets.map((target) => {
                    if (target.group)
                        return {
                            target,
                            drill: drillOf(target, drills),
                            walk: null,
                        };
                    const lo = Math.max(fromBeat, target.start);
                    const hi = Math.min(toBeat, target.end);
                    const walk =
                        hi > lo
                            ? Array.from(
                                  { length: WALK_SAMPLES + 1 },
                                  (_, i) => {
                                      const p = resolver.positionAt(
                                          target.marcherId,
                                          lo + ((hi - lo) * i) / WALK_SAMPLES,
                                      );
                                      return { x: p[0], y: p[1] };
                                  },
                              )
                            : [];
                    return {
                        target,
                        drill: drillOf(target, drills),
                        walk,
                    };
                });
                setPathObjects(objects);
            },
        );
    }, [wanted, playheadBeat, fromBeat, toBeat, version, drills]);
    useEffect(() => () => setPathObjects([]), []);
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
 * - A path selected as an object (step 3a): Escape lets it go (open, it goes back to selected
 *   first, AP-O4); Backspace or Delete removes it, as Remove path does (AP-O6).
 */
export function PathPenKeys(): null {
    const phase = usePathPenStore((s) => s.session?.phase ?? null);
    const picked = usePathPenStore((s) => s.session?.selected ?? null);
    const object = usePathPenStore((s) => s.session?.object ?? false);
    const drawing = phase === "drawing";
    const objectSelected = object && phase === "closed";
    useActionHandler(
        "cancelAlignmentUpdates",
        () => {
            if (!drawing && picked !== null) selectPoint(null);
            else if (!drawing && escapePathObject()) return;
            else closePath();
        },
        {
            label: drawing
                ? tolgee.t("actions.path.cancel", "Cancel path")
                : picked !== null
                  ? tolgee.t("actions.path.deselectPoint", "Deselect point")
                  : objectSelected
                    ? tolgee.t("actions.path.deselect", "Deselect path")
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
            // The open path with no point selected, or the path selected as an object (owner,
            // 2026-11-04 and 2026-11-06): the path goes, one undo step. Not on a path only shown
            // for its marchers, so a stray key there removes nothing
            else void removePath();
        },
        {
            label: drawing
                ? tolgee.t("actions.path.removeLastPoint", "Remove last point")
                : picked !== null
                  ? tolgee.t("actions.path.deletePoint", "Delete point")
                  : tolgee.t("actions.path.remove", "Remove path"),
        },
        drawing || phase === "open" || objectSelected,
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
