/**
 * The Align view's pure logic (E7, Tempo lab `alignView`; docs/tempo/README.md): which counts a
 * drag moves, where it snaps, and the "what will move" chip. Counts here are spec count indexes,
 * as in `@/timeline/tempo` (count 0 is the fixed zero-length beat, count 1 starts the show);
 * the timeline's view beats are `index - offset`.
 */
import {
    bpmOfRange,
    countTimes,
    formatUnitTempo,
    holdCount,
    keepSyncedAfter,
    MIN_COUNT_SECONDS,
    moveCount,
    previousSynced,
    respaceEven,
    respaceProportional,
    setRangeBpm,
    spanLimits,
    spanOf,
    unitTempo,
    type CountDurations,
    type CountUnit,
    type MoveCountResult,
    type RetimeResult,
    type TypedSection,
} from "@/timeline/tempo";
import type { TimelinePageMarker } from "./TimelineViewModel";

/** How close, in pixels, a dragged count must come to a snap target to land on it */
export const ALIGN_SNAP_PX = 6;

/** The lowest tempo a typed page tempo may have (11-ui.md B; drags and holds aren't limited) */
export const TYPED_TEMPO_FLOOR_BPM = 40;
/** The highest one: the fastest a count may be (`MIN_COUNT_SECONDS`, 400 BPM) */
export const TYPED_TEMPO_CEILING_BPM = Math.round(60 / MIN_COUNT_SECONDS);

/** A timed page's counts, `[start, end)` in spec count indexes; its flag is at `end` */
export interface AlignPage {
    readonly id: string | number;
    readonly label: string;
    readonly start: number;
    readonly end: number;
}

/** Translation, as `useTolgee().t` gives it */
export type AlignTranslate = (
    key: string,
    params?: Record<string, string | number>,
) => string;

/** The view model's timed pages as count ranges (view beat + `offset` = count index) */
export function alignPages(
    pages: readonly TimelinePageMarker[],
    beatCount: number,
    offset: number,
): AlignPage[] {
    const timed = pages
        .filter((page) => !page.isInitial)
        .sort((a, b) => a.atBeat - b.atBeat);
    return timed.map((page, i) => ({
        id: page.id,
        label: page.label,
        start: page.atBeat + offset,
        end: (timed[i + 1]?.atBeat ?? page.endBeat ?? beatCount) + offset,
    }));
}

/** The page whose flag is at count `index` (it ends there), if any */
export const pageWithFlagAt = (
    pages: readonly AlignPage[],
    index: number,
): AlignPage | undefined => pages.find((page) => page.end === index);

/** The pages whose counts overlap `[from, to)`, as "Pg 5" or "Pg 3–5"; null for none */
export function pagesLabel(
    pages: readonly AlignPage[],
    from: number,
    to: number,
): string | null {
    const over = pages.filter((page) => page.start < to && from < page.end);
    if (over.length === 0) return null;
    const first = over[0]!.label;
    const last = over[over.length - 1]!.label;
    return first === last ? `Pg ${first}` : `Pg ${first}–${last}`;
}

/**
 * A moment (a count tick) by its page and count, as the transport reads it (UI-13): the tick at
 * count `index` is count `index - start` of the page it ends in, so a page's last count sits on
 * its flag.
 */
export function countName(pages: readonly AlignPage[], index: number): string {
    const page = pages.find((p) => p.start < index && index <= p.end);
    return page ? `Pg ${page.label} ct ${index - page.start}` : `ct ${index}`;
}

/** Each count's note and length in it (the tempo map's `countUnits`); none means plain ♩ */
export type AlignUnits = readonly (CountUnit | undefined)[];

/**
 * A tempo as a page label shows it (Sam: exact values stay exact): "120" or "152.5" when every
 * count is the same length, "≈118" when they aren't. Where the tempo map counts in another note
 * (6/8 in ♩., 5/8 3+2 in ♩ with a long count), with the note: "♩.=88", and only the counts that
 * share the page start's note, never an average across a meter change (FX-7). Null for no tempo.
 */
export function formatTempo(
    durations: CountDurations,
    from: number,
    to: number,
    units: AlignUnits = [],
): string | null {
    const tempo = unitTempo(durations, units, from, to);
    // A dragged page lands on 137.9312…: that isn't a tempo anyone typed, so it reads "≈138"
    return tempo ? formatUnitTempo(tempo) : null;
}

/** A chip's before and after tempo: "176", or "♩.≈85" where the counts aren't plain ♩ */
const roundBpm = (
    durations: CountDurations,
    from: number,
    to: number,
    units: AlignUnits = [],
) => {
    const tempo = unitTempo(durations, units, from, to);
    if (!tempo) return "–";
    return tempo.plain ? String(Math.round(tempo.bpm)) : formatUnitTempo(tempo);
};

/**
 * The readout's tempo at count `index`: "120 BPM", or "♩.=88" where the tempo map counts in
 * another note (FX-7). Null for a zero-length count.
 */
export function countTempoText(
    durations: CountDurations,
    index: number,
    units: AlignUnits = [],
): string | null {
    const i = Math.min(index, durations.length - 1);
    const tempo = unitTempo(durations, units, i, i + 1);
    if (!tempo) return null;
    return tempo.plain
        ? `${Math.round(tempo.bpm)} BPM`
        : formatUnitTempo(tempo);
}

const signedSeconds = (seconds: number) =>
    `${seconds >= 0 ? "+" : "−"}${Math.abs(seconds).toFixed(2)}`;

/**
 * Where a dragged count lands: on the first target (in priority order: the playhead, then the
 * count's original time) within `thresholdPx`, else where the pointer is. Alt turns it off.
 */
export function snapAlignTime({
    time,
    targets,
    pixelsPerSecond,
    disabled,
    thresholdPx = ALIGN_SNAP_PX,
}: {
    time: number;
    targets: readonly (number | null | undefined)[];
    pixelsPerSecond: number;
    disabled: boolean;
    thresholdPx?: number;
}): { time: number; snapped: boolean } {
    if (!disabled)
        for (const target of targets)
            if (
                target != null &&
                Math.abs(target - time) * pixelsPerSecond <= thresholdPx
            )
                return { time: target, snapped: true };
    return { time, snapped: false };
}

/** How close, in pixels, a drop must come back to where the count was to write nothing */
export const ALIGN_ORIGIN_SNAP_PX = 2;

/**
 * Where an Align drag lands: on the playhead within `ALIGN_SNAP_PX`, back where it started only
 * within `ALIGN_ORIGIN_SNAP_PX` (so a small correction at a low zoom isn't thrown away, FB-8), else
 * at the pointer. Alt turns snapping off.
 */
export function alignDropTime({
    time,
    playhead,
    origin,
    pixelsPerSecond,
    disabled,
}: {
    time: number;
    playhead: number | null;
    origin: number;
    pixelsPerSecond: number;
    disabled: boolean;
}): { time: number; snapped: boolean } {
    const toPlayhead = snapAlignTime({
        time,
        targets: [playhead],
        pixelsPerSecond,
        disabled,
    });
    if (toPlayhead.snapped) return toPlayhead;
    return snapAlignTime({
        time,
        targets: [origin],
        pixelsPerSecond,
        disabled,
        thresholdPx: ALIGN_ORIGIN_SNAP_PX,
    });
}

/** The synced counts after a drag of count `index`: it joins them (count 1 always is) */
export function syncedWith(
    synced: readonly number[],
    index: number,
    sync: boolean,
): number[] {
    if (!sync || index <= 1 || synced.includes(index)) return [...synced];
    return [...synced, index].sort((a, b) => a - b);
}

/**
 * How far back a flag drag re-spaces (Tempo lab `alignDragScope`, docs/tempo/decisions.md FB-2):
 * `page`, only the page before the dragged count (back to the previous flag, synced or not);
 * `toSynced`, back to the previous synced count (E7's first rule).
 */
export type AlignDragScope = "page" | "toSynced";

/** The last flag before `index`, or undefined */
export const flagBefore = (
    flags: readonly number[],
    index: number,
): number | undefined => {
    let best: number | undefined;
    for (const f of flags)
        if (f < index && (best === undefined || f > best)) best = f;
    return best;
};

/** The first flag after `index`, or undefined */
export const flagAfter = (
    flags: readonly number[],
    index: number,
): number | undefined => {
    let best: number | undefined;
    for (const f of flags)
        if (f > index && (best === undefined || f < best)) best = f;
    return best;
};

/**
 * A drag of count `index` to `toTime`: `moveCount`, re-spacing up to the next synced count. Before
 * it, counts re-space back to the previous synced count, or with the `page` scope only back to the
 * previous flag (`flags`, spec count indexes). The end of the show (`index === durations.length`,
 * the last page's flag) has nothing after it: the counts back to that start re-space, clamped as
 * `moveCount` clamps.
 */
export function alignMove({
    durations,
    index,
    toTime,
    synced,
    scope = "toSynced",
    flags = [],
}: {
    durations: CountDurations;
    index: number;
    toTime: number;
    synced: readonly number[];
    scope?: AlignDragScope;
    flags?: readonly number[];
}): MoveCountResult {
    // Count 1 is where the music starts: moving it shifts the whole show against the music and
    // never re-spaces the counts up to a synced one (FX-5)
    if (index === 1)
        return moveCount({ durations, index, toTime, after: "shift" });
    const respaceFrom = scope === "page" ? flagBefore(flags, index) : undefined;
    if (index < durations.length)
        return moveCount({ durations, index, toTime, synced, respaceFrom });
    const times = countTimes(durations);
    const synced0 = previousSynced(synced, index);
    const from =
        respaceFrom !== undefined &&
        respaceFrom > synced0 &&
        respaceFrom < index
            ? respaceFrom
            : synced0;
    const [min, max] = spanLimits(durations, from, index);
    const wanted = toTime - times[from]!;
    const span = Math.min(Math.max(wanted, min), max);
    const clamped = span !== wanted;
    return {
        durations: respaceProportional(durations, from, index, span),
        time: times[from]! + span,
        originShift: 0,
        effect: {
            respaced: [{ from, to: index }],
            shifted: null,
            heldFrom: null,
        },
        clamped,
        ...(clamped
            ? {
                  clampReason: span === min ? "minCount" : "maxCount",
                  clampSide: "before",
              }
            : {}),
    };
}

/** A count the Align view lets you drag: count 1, or a page's flag (where the page ends) */
export interface AlignFlag {
    /** Spec count index */
    readonly index: number;
    /** The page that ends here; none for count 1 */
    readonly page?: AlignPage;
}

/** Count 1 (where the first page starts) and every page's flag, in order, once each */
export function alignFlags(pages: readonly AlignPage[]): AlignFlag[] {
    const flags = new Map<number, AlignFlag>();
    if (pages.length > 0)
        flags.set(pages[0]!.start, { index: pages[0]!.start });
    for (const page of pages)
        if (page.end > page.start)
            flags.set(page.end, { index: page.end, page });
    return [...flags.values()].sort((a, b) => a.index - b.index);
}

/** When each view beat starts, plus the end of the last: spec times without the hidden beats */
export const viewTimes = (durations: CountDurations, offset: number) =>
    countTimes(durations).slice(offset);

/** The tempo of the count at spec index `index` (rounded BPM), or null for a zero-length one */
export function countTempo(
    durations: CountDurations,
    index: number,
): number | null {
    const length = durations[Math.min(index, durations.length - 1)];
    return length && length > 0 ? Math.round(60 / length) : null;
}

/**
 * A drag of count tick `index` to `toTime`: the count before it holds (a fermata) until then.
 * Null for the first count, which has no count before it to hold.
 */
export function alignHold({
    durations,
    index,
    toTime,
    synced,
    scope = "toSynced",
    flags = [],
}: {
    durations: CountDurations;
    index: number;
    toTime: number;
    synced: readonly number[];
    /** `page`: the change is absorbed up to the next flag after the tick, so the hold stays in its page */
    scope?: AlignDragScope;
    flags?: readonly number[];
}): RetimeResult | null {
    const held = index - 1;
    if (held < 1 || index >= durations.length + 1) return null;
    const start = countTimes(durations)[held]!;
    return holdCount({
        durations,
        index: held,
        newDuration: toTime - start,
        synced,
        absorbUntil: scope === "page" ? flagAfter(flags, index) : undefined,
    });
}

/** "Even out page 5": its counts get equal lengths between its two flags, which stay put */
export const evenOutPage = (
    durations: CountDurations,
    page: AlignPage,
): number[] =>
    respaceEven(
        durations,
        page.start,
        page.end,
        spanOf(durations, page.start, page.end),
    );

/**
 * "Tempo… [120]" on a page: every count exactly `60 / bpm` (typed decimals stay exact); later
 * counts re-space up to the next synced count so it stays put, or shift. Null outside 40–400 BPM
 * (a typed "12" is likelier a typo for 120 than a 12 BPM page) or for a page without counts.
 */
export function typedPageTempo({
    durations,
    page,
    bpm,
    synced,
}: {
    durations: CountDurations;
    page: AlignPage;
    bpm: number;
    synced: readonly number[];
}): RetimeResult | null {
    if (
        !Number.isFinite(bpm) ||
        bpm < TYPED_TEMPO_FLOOR_BPM ||
        bpm > TYPED_TEMPO_CEILING_BPM ||
        page.end <= page.start
    )
        return null;
    const edited = setRangeBpm(durations, page.start, page.end, bpm);
    return keepSyncedAfter({
        before: durations,
        edited,
        from: page.end,
        synced,
    });
}

/** The "what will move" chip: one line, amber when the drag was limited */
export interface AlignChip {
    readonly text: string;
    readonly amber: boolean;
}

/** What comes after the edited count, for the chip's second part */
function afterPart({
    before,
    result,
    from,
    pages,
    synced,
    t,
    units,
}: {
    before: CountDurations;
    result: RetimeResult;
    from: number;
    pages: readonly AlignPage[];
    synced?: readonly number[];
    t: AlignTranslate;
    units?: AlignUnits;
}): string | null {
    const { effect } = result;
    if (effect.heldFrom !== null) {
        const respaced = effect.respaced.find((r) => r.from === from);
        // Named as the transport names that moment: a flag is the last count of the page it
        // closes ("up to synced Pg 11 ct 16"), never the page that starts there (FB-3)
        const what = countName(pages, effect.heldFrom);
        // A hold kept inside its page stops at a flag that may not be synced
        const isSynced = !synced || synced.includes(effect.heldFrom);
        const label = respaced
            ? pagesLabel(pages, respaced.from, respaced.to)
            : null;
        return label && respaced && respaced.to > respaced.from
            ? t(
                  isSynced
                      ? "tempo.align.chip.respacedTo"
                      : "tempo.align.chip.respacedToFlag",
                  {
                      pages: label,
                      from: roundBpm(before, respaced.from, respaced.to, units),
                      to: roundBpm(
                          result.durations,
                          respaced.from,
                          respaced.to,
                          units,
                      ),
                      synced: what,
                  },
              )
            : t(
                  isSynced
                      ? "tempo.align.chip.upToSynced"
                      : "tempo.align.chip.upToFlag",
                  { synced: what },
              );
    }
    if (effect.shifted) {
        const label = pagesLabel(pages, effect.shifted.from, Infinity);
        if (!label) return null;
        return t("tempo.align.chip.shifted", {
            pages: label,
            seconds: signedSeconds(effect.shifted.bySeconds),
        });
    }
    return null;
}

/** Pages a re-spaced range mixes if the fastest is this much faster than the slowest (1.5×) */
export const MIXED_TEMPO_RATIO = 1.5;

/**
 * The fastest and slowest page tempos (rounded BPM) in counts `[from, to)`, when they differ by
 * `MIXED_TEMPO_RATIO` or more, else null: a drag that re-spaces them all by one factor changes
 * an opener and a ballad alike, and their average means little.
 */
export function mixedTempos(
    durations: CountDurations,
    pages: readonly AlignPage[],
    from: number,
    to: number,
): { readonly fast: number; readonly slow: number } | null {
    const tempos: number[] = [];
    for (const page of pages) {
        const start = Math.max(page.start, from);
        const end = Math.min(page.end, to);
        if (end <= start) continue;
        const bpm = bpmOfRange(durations, start, end);
        if (bpm !== null && Number.isFinite(bpm) && bpm > 0) tempos.push(bpm);
    }
    if (tempos.length < 2) return null;
    const fast = Math.max(...tempos);
    const slow = Math.min(...tempos);
    return fast / slow >= MIXED_TEMPO_RATIO
        ? { fast: Math.round(fast), slow: Math.round(slow) }
        : null;
}

const clampPart = (result: RetimeResult, t: AlignTranslate) =>
    result.clamped
        ? result.clampReason === "maxCount"
            ? t("tempo.align.chip.clampSlow")
            : t("tempo.align.chip.clampFast")
        : null;

/**
 * The chip while dragging count `index` (a page flag, a rehearsal mark or a measure line):
 * "Pg 5 · 120 → 112 · Pg 6–8 move +0.31 s", "… · Pg 6–8 120 → 129 up to synced pg 8", or for
 * count 1 "Music starts 1.84 s before count 1". `head` names what is dragged; without it, the
 * pages that re-space before it.
 */
// eslint-disable-next-line max-lines-per-function
export function moveChip({
    before,
    result,
    index,
    pages,
    audioOffsetSeconds,
    head,
    synced,
    t,
    units,
    overrides = [],
}: {
    before: CountDurations;
    result: MoveCountResult;
    index: number;
    pages: readonly AlignPage[];
    /** The audio offset before the drag: positive pads silence before the music */
    audioOffsetSeconds: number;
    head?: string;
    /** The synced counts, so a stop at an unsynced flag isn't called synced */
    synced?: readonly number[];
    t: AlignTranslate;
    units?: AlignUnits;
    /** Typed sections the drag would rescale (FX-5) */
    overrides?: readonly TypedSection[];
}): AlignChip {
    const parts: string[] = [];
    if (
        index !== 1 &&
        result.originShift === 0 &&
        result.durations.every((d, i) => d === before[i])
    )
        return { text: t("tempo.align.chip.noChange"), amber: false };
    let mixedWarning = false;
    const override = overridePart(overrides, t);
    if (override) parts.push(override);
    if (index === 1) {
        // The music now starts this long before count 1 (negative: after it)
        parts.push(musicLeadText(result.originShift - audioOffsetSeconds, t));
    } else {
        const left = result.effect.respaced.find((r) => r.to === index);
        const label =
            head ?? (left ? pagesLabel(pages, left.from, left.to) : null);
        const mixed = left
            ? mixedTempos(before, pages, left.from, left.to)
            : null;
        const from = left ? roundBpm(before, left.from, left.to, units) : null;
        const to = left
            ? roundBpm(result.durations, left.from, left.to, units)
            : null;
        const tempo = left
            ? mixed
                ? t("tempo.align.chip.average", { from: from!, to: to! })
                : `${from} → ${to}`
            : null;
        // Re-spacing that reaches back past one page says from where, so it is never silent (FB-2)
        const reach =
            left &&
            pages.filter((p) => p.start < left.to && left.from < p.end).length >
                1
                ? t("tempo.align.chip.since", {
                      place:
                          left.from <= 1
                              ? t("tempo.align.chip.theStart")
                              : countName(pages, left.from),
                  })
                : null;
        parts.push([label, tempo, reach].filter(Boolean).join(" · "));
        if (mixed) {
            parts.push(t("tempo.align.chip.mixed", mixed));
            mixedWarning = true;
        }
    }
    // Moving count 1 shifts the whole show unless a synced count holds the rest
    const after = afterPart({
        before,
        result,
        from: index,
        pages,
        synced,
        t,
        units,
    });
    if (after && (index !== 1 || result.effect.heldFrom !== null))
        parts.push(after);
    const clamp = clampPart(result, t);
    if (clamp) parts.push(clamp);
    return {
        text: parts.filter(Boolean).join(" · "),
        amber: result.clamped || mixedWarning || overrides.length > 0,
    };
}

/** Where the music starts against count 1, `lead` seconds before it (negative: after) */
const musicLeadText = (lead: number, t: AlignTranslate) =>
    Math.abs(lead) < 0.005
        ? t("tempo.align.chip.musicOnCountOne")
        : lead > 0
          ? t("tempo.align.chip.musicBefore", { seconds: lead.toFixed(2) })
          : t("tempo.align.chip.musicAfter", { seconds: (-lead).toFixed(2) });

/** "Overrides typed ♩=176 (m1–16)", or "… and 2 more typed sections" */
function overridePart(
    overrides: readonly TypedSection[],
    t: AlignTranslate,
): string | null {
    if (overrides.length === 0) return null;
    const first = overrides[0]!;
    return t("tempo.align.chip.overridesTyped", {
        tempo: first.tempo,
        measures: first.measures,
        more: overrides.length - 1,
    });
}

/** The chip while holding the count before tick `index`: "Pg 5 ct 4 held · 0.50 → 1.85 s" */
export function holdChip({
    before,
    result,
    index,
    pages,
    synced,
    t,
    units,
    overrides = [],
}: {
    before: CountDurations;
    result: RetimeResult;
    index: number;
    pages: readonly AlignPage[];
    synced?: readonly number[];
    t: AlignTranslate;
    units?: AlignUnits;
    overrides?: readonly TypedSection[];
}): AlignChip {
    const held = index - 1;
    if (result.durations.every((d, i) => d === before[i]))
        return { text: t("tempo.align.chip.noChange"), amber: false };
    const override = overridePart(overrides, t);
    const parts = [
        ...(override ? [override] : []),
        t("tempo.align.chip.held", {
            count: countName(pages, held),
            from: (before[held] ?? 0).toFixed(2),
            to: (result.durations[held] ?? 0).toFixed(2),
        }),
    ];
    const after = afterPart({
        before,
        result,
        from: index,
        pages,
        synced,
        t,
        units,
    });
    if (after) parts.push(after);
    const clamp = clampPart(result, t);
    if (clamp) parts.push(clamp);
    return {
        text: parts.join(" · "),
        amber: result.clamped || overrides.length > 0,
    };
}

/**
 * Counts that are held (a fermata): noticeably longer than the usual count of their page, so the
 * Align view can hatch them. Spec count indexes.
 */
export function heldCounts(
    durations: CountDurations,
    pages: readonly AlignPage[],
    factor = 1.6,
): Set<number> {
    const held = new Set<number>();
    for (const page of pages) {
        const lengths = durations
            .slice(page.start, page.end)
            .filter((d) => d > 0)
            .sort((a, b) => a - b);
        if (lengths.length < 2) continue;
        const median = lengths[Math.floor(lengths.length / 2)]!;
        for (let i = page.start; i < page.end; i++)
            if (durations[i]! > median * factor) held.add(i);
    }
    return held;
}

/** A label on the Align view's time line ("0:40", or "0:40.5" between whole seconds) */
export interface AlignTimeTick {
    readonly seconds: number;
    readonly label: string;
}

const TIME_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120];

/** "1:05" (or "1:05.5" when `fraction`) */
export const formatShowTime = (seconds: number, fraction = false) => {
    const sign = seconds < 0 ? "−" : "";
    // With tenths, round to tenths first, so 76.97 s reads 1:17, not 1:16.10
    const abs = fraction
        ? Math.round(Math.abs(seconds) * 10) / 10
        : Math.abs(seconds);
    const minutes = Math.floor(abs / 60 + 1e-9);
    const rest = Math.max(0, abs - minutes * 60);
    const whole = Math.floor(rest + 1e-9);
    const tenths = Math.min(9, Math.round((rest - whole) * 10));
    return `${sign}${minutes}:${String(whole).padStart(2, "0")}${
        fraction && tenths > 0 ? `.${tenths}` : ""
    }`;
};

/**
 * The time line's labels from 0 to `extent` seconds, every `step` seconds with `step` the
 * shortest of 0.5 s, 1 s, 2 s, 5 s, … that leaves `minimumPx` between labels.
 */
export function alignTimeTicks(
    extent: number,
    pixelsPerSecond: number,
    minimumPx = 44,
): AlignTimeTick[] {
    if (!(extent > 0) || !(pixelsPerSecond > 0)) return [];
    const step =
        TIME_STEPS.find((s) => s * pixelsPerSecond >= minimumPx) ??
        TIME_STEPS[TIME_STEPS.length - 1]!;
    const ticks: AlignTimeTick[] = [];
    for (let i = 0; i * step <= extent + 1e-9; i++) {
        const seconds = i * step;
        ticks.push({ seconds, label: formatShowTime(seconds, step < 1) });
    }
    return ticks;
}
