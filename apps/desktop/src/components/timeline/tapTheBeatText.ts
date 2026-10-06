/**
 * What "Tap the beat" (E6) says, in pages and counts as designers count them. Pure: the caller
 * passes Tolgee's `t`; keys are under `tempo.tapTheBeat`.
 */
import { pageFlags, type FlagPage } from "@/timeline/timelinePlayhead";
import { formatMusicTime, type TapTheBeatPlan } from "@/timeline/tempo";

/** Tolgee's `t` as these helpers use it. */
export type Translate = (
    key: string,
    params?: Record<string, string | number>,
) => string;

const K = "tempo.tapTheBeat";

type NamedPage = FlagPage & { readonly name: string };

/**
 * A count tick named as the transport names it (UI-13, docs/tempo/count-convention.md): "Pg 2 ct
 * 4" for the 4th count after page 2's start, so a page's flag is its last count ("Pg 10 ct 16"),
 * never "page 11, count 1". "the start" for the show's start, "count 40" past the last page.
 */
export function countLabel(
    t: Translate,
    pages: readonly NamedPage[],
    ordinal: number,
): string {
    const flags = pageFlags(pages);
    const box = flags.find(
        (f) => f.range && f.range.start < ordinal && ordinal <= f.range.end,
    );
    if (box?.range)
        return t(`${K}.countOnPage`, {
            page: box.page.name,
            count: ordinal - box.range.start,
        });
    const first = flags.find((f) => f.range)?.range;
    if (ordinal <= 1 || (first && ordinal <= first.start))
        return t(`${K}.countStart`);
    return t(`${K}.countAlone`, { count: ordinal });
}

/** "132": the tempo for people, rounded to a whole count per minute. */
export const perMinute = (bpm: number): string => String(Math.round(bpm));

/**
 * The sentence under the taps: what Apply will do (`applied` false) or did. From the start it
 * names where count 1 lands in the music; from here, the count it starts at. Mentions a synced
 * count that stays put, synced counts the edit moves, and the count limits holding it back.
 */
export function tapPlanSentence({
    t,
    plan,
    pages,
    applied,
    audioOffsetSeconds = 0,
}: {
    t: Translate;
    plan: TapTheBeatPlan;
    pages: readonly NamedPage[];
    applied: boolean;
    /** The audio offset before applying: show time `t` is `t - offset` in the music */
    audioOffsetSeconds?: number;
}): string {
    const bpm = perMinute(plan.bpm);
    const tense = applied ? "applied" : "preview";
    const parts: string[] = [];
    if (plan.fromCount === 1 && plan.originShift !== 0)
        parts.push(
            t(`${K}.start.${tense}`, {
                time: formatMusicTime(plan.originShift - audioOffsetSeconds),
                bpm,
            }),
        );
    else if (plan.fromCount === 1)
        parts.push(t(`${K}.startFlat.${tense}`, { bpm }));
    else
        parts.push(
            t(`${K}.here.${tense}`, {
                count: countLabel(t, pages, plan.fromCount),
                bpm,
            }),
        );
    if (plan.heldFrom !== null)
        parts.push(
            t(`${K}.heldSynced`, {
                count: countLabel(t, pages, plan.heldFrom),
            }),
        );
    if (plan.unsynced.length === 1)
        parts.push(
            t(`${K}.unsyncedOne`, {
                count: countLabel(t, pages, plan.unsynced[0]!),
            }),
        );
    else if (plan.unsynced.length > 1)
        parts.push(t(`${K}.unsyncedMany`, { count: plan.unsynced.length }));
    if (plan.clamped) parts.push(t(`${K}.clamped`));
    return parts.join(" ");
}

/**
 * "The music goes on for 0:42 after the last count." when the music outlasts the counts by more
 * than a count's length, else null.
 */
export function musicPastCountsSentence(
    t: Translate,
    musicSeconds: number | null,
    showSeconds: number,
    period: number,
): string | null {
    if (musicSeconds === null) return null;
    const rest = musicSeconds - showSeconds;
    if (!(rest > period)) return null;
    const whole = Math.round(rest);
    const time = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
    return t(`${K}.musicAfterCounts`, { time });
}
