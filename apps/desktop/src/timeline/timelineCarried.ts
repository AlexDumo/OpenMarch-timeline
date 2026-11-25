import {
    boxesAt,
    isUngrouped,
    PLACED_KINDS,
    type PlacedBox,
    type PlacedRecipe,
} from "@/shapes/placed/placedBox";
import {
    recipeCount,
    recipeMoveEnd,
    type MoveEndOf,
} from "@/shapes/placed/recipeCount";
import { isOrderMarkKind } from "@/db-functions/shapeRecipes";
import type { AnyToolKind } from "@/shapes/tool/toolKind";
import type { XY } from "@/shapes/types";
import type { CarrySpan } from "./timelineCarryForward";

/**
 * Where a placed shape carries its members (owner, 2026-11-01 on #477: a shape carried onto later
 * pages is the shape's hold, so its members are decided there). One rule for the field's look
 * (`notDefinedAt`, #478) and the timeline's hold bars (#477): a member is carried on a count while
 * `boxesAt` shows its shape there, so only while every member of the shape stands on its spot, the
 * latest shape or ungrouped mark claiming a marcher wins, and kinds this app can't read are skipped.
 */

/** The members of `boxes` (`boxesAt` at some count): carried there. */
export function carriedMembers(boxes: readonly PlacedBox[]): Set<number> {
    return new Set(carriedSince(boxes).keys());
}

/**
 * The members of `boxes` (`boxesAt` at some count), each with the beat its shape was placed or
 * last laid out at (`PlacedBox.endBeat`): where the carry comes from, which the inspector's hold
 * line names as the page the hold is held since.
 */
export function carriedSince(boxes: readonly PlacedBox[]): Map<number, number> {
    const since = new Map<number, number>();
    for (const box of boxes)
        for (const member of box.recipe.members)
            since.set(member.marcherId, box.endBeat);
    return since;
}

/** A beat range `[start, end)`, in spec beats. */
interface Range {
    readonly start: number;
    readonly end: number;
}

/**
 * Where each of `marcherIds` is carried within `within`, as timeline ranges `[start, end)`: the
 * range `[c - 1, c)` is carried when the marcher is carried on count `c` (`boxesAt` at `c`), as
 * the field draws count `c`. Ascending and joined, per marcher; a marcher carried nowhere is left
 * out.
 *
 * `boxesAt` is asked only where the answer can change: who's in a shape changes only at a recipe's
 * count (`recipeCount`) or where a member of some shape starts or stops moving. Between two of
 * those, every member either stands still or is partway through one move (off its spot), so one
 * look covers the counts between them, and one more covers the count on the later one.
 *
 * @param within the ranges to answer for (the selection's holds), any order
 * @param moveEndOf the end beat of a move, undefined for a move that's gone (`boxesAt`)
 * @param spansOf a marcher's resolver spans, for where the shapes' members move
 * @param positionAt where a marcher stands at a beat (as the field reads it)
 */
export function carriedStretches({
    marcherIds,
    within,
    recipes,
    moveEndOf,
    spansOf,
    positionAt,
    kinds = PLACED_KINDS,
}: {
    marcherIds: readonly number[];
    within: readonly Range[];
    recipes: readonly PlacedRecipe[];
    moveEndOf: MoveEndOf;
    spansOf: (marcherId: number) => readonly CarrySpan[];
    positionAt: (marcherId: number, beat: number) => XY | undefined;
    kinds?: readonly AnyToolKind[];
}): Map<number, Range[]> {
    const out = new Map<number, Range[]>();
    const wanted = new Set(marcherIds);
    const inAnyShape = recipes.some(
        (r) =>
            !isUngrouped(r) && r.members.some((m) => wanted.has(m.marcherId)),
    );
    if (!inAnyShape || within.length === 0) return out;

    const sortedCuts = shapeCuts(recipes, moveEndOf, spansOf);

    const looks = new Map<number, Set<number>>();
    const carriedOn = (beat: number) => {
        let carried = looks.get(beat);
        if (!carried) {
            const positions = new Map<number, XY | undefined>();
            carried = carriedMembers(
                boxesAt({
                    recipes,
                    moveEndOf,
                    beat,
                    kinds,
                    positionOf: (id) => {
                        if (!positions.has(id))
                            positions.set(id, positionAt(id, beat));
                        return positions.get(id);
                    },
                }),
            );
            looks.set(beat, carried);
        }
        return carried;
    };
    const add = (start: number, end: number, carried: ReadonlySet<number>) => {
        if (end <= start) return;
        for (const id of wanted) {
            if (!carried.has(id)) continue;
            const list = out.get(id);
            const last = list?.[list.length - 1];
            if (last && last.end >= start)
                list![list!.length - 1] = {
                    start: last.start,
                    end: Math.max(last.end, end),
                };
            else if (list) list.push({ start, end });
            else out.set(id, [{ start, end }]);
        }
    };

    // Overlapping ranges (several marchers' holds) are joined, so each count is answered once
    for (const range of joined(within)) {
        const points = [
            range.start,
            ...sortedCuts.filter((c) => c > range.start && c < range.end),
            range.end,
        ];
        for (let i = 1; i < points.length; i++) {
            const from = points[i - 1]!;
            const to = points[i]!;
            // The counts strictly between two cuts share one answer; the count on `to` has its own
            const last = Math.max(from, to - 1);
            if (last > from) add(from, last, carriedOn((from + last) / 2));
            add(last, to, carriedOn(to));
        }
    }
    return out;
}

/**
 * Where who's in a shape can change: at a recipe's count, or where a member starts or stops moving.
 * An order mark draws nothing, but its cut stays where its move ends, as before (`recipeMoveEnd`):
 * a cut at its own beat, which can fall partway through a count, would change which count the
 * range before it is answered at.
 */
function shapeCuts(
    recipes: readonly PlacedRecipe[],
    moveEndOf: MoveEndOf,
    spansOf: (marcherId: number) => readonly CarrySpan[],
): number[] {
    const cuts = new Set<number>();
    const members = new Set<number>();
    for (const recipe of recipes) {
        const end = isOrderMarkKind(recipe.kind)
            ? recipeMoveEnd(recipe, moveEndOf)
            : recipeCount(recipe, moveEndOf);
        if (end !== undefined) cuts.add(end);
        for (const m of recipe.members) members.add(m.marcherId);
    }
    for (const id of members)
        for (const span of spansOf(id)) {
            if (span.kind === "hold") continue;
            if (Number.isFinite(span.start)) cuts.add(span.start);
            if (Number.isFinite(span.end)) cuts.add(span.end);
        }
    return [...cuts].sort((a, b) => a - b);
}

/** `ranges` ascending, overlapping and touching ones joined */
function joined(ranges: readonly Range[]): Range[] {
    const out: Range[] = [];
    for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
        const last = out[out.length - 1];
        if (last && r.start <= last.end)
            out[out.length - 1] = {
                start: last.start,
                end: Math.max(last.end, r.end),
            };
        else out.push({ start: r.start, end: r.end });
    }
    return out;
}
