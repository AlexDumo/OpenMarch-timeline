/**
 * What "Tap the beat" (E6) says, in pages and counts as designers count them. Pure.
 */
import { pageFlags, type FlagPage } from "@/timeline/timelinePlayhead";
import { formatMusicTime, type TapTheBeatPlan } from "@/timeline/tempo";

/** "page 2, count 5" for count `ordinal` (a beat index); "count 5" when no page box holds it. */
export function countLabel(
    pages: readonly (FlagPage & { readonly name: string })[],
    ordinal: number,
): string {
    const box = pageFlags(pages).find(
        (f) => f.range && f.range.start <= ordinal && ordinal < f.range.end,
    );
    return box?.range
        ? `page ${box.page.name}, count ${ordinal - box.range.start + 1}`
        : `count ${ordinal}`;
}

/** "132": the tempo for people, rounded to a whole count per minute. */
export const perMinute = (bpm: number): string => String(Math.round(bpm));

/**
 * The sentence under the taps: what Apply will do (`applied` false) or did. From the start it
 * names where count 1 lands in the music; from here, the count it starts at. Mentions a synced
 * count that stays put, synced counts the edit moves, and the count limits holding it back.
 */
export function tapPlanSentence({
    plan,
    pages,
    applied,
    audioOffsetSeconds = 0,
}: {
    plan: TapTheBeatPlan;
    pages: readonly (FlagPage & { readonly name: string })[];
    applied: boolean;
    /** The audio offset before applying: show time `t` is `t - offset` in the music */
    audioOffsetSeconds?: number;
}): string {
    const tempo = `about ${perMinute(plan.bpm)} per minute`;
    const parts: string[] = [];
    if (plan.fromCount === 1 && plan.originShift !== 0) {
        const at = formatMusicTime(plan.originShift - audioOffsetSeconds);
        parts.push(
            applied
                ? `Count 1 is at ${at} in the music, and counts run at ${tempo}.`
                : `Count 1 will start at ${at} in the music, and counts will run at ${tempo}.`,
        );
    } else if (plan.fromCount === 1) {
        parts.push(
            applied
                ? `Counts run at ${tempo} from the start.`
                : `Counts will run at ${tempo} from the start.`,
        );
    } else {
        const from = countLabel(pages, plan.fromCount);
        parts.push(
            applied
                ? `From ${from}, counts run at ${tempo}. Earlier counts didn't change.`
                : `From ${from}, counts will run at ${tempo}. Earlier counts stay as they are.`,
        );
    }
    if (plan.heldFrom !== null)
        parts.push(
            `${capitalize(countLabel(pages, plan.heldFrom))} is synced, so it and everything after it stay on the music.`,
        );
    if (plan.unsynced.length > 0)
        parts.push(
            plan.unsynced.length === 1
                ? `${capitalize(countLabel(pages, plan.unsynced[0]!))} was synced and moves with the taps.`
                : `${plan.unsynced.length} synced counts move with the taps.`,
        );
    if (plan.clamped)
        parts.push(
            "Some counts would be too fast or too slow, so they were kept within limits.",
        );
    return parts.join(" ");
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * "The music goes on for 0:42 after the last count." when the music outlasts the counts by more
 * than a count's length, else null.
 */
export function musicPastCountsSentence(
    musicSeconds: number | null,
    showSeconds: number,
    period: number,
): string | null {
    if (musicSeconds === null) return null;
    const rest = musicSeconds - showSeconds;
    if (!(rest > period)) return null;
    const whole = Math.round(rest);
    const text = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
    return `The music goes on for ${text} after the last count.`;
}
