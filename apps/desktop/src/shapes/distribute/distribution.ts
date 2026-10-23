import { SPREAD_GENERATOR } from "../geometry/naturalFill";

/**
 * How a closed shape is filled (spec #385): one host-owned object in a recipe's `params`, beside
 * the kind's own numbers (ADR 0006, 2026-10-22 amendment). A closed kind only describes its region
 * (`region.ts`); the host's distributor (`distribute.ts`) lays the spots out in one of these modes.
 * Everything here is pure.
 */

/** The ways a closed shape can be filled, in the order the mode switch shows them */
export const DISTRIBUTION_MODES = ["files", "outline", "spread"] as const;

export type DistributionMode = (typeof DISTRIBUTION_MODES)[number];

/** What the mode switch and the command bar call each mode */
export const MODE_LABELS: Readonly<Record<DistributionMode, string>> = {
    files: "Files",
    outline: "Outline",
    spread: "Spread",
};

/**
 * A fraction of an interval, `[p, q]` for p/q, so ⅓ round-trips exactly. `q` is a whole number
 * above 0 and `p` a whole number.
 */
export type Fraction = readonly [number, number];

export const NO_STAGGER: Fraction = [0, 1];

/**
 * Which rows of a full block a Files layout keeps (#387 adds the rest of the catalogue: Full,
 * Stagger, Rounded, Notched). Short back is today's box: full ranks, the back one short and
 * centered.
 */
export type LayoutFamily = "shortBack";

export interface FilesLayout {
    readonly family: LayoutFamily;
    /** Marchers across a full rank (a full file when `byFile`) */
    readonly files: number;
    /** Turned: the rows run front to back, as files, instead of side to side */
    readonly byFile: boolean;
}

/** Ranks and files at the kind's intervals, every rank offset by the stagger */
export interface FilesDistribution {
    readonly mode: "files";
    readonly layout: FilesLayout;
    /**
     * The signed stagger offset, a fraction of the across interval: rank r (0 the front) moves
     * r·s, wrapped to ±½. + is toward the audience's right (screen right with the front at the
     * bottom).
     */
    readonly stagger: Fraction;
}

/** A side of a shape with corners, in its own frame: the back is away from the audience */
export type GapSide = "back" | "front" | "left" | "right";

export const GAP_SIDES: readonly GapSide[] = ["back", "front", "left", "right"];

/**
 * Where an odd-count outline leaves its one spot out (#390): a spot between the corners of
 * `side`, `at` intervals from its start (left to right on the back and front, front to back on
 * the left and right), or the middle when null. With `style` "spread" that side's spots spread
 * evenly between its corners instead of leaving a gap.
 */
export interface OddGap {
    readonly side: GapSide;
    readonly at: number | null;
    readonly style: "gap" | "spread";
}

/**
 * The back, spread evenly: leaving a gap is the rare case (owner, lab feedback on box-outline,
 * 2026-10-23)
 */
export const DEFAULT_ODD_GAP: OddGap = {
    side: "back",
    at: null,
    style: "spread",
};

/** Spots around the edge at the interval, one on every corner */
export interface OutlineDistribution {
    readonly mode: "outline";
    /** Which spot an odd count leaves out; an even count leaves none */
    readonly oddGap: OddGap;
}

/**
 * Even spread (#391): a seeded scatter with no visible files, the closest pair one interval
 * apart. Reshuffle moves to the next seed.
 */
export interface SpreadDistribution {
    readonly mode: "spread";
    /** Which layout: a whole number from 1; the same one gives the same spots */
    readonly seed: number;
    /** The algorithm that laid it out (`SPREAD_GENERATOR`); another reads as plain positions */
    readonly generator: number;
    /**
     * The count the seed was laid out for. At another count the spots relax from that layout
     * rather than reshuffle, so adding or removing a marcher nudges the spread. Absent: the
     * count it's laid out at.
     */
    readonly count?: number;
}

export type Distribution =
    | FilesDistribution
    | OutlineDistribution
    | SpreadDistribution;

/** Files, Short back with `files` across, no stagger: what a recipe with no distribution reads as */
export function filesDistribution(files: number): FilesDistribution {
    return {
        mode: "files",
        layout: { family: "shortBack", files, byFile: false },
        stagger: NO_STAGGER,
    };
}

const isWhole = (v: unknown): v is number =>
    typeof v === "number" && Number.isInteger(v);

/** A stagger as stored, or no stagger when it isn't one */
function readFraction(v: unknown): Fraction {
    if (!Array.isArray(v) || v.length !== 2) return NO_STAGGER;
    const [p, q] = v as unknown[];
    return isWhole(p) && isWhole(q) && q > 0 ? [p, q] : NO_STAGGER;
}

/**
 * The distribution `params` stores, read defensively (recipes come from files): undefined when it
 * has none, or one this version doesn't know, which reads as the kind's default.
 * `files` is the kind's own file count, which a Files layout without a usable one takes.
 */
export function storedDistribution(
    params: unknown,
    files: number,
): Distribution | undefined {
    const d = (params as { distribution?: unknown } | null)?.distribution;
    if (!d || typeof d !== "object") return undefined;
    const mode = (d as { mode?: unknown }).mode;
    if (mode === "outline")
        return {
            mode,
            oddGap: readOddGap((d as { oddGap?: unknown }).oddGap),
        };
    if (mode === "spread") return readSpread(d);
    if (mode !== "files") return undefined;
    const layout = (d as { layout?: Partial<FilesLayout> }).layout;
    return {
        mode: "files",
        layout: {
            family: "shortBack",
            files:
                isWhole(layout?.files) && layout.files >= 1
                    ? layout.files
                    : files,
            byFile: layout?.byFile === true,
        },
        stagger: readFraction((d as { stagger?: unknown }).stagger),
    };
}

/** An outline's gap as stored, each part that isn't one read as the default's */
function readOddGap(v: unknown): OddGap {
    const g = (v ?? {}) as Partial<Record<keyof OddGap, unknown>>;
    return {
        side: GAP_SIDES.includes(g.side as GapSide)
            ? (g.side as GapSide)
            : DEFAULT_ODD_GAP.side,
        at: isWhole(g.at) && g.at >= 1 ? g.at : null,
        style: g.style === "gap" ? "gap" : DEFAULT_ODD_GAP.style,
    };
}

/**
 * A stored spread, or undefined when this app doesn't have its generator (a newer app's), which
 * then can't be laid out: see {@link canLayOut}
 */
function readSpread(d: object): SpreadDistribution | undefined {
    const { seed, generator, count } = d as Partial<Record<string, unknown>>;
    if (generator !== SPREAD_GENERATOR) return undefined;
    return {
        mode: "spread",
        seed: isWhole(seed) && seed >= 1 ? seed : 1,
        generator,
        ...(isWhole(count) && count >= 1 && { count }),
    };
}

/**
 * Whether `params` can be laid out again: false for a spread from a generator this app doesn't
 * have (ADR 0006, 2026-10-22 amendment, point 4), whose recipe shows as plain positions
 */
export function canLayOut(params: unknown): boolean {
    const d = (params as { distribution?: unknown } | null)?.distribution;
    if (!d || typeof d !== "object") return true;
    return (
        (d as { mode?: unknown }).mode !== "spread" ||
        readSpread(d) !== undefined
    );
}

/** A spread of `n` spots at `seed` */
export const spreadDistribution = (
    seed: number,
    n: number,
): SpreadDistribution => ({
    mode: "spread",
    seed,
    generator: SPREAD_GENERATOR,
    count: Math.max(1, n),
});

/** Reshuffle: the next seed, laid out for the `n` spots there are now */
export const reshuffled = (
    d: SpreadDistribution,
    n: number,
): SpreadDistribution => spreadDistribution(d.seed + 1, n);

/**
 * The distribution a shape of `n` spots switched to `mode` starts with: Files takes `files`
 * across, a spread starts at seed 1
 */
export function distributionFor(
    mode: DistributionMode,
    files: number,
    n: number,
): Distribution {
    if (mode === "files") return filesDistribution(files);
    if (mode === "outline") return { mode, oddGap: DEFAULT_ODD_GAP };
    return spreadDistribution(1, n);
}

/**
 * The stagger offset of rank `r` (0 the front), as a fraction of the across interval: r·s
 * wrapped to ±½, so no rank sticks out more than half an interval. At exactly ±½ the sign of s
 * picks the side. Whole-number arithmetic, so ⅓ and ⅙ land exactly.
 */
export function rankOffset(r: number, [p, q]: Fraction): number {
    if (p === 0) return 0;
    const m = r * p;
    let w = m - q * Math.round(m / q);
    if (2 * Math.abs(w) === q) w = (Math.sign(p) * q) / 2;
    return w / q;
}
