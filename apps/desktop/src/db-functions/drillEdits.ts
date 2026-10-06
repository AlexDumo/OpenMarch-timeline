import { asc, eq, inArray } from "drizzle-orm";
import { createResolver, FieldProperties, type XY } from "@openmarch/core";
import * as schema from "@om-electron/database/migrations/schema";
import { readTimelineTables } from "@/timeline/timelineRows";
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory, withTimelineWriteLock } from "./history";
import { refuse } from "./timelineErrors";
import { assertNoTimelineCommitViolationsInTransaction } from "./timelineChanges";
import {
    isPageMove,
    readPageGrid,
    timelineModeInTransaction,
    withTimelinePageRipple,
    type GridPage,
    type PageGrid,
} from "./timelineRipple";
import { createBeatsInTransaction, deleteBeatsInTransaction } from "./beat";
import { createMeasuresInTransaction } from "./measures";
import {
    createPagesInTransaction,
    ensureSecondBeatHasPage,
    updateLastPageCounts,
} from "./page";
import { setTimelineTransitionDestinationInTransaction } from "./timelineTransitionsInTransaction";
import { deleteTimelinesInTransaction } from "./timelines";
import {
    clipRefOf,
    countSpanOf,
    labelsInDrillOrder,
    pageNamesOf,
    readMarcherLabels,
    type CountSpan,
    type DrillClipRef,
} from "./drillNames";

/**
 * Count edits that say what happens to the drill (tempo experiment E10, Tempo lab flag
 * `drillChoices`; docs/tempo/decisions.md).
 *
 * Adding or removing counts, or moving a page flag, changes the beat grid that timeline rows are
 * stored against, so it runs through `withTimelinePageRipple` (see its module comment for how row
 * edges move). These edits add a choice where the ripple alone has one fixed answer, and a report
 * of what happened to every clip, in pages and counts:
 *
 * - **Remove counts** `[start, end)` (ordinals): the beats go, with the pages and measure lines
 *   that start inside them (a page or measure that runs on past the cut starts at the first count
 *   after it instead). A move crossing the cut is either squeezed (the ripple's rule: same set,
 *   fewer counts) or, with `crossing: "skip"`, a move that runs into the cut stops where its
 *   marchers are when the cut starts (its destination becomes their positions there). A move that
 *   runs out of the cut can't skip: marchers can't jump, so it is squeezed. With
 *   `inside: "delete"`, clips that lie wholly inside the cut go with it; with `"keep"` they make
 *   the ripple refuse.
 * - **Add counts** at boundary `at`: new beats at the tempo of the beat before (`recording:
 *   "has"`), or squeezed into the same time as the page that gets them (`"sameTime"`, a
 *   duration-only change). At a page flag the counts belong to that page; a move that lands on the
 *   flag either stretches over them (the ripple's rule) or, with `crossing: "hold"`, keeps its
 *   counts and its marchers hold until the flag (the ripple's holding moves for an added page,
 *   then that page's flag is taken out again, so pages don't renumber). A move partway through at
 *   `at` can only stretch.
 * - **Move a page flag** to another count: the next page starts there instead, so moves that land
 *   on the flag follow it (and the next page's moves start there). Total counts don't change.
 *
 * `previewDrillEdit` runs an edit in a transaction it rolls back and returns the report, or the
 * refusal; `commitDrillEdit` runs it as one undoable edit. Beats are ordinals throughout, as in
 * `readPageGrid` and the timeline rows.
 */

export type DrillEdit = RemoveCountsEdit | AddCountsEdit | MoveFlagEdit;

export interface RemoveCountsEdit {
    readonly kind: "removeCounts";
    /** The first beat to remove (an ordinal, at least 1) */
    readonly start: number;
    /** One past the last beat to remove */
    readonly end: number;
    /** Moves that run into the cut: squeeze them, or stop them where the cut starts */
    readonly crossing: "squeeze" | "skip";
    /** Clips wholly inside the cut: delete them, or keep them (the edit is then refused) */
    readonly inside: "delete" | "keep";
}

export interface AddCountsEdit {
    readonly kind: "addCounts";
    /** The new counts go before beat `at` (a boundary, 1 to the show's beat count) */
    readonly at: number;
    readonly count: number;
    /** "has": the recording has these counts (keep the tempo); "sameTime": squeeze them in */
    readonly recording: "has" | "sameTime";
    /** Moves that land at `at`: stretch over the new counts, or hold through them */
    readonly crossing: "stretch" | "hold";
}

export interface MoveFlagEdit {
    readonly kind: "moveFlag";
    /** The page whose flag (its end) moves */
    readonly pageId: number;
    /** The flag's new beat boundary */
    readonly to: number;
}

/** What happened to one clip (a timeline) */
export type DrillMoveChange =
    | "shifted"
    | "squeezed"
    | "stretched"
    /** Skip: it stops where its marchers were when the cut starts */
    | "stopsEarly"
    | "deleted"
    /** A holding move the edit made */
    | "holds";

export interface DrillMoveImpact {
    readonly timelineId: number;
    readonly clip: DrillClipRef;
    /** True for a page's own move (a timeline over exactly a page box) */
    readonly pageMove: boolean;
    readonly change: DrillMoveChange;
    readonly before?: CountSpan;
    readonly after?: CountSpan;
    readonly countsBefore?: number;
    readonly countsAfter?: number;
    /** Counts it moved by: positive later, negative earlier */
    readonly shiftBy?: number;
    /**
     * The largest step among its marchers, as steps per five yards (8 is "8 to 5"), before and
     * after. Absent where nobody moves.
     */
    readonly stepBefore?: number;
    readonly stepAfter?: number;
    /**
     * - `onlyInCut`: it lay wholly inside the removed counts
     * - `cantSkip`: skip was asked for, but it runs out of the cut (or can't be cut cleanly), so it
     *   is squeezed
     * - `cantHold`: hold was asked for, but it is partway through its move there, so it stretches
     */
    readonly note?: "onlyInCut" | "cantSkip" | "cantHold";
}

export interface DrillPageImpact {
    readonly id: number;
    readonly nameBefore: string;
    /** Absent when the page goes */
    readonly nameAfter?: string;
    readonly countsBefore: number;
    readonly countsAfter?: number;
}

export interface DrillTimingImpact {
    readonly page: string;
    readonly bpmBefore: number;
    readonly bpmAfter: number;
}

export interface DrillImpact {
    /** Counts in the show (beat 0 not counted) */
    readonly countsBefore: number;
    readonly countsAfter: number;
    /** Pages whose counts change, or that go */
    readonly pages: readonly DrillPageImpact[];
    /** The first page whose name changes, when later pages renumber */
    readonly renumbered: { readonly from: string; readonly to: string } | null;
    /** Every clip that changes, in show order (before the edit) */
    readonly moves: readonly DrillMoveImpact[];
    /** Pages whose tempo changes by half a BPM or more */
    readonly timing: readonly DrillTimingImpact[];
}

export type DrillEditPreview =
    | { readonly ok: true; readonly impact: DrillImpact }
    | { readonly ok: false; readonly error: unknown };

// ---------------------------------------------------------------------------
// State and report
// ---------------------------------------------------------------------------

type TimelineRow = typeof schema.timelines.$inferSelect;
type TransitionRow = typeof schema.timeline_transitions.$inferSelect;
type AssignmentRow = typeof schema.timeline_assignments.$inferSelect;

/** The rows the report compares, read inside the edit's transaction */
export interface DrillState {
    readonly grid: PageGrid;
    readonly timelines: readonly TimelineRow[];
    readonly transitions: readonly TransitionRow[];
    readonly assignments: readonly AssignmentRow[];
    /** Beat durations in seconds, by ordinal */
    readonly durations: readonly number[];
}

export async function readDrillState(tx: DbTransaction): Promise<DrillState> {
    const grid = await readPageGrid(tx);
    const beats = await tx
        .select({ duration: schema.beats.duration })
        .from(schema.beats)
        .orderBy(asc(schema.beats.position), asc(schema.beats.id))
        .all();
    return {
        grid,
        timelines: await tx.select().from(schema.timelines).all(),
        transitions: await tx.select().from(schema.timeline_transitions).all(),
        assignments: await tx.select().from(schema.timeline_assignments).all(),
        durations: beats.map((b) => b.duration),
    };
}

/** Anything that answers where a marcher is at a beat (the resolver) */
export interface PositionSource {
    positionAt(marcherId: number, beat: number): XY;
}

/**
 * Steps per five yards for covering `distance` field pixels in `counts` counts (8 is "8 to 5"),
 * as `StepSize` computes it. Infinity for a hold.
 */
export const stepsPerFiveYards = (distance: number, counts: number) =>
    distance > 0
        ? (5 * 36 * counts * FieldProperties.PIXELS_PER_INCH) / distance
        : Infinity;

/** The largest step (fewest steps per five yards) of `marcherIds` over `[start, end)`, if any */
const largestStep = (
    positions: PositionSource,
    marcherIds: Iterable<number>,
    start: number,
    end: number,
): number | undefined => {
    let best = Infinity;
    for (const id of marcherIds) {
        const [x0, y0] = positions.positionAt(id, start);
        const [x1, y1] = positions.positionAt(id, end);
        best = Math.min(
            best,
            stepsPerFiveYards(Math.hypot(x1 - x0, y1 - y0), end - start),
        );
    }
    return Number.isFinite(best) ? best : undefined;
};

const pageBpm = (durations: readonly number[], page: GridPage) => {
    let seconds = 0;
    for (let b = page.start; b < page.end; b++) seconds += durations[b] ?? 0;
    return seconds > 0 ? ((page.end - page.start) * 60) / seconds : null;
};

/** What the edit itself knows about clips, beyond what the rows show */
export interface DrillEditNotes {
    readonly notes: ReadonlyMap<number, DrillMoveImpact["note"]>;
    /** Timelines skip cut short */
    readonly stoppedEarly: ReadonlySet<number>;
}

const NO_NOTES: DrillEditNotes = { notes: new Map(), stoppedEarly: new Set() };

/**
 * The report: every page whose counts change, every clip that changes and how, step sizes where
 * `positions` are given, and pages whose tempo changes. Pure.
 */
// eslint-disable-next-line max-lines-per-function
export function diffDrill({
    before,
    after,
    labels,
    positions,
    notes = NO_NOTES,
}: {
    before: DrillState;
    after: DrillState;
    /** Marcher labels by id, in drill order */
    labels: ReadonlyMap<number, string>;
    positions?: { before: PositionSource; after: PositionSource };
    notes?: DrillEditNotes;
}): DrillImpact {
    const namesBefore = pageNamesOf(before.grid.pages);
    const namesAfter = pageNamesOf(after.grid.pages);

    const pages: DrillPageImpact[] = [];
    let renumbered: DrillImpact["renumbered"] = null;
    const afterPages = new Map(after.grid.pages.map((p) => [p.id, p]));
    for (const p of before.grid.pages) {
        if (p.id === 0) continue;
        const q = afterPages.get(p.id);
        const nameBefore = namesBefore.get(p.id)!;
        if (!q) {
            pages.push({ id: p.id, nameBefore, countsBefore: p.end - p.start });
            continue;
        }
        const nameAfter = namesAfter.get(q.id)!;
        if (!renumbered && nameAfter !== nameBefore)
            renumbered = { from: nameBefore, to: nameAfter };
        if (q.end - q.start !== p.end - p.start)
            pages.push({
                id: p.id,
                nameBefore,
                nameAfter,
                countsBefore: p.end - p.start,
                countsAfter: q.end - q.start,
            });
    }

    const timing: DrillTimingImpact[] = [];
    for (const p of before.grid.pages) {
        const q = afterPages.get(p.id);
        if (p.id === 0 || !q) continue;
        const b0 = pageBpm(before.durations, p);
        const b1 = pageBpm(after.durations, q);
        if (b0 !== null && b1 !== null && Math.abs(b1 - b0) >= 0.5)
            timing.push({
                page: namesAfter.get(q.id)!,
                bpmBefore: b0,
                bpmAfter: b1,
            });
    }

    const marchersOf = (state: DrillState, timelineId: number) => {
        const ids = new Set(
            state.transitions
                .filter((t) => t.timeline_id === timelineId)
                .map((t) => t.id),
        );
        return new Set(
            state.assignments
                .filter((a) => ids.has(a.transition_id))
                .map((a) => a.marcher_id),
        );
    };
    const describe = (
        state: DrillState,
        names: ReadonlyMap<number, string>,
        l: TimelineRow,
    ) => {
        const marchers = marchersOf(state, l.id);
        return {
            marchers,
            clip: clipRefOf({
                timeline: l,
                pages: state.grid.pages,
                names,
                marcherLabels: labelsInDrillOrder(marchers, labels),
            }),
            pageMove: state.grid.pages.some(
                (p) =>
                    p.id !== 0 &&
                    p.start === l.start_beat &&
                    p.end === l.end_beat,
            ),
            span: countSpanOf(
                state.grid.pages,
                names,
                l.start_beat,
                l.end_beat,
            ),
        };
    };

    const moves: DrillMoveImpact[] = [];
    const afterTimelines = new Map(after.timelines.map((l) => [l.id, l]));
    const ordered = [...before.timelines].sort(
        (a, b) => a.start_beat - b.start_beat || a.id - b.id,
    );
    for (const l of ordered) {
        const was = describe(before, namesBefore, l);
        const note = notes.notes.get(l.id);
        const m = afterTimelines.get(l.id);
        if (!m) {
            moves.push({
                timelineId: l.id,
                clip: was.clip,
                pageMove: was.pageMove,
                change: "deleted",
                before: was.span,
                countsBefore: l.end_beat - l.start_beat,
                ...(note ? { note } : {}),
            });
            continue;
        }
        const lengthBefore = l.end_beat - l.start_beat;
        const lengthAfter = m.end_beat - m.start_beat;
        const change: DrillMoveChange | null = notes.stoppedEarly.has(l.id)
            ? "stopsEarly"
            : lengthAfter < lengthBefore
              ? "squeezed"
              : lengthAfter > lengthBefore
                ? "stretched"
                : m.start_beat !== l.start_beat
                  ? "shifted"
                  : null;
        if (change === null) continue;
        const now = describe(after, namesAfter, m);
        const steps =
            positions && change !== "shifted"
                ? {
                      stepBefore: largestStep(
                          positions.before,
                          was.marchers,
                          l.start_beat,
                          l.end_beat,
                      ),
                      stepAfter: largestStep(
                          positions.after,
                          now.marchers,
                          m.start_beat,
                          m.end_beat,
                      ),
                  }
                : {};
        moves.push({
            timelineId: l.id,
            clip: was.clip,
            pageMove: was.pageMove,
            change,
            before: was.span,
            after: now.span,
            countsBefore: lengthBefore,
            countsAfter: lengthAfter,
            ...(change === "shifted"
                ? { shiftBy: m.start_beat - l.start_beat }
                : {}),
            ...(steps.stepBefore !== undefined
                ? { stepBefore: steps.stepBefore }
                : {}),
            ...(steps.stepAfter !== undefined
                ? { stepAfter: steps.stepAfter }
                : {}),
            ...(note ? { note } : {}),
        });
    }
    const beforeIds = new Set(before.timelines.map((l) => l.id));
    for (const m of after.timelines) {
        if (beforeIds.has(m.id)) continue;
        const now = describe(after, namesAfter, m);
        moves.push({
            timelineId: m.id,
            clip: now.clip,
            pageMove: false,
            change: "holds",
            after: now.span,
            countsAfter: m.end_beat - m.start_beat,
        });
    }

    return {
        countsBefore: before.grid.beatIds.length - 1,
        countsAfter: after.grid.beatIds.length - 1,
        pages,
        renumbered,
        moves,
        timing,
    };
}

// ---------------------------------------------------------------------------
// The edits
// ---------------------------------------------------------------------------

const MAX_ADDED_COUNTS = 512;

/** `x` as a new start after removing `[a, b)`: inside the cut it lands on the cut */
const startAfterCut = (x: number, a: number, b: number) =>
    x < a ? x : x < b ? a : x - (b - a);

/** `x` as a new end after removing `[a, b)` */
const endAfterCut = (x: number, a: number, b: number) =>
    x <= a ? x : x <= b ? a : x - (b - a);

/**
 * Whether skip can cut transition `t` at beat `a`: a direct path, one marcher in every slot over
 * the whole move, and no higher layer over that marcher at `a` (whose position would be the
 * resolver's answer there instead of this move's).
 */
const canStopAt = (
    t: TransitionRow,
    a: number,
    assignments: readonly AssignmentRow[],
) => {
    if (t.path_style !== "direct") return false;
    const rows = assignments.filter((r) => r.transition_id === t.id);
    const slots = new Set(rows.map((r) => r.slot_index));
    if (rows.length !== t.slot_count || slots.size !== t.slot_count)
        return false;
    return rows.every(
        (r) =>
            r.start_beat === t.start_beat &&
            r.end_beat === t.end_beat &&
            !assignments.some(
                (o) =>
                    o.marcher_id === r.marcher_id &&
                    o.layer > r.layer &&
                    o.start_beat < a &&
                    o.end_beat >= a,
            ),
    );
};

// eslint-disable-next-line max-lines-per-function
async function removeCountsInTransaction(
    tx: DbTransaction,
    edit: RemoveCountsEdit,
    before: DrillState,
    positions: PositionSource,
): Promise<DrillEditNotes> {
    const { grid } = before;
    const n = grid.beatIds.length;
    const a = edit.start;
    const b = edit.end;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b > n)
        refuse(`counts ${a} to ${b} aren't in the show`);
    if (b <= a) refuse("there are no counts to remove");
    if (a === 1 && b === n)
        refuse("a show can't have all of its counts removed");

    const notes = new Map<number, DrillMoveImpact["note"]>();
    const stoppedEarly = new Set<number>();
    const removedPages = grid.pages.filter(
        (p) => p.id !== 0 && p.start >= a && p.start < b && p.end <= b,
    );
    const rowsOf = (transitionId: number) =>
        before.assignments.filter((r) => r.transition_id === transitionId);
    const goesWithPage = (l: TimelineRow) => {
        const owned = before.transitions.filter((t) => t.timeline_id === l.id);
        return (
            owned.length > 0 &&
            owned.every((t) =>
                removedPages.some((p) => isPageMove(t, rowsOf(t.id), p)),
            )
        );
    };

    // Clips wholly inside the cut (the ripple takes removed pages' own moves by itself)
    const inside = before.timelines.filter(
        (l) => l.start_beat >= a && l.end_beat <= b,
    );
    for (const l of inside) if (!goesWithPage(l)) notes.set(l.id, "onlyInCut");
    if (edit.inside === "delete") {
        await deleteTimelinesInTransaction({
            tx,
            timelineIds: new Set(inside.map((l) => l.id)),
        });
        // Parts of a longer move that lie wholly inside the cut
        const insideIds = new Set(inside.map((l) => l.id));
        const timelineOf = new Map(
            before.transitions.map((t) => [t.id, t.timeline_id]),
        );
        const parts = before.assignments.filter(
            (r) =>
                r.start_beat >= a &&
                r.end_beat <= b &&
                !insideIds.has(timelineOf.get(r.transition_id)!),
        );
        if (parts.length > 0)
            await tx.delete(schema.timeline_assignments).where(
                inArray(
                    schema.timeline_assignments.id,
                    parts.map((r) => r.id),
                ),
            );
    }

    // Moves crossing the cut
    for (const t of before.transitions) {
        if (inside.some((l) => l.id === t.timeline_id)) continue;
        const into = t.start_beat < a && t.end_beat > a && t.end_beat <= b;
        const outOf = t.start_beat >= a && t.start_beat < b && t.end_beat > b;
        const across = t.start_beat < a && t.end_beat > b;
        if (edit.crossing !== "skip" || !(into || outOf || across)) continue;
        if (into && canStopAt(t, a, before.assignments)) {
            const points: XY[] = new Array<XY>(t.slot_count);
            for (const r of rowsOf(t.id))
                points[r.slot_index] = positions.positionAt(r.marcher_id, a);
            await setTimelineTransitionDestinationInTransaction({
                tx,
                transitionId: t.id,
                destination: { kind: "individual", points },
            });
            stoppedEarly.add(t.timeline_id);
        } else notes.set(t.timeline_id, "cantSkip");
    }

    // Pages and measure lines that start inside the cut: on to the first count after it when they
    // run past it (and nothing else starts there), else they go
    const startsAfter = new Set(grid.pages.map((p) => p.start));
    const pageMoves: { id: number; beat: number }[] = [];
    const pageDeletes: number[] = [];
    for (const p of grid.pages) {
        if (p.id === 0 || p.start < a || p.start >= b) continue;
        if (p.end > b && !startsAfter.has(b))
            pageMoves.push({ id: p.id, beat: grid.beatIds[b]! });
        else pageDeletes.push(p.id);
    }
    const ordinal = new Map(grid.beatIds.map((id, i) => [id, i]));
    const measures = (
        await tx
            .select({
                id: schema.measures.id,
                start_beat: schema.measures.start_beat,
            })
            .from(schema.measures)
            .all()
    )
        .map((m) => ({ id: m.id, start: ordinal.get(m.start_beat) ?? -1 }))
        .sort((x, y) => x.start - y.start);
    const measureStarts = new Set(measures.map((m) => m.start));
    const measureMoves: { id: number; beat: number }[] = [];
    const measureDeletes: number[] = [];
    measures.forEach((m, i) => {
        if (m.start < a || m.start >= b) return;
        const next = measures[i + 1]?.start ?? n;
        if (next > b && b < n && !measureStarts.has(b))
            measureMoves.push({ id: m.id, beat: grid.beatIds[b]! });
        else measureDeletes.push(m.id);
    });

    // The last page keeps the end it had, less the counts cut from it
    const survivors = grid.pages.filter((p) => !pageDeletes.includes(p.id));
    const last = survivors[survivors.length - 1]!;
    const lastIndex = grid.pages.findIndex((p) => p.id === last.id);
    const oldEnd =
        lastIndex === grid.pages.length - 1
            ? last.end
            : grid.pages[lastIndex + 1]!.start;
    const lastPageCounts =
        endAfterCut(oldEnd, a, b) - startAfterCut(last.start, a, b);

    await withTimelinePageRipple(tx, async () => {
        if (pageDeletes.length > 0) {
            await tx
                .delete(schema.pages)
                .where(inArray(schema.pages.id, pageDeletes));
            await tx
                .delete(schema.marcher_pages)
                .where(inArray(schema.marcher_pages.page_id, pageDeletes));
        }
        for (const p of pageMoves)
            await tx
                .update(schema.pages)
                .set({ start_beat: p.beat })
                .where(eq(schema.pages.id, p.id));
        if (measureDeletes.length > 0)
            await tx
                .delete(schema.measures)
                .where(inArray(schema.measures.id, measureDeletes));
        for (const m of measureMoves)
            await tx
                .update(schema.measures)
                .set({ start_beat: m.beat })
                .where(eq(schema.measures.id, m.id));
        await deleteBeatsInTransaction({
            tx,
            beatIds: new Set(grid.beatIds.slice(a, b)),
        });
        if (last.id !== 0 && lastPageCounts > 0)
            await updateLastPageCounts({ tx, lastPageCounts });
        await ensureSecondBeatHasPage({ tx });
    });
    return { notes, stoppedEarly };
}

/** The page that gets counts added at `at`: the one whose box ends at or holds `at` */
export const pageForAddedCounts = (
    pages: readonly GridPage[],
    at: number,
): GridPage | null =>
    pages.find((p) => p.id !== 0 && p.start < at && at <= p.end) ??
    pages.find((p) => p.id !== 0 && p.start === at) ??
    null;

// eslint-disable-next-line max-lines-per-function
async function addCountsInTransaction(
    tx: DbTransaction,
    edit: AddCountsEdit,
    before: DrillState,
): Promise<DrillEditNotes> {
    const { grid } = before;
    const n = grid.beatIds.length;
    const { at, count } = edit;
    if (!Number.isInteger(at) || at < 1 || at > n)
        refuse(`counts can't be added at beat ${at}`);
    if (!Number.isInteger(count) || count < 1 || count > MAX_ADDED_COUNTS)
        refuse(
            `the counts to add must be a whole number from 1 to ${MAX_ADDED_COUNTS}`,
        );
    const owner = pageForAddedCounts(grid.pages, at);
    const onFlag = owner !== null && at === owner.end;
    if (edit.crossing === "hold" && !onFlag)
        refuse("marchers can only hold for new counts added at a page flag");
    if (edit.recording === "sameTime" && !owner)
        refuse("counts after the last flag have no page to squeeze them into");
    const isLast = owner?.id === grid.pages[grid.pages.length - 1]?.id;

    // Moves partway through at `at` stretch whatever is asked
    const notes = new Map<number, DrillMoveImpact["note"]>();
    if (edit.crossing === "hold")
        for (const l of before.timelines)
            if (l.start_beat < at && at < l.end_beat)
                notes.set(l.id, "cantHold");

    const beats = await tx
        .select()
        .from(schema.beats)
        .orderBy(asc(schema.beats.position), asc(schema.beats.id))
        .all();
    const previous = beats[at - 1]!;
    const duration =
        previous.duration > 0
            ? previous.duration
            : (beats[at]?.duration ?? 0) > 0
              ? beats[at]!.duration
              : 0.5;
    const isDownbeat =
        at < n &&
        (await tx
            .select({ id: schema.measures.id })
            .from(schema.measures)
            .where(eq(schema.measures.start_beat, beats[at]!.id))
            .get()) !== undefined;

    let holdPageId: number | undefined;
    const created = await withTimelinePageRipple(tx, async () => {
        const newBeats = await createBeatsInTransaction({
            tx,
            newBeats: Array.from({ length: count }, () => ({
                duration,
                include_in_measure: true,
            })),
            startingPosition: previous.position,
        });
        // The new counts are their own measure, so later measures keep their beats
        if (isDownbeat)
            await createMeasuresInTransaction({
                tx,
                newItems: [{ start_beat: newBeats[0]!.id }],
            });
        if (edit.crossing === "hold") {
            // A page over the new counts, for the ripple's holding moves; it goes again below
            const [page] = await createPagesInTransaction({
                tx,
                newPages: [{ start_beat: newBeats[0]!.id, is_subset: false }],
            });
            holdPageId = page!.id;
            if (isLast)
                await updateLastPageCounts({ tx, lastPageCounts: count });
        } else if (owner && isLast)
            await updateLastPageCounts({
                tx,
                lastPageCounts: owner.end - owner.start + count,
            });
        await ensureSecondBeatHasPage({ tx });
        return newBeats;
    });

    if (holdPageId !== undefined) {
        // The holds stay; the page over them goes, so the owner's flag moves to their end
        await tx.delete(schema.pages).where(eq(schema.pages.id, holdPageId));
        await tx
            .delete(schema.marcher_pages)
            .where(eq(schema.marcher_pages.page_id, holdPageId));
        if (owner && isLast)
            await updateLastPageCounts({
                tx,
                lastPageCounts: owner.end - owner.start + count,
            });
    }

    if (edit.recording === "sameTime" && owner) {
        // The page keeps its length in time: every beat of it, old and new, gets shorter alike
        const ids = new Set(created.map((c) => c.id));
        for (let o = owner.start; o < owner.end; o++) ids.add(beats[o]!.id);
        let seconds = 0;
        for (let o = owner.start; o < owner.end; o++)
            seconds += beats[o]!.duration;
        const factor = seconds / (seconds + count * duration);
        const rows = await tx
            .select({ id: schema.beats.id, duration: schema.beats.duration })
            .from(schema.beats)
            .where(inArray(schema.beats.id, [...ids]))
            .all();
        for (const row of rows)
            await tx
                .update(schema.beats)
                .set({ duration: row.duration * factor })
                .where(eq(schema.beats.id, row.id));
    }
    return { notes, stoppedEarly: new Set() };
}

async function moveFlagInTransaction(
    tx: DbTransaction,
    edit: MoveFlagEdit,
    before: DrillState,
): Promise<DrillEditNotes> {
    const { grid } = before;
    const index = grid.pages.findIndex((p) => p.id === edit.pageId);
    const page = grid.pages[index];
    if (!page || page.id === 0)
        refuse(`page ${edit.pageId} has no flag to move`);
    const next = grid.pages[index + 1];
    const { to } = edit;
    if (!Number.isInteger(to) || to <= page.start)
        refuse("a page flag can't move to or before the page's start");
    if (next ? to >= next.end : to > grid.beatIds.length)
        refuse(
            next
                ? "a page flag can't move to or past the next page's flag"
                : "the last flag can't move past the show's last count",
        );
    if (to === page.end) refuse("the flag is already there");

    await withTimelinePageRipple(tx, async () => {
        if (next) {
            await tx
                .update(schema.pages)
                .set({ start_beat: grid.beatIds[to]! })
                .where(eq(schema.pages.id, next.id));
            // The next page keeps its own flag
            if (index + 1 === grid.pages.length - 1)
                await updateLastPageCounts({
                    tx,
                    lastPageCounts: next.end - to,
                });
        } else
            await updateLastPageCounts({
                tx,
                lastPageCounts: to - page.start,
            });
    });
    return NO_NOTES;
}

/**
 * Runs `edit` inside `tx` (timeline mode only) and reports what it did to the drill. Refusals
 * throw, as the ripple's do.
 */
export async function applyDrillEditInTransaction(
    tx: DbTransaction,
    edit: DrillEdit,
): Promise<DrillImpact> {
    if (!(await timelineModeInTransaction(tx)))
        refuse("count edits with drill choices are only for timeline mode");
    const before = await readDrillState(tx);
    const labels = await readMarcherLabels(tx);
    const beforePositions = createResolver(
        (await readTimelineTables(tx)).snapshot,
    );
    const notes =
        edit.kind === "removeCounts"
            ? await removeCountsInTransaction(tx, edit, before, beforePositions)
            : edit.kind === "addCounts"
              ? await addCountsInTransaction(tx, edit, before)
              : await moveFlagInTransaction(tx, edit, before);
    const after = await readDrillState(tx);
    const afterPositions = createResolver(
        (await readTimelineTables(tx)).snapshot,
    );
    return diffDrill({
        before,
        after,
        labels,
        positions: { before: beforePositions, after: afterPositions },
        notes,
    });
}

/** Thrown to roll a preview back */
const ROLLBACK = Symbol("drill edit preview");

/**
 * Runs `edit` in a transaction that is rolled back, and returns its report, or its refusal (the
 * ripple's, or the commit check's). Nothing reaches the file or the undo history. It waits for
 * other wrapped writes, so it sees the state the next edit would.
 */
export async function previewDrillEdit({
    db,
    edit,
}: {
    db: DbConnection;
    edit: DrillEdit;
}): Promise<DrillEditPreview> {
    return await withTimelineWriteLock(async () => {
        let impact: DrillImpact | undefined;
        try {
            await db.transaction(async (tx) => {
                impact = await applyDrillEditInTransaction(tx, edit);
                await assertNoTimelineCommitViolationsInTransaction(tx);
                throw ROLLBACK;
            });
        } catch (error) {
            if (error !== ROLLBACK) return { ok: false, error };
        }
        return { ok: true, impact: impact! };
    });
}

/** Runs `edit` as one undoable edit and returns its report. */
export async function commitDrillEdit({
    db,
    edit,
}: {
    db: DbConnection;
    edit: DrillEdit;
}): Promise<DrillImpact> {
    return await transactionWithHistory(
        db,
        `drillEdit:${edit.kind}`,
        async (tx) => await applyDrillEditInTransaction(tx, edit),
    );
}
