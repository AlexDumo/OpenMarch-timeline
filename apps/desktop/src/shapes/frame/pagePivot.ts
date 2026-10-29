import { isPivot, type Pivot } from "./frame";
import { pivotOf } from "./pivot";

/**
 * A pivot per page (owner, option C on #492): a shape shown on later pages, carried there from the
 * page its recipe belongs to, can have its pivot changed on one of those pages alone. The page's
 * pivot lives in the recipe's params as `pagePivots`, by page id, beside the recipe's own `pivot`
 * (its own page's). Nobody is set on that page, so the page keeps following the earlier page's
 * other edits. A later page uses the most recent earlier page's pivot unless it has its own, like
 * positions. Everything here is pure.
 */

/** Pivots by page id (JSON keys are strings) */
export type PagePivots = Readonly<Record<string, Pivot>>;

/** A page's box, the previous flag to its own flag, in spec beats */
export interface PivotPage {
    readonly id: number;
    readonly start: number;
    readonly end: number;
}

const EPS = 1e-9;

/** The page pivots stored in `params`, leaving out any that aren't pivots */
export function pagePivotsOf(params: unknown): PagePivots {
    const stored =
        typeof params === "object" && params !== null
            ? (params as { pagePivots?: unknown }).pagePivots
            : undefined;
    if (typeof stored !== "object" || stored === null) return {};
    return Object.fromEntries(
        Object.entries(stored).filter(([, pivot]) => isPivot(pivot)),
    ) as PagePivots;
}

/**
 * The page a shape whose recipe ends at `endBeat` can have a pivot of its own on, seen at `beat`:
 * the page holding `beat` (a page's flag is its own), when it starts at or after `endBeat`. Null on
 * the recipe's own page, or past the last flag.
 */
export function pivotPageAt(
    pages: readonly PivotPage[],
    endBeat: number,
    beat: number,
): number | null {
    const page = pages.find((p) => p.start < beat - EPS && beat <= p.end + EPS);
    return page && page.start >= endBeat - EPS ? page.id : null;
}

/**
 * The pivot a shape shows at `beat`: the page pivot of the latest page after its recipe's own
 * (`endBeat`) that starts before `beat` and has one, or else the recipe's own
 */
export function pivotAtBeat(
    params: unknown,
    pages: readonly PivotPage[],
    endBeat: number,
    beat: number,
): Pivot {
    const own = pagePivotsOf(params);
    let latest: { start: number; pivot: Pivot } | null = null;
    for (const p of pages) {
        const pivot = own[String(p.id)];
        if (
            pivot !== undefined &&
            p.start >= endBeat - EPS &&
            p.start < beat - EPS &&
            (!latest || p.start > latest.start)
        )
            latest = { start: p.start, pivot };
    }
    return latest ? latest.pivot : pivotOf(params);
}

/** `params` without `pagePivots`: what a kind and the editor see */
export function withoutPagePivots<P>(params: P): P {
    if (typeof params !== "object" || params === null) return params;
    if (!("pagePivots" in params)) return params;
    const { pagePivots: _, ...rest } = params as P & { pagePivots?: unknown };
    return rest as P;
}

/** `params` with `stored`'s page pivots, so a save keeps them */
export function keepPagePivots<P>(stored: unknown, params: P): P {
    const pivots = pagePivotsOf(stored);
    if (Object.keys(pivots).length === 0) return withoutPagePivots(params);
    return { ...params, pagePivots: pivots };
}

/**
 * `edited` (the shape as changed on `page`, a later page than its recipe's own) saved back into
 * its recipe, whose params are `stored`: its pivot becomes `page`'s, and the recipe's own pivot
 * and every other page's stay as stored
 */
export function withPagePivot<P>(edited: P, stored: unknown, page: number): P {
    const base =
        typeof stored === "object" && stored !== null
            ? (stored as { pivot?: unknown }).pivot
            : undefined;
    return {
        ...edited,
        pivot: base,
        pagePivots: {
            ...pagePivotsOf(stored),
            [String(page)]: pivotOf(edited),
        },
    };
}
