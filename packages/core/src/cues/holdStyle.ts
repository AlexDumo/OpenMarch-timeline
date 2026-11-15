/**
 * The hold style: what a performer's feet do on counts where their dot
 * doesn't travel. It is not a cue (ADR 0015 D-1): it comes from the show
 * setting, and the compile hands it out beside the cue types.
 */
import type {
    CompileInput,
    CueMarcher,
    HoldStyleSpan,
    HoldTechnique,
} from "./types";

/** Items (props, equipment with its own row) are never performers. */
export const isItem = (marcher: CueMarcher) =>
    marcher.type === "prop" || marcher.type === "equipment";

/** What the hold style reads of the compile's input. */
export type HoldStyleInput = Pick<
    CompileInput,
    "beats" | "marchers" | "showDefaults" | "travels" | "bandTravels"
>;

/** Whether any performer travels on each count, from `bandTravels` or else `travels`. */
function bandTravelsByCount(input: HoldStyleInput): boolean[] | null {
    const counts = input.beats.length;
    if (input.bandTravels) {
        const bandTravels = input.bandTravels;
        return Array.from({ length: counts }, (_, c) => bandTravels(c));
    }
    const travels = input.travels;
    if (!travels) return null;
    const performers = input.marchers.filter((m) => !isItem(m));
    return Array.from({ length: counts }, (_, c) =>
        performers.some((m) => travels(m.id, c)),
    );
}

/**
 * The show's hold style on each count: a holding performer marks time (or the
 * show's `holdWhileBandMoves`) on counts where any performer travels, and
 * stands where the whole band holds. The style only matters on counts the
 * performer's own dot doesn't travel.
 */
function showHoldTechniques(input: HoldStyleInput): HoldTechnique[] {
    const moving = input.showDefaults?.holdWhileBandMoves ?? "markTime";
    const band = moving === "stand" ? null : bandTravelsByCount(input);
    return Array.from({ length: input.beats.length }, (_, c) =>
        band?.[c] ? moving : "stand",
    );
}

/** The spans of a hold style given per count: a new span wherever it changes. */
function holdSpans(onHolds: readonly HoldTechnique[]): HoldStyleSpan[] {
    const spans: HoldStyleSpan[] = [];
    onHolds.forEach((style, c) => {
        const last = spans[spans.length - 1];
        if (last && last.style === style) last.to = c + 1;
        else spans.push({ from: c, to: c + 1, style });
    });
    return spans.length > 0
        ? spans
        : [{ from: 0, to: onHolds.length, style: "stand" }];
}

/**
 * Each performer's hold style over the show. Every performer gets the show's
 * (the same spans, shared), so `of` answers for any marcher id.
 */
export function holdStyles(input: HoldStyleInput): {
    of(marcherId: number): readonly HoldStyleSpan[];
} {
    const show = holdSpans(showHoldTechniques(input));
    return { of: () => show };
}

/** The hold style at count `count`; `stand` outside the spans. */
export function holdStyleAt(
    spans: readonly HoldStyleSpan[],
    count: number,
): HoldTechnique {
    for (const span of spans)
        if (span.from <= count && count < span.to) return span.style;
    return "stand";
}
