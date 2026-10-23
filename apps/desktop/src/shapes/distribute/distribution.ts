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

/**
 * Outline (#390) and Even spread (#391) are declared so kinds and the mode switch can name them;
 * their tickets add their settings. Until then the distributor lays them out as Files.
 */
export interface OutlineDistribution {
    readonly mode: "outline";
}

export interface SpreadDistribution {
    readonly mode: "spread";
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
    if (mode === "outline" || mode === "spread") return { mode };
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

/** The distribution a shape switched to `mode` starts with; Files takes `files` across */
export function distributionFor(
    mode: DistributionMode,
    files: number,
): Distribution {
    return mode === "files" ? filesDistribution(files) : { mode };
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
