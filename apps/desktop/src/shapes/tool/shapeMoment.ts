import {
    useTimelineSelectionStore,
    type TimelineSelectionState,
} from "@/stores/TimelineSelectionStore";

/**
 * The moment an open shape belongs to (#416, option B): the edit window it was drawn at. Moving
 * around the timeline doesn't end the shape. While the window is somewhere else the shape is
 * "away": hidden, with a chip that goes back to it, and back at its moment it shows again.
 *
 * Isolating a move or leaving isolation still ends the shape (placed where it was drawn): that
 * changes what an edit writes to, not only where the playhead is.
 */
export interface ShapeMoment {
    /** The window: its kind and range, and the move it stands for when several share the range */
    readonly key: string;
    /** The start flag and the playhead, to go back to */
    readonly startBeat: number;
    readonly playheadBeat: number;
    readonly windowTimelineId: number | null;
    /** The isolated timeline and its range, `""` outside isolation */
    readonly isolation: string;
}

type MomentState = Pick<
    TimelineSelectionState,
    | "selection"
    | "startBeat"
    | "playheadBeat"
    | "windowTimelineId"
    | "isolation"
>;

/** The moment the timeline is at now */
export function momentOf(
    state: MomentState = useTimelineSelectionStore.getState(),
): ShapeMoment {
    const sel = state.selection;
    const iso = state.isolation;
    return {
        key: [
            sel.kind,
            sel.kind === "range" ? `${sel.start}-${sel.end}` : "",
            state.windowTimelineId ?? "",
        ].join("|"),
        startBeat: state.startBeat,
        playheadBeat: state.playheadBeat,
        windowTimelineId: state.windowTimelineId,
        isolation: iso ? `${iso.timelineId}:${iso.start}-${iso.end}` : "",
    };
}

/** Whether the timeline has moved off `moment`, so its shape is hidden */
export function isAwayFrom(
    moment: ShapeMoment | null,
    state: MomentState = useTimelineSelectionStore.getState(),
): boolean {
    return moment !== null && momentOf(state).key !== moment.key;
}

/** Whether a move was isolated or isolation left since `moment`: that ends its shape */
export function isolationChangedSince(
    moment: ShapeMoment | null,
    state: MomentState = useTimelineSelectionStore.getState(),
): boolean {
    return moment !== null && momentOf(state).isolation !== moment.isolation;
}

/** Go back: puts the start flag and the playhead where they were at `moment` */
export function goBackTo(moment: ShapeMoment): void {
    const store = useTimelineSelectionStore.getState();
    if (store.isolation) store.seekKeepingStart(moment.playheadBeat);
    else if (moment.playheadBeat === 0) store.selectHome();
    else
        store.selectRange(
            moment.startBeat,
            moment.playheadBeat,
            moment.windowTimelineId ?? undefined,
        );
}

/** "count 12", or "home" at beat 0: where the shape belongs, for the away chip */
export function momentLabel(moment: ShapeMoment): string {
    return moment.playheadBeat === 0 ? "home" : `count ${moment.playheadBeat}`;
}
