/**
 * One name for a place in the show (tempo decision D6, docs/tempo/decisions.md DN-2): the
 * transport's readout, Align's chips, the synced toast, Tap the beat's sentences and the punch-in
 * chip all name a moment with these functions, so one count never has two names.
 *
 * Counts follow docs/tempo/count-convention.md: count k of a page is the k-th beat line after its
 * start, so a page's flag is its last count. A flag is also where the next page starts, and
 * people think of it both ways ("the move lands on count 16 of page 11", "page 12 starts at C"),
 * so a flag is named both ways, with the rehearsal letter on its downbeat first:
 * "C · end of Pg 10 · Pg 11 starts". Inside a page: "Pg 2 · ct 7/16". Where space is tight:
 * "Pg 11 ct 16 → 12" and "Pg 2 ct 7".
 *
 * Positions are whole beat lines in any one numbering (view beats, or Align's count indexes), as
 * long as pages and measures use the same one.
 */

/** A timed page's counts: its box runs from `start` to its flag at `end` */
export interface PlacePage {
    readonly label: string;
    readonly start: number;
    readonly end: number;
    /** The rehearsal mark on the flag's downbeat, when the caller has no measures to pass */
    readonly flagMark?: string | null;
}

/** A measure line: the line its downbeat is on, its number and its rehearsal mark */
export interface PlaceMeasure {
    readonly at: number;
    readonly number: string;
    readonly rehearsalMark?: string | null;
}

/** Where a beat line is, before it is written down */
export type Place =
    | { readonly kind: "start" }
    | {
          /** Inside a page's box, before its flag */
          readonly kind: "count";
          readonly page: string;
          readonly count: number;
          /** The page's counts, when it has a flag */
          readonly total?: number;
      }
    | {
          /** On a page's flag: its last count, where the next page (if any) starts */
          readonly kind: "flag";
          readonly page: string;
          readonly count: number;
          readonly next: string | null;
          /** The rehearsal mark on the flag's downbeat */
          readonly mark: string | null;
      }
    | {
          /** Past the last flag, `count` counts after it */
          readonly kind: "after";
          readonly page: string;
          readonly count: number;
      };

/** "full" where a name has room; "compact" in tight places (the narrow readout, tags) */
export type PlaceStyle = "full" | "compact";

const markOf = (mark: string | null | undefined) => mark?.trim() || null;

/** The rehearsal mark whose measure starts on line `at`, if any */
export const markAt = (
    measures: readonly PlaceMeasure[] | undefined,
    at: number,
): string | null =>
    markOf(
        measures?.find((m) => m.at === at && markOf(m.rehearsalMark))
            ?.rehearsalMark,
    );

/** Where beat line `at` is among `pages` (sorted or not) */
export function placeAt(
    pages: readonly PlacePage[],
    at: number,
    measures?: readonly PlaceMeasure[],
): Place {
    const sorted = [...pages].sort((a, b) => a.start - b.start);
    const page = sorted.find((p) => p.start < at && at <= p.end);
    if (!page) {
        const last = sorted[sorted.length - 1];
        return last && at > last.end
            ? { kind: "after", page: last.label, count: at - last.end }
            : { kind: "start" };
    }
    const count = at - page.start;
    if (at === page.end)
        return {
            kind: "flag",
            page: page.label,
            count,
            next:
                sorted.find((p) => p !== page && p.start === at)?.label ?? null,
            mark: markAt(measures, at) ?? markOf(page.flagMark),
        };
    return {
        kind: "count",
        page: page.label,
        count,
        total: page.end - page.start,
    };
}

/**
 * A place as it is written: "C · end of Pg 10 · Pg 11 starts", "end of Pg 6" (the last flag),
 * "Pg 2 · ct 7/16", "the start", "After pg 4 · +4"; compact, "C · Pg 10 ct 16 → 11" and
 * "Pg 2 ct 7".
 */
export function formatPlace(place: Place, style: PlaceStyle = "full"): string {
    switch (place.kind) {
        case "start":
            return "the start";
        case "after":
            return style === "compact"
                ? `Pg ${place.page} +${place.count}`
                : `After pg ${place.page} · +${place.count}`;
        case "count":
            return style === "compact"
                ? `Pg ${place.page} ct ${place.count}`
                : `Pg ${place.page} · ct ${place.count}${place.total != null ? `/${place.total}` : ""}`;
        case "flag": {
            const letter = place.mark ? `${place.mark} · ` : "";
            if (style === "compact")
                return `${letter}Pg ${place.page} ct ${place.count}${place.next ? ` → ${place.next}` : ""}`;
            return `${letter}end of Pg ${place.page}${place.next ? ` · Pg ${place.next} starts` : ""}`;
        }
    }
}

/** A place for screen readers: "Rehearsal C, end of page 10, page 11 starts" */
export function spokenPlace(place: Place): string {
    switch (place.kind) {
        case "start":
            return "The start";
        case "after":
            return `${place.count} counts after page ${place.page}`;
        case "count":
            return `Page ${place.page}, count ${place.count}${place.total != null ? ` of ${place.total}` : ""}`;
        case "flag":
            return `${place.mark ? `Rehearsal ${place.mark}, end` : "End"} of page ${place.page}, count ${place.count}${place.next ? `, page ${place.next} starts` : ""}`;
    }
}

/** Beat line `at` named among `pages`, as everywhere else names it (D6) */
export const placeName = (
    pages: readonly PlacePage[],
    at: number,
    {
        measures,
        style = "full",
    }: { measures?: readonly PlaceMeasure[]; style?: PlaceStyle } = {},
): string => formatPlace(placeAt(pages, at, measures), style);

/**
 * The beat starting on line `at` in the music, "m5 beat 4", or null before the first measure. A
 * line is named by the beat that starts on it, as the readout names it.
 */
export function musicAt(
    measures: readonly PlaceMeasure[] | undefined,
    at: number,
): string | null {
    let measure: PlaceMeasure | undefined;
    for (const m of measures ?? [])
        if (m.at <= at && (!measure || m.at > measure.at)) measure = m;
    return measure ? `m${measure.number} beat ${at - measure.at + 1}` : null;
}

/**
 * The view model's measure markers as places, shifted by `offset` (Align's count index is the
 * view beat plus its offset)
 */
export const placeMeasures = (
    measures: readonly {
        readonly atBeat: number;
        readonly label: string;
        readonly rehearsalMark?: string | null;
    }[],
    offset = 0,
): PlaceMeasure[] =>
    measures.map((m) => ({
        at: m.atBeat + offset,
        number: m.label.replace(/^m/i, ""),
        rehearsalMark: m.rehearsalMark ?? null,
    }));
