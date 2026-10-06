/**
 * Which note value is "the count" in a meter.
 *
 * OpenMarch stores no time signature, only one beat (a count) per counted note, each with its
 * own duration. Mixed meter is a measure whose counts are a mix of short and long ones in the
 * ratio 2:3 (an eighth pair and an eighth triple), which is how the desktop app's tempo groups
 * read it back (`measureIsMixedMeter`, `getStrongBeatIndexes`). The rule below picks the counts
 * for a time signature so that a marching band's "one count" lands where a conductor would beat:
 *
 * 1. **Grouping written in the score wins.** `<beats>2+2+3</beats>` gives one count per group:
 *    here two eighth pairs and an eighth triple (short, short, long).
 * 2. **Whole, half and quarter denominators (x/1, x/2, x/4) count the denominator.** 4/4 is four
 *    quarter counts, 2/2 two half-note counts, 3/2 three half-note counts, 6/4 six quarters.
 *    One exception: x/2 counts quarters while the tempo in effect is marked in quarters (a 3/2
 *    bar inside a ♩ = 176 section is six quarter counts; cut time marked half = 120 is two).
 * 3. **Eighths and shorter (x/8, x/16, …) count in groups of 2 and 3 of the denominator.**
 *    - 6/8, 9/8, 12/8 (any multiple of 3) are compound: one dotted-quarter count per three
 *      eighths. 3/8 is one dotted-quarter count.
 *    - 2/8 and 4/8 count in eighth pairs (one and two quarter counts).
 *    - Other numerators have no standard grouping, so one is assumed and reported: 5 → 3+2,
 *      7 → 2+2+3, 8 → 3+3+2, 10 → 3+3+2+2, 11 → 3+3+3+2, and so on (3s first, then 2s).
 *    - 1/8 is a single eighth count.
 * 4. **A composite signature (3/4+3/8)** counts each part by the rules above, in order.
 * 5. **Anything else** (a denominator that isn't a power of two, a numerator that isn't a whole
 *    number, `<senza-misura>`) is not understood. The parser keeps the previous meter and warns.
 */

/** A time signature as OpenMarch counts it. */
export interface Meter {
    /** The signature as written in the file, for example "7/8", "2+2+3/8" or "3/4+3/8" */
    text: string;
    /** The length of each count in quarter notes, in order. 6/8 is [1.5, 1.5] */
    counts: number[];
    /**
     * How the counts group the denominator note, when they aren't all the same length, for
     * example "2+2+3". Undefined for meters whose counts are all equal (4/4, 6/8).
     */
    grouping?: string;
    /** True when the file gave no grouping and `grouping` is the rule's guess */
    assumedGrouping: boolean;
    /** True for an x/2 meter counted in quarters because the tempo is marked in quarters */
    inQuarters?: boolean;
}

/** One `<beats>`/`<beat-type>` pair from a `<time>` element. */
export interface TimeSignaturePart {
    beats: string;
    beatType: string;
}

const isPowerOfTwo = (n: number) =>
    Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;

/**
 * Splits `n` denominator notes into the groups of 2 and 3 a conductor beats (rule 3 above).
 * Multiples of 3 are all 3s; 7 is the conventional 2+2+3; otherwise 3s come first, then 2s.
 */
export function defaultGroups(n: number): number[] {
    if (n <= 0 || !Number.isInteger(n)) return [];
    if (n === 1) return [1];
    if (n === 7) return [2, 2, 3];
    const remainder = n % 3;
    const twos = remainder === 0 ? 0 : remainder === 2 ? 1 : 2;
    const threes = (n - twos * 2) / 3;
    return [...Array(threes).fill(3), ...Array(twos).fill(2)];
}

/** Counts for one `<beats>`/`<beat-type>` pair, or undefined when the rule doesn't cover it. */
function countsForPart(
    part: TimeSignaturePart,
    quarterMarked: boolean,
):
    | {
          groups: number[];
          counts: number[];
          explicit: boolean;
          inQuarters?: boolean;
      }
    | undefined {
    const beatType = Number(part.beatType.trim());
    if (!isPowerOfTwo(beatType)) return undefined;
    const terms = part.beats
        .trim()
        .split("+")
        .map((t) => Number(t.trim()));
    if (terms.length === 0 || terms.some((t) => !Number.isInteger(t) || t <= 0))
        return undefined;
    const quartersPerNote = 4 / beatType;

    // Rule 1: the score's own grouping
    if (terms.length > 1)
        return {
            groups: terms,
            counts: terms.map((t) => t * quartersPerNote),
            explicit: true,
        };

    const n = terms[0]!;
    // Rule 2: whole, half and quarter denominators count the denominator
    if (beatType === 2 && quarterMarked)
        return {
            groups: Array(n * 2).fill(1),
            counts: Array(n * 2).fill(1),
            explicit: false,
            inQuarters: true,
        };
    if (beatType <= 4)
        return {
            groups: Array(n).fill(1),
            counts: Array(n).fill(quartersPerNote),
            explicit: false,
        };

    // Rule 3: eighths and shorter count in groups of 2 and 3
    const groups = defaultGroups(n);
    return {
        groups,
        counts: groups.map((g) => g * quartersPerNote),
        explicit: false,
    };
}

/**
 * The meter for a `<time>` element's signature parts, or undefined when it isn't understood
 * (rule 5). See the module comment for the counting rule.
 */
export function meterFromTimeSignature(
    parts: TimeSignaturePart[],
    { quarterMarked = false }: { quarterMarked?: boolean } = {},
): Meter | undefined {
    if (parts.length === 0) return undefined;
    const counts: number[] = [];
    const groups: number[] = [];
    let assumedGrouping = false;
    let inQuarters = false;
    for (const part of parts) {
        const result = countsForPart(part, quarterMarked);
        if (!result) return undefined;
        if (result.inQuarters) inQuarters = true;
        counts.push(...result.counts);
        groups.push(...result.groups);
        const mixed = new Set(result.groups).size > 1;
        if (!result.explicit && mixed) assumedGrouping = true;
    }
    const text = parts
        .map((p) => `${p.beats.replace(/\s+/g, "")}/${p.beatType.trim()}`)
        .join("+");
    const allEqual = counts.every((c) => c === counts[0]);
    return {
        text,
        counts,
        grouping: allEqual ? undefined : groups.join("+"),
        assumedGrouping,
        ...(inQuarters ? { inQuarters } : {}),
    };
}

/** The meter's total length in quarter notes. */
export const meterLength = (meter: Meter) =>
    meter.counts.reduce((sum, c) => sum + c, 0);

/** Meter for a file with no time signature before its first measure: 4/4. */
export const DEFAULT_METER: Meter = {
    text: "4/4",
    counts: [1, 1, 1, 1],
    assumedGrouping: false,
};
