import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { editingPositionAt } from "@/timeline/timelineIsolationPlan";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import type { XY } from "../types";

/**
 * Where each marcher comes from in the move being edited: its position at the start flag (or at
 * the isolated move's start), not where it is drawn now at the playhead, which the edit is about
 * to replace. Empty at Home, where there is no move.
 */
export function originsAtStart(ids: readonly number[]): Map<number, XY> {
    const out = new Map<number, XY>();
    const resolver = useTimelineResolverStore.getState().resolver;
    const { selection, isolation } = useTimelineSelectionStore.getState();
    const start = isolation
        ? isolation.start
        : selection.kind === "range"
          ? selection.start
          : null;
    if (!resolver || start === null) return out;
    const known = new Set(resolver.marcherIds());
    for (const id of ids) {
        if (!known.has(id)) continue;
        const [x, y] = editingPositionAt(resolver, id, start);
        out.set(id, { x, y });
    }
    return out;
}

/** The length in counts of the move being edited (its start flag to the playhead), if any */
export function moveCounts(): number | null {
    const { selection, isolation } = useTimelineSelectionStore.getState();
    const window = isolation
        ? isolation
        : selection.kind === "range"
          ? selection
          : null;
    return window ? window.end - window.start : null;
}
