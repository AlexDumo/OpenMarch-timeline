/**
 * What "Tap the beat" (E6) says, in pages and counts as designers count them. Pure: the caller
 * passes Tolgee's `t`; keys are under `tempo.tapTheBeat`.
 */
import { pageFlags, type FlagPage } from "@/timeline/timelinePlayhead";
import { formatMusicTime, type TapTheBeatPlan } from "@/timeline/tempo";
import { placeName } from "./placeName";

/** Tolgee's `t` as these helpers use it. */
export type Translate = (
    key: string,
    params?: Record<string, string | number>,
) => string;

const K = "tempo.tapTheBeat";

type NamedPage = FlagPage & { readonly name: string };

/** A measure as Tap the beat names flags by it: the ordinal of its downbeat, and its mark */
export interface TapMeasure {
    readonly number: number;
    readonly rehearsalMark: string | null;
    readonly startBeat: { readonly index: number };
}

/**
 * A count tick named as everywhere names it (D6, `placeName`): "Pg 2 · ct 4/16" for the 4th count
 * after page 2's start; on a flag, "C · end of Pg 10 · Pg 11 starts", with the rehearsal mark on
 * its downbeat; "the start" for the show's start, "After pg 4 · +4" past the last page.
 */
export function countLabel(
    pages: readonly NamedPage[],
    ordinal: number,
    measures: readonly TapMeasure[] = [],
): string {
    const places = pageFlags(pages).flatMap((f) =>
        f.range
            ? [{ label: f.page.name, start: f.range.start, end: f.range.end }]
            : [],
    );
    return placeName(places, ordinal, {
        measures: measures.map((m) => ({
            at: m.startBeat.index,
            number: String(m.number),
            rehearsalMark: m.rehearsalMark,
        })),
    });
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
    measures = [],
}: {
    t: Translate;
    plan: TapTheBeatPlan;
    pages: readonly NamedPage[];
    /** The show's measures, so a flag is named with its rehearsal mark */
    measures?: readonly TapMeasure[];
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
                count: countLabel(pages, plan.fromCount, measures),
                bpm,
            }),
        );
    if (plan.heldFrom !== null)
        parts.push(
            t(`${K}.heldSynced`, {
                count: countLabel(pages, plan.heldFrom, measures),
            }),
        );
    if (plan.unsynced.length === 1)
        parts.push(
            t(`${K}.unsyncedOne`, {
                count: countLabel(pages, plan.unsynced[0]!, measures),
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
