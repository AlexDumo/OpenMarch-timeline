import { asc } from "drizzle-orm";
import { generatePageNames } from "@openmarch/core";
import * as schema from "@om-electron/database/migrations/schema";
import type { DbTransaction } from "./types";

/**
 * Names for timeline rows in the words a drill writer uses (tempo experiment E10): pages, counts,
 * clip names and marcher labels, instead of beat ordinals and timeline ids. The ripple's refusals
 * and the drill-edit impact report both carry these, and `timeline/drillEditText.ts` words them.
 *
 * Beats here are ordinals, as in `readPageGrid`. A page's counts run from 1 on its first beat to N
 * on its last, the beat that lands on its flag (UI-12, `getPageCountAt`), so beat `b` of a page
 * over `[start, end)` is count `b - start + 1`.
 */

/** A page's ordinal range, as `readPageGrid` gives it, with whether it is a subset page */
export interface NamedGridPage {
    readonly id: number;
    readonly start: number;
    readonly end: number;
    readonly isSubset?: boolean;
}

/** Where a row runs, from its first count to its last */
export interface CountSpan {
    readonly startPage: string;
    readonly startCount: number;
    readonly endPage: string;
    readonly endCount: number;
}

/**
 * A clip as the user knows it: a page's own move (a timeline over exactly a page box, drawn as
 * the page box, UI-10), a named timeline, or the marchers it moves.
 */
export type DrillClipRef =
    | { readonly kind: "page"; readonly page: string }
    | { readonly kind: "named"; readonly name: string }
    | {
          readonly kind: "marchers";
          /** Up to three marcher labels, in drill order */
          readonly marchers: readonly string[];
          /** How many marchers the clip moves */
          readonly total: number;
      };

/** Page names by id, in show order, as the app names them (`generatePageNames`). */
export function pageNamesOf(
    pages: readonly NamedGridPage[],
): Map<number, string> {
    const names = generatePageNames(pages.map((p) => p.isSubset === true));
    return new Map(pages.map((p, i) => [p.id, names[i] ?? String(i)]));
}

/** The page and count of beat `beat`: the page holding it, or the last page past the last flag. */
export function countOfBeat(
    pages: readonly NamedGridPage[],
    names: ReadonlyMap<number, string>,
    beat: number,
): { page: string; count: number } {
    const page =
        pages.find((p) => p.start <= beat && beat < p.end) ??
        [...pages].reverse().find((p) => p.start <= beat) ??
        pages[0];
    if (!page) return { page: "0", count: beat + 1 };
    return { page: names.get(page.id) ?? "?", count: beat - page.start + 1 };
}

/** The counts a row over `[start, end)` runs over: its first beat's count to its last's. */
export function countSpanOf(
    pages: readonly NamedGridPage[],
    names: ReadonlyMap<number, string>,
    start: number,
    end: number,
): CountSpan {
    const first = countOfBeat(pages, names, start);
    const last = countOfBeat(pages, names, Math.max(start, end - 1));
    return {
        startPage: first.page,
        startCount: first.count,
        endPage: last.page,
        endCount: last.count,
    };
}

/** A marcher's label, as the canvas and the timeline show it ("B4") */
export const marcherLabel = (m: {
    drill_prefix: string;
    drill_order: number;
}) => `${m.drill_prefix}${m.drill_order}`;

/** Up to three of `labels` and how many there are, for `DrillClipRef` */
export const marchersRef = (labels: readonly string[]): DrillClipRef => ({
    kind: "marchers",
    marchers: labels.slice(0, 3),
    total: labels.length,
});

/**
 * Names a timeline: its page when it runs over exactly a page box and has no name of its own,
 * its name when it has one, or else the marchers it moves (by label, in drill order).
 */
export function clipRefOf({
    timeline,
    pages,
    names,
    marcherLabels,
}: {
    timeline: { name: string | null; start_beat: number; end_beat: number };
    pages: readonly NamedGridPage[];
    names: ReadonlyMap<number, string>;
    /** The labels of the marchers it moves */
    marcherLabels: readonly string[];
}): DrillClipRef {
    const name = timeline.name?.trim();
    if (name) return { kind: "named", name };
    const page = pages.find(
        (p) =>
            p.id !== 0 &&
            p.start === timeline.start_beat &&
            p.end === timeline.end_beat,
    );
    if (page) return { kind: "page", page: names.get(page.id) ?? "?" };
    return marchersRef(marcherLabels);
}

/** Marcher labels by id, read inside `tx` */
export async function readMarcherLabels(
    tx: DbTransaction,
): Promise<Map<number, string>> {
    const rows = await tx
        .select({
            id: schema.marchers.id,
            drill_prefix: schema.marchers.drill_prefix,
            drill_order: schema.marchers.drill_order,
        })
        .from(schema.marchers)
        .orderBy(
            asc(schema.marchers.drill_prefix),
            asc(schema.marchers.drill_order),
        )
        .all();
    return new Map(rows.map((m) => [m.id, marcherLabel(m)]));
}

/** Sorts marcher ids by their labels' drill order (the map's order), unknown ids last */
export const labelsInDrillOrder = (
    ids: Iterable<number>,
    labels: ReadonlyMap<number, string>,
): string[] => {
    const wanted = new Set(ids);
    const out: string[] = [];
    for (const [id, label] of labels) if (wanted.has(id)) out.push(label);
    for (const id of wanted) if (!labels.has(id)) out.push(`#${id}`);
    return out;
};
