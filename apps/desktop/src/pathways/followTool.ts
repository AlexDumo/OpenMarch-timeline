/**
 * Opening the Follow tool (pathways step 4b, DL-4): the window between the start flag and the
 * end flag, the selected line's shape at the start flag (DL-6), refusals said before anything is
 * drawn, and the session whose ends pulse until one is pressed.
 */
import type { Resolver } from "@openmarch/core";
import { db } from "@/global/database/db";
import {
    followSource,
    trailDragRefusalFor,
    trailDragRefusal,
    windowMoveOf,
    type TrailWindow,
} from "@/db-functions/timelineTrailDrag";
import { isBasicMode } from "@/stores/EditorModeStore";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { basicPageBox } from "@/timeline/timelineCoordinateWrites";
import { translateTimelineText } from "@/timeline/translateTimelineText";
import { currentShapeField } from "@/shapes/field/shapeField";
import type { XY } from "@/shapes/types";
import type { PathTarget } from "./pathTarget";
import { usePathPenStore } from "./pathPenStore";
import type { FollowDrag } from "./followDrag";

/**
 * The window a trail is dragged in now (DL-2): the edit window `[start flag, playhead)`, in Basic
 * the page box at the playhead (past the last page, the window after the last flag). Null at home.
 */
export function followWindowNow(): TrailWindow | null {
    const state = useTimelineSelectionStore.getState();
    const { selection } = state;
    if (selection.kind !== "range") return null;
    if (isBasicMode()) {
        const box = basicPageBox(state, selection.end);
        if (box) return box;
    }
    return { start: selection.start, end: selection.end };
}

/**
 * Opens the Follow tool on the selected marchers `ids`: their ends pulse, ready to drag a trail
 * out of one. Resolves to why not (translated), or null when it opened.
 */
export async function openFollowTool(
    resolver: Pick<Resolver, "positionAt">,
    ids: readonly number[],
    drills: ReadonlyMap<number, string>,
): Promise<string | null> {
    const window = followWindowNow();
    if (!window) return translateTimelineText(trailDragRefusal.noWindow());
    const field = currentShapeField();
    if (!field) return null;
    const sorted = [...new Set(ids)].sort((a, b) => a - b);
    const starts = sorted.map((m): [number, number] => {
        const [x, y] = resolver.positionAt(m, window.start);
        return [x, y];
    });
    const source = followSource(starts);
    if (!source) return translateTimelineText(trailDragRefusal.notFitted());
    const order = source.order.map((i) => sorted[i]!);
    // Said before drawing starts, so no drawing is lost (AP-T8's refusals)
    const refusal = await db.transaction((tx) =>
        trailDragRefusalFor(tx, window, sorted, order.at(-1)!, "trail"),
    );
    if (refusal) return translateTimelineText(refusal);
    const keepOffered = (await windowMoveOf(db, window, sorted)) !== null;
    const at = new Map<number, XY>(
        sorted.map((m, i) => [m, { x: starts[i]![0], y: starts[i]![1] }]),
    );
    const follow: FollowDrag = {
        window,
        ids: sorted,
        order,
        starts: at,
        grabbed: null,
        spacing: { kind: "keep" },
        ends: "trail",
        keepOffered,
        step: field.fieldProperties.pixelsPerStep,
    };
    const members = order.map((m) => ({
        marcherId: m,
        drill: drills.get(m) ?? `${m}`,
        from: at.get(m)!,
        to: at.get(m)!,
    }));
    const leader = members.at(-1)!;
    const target: PathTarget = {
        timelineId: -1,
        transitionId: -1,
        marcherId: leader.marcherId,
        start: window.start,
        end: window.end,
        from: leader.from,
        to: leader.from,
        routeId: null,
        points: [],
        ends: null,
        group: null,
        trail: { members, leaderId: leader.marcherId, reverse: false },
    };
    usePathPenStore.setState({
        session: {
            phase: "drawing",
            target,
            drill: `${sorted.length}`,
            points: [],
            pointer: null,
            selected: null,
            dragging: null,
            object: false,
            byRoute: false,
            follow,
        },
    });
    return null;
}
