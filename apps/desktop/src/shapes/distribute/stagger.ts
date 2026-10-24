import { NO_STAGGER, type Fraction } from "./distribution";

/**
 * The box's stagger offset as the slider and the command bar see it (#388, spec #385): its
 * detents, snapping, the readout and typed answers. The offset itself is a signed fraction of the
 * across interval (`FilesDistribution.stagger`); `rankOffset` lays it out. Everything is pure.
 */

/** The slider's rests, left to right: 0, ±⅙, ±¼, ±⅓ and ±½ */
export const STAGGER_DETENTS: readonly Fraction[] = [
    [-1, 2],
    [-1, 3],
    [-1, 4],
    [-1, 6],
    [0, 1],
    [1, 6],
    [1, 4],
    [1, 3],
    [1, 2],
];

/** Where the switch turns the stagger on: the usual half-interval stagger */
export const STAGGER_ON: Fraction = [1, 2];

/** A free value (Alt) lands on hundredths of an interval */
export const FREE_STAGGER_STEP = 0.01;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** `[p, q]` in lowest terms, 0 as [0, 1] */
export function reduced([p, q]: Fraction): Fraction {
    if (p === 0) return NO_STAGGER;
    const d = gcd(Math.abs(p), q);
    return [p / d, q / d];
}

export const staggerValue = ([p, q]: Fraction): number => p / q;

const clampHalf = (v: number) => Math.min(0.5, Math.max(-0.5, v));

/** The detent nearest `value` (a fraction of the interval) */
function nearestDetent(value: number): Fraction {
    let best = NO_STAGGER;
    for (const d of STAGGER_DETENTS)
        if (
            Math.abs(staggerValue(d) - value) <
            Math.abs(staggerValue(best) - value)
        )
            best = d;
    return best;
}

/**
 * The stagger for a slider at `value`, held to ±½: the nearest detent, or with `free` (Alt) the
 * nearest hundredth
 */
export function snapStagger(value: number, free: boolean): Fraction {
    const v = clampHalf(value);
    if (!free) return nearestDetent(v);
    return reduced([Math.round(v / FREE_STAGGER_STEP), 1 / FREE_STAGGER_STEP]);
}

/**
 * The slider's arrow keys: the next detent past `now` toward `by`, or with `free` one hundredth
 * further; `now` itself at the end of the range
 */
export function stepStagger(
    now: Fraction,
    by: -1 | 1,
    free: boolean,
): Fraction {
    const v = staggerValue(now);
    if (free) return snapStagger(v + by * FREE_STAGGER_STEP, true);
    const past = STAGGER_DETENTS.filter(
        (d) => (staggerValue(d) - v) * by > 1e-9,
    );
    if (past.length === 0) return reduced(now);
    return by > 0 ? past[0]! : past[past.length - 1]!;
}

const GLYPHS: Readonly<Record<string, string>> = {
    "1/2": "½",
    "1/3": "⅓",
    "2/3": "⅔",
    "1/4": "¼",
    "3/4": "¾",
    "1/5": "⅕",
    "1/6": "⅙",
    "5/6": "⅚",
    "1/8": "⅛",
};

/** Ranks a stagger takes to line up again that the readout still says: a block is rarely deeper */
const LINES_UP_MAX = 12;

/** How much, without a side: "½", "⅓", "5/12", or hundredths as "0.37" */
export function staggerSize(stagger: Fraction): string {
    const [p, q] = reduced(stagger);
    const plain = `${Math.abs(p)}/${q}`;
    if (GLYPHS[plain]) return GLYPHS[plain];
    return q <= LINES_UP_MAX ? plain : String(Math.abs(p) / q);
}

/**
 * The stagger as typed and shown in the command bar: "⅓ right", "½ left", or "0". + is toward the
 * audience's right.
 */
export function staggerAmount(stagger: Fraction): string {
    const [p] = stagger;
    if (p === 0) return "0";
    return `${staggerSize(stagger)} ${p > 0 ? "right" : "left"}`;
}

/** The slider's readout: "⅓ right · lines up every 3 ranks", "Straight" at 0 */
export function staggerReadout(stagger: Fraction): string {
    const [p, q] = reduced(stagger);
    if (p === 0) return "Straight";
    const amount = staggerAmount([p, q]);
    return q <= LINES_UP_MAX ? `${amount} · lines up every ${q} ranks` : amount;
}

const GLYPH_VALUES = new Map(
    Object.entries(GLYPHS).map(([plain, glyph]) => [glyph, plain]),
);

/**
 * A typed stagger: "1/3", "-1/2", "⅓ left", "0.25", "0" or "none"; null when it isn't one or is
 * more than ½. A decimal at a detent is that detent (0.33 is ⅓); any other lands on hundredths.
 */
export function parseStagger(text: string): Fraction | null {
    let t = text.trim().toLowerCase();
    if (t === "") return null;
    if (["none", "off", "straight"].includes(t)) return NO_STAGGER;
    let sign = 1;
    const side = /\s*\b(right|left)$/.exec(t);
    if (side) {
        if (side[1] === "left") sign = -1;
        t = t.slice(0, side.index).trim();
        if (t.startsWith("-") || t.startsWith("+")) return null;
    }
    for (const [glyph, plain] of GLYPH_VALUES) t = t.replace(glyph, plain);
    let f: Fraction | null = null;
    const ratio = /^([+-]?\d+)\s*\/\s*(\d+)$/.exec(t);
    if (ratio) {
        const q = Number(ratio[2]);
        if (q > 0) f = reduced([sign * Number(ratio[1]), q]);
    } else if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) {
        const v = sign * Number(t);
        const detent = nearestDetent(v);
        f =
            Math.abs(staggerValue(detent) - v) < 0.005
                ? detent
                : snapStagger(v, true);
        if (Math.abs(v) > 0.5) f = null;
    }
    if (!f || Math.abs(staggerValue(f)) > 0.5) return null;
    return f;
}
