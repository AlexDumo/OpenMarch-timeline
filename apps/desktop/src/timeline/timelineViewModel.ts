import type { AssignmentRow, Diagnostic, SpanInfo } from "@openmarch/core";
import type { TimelineInput } from "@/components/timeline/Timeline";
import type {
    TimelineActivitySpan,
    TimelineTrackDiagnostics,
} from "@/components/timeline/TimelineViewModel";

/**
 * The view-model adapter (docs/timeline/ui.md, "Mapping the spec onto the view model";
 * docs/timeline/phases/08-authoring-ui.md P8.8). Pure: the stored timeline tables, the resolver's
 * spans and its diagnostics in, the timeline's tracks out. Nothing it builds is stored.
 *
 * The app draws one track per stored timeline (ui.md UI-9 "Tracks", `buildTimelineClipTracks`).
 * The marcher and shape tracks of UI-3 were removed with the selected page (P8.12): every
 * transition spans its timeline (C-11), so there were no gaps left for them to show.
 *
 * Every range here is in spec beat positions (spec §7). `Timeline` maps them onto the view's beat
 * axis (`createTimelineBeatAxis`), which hides the zero-length beat 0.
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface TimelineViewTimeline {
    readonly id: number;
    readonly name: string | null;
    readonly start: number;
    readonly end: number;
}

export interface TimelineViewTransition {
    readonly id: number;
    readonly timelineId: number;
    /** null: slots are placed individually (D-16) */
    readonly destShapeId: number | null;
    readonly slotCount: number;
    readonly start: number;
    readonly end: number;
}

export interface TimelineViewShape {
    readonly id: number;
    readonly name: string | null;
}

export interface TimelineViewMarcher {
    readonly id: number;
    /** Drill number, such as "T3" */
    readonly label: string;
}

/** The stored rows the adapter reads (spec §5.1). */
export interface TimelineViewTables {
    readonly timelines: readonly TimelineViewTimeline[];
    readonly transitions: readonly TimelineViewTransition[];
    readonly assignments: readonly AssignmentRow[];
    readonly shapes: readonly TimelineViewShape[];
    readonly marchers: readonly TimelineViewMarcher[];
}

export interface TimelineViewSources {
    readonly tables: TimelineViewTables;
    /**
     * A marcher's resolver spans (R-2), sorted, partitioning (-Infinity, +Infinity). Called only
     * for marchers whose spans a track needs. See `resolverSpans` in `timelineStore.ts`.
     */
    readonly spansOf: (marcherId: number) => readonly SpanInfo[];
    readonly diagnostics: readonly Diagnostic[];
}

// ---------------------------------------------------------------------------
// Track ids and colors
// ---------------------------------------------------------------------------

/** One color per spec timeline, so linked clips share it. */
export const TIMELINE_TRACK_COLORS = [
    "#2fc4b2",
    "#e79b00",
    "#e56a82",
    "#7c8cf8",
    "#62b851",
    "#c27be0",
    "#e0784a",
    "#4aa3e0",
] as const;

// ---------------------------------------------------------------------------
// Interval helpers (half-open [start, end), spec §7)
// ---------------------------------------------------------------------------

interface Interval {
    start: number;
    end: number;
}

/** Sorted, non-overlapping union of `intervals`, merging ones that touch. */
function union(intervals: Interval[]): Interval[] {
    const sorted = intervals
        .filter((i) => i.end > i.start)
        .sort((a, b) => a.start - b.start);
    const out: Interval[] = [];
    for (const i of sorted) {
        const last = out[out.length - 1];
        if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
        else out.push({ ...i });
    }
    return out;
}

/** Partitions `clip` into active spans (inside `active`, a sorted union) and inactive ones. */
function activityOver(
    clip: Interval,
    active: Interval[],
): TimelineActivitySpan[] {
    const out: TimelineActivitySpan[] = [];
    const push = (start: number, end: number, isActive: boolean) => {
        if (end <= start) return;
        const last = out[out.length - 1];
        if (last && last.active === isActive && last.endBeatIndex === start) {
            out[out.length - 1] = { ...last, endBeatIndex: end };
            return;
        }
        out.push({
            startBeatIndex: start,
            endBeatIndex: end,
            active: isActive,
        });
    };
    let cursor = clip.start;
    for (const i of active) {
        const start = Math.max(i.start, clip.start);
        const end = Math.min(i.end, clip.end);
        if (end <= start) continue;
        push(cursor, start, false);
        push(start, end, true);
        cursor = end;
    }
    push(cursor, clip.end, false);
    return out;
}

function diagnosticsBadge(
    diagnostics: readonly Diagnostic[],
): TimelineTrackDiagnostics | undefined {
    if (diagnostics.length === 0) return undefined;
    return {
        level: diagnostics.some((d) => d.level === "warning")
            ? "warning"
            : "info",
        messages: diagnostics.map((d) => `${d.code}: ${d.message}`),
    };
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

/** Groups `items` by `key`, keeping their order. */
function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
    const out = new Map<K, T[]>();
    for (const item of items) {
        const k = key(item);
        const list = out.get(k);
        if (list) list.push(item);
        else out.set(k, [item]);
    }
    return out;
}

export const timelineTrackId = (timelineId: number) => `timeline-${timelineId}`;

/**
 * One track per stored timeline (ui.md UI-9 "Tracks"; P8.11), however many transitions it holds,
 * so a group of one-slot transitions is one clip. It replaces UI-3's marcher and shape tracks.
 *
 * - **Clip:** the timeline's range (C-11), one `move` leg. A stored timeline with nobody in it
 *   still shows (UI-9: removing marchers never deletes a timeline).
 * - **Activity:** active where at least one member's winning span (R-2) is in one of its
 *   transitions, and inactive where every member is stolen or there are none (UI-4's rule over
 *   the whole timeline).
 * - **Diagnostics:** every diagnostic of its transitions.
 * - **Order and color:** by start, then id; one color per timeline.
 *
 * How a selected marcher's spans (UI-1) show inside the one track is open (ui.md U-Q5 TODO).
 */
export function buildTimelineClipTracks(
    sources: TimelineViewSources,
): TimelineInput[] {
    const { tables } = sources;
    const transitionsByTimeline = groupBy(
        tables.transitions,
        (t) => t.timelineId,
    );
    const rowsByTransition = groupBy(tables.assignments, (r) => r.transition);
    const diagnosticsByTransition = groupBy(
        sources.diagnostics,
        (d) => d.transitionId,
    );
    const spanCache = new Map<number, readonly SpanInfo[]>();
    const spansOf = (marcherId: number) => {
        let spans = spanCache.get(marcherId);
        if (!spans)
            spanCache.set(marcherId, (spans = sources.spansOf(marcherId)));
        return spans;
    };
    return [...tables.timelines]
        .sort((a, b) => a.start - b.start || a.id - b.id)
        .map((timeline, index) => {
            const transitions = transitionsByTimeline.get(timeline.id) ?? [];
            const ids = new Set(transitions.map((t) => t.id));
            const members = new Set(
                transitions.flatMap((t) =>
                    (rowsByTransition.get(t.id) ?? []).map((r) => r.marcher),
                ),
            );
            const active: Interval[] = [];
            for (const marcherId of members)
                for (const span of spansOf(marcherId))
                    if (span.transitionId != null && ids.has(span.transitionId))
                        active.push({ start: span.start, end: span.end });
            const id = timelineTrackId(timeline.id);
            const clip: Interval = { start: timeline.start, end: timeline.end };
            return {
                id,
                linkId: timeline.id,
                targetId: timeline.id,
                targetType: "timeline",
                label: timeline.name ?? `Timeline ${timeline.id}`,
                color: TIMELINE_TRACK_COLORS[
                    index % TIMELINE_TRACK_COLORS.length
                ],
                startBeatIndex: clip.start,
                endBeatIndex: clip.end,
                legs: [
                    {
                        id: `${id}-leg-${clip.start}`,
                        startBeatIndex: clip.start,
                        endBeatIndex: clip.end,
                        texture: "move",
                    },
                ],
                activitySpans: activityOver(clip, union(active)),
                diagnostics: diagnosticsBadge(
                    [...ids]
                        .sort((a, b) => a - b)
                        .flatMap(
                            (tid) => diagnosticsByTransition.get(tid) ?? [],
                        ),
                ),
            };
        });
}

// ---------------------------------------------------------------------------
// The view's beat axis
// ---------------------------------------------------------------------------

/**
 * Maps spec beat positions onto the timeline's x axis. Every show starts with a fixed,
 * zero-length beat 0 (`timeMap.ts`): it has no time, so drawn one beat wide it would be an empty
 * column before the first timed page. The axis hides it: view beat `v` is spec beat `v + 1`, and
 * spec positions in `[0, 1)` all land on view 0. Beats without a zero-length beat 0 (such as the
 * stories') map one to one.
 */
export interface TimelineBeatAxis {
    /** Spec beats hidden before view 0: 1 when beat 0 is the zero-length beat, else 0 */
    readonly offset: number;
    /** The number of view beats */
    readonly beatCount: number;
    /** Spec beat position to view beat position */
    readonly toView: (beat: number) => number;
    /** View beat position to spec beat position */
    readonly toSpec: (beat: number) => number;
}

export function createTimelineBeatAxis(
    beats: readonly { readonly duration: number }[],
): TimelineBeatAxis {
    const offset = beats.length > 1 && beats[0]!.duration === 0 ? 1 : 0;
    return {
        offset,
        beatCount: beats.length - offset,
        toView: (beat) => Math.max(0, beat - offset),
        toSpec: (beat) => beat + offset,
    };
}

/** A track's spec-beat ranges mapped onto the view axis; zero-width pieces are dropped. */
export function timelineInputToView(
    input: TimelineInput,
    axis: TimelineBeatAxis,
): TimelineInput | null {
    if (axis.offset === 0) return input;
    const legs = input.legs
        .map((leg) => ({
            ...leg,
            startBeatIndex: axis.toView(leg.startBeatIndex),
            endBeatIndex: axis.toView(leg.endBeatIndex),
        }))
        .filter((leg) => leg.endBeatIndex > leg.startBeatIndex);
    if (legs.length === 0) return null;
    const activitySpans: TimelineActivitySpan[] = [];
    for (const span of input.activitySpans) {
        const start = axis.toView(span.startBeatIndex);
        const end = axis.toView(span.endBeatIndex);
        if (end <= start) continue;
        const last = activitySpans[activitySpans.length - 1];
        if (last && last.active === span.active)
            activitySpans[activitySpans.length - 1] = {
                ...last,
                endBeatIndex: end,
            };
        else
            activitySpans.push({
                startBeatIndex: start,
                endBeatIndex: end,
                active: span.active,
            });
    }
    return {
        ...input,
        startBeatIndex: axis.toView(input.startBeatIndex),
        endBeatIndex: axis.toView(input.endBeatIndex),
        legs,
        activitySpans,
    };
}
