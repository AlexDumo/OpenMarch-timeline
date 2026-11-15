import type { AssignMarcher } from "../assign";
import { groupAt } from "../group/groupGeometry";
import { groupTool } from "../group/groupTool";
import { pivotByHand } from "../frame/gestures";
import { leastTravelOnto } from "../leastTravel";
import { PLACED_KINDS, placedOf, type PlacedBox } from "../placed/placedBox";
import type { AnyToolKind, ToolKind } from "../tool/toolKind";
import type { GroupParams } from "../group/groupGeometry";
import type { XY } from "../types";

/**
 * A copied picture (#961): where a selection of marchers stood, to paste onto other marchers.
 * Pasting rearranges the marchers selected then; it never adds any, and the picture doesn't say
 * who stood where. Everything here is pure.
 *
 * It's kept by the app, not on the system clipboard (`pictureStore.ts`), and its `version` is
 * checked when it's read back, so the format can change.
 */
export interface CopiedPicture {
    readonly version: typeof PICTURE_VERSION;
    /** Field units per step on the field it was copied from, so it keeps its size in steps */
    readonly stepPx: number;
    /** Where each copied marcher stood, in field units: what loose dots paste as */
    readonly dots: readonly XY[];
    /** The placed shape, when the selection was exactly one: it pastes as a shape of its kind */
    readonly shape?: CopiedShape;
}

/** A placed shape as copied: its recipe's kind and params, without its spot count or members */
export interface CopiedShape {
    readonly kind: string;
    readonly kindVersion: number;
    readonly params: unknown;
}

export const PICTURE_VERSION = 1;

/**
 * Loose dots as the paste preview shows them (#961): the group kind's geometry, so they move,
 * turn, flip and scale like any open shape, but placed as plain marchers with no recipe. Who goes
 * where can be worked out again, unlike a group made where its marchers stand.
 */
export const dotsTool: ToolKind<GroupParams> = {
    ...groupTool,
    asIs: false,
    loose: true,
};

/** A copied group as the paste preview shows it: placed as a group, who goes where worked out */
export const pastedGroupTool: ToolKind<GroupParams> = {
    ...groupTool,
    asIs: false,
};

/**
 * The picture a selection copies: `shape` when it's exactly one placed shape (its members the
 * marchers standing at `positions`), loose dots otherwise. Null with nobody to copy.
 */
export function pictureOf({
    positions,
    shape,
    stepPx,
}: {
    positions: readonly XY[];
    shape: Pick<PlacedBox, "recipe" | "params"> | null;
    stepPx: number;
}): CopiedPicture | null {
    if (positions.length === 0) return null;
    return {
        version: PICTURE_VERSION,
        stepPx,
        dots: positions.map((p) => ({ x: p.x, y: p.y })),
        ...(shape && {
            shape: {
                kind: shape.recipe.kind,
                kindVersion: shape.recipe.kindVersion,
                params: shape.params,
            },
        }),
    };
}

const isPoint = (v: unknown): v is XY =>
    typeof v === "object" &&
    v !== null &&
    Number.isFinite((v as XY).x) &&
    Number.isFinite((v as XY).y);

/** A picture read back from storage; null for anything this app can't paste */
export function readPicture(stored: unknown): CopiedPicture | null {
    if (typeof stored !== "object" || stored === null) return null;
    const { version, stepPx, dots, shape } = stored as Partial<CopiedPicture>;
    if (version !== PICTURE_VERSION) return null;
    if (!(typeof stepPx === "number" && stepPx > 0)) return null;
    if (!Array.isArray(dots) || dots.length === 0 || !dots.every(isPoint))
        return null;
    const kept =
        typeof shape === "object" &&
        shape !== null &&
        typeof shape.kind === "string" &&
        typeof shape.kindVersion === "number" &&
        typeof shape.params === "object" &&
        shape.params !== null
            ? shape
            : undefined;
    return {
        version,
        stepPx,
        dots: dots.map((p) => ({ x: p.x, y: p.y })),
        ...(kept && {
            shape: {
                kind: kept.kind,
                kindVersion: kept.kindVersion,
                params: kept.params,
            },
        }),
    };
}

/** What a paste opens: the shape to preview and the marchers who take its spots */
export interface PastePlan {
    readonly kind: AnyToolKind;
    readonly params: unknown;
    /** The receiving marchers who take a spot, in the order they were given */
    readonly marchers: readonly AssignMarcher[];
    /** Whether the shape's pivot was moved by hand, so the preview keeps it */
    readonly pivotMoved: boolean;
    /** How many receiving marchers have no spot: loose dots pasted onto more marchers than dots */
    readonly left: number;
}

/** Sizes within this of each other are the same step size */
const SAME_STEP = 1e-6;

const middle = (points: readonly XY[]): XY => {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    return {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
};

/**
 * How far a picture whose middle is `from` moves to sit on the receiving marchers: onto the
 * middle of where they stand, in whole half steps, so every spot keeps its place on the grid.
 * Nowhere for a paste in place.
 */
function shift(
    from: XY,
    marchers: readonly AssignMarcher[],
    stepPx: number,
    inPlace: boolean,
): XY {
    if (inPlace) return { x: 0, y: 0 };
    const to = middle(marchers.map((m) => m.at));
    const half = stepPx / 2;
    return {
        x: Math.round((to.x - from.x) / half) * half,
        y: Math.round((to.y - from.y) / half) * half,
    };
}

const startOf = (m: AssignMarcher): XY => m.from ?? m.at;

/**
 * What pasting `picture` onto `marchers` opens (#961, owner 2026-11-15). The preview starts
 * centered on the receiving marchers, or where it was copied for a paste `inPlace`.
 *
 * - A **shape** keeps its kind, spacing and settings and is laid out for the receiving count, as
 *   if it had been drawn with that many selected.
 * - **Loose dots** (and a group, whose spots have no rule either) only fill spots. With fewer
 *   marchers than dots, the dots that give the shortest total walk are used; with more, the
 *   marchers with the shortest total walk take the dots and the rest are left where they are.
 *
 * A shape this app can't lay out (a newer kind, or a picture from a field with another step size)
 * pastes as loose dots, kept the same size in steps. Null with nobody to paste onto.
 */
export function planPaste({
    picture,
    marchers,
    stepPx,
    inPlace = false,
    kinds = PLACED_KINDS,
}: {
    picture: CopiedPicture;
    /** The receiving marchers, where they stand and where they start the move */
    marchers: readonly AssignMarcher[];
    /** Field units per step on the field pasted onto */
    stepPx: number;
    inPlace?: boolean;
    kinds?: readonly AnyToolKind[];
}): PastePlan | null {
    const n = marchers.length;
    if (n === 0) return null;
    const scale = stepPx / picture.stepPx;
    const sameStep = Math.abs(scale - 1) <= SAME_STEP;
    const read =
        picture.shape && sameStep
            ? placedOf({ id: 0, ...picture.shape, members: [] }, kinds)
            : null;

    if (read && read.kind !== groupTool) {
        const { kind, params } = read;
        const frame = kind.frameOf(params, n);
        const by = shift(frame.center, marchers, stepPx, inPlace);
        const moved =
            by.x === 0 && by.y === 0
                ? params
                : kind.withFrame(params, n, {
                      ...frame,
                      center: {
                          x: frame.center.x + by.x,
                          y: frame.center.y + by.y,
                      },
                  });
        return {
            kind,
            params: moved,
            marchers,
            pivotMoved: pivotByHand(kind, moved),
            left: 0,
        };
    }

    // Loose dots: the same spot in steps on a field with another step size
    const copied = sameStep
        ? picture.dots
        : picture.dots.map((p) => ({ x: p.x * scale, y: p.y * scale }));
    const by = shift(middle(copied), marchers, stepPx, inPlace);
    const dots = copied.map((p) => ({ x: p.x + by.x, y: p.y + by.y }));
    const kind = read ? pastedGroupTool : dotsTool;
    const starts = marchers.map(startOf);

    if (n <= dots.length) {
        // The dots that give the shortest walk; all of them with as many marchers as dots
        const used =
            n === dots.length
                ? dots
                : leastTravelOnto(starts, dots).map((spot) => dots[spot]!);
        return {
            kind,
            params: groupAt(used),
            marchers,
            pivotMoved: false,
            left: 0,
        };
    }

    // More marchers than dots: the marchers with the shortest walk take them
    const taking = new Set(leastTravelOnto(dots, starts));
    return {
        kind,
        params: groupAt(dots),
        marchers: marchers.filter((_, i) => taking.has(i)),
        pivotMoved: false,
        left: n - dots.length,
    };
}
