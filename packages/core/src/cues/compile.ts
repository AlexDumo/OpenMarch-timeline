import {
    cueSettings,
    cueValueLookup,
    defaultCueValue,
    type CueValueLookup,
} from "./library";
import {
    CUE_CHANNELS,
    type CompileInput,
    type CompiledCues,
    type CueChannel,
    type CueFlag,
    type CueFlagKind,
    type CueInput,
    type CueMarcher,
    type CueSegment,
    type CueTrace,
    type RippleOrder,
} from "./types";

const segmentKey = (marcherId: number, channel: CueChannel) =>
    `${marcherId}:${channel}`;

/**
 * A cue placed for one marcher: `count` is where it was authored (ties are
 * settled there), `at` is where it lands for this marcher after a ripple.
 */
interface PlacedCue {
    cue: CueInput;
    count: number;
    at: number;
}

/** A Feet state's label, from its settings ("½", "2×", "MT"). */
function feetLabel(settings: Readonly<Record<string, unknown>>): string {
    if (settings.pace === "half") return "½";
    if (settings.pace === "double") return "2×";
    if (settings.onHolds === "markTime" || settings.onHolds === "highMarkTime")
        return "MT";
    return "Step";
}

function labelOf(
    lookup: CueValueLookup,
    value: string | null,
    settings: Readonly<Record<string, unknown>> = {},
): string {
    if (value === null) return "";
    if (value === "builtin:feet.step") return feetLabel(settings);
    return lookup(value)?.label ?? "";
}

/**
 * A phrase's length in counts: the cue's, else the shortest its value
 * allows, held to the value's range and never under 2.
 */
function phraseLength(lookup: CueValueLookup, cue: CueInput): number {
    const value = lookup(cue.value);
    const min = Math.max(2, value?.minLength ?? 2);
    const max = Math.max(min, value?.maxLength ?? Infinity);
    return Math.min(max, Math.max(min, cue.length ?? min));
}

function segment(
    lookup: CueValueLookup,
    from: number,
    to: number,
    kind: CueSegment["kind"],
    value: string | null,
    cue: CueInput | null,
    extra: Partial<CueSegment> = {},
): CueSegment {
    return {
        from,
        to,
        kind,
        value,
        label: labelOf(lookup, value, cue?.settings),
        settings: value ? cueSettings(lookup(value), cue?.settings) : {},
        cueId: cue?.id ?? null,
        ...extra,
    };
}

/**
 * The state timeline for one marcher and channel: the default, then each
 * winning state cue landing on its count's click with its transition before
 * it, counted inclusively (a transition of L counts starts on the click of
 * `count - L + 1`; L = 1 is a snap).
 */
function stateTimeline(
    lookup: CueValueLookup,
    marcher: CueMarcher,
    channel: CueChannel,
    states: readonly PlacedCue[],
    counts: number,
    flags: FlagCollector,
): CueSegment[] {
    const defaultValue = defaultCueValue(channel, marcher.carries);
    const out: CueSegment[] = [];
    let current = segment(lookup, 0, counts, "default", defaultValue, null);
    let previousCount = 0;
    let previous: CueInput | null = null;

    for (const { cue, at: count } of states) {
        const length =
            cue.transitionLength ?? lookup(cue.value)?.defaultTransition ?? 1;
        if (previous && count - length + 1 < previousCount)
            flags.add("transition_cut", [previous.id, cue.id], marcher.id);
        const start = Math.max(count - length + 1, previousCount);
        if (start > current.from) out.push({ ...current, to: start });
        out.push(
            start < count
                ? segment(lookup, start, count, "transition", cue.value, cue)
                : segment(lookup, count, count, "transition", cue.value, cue, {
                      snap: true,
                  }),
        );
        current = segment(lookup, count, counts, "state", cue.value, cue);
        previousCount = count;
        previous = cue;
    }
    out.push(current);
    return out;
}

/** Channels that take states only (no Feet phrases in v1). */
const STATES_ONLY: ReadonlySet<CueChannel> = new Set(["facing", "feet"]);

const SPECIFICITY = { band: 0, section: 1, tag: 2, set: 3 } as const;

const specificity = (cue: CueInput) => SPECIFICITY[cue.target.kind];

/** Flags merged across marchers: one per kind and set of cues. */
class FlagCollector {
    private readonly byKey = new Map<
        string,
        CueFlag & { marcherIds: number[] }
    >();

    add(kind: CueFlagKind, cueIds: readonly number[], marcherId: number) {
        const ids = [...cueIds].sort((a, b) => a - b);
        const key = `${kind}:${ids.join(",")}`;
        const flag = this.byKey.get(key);
        if (flag) {
            if (!flag.marcherIds.includes(marcherId))
                flag.marcherIds.push(marcherId);
        } else
            this.byKey.set(key, { kind, cueIds: ids, marcherIds: [marcherId] });
    }

    get flags(): CueFlag[] {
        return [...this.byKey.values()];
    }
}

/**
 * The cue that wins each count among cues sorted by count: the most specific
 * target, then the newest (highest id), flagging a tie at the top.
 */
function winnersByCount(
    cues: readonly PlacedCue[],
    marcherId: number,
    flags: FlagCollector,
): PlacedCue[] {
    const groups = new Map<number, PlacedCue[]>();
    for (const p of cues) {
        const group = groups.get(p.count);
        if (group) group.push(p);
        else groups.set(p.count, [p]);
    }
    const winners: PlacedCue[] = [];
    for (const group of groups.values()) {
        const top = Math.max(...group.map((p) => specificity(p.cue)));
        const tied = group.filter((p) => specificity(p.cue) === top);
        const winner = tied.reduce((a, b) => (b.cue.id > a.cue.id ? b : a));
        if (tied.length > 1)
            flags.add(
                "clash",
                tied.map((p) => p.cue.id),
                marcherId,
            );
        winners.push(winner);
    }
    return winners.sort((a, b) => a.at - b.at || a.cue.id - b.cue.id);
}

/**
 * Phrase segments for one marcher and channel. A phrase of L counts on
 * count c covers counts c to c + L - 1 (release on c, catch on c + L - 1),
 * so the channel is the phrase's over `[c, c + L)`. A later phrase that
 * starts inside it takes over on its own count, and the overlap is flagged.
 */
function phraseSpans(
    lookup: CueValueLookup,
    phrases: readonly PlacedCue[],
    marcherId: number,
    counts: number,
    flags: FlagCollector,
): CueSegment[] {
    const out: CueSegment[] = [];
    for (const { cue, at: count } of phrases) {
        const length = phraseLength(lookup, cue);
        const previous = out[out.length - 1];
        if (previous && previous.to > count) {
            previous.to = count;
            flags.add("phrase_overlap", [previous.cueId!, cue.id], marcherId);
        }
        out.push(
            segment(
                lookup,
                count,
                Math.min(count + length, counts),
                "phrase",
                cue.value,
                cue,
            ),
        );
    }
    return out;
}

/** Lays `over` on top of `base`, cutting base segments where they overlap. */
function overlay(
    base: readonly CueSegment[],
    over: readonly CueSegment[],
): CueSegment[] {
    if (over.length === 0) return [...base];
    const out: CueSegment[] = [];
    for (const seg of base) {
        let pieces: CueSegment[] = [seg];
        for (const span of over) {
            pieces = pieces.flatMap((p) => {
                if (p.from === p.to)
                    return p.from >= span.from && p.from < span.to ? [] : [p];
                if (p.to <= span.from || p.from >= span.to) return [p];
                const kept: CueSegment[] = [];
                if (p.from < span.from) kept.push({ ...p, to: span.from });
                if (p.to > span.to) kept.push({ ...p, from: span.to });
                return kept;
            });
        }
        out.push(...pieces);
    }
    out.push(...over);
    return out.sort((a, b) => a.from - b.from || a.to - b.to);
}

/**
 * Copies each segment whose value takes over another channel onto that
 * channel, and flags standing-only values (kneel) on counts where the dot
 * travels.
 */
function applyTakeovers(
    lookup: CueValueLookup,
    marcherId: number,
    channels: Map<CueChannel, CueSegment[]>,
    travels: CompileInput["travels"],
    flags: FlagCollector,
): void {
    const taken = new Map<CueChannel, CueSegment[]>();
    for (const [channel, segments] of channels) {
        for (const seg of segments) {
            if (seg.kind === "default" || seg.value === null) continue;
            const value = lookup(seg.value);
            for (const other of value?.takesOver ?? []) {
                if (other === channel) continue;
                const list = taken.get(other) ?? [];
                list.push({ ...seg, takenOverFrom: channel });
                taken.set(other, list);
            }
            if (value?.standingOnly && travels && seg.cueId !== null) {
                for (let c = Math.floor(seg.from); c < Math.ceil(seg.to); c++) {
                    if (travels(marcherId, c)) {
                        flags.add(
                            "takeover_while_moving",
                            [seg.cueId],
                            marcherId,
                        );
                        break;
                    }
                }
            }
        }
    }
    for (const [channel, over] of taken)
        channels.set(channel, overlay(channels.get(channel) ?? [], over));
}

/** Show time at each count's click, and its inverse. */
class TimeMap {
    private readonly clicks: Float64Array;

    constructor(beats: CompileInput["beats"]) {
        this.clicks = new Float64Array(beats.length + 1);
        beats.forEach(
            (b, i) => (this.clicks[i + 1] = this.clicks[i]! + b.duration),
        );
    }

    /** Seconds at count `c` (fractional counts are proportional in the beat). */
    timeAt(c: number): number {
        const last = this.clicks.length - 1;
        const i = Math.min(Math.max(Math.floor(c), 0), Math.max(last - 1, 0));
        const start = this.clicks[i]!;
        return start + (this.clicks[i + 1]! - start) * (c - i);
    }

    /** The fractional count at `seconds`. */
    countAt(seconds: number): number {
        let lo = 0;
        let hi = this.clicks.length - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (this.clicks[mid]! <= seconds) lo = mid;
            else hi = mid;
        }
        const start = this.clicks[lo]!;
        const length = this.clicks[lo + 1]! - start;
        return length > 0 ? lo + (seconds - start) / length : lo;
    }
}

/**
 * Marchers in a ripple's order. Positional orders read where marchers stand
 * on the cue's count; without positions they fall back to drill order.
 * "Down the form" runs along the form's long axis from the end nearest the
 * first marcher in drill order.
 */
function rippleOrder(
    order: RippleOrder,
    marchers: readonly CueMarcher[],
    count: number,
    positionAt: CompileInput["positionAt"],
): CueMarcher[] {
    const byDrill = [...marchers].sort((a, b) => a.drillOrder - b.drillOrder);
    if (order === "drill" || !positionAt) return byDrill;
    const at = new Map(marchers.map((m) => [m.id, positionAt(m.id, count)]));
    const pos = (m: CueMarcher) => at.get(m.id)!;
    if (order === "left_right" || order === "right_left") {
        const sign = order === "left_right" ? 1 : -1;
        return byDrill.sort((a, b) => sign * (pos(a).x - pos(b).x));
    }
    // down_form: project onto the principal axis of the positions.
    const n = marchers.length;
    const mx = marchers.reduce((t, m) => t + pos(m).x, 0) / n;
    const my = marchers.reduce((t, m) => t + pos(m).y, 0) / n;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const m of marchers) {
        const dx = pos(m).x - mx;
        const dy = pos(m).y - my;
        sxx += dx * dx;
        sxy += dx * dy;
        syy += dy * dy;
    }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ax = Math.cos(angle);
    const ay = Math.sin(angle);
    const along = (m: CueMarcher) =>
        (pos(m).x - mx) * ax + (pos(m).y - my) * ay;
    const sorted = byDrill.sort((a, b) => along(a) - along(b));
    const first = along(
        byDrill.reduce((a, b) => (b.drillOrder < a.drillOrder ? b : a)),
    );
    const nearStart =
        Math.abs(first - along(sorted[0]!)) <=
        Math.abs(first - along(sorted[sorted.length - 1]!));
    return nearStart ? sorted : sorted.reverse();
}

/**
 * Where each of a rippled cue's marchers starts: the first on the cue's
 * count, the rest spread evenly in time to the span's last count, in the
 * ripple's order. Feet cues don't ripple.
 */
function rippleCounts(
    cue: CueInput,
    count: number,
    marchers: readonly CueMarcher[],
    time: TimeMap,
    counts: number,
    positionAt: CompileInput["positionAt"],
): Map<number, number> | null {
    const ripple = cue.ripple;
    if (!ripple || cue.channel === "feet" || marchers.length < 2) return null;
    const ordered = rippleOrder(ripple.order, marchers, count, positionAt);
    const start = time.timeAt(count);
    const last = Math.min(count + Math.max(ripple.span, 1) - 1, counts - 1);
    const end = time.timeAt(Math.max(last, count));
    const out = new Map<number, number>();
    ordered.forEach((m, i) => {
        const t = start + ((end - start) * i) / (ordered.length - 1);
        out.set(m.id, i === 0 ? count : time.countAt(t));
    });
    return out;
}

function appliesTo(cue: CueInput, marcher: CueMarcher): boolean {
    const target = cue.target;
    switch (target.kind) {
        case "band":
            return true;
        case "section":
            return target.section === marcher.section;
        case "tag":
            return marcher.tagIds.includes(target.tagId);
        case "set":
            return target.marcherIds.includes(marcher.id);
    }
}

/** Whether the cue's value suits what the marcher carries. */
function fits(
    lookup: CueValueLookup,
    cue: CueInput,
    marcher: CueMarcher,
): boolean {
    const value = lookup(cue.value);
    return value ? value.fits.includes(marcher.carries) : false;
}

/**
 * One marcher's channel from its applicable cues (sorted by count): the
 * state timeline with the phrases laid over it.
 */
function resolveChannel(
    lookup: CueValueLookup,
    marcher: CueMarcher,
    channel: CueChannel,
    applicable: readonly PlacedCue[],
    counts: number,
    flags: FlagCollector,
): CueSegment[] {
    const states = winnersByCount(
        applicable.filter((p) => p.cue.kind === "state"),
        marcher.id,
        flags,
    );
    const phrases = winnersByCount(
        applicable.filter((p) => p.cue.kind === "phrase"),
        marcher.id,
        flags,
    );
    return overlay(
        stateTimeline(lookup, marcher, channel, states, counts, flags),
        phraseSpans(lookup, phrases, marcher.id, counts, flags),
    );
}

/** One marcher's channel before take-overs, kept for tracing and reuse. */
interface ChannelResult {
    placed: readonly PlacedCue[];
    base: CueSegment[];
}

/** What a compile keeps beside its output. */
interface CompileState {
    lookup: CueValueLookup;
    channels: Map<string, ChannelResult>;
    /** Flags raised while resolving each channel (clashes, overlaps, cuts). */
    channelFlags: Map<CueChannel, FlagCollector>;
}

const compileStates = new WeakMap<CompiledCues, CompileState>();

/**
 * Why a marcher does what it does on a channel at a count: the cue in
 * effect (null for the default) and the applicable cues it beat, latest
 * and most specific first.
 */
export function traceCue(
    compiled: CompiledCues,
    marcherId: number,
    channel: CueChannel,
    count: number,
): CueTrace {
    const segments = compiled.segments(marcherId, channel);
    const current = segments.find((s) => s.from <= count && count < s.to);
    const winner = current?.cueId ?? null;
    const state = compileStates.get(compiled);
    const entry = state?.channels.get(segmentKey(marcherId, channel));
    const takeover = current?.takenOverFrom
        ? { takenOverFrom: current.takenOverFrom }
        : {};
    if (!state || !entry) return { winner, ...takeover, beaten: [] };
    const beaten = entry.placed
        .filter(({ cue, at }) => {
            if (cue.id === winner || at > count) return false;
            if (cue.kind === "state") return true;
            const length = phraseLength(state.lookup, cue);
            return count < at + length;
        })
        .sort(
            (a, b) =>
                b.at - a.at ||
                specificity(b.cue) - specificity(a.cue) ||
                b.cue.id - a.cue.id,
        )
        .map((p) => p.cue.id);
    return { winner, ...takeover, beaten };
}

/** Options for recompiling after an edit. */
export interface RecompileOptions {
    /** The compile before the edit. */
    previous: CompiledCues;
    /**
     * The channels whose cues changed. Every other channel is reused from
     * `previous`, so nothing else may have changed: not the beats, the
     * marchers, the phrase assets, positions or show defaults.
     */
    channels: readonly CueChannel[];
}

/**
 * Resolves the show's cues into each marcher's behavior per channel
 * (docs/3d/performer-behavior.md sections 2 and 6). Pure. With `recompile`,
 * only the edited channels are resolved again; take-overs and the flags
 * that cross channels are always redone.
 */
export function compileCues(
    input: CompileInput,
    recompile?: RecompileOptions,
): CompiledCues {
    const counts = input.beats.length;
    const byKey = new Map<string, CueSegment[]>();
    const flags = new FlagCollector();
    const lookup = cueValueLookup(input.phraseAssets, input.showDefaults);
    const previous = recompile && compileStates.get(recompile.previous);
    const reused = (channel: CueChannel) =>
        previous !== undefined && !recompile!.channels.includes(channel);
    const state: CompileState = {
        lookup,
        channels: new Map(),
        channelFlags: new Map(
            CUE_CHANNELS.map((channel) => [
                channel,
                reused(channel)
                    ? previous!.channelFlags.get(channel)!
                    : new FlagCollector(),
            ]),
        ),
    };

    const { placed, ripples, notAllowed } = placeCues(
        input,
        lookup,
        flags,
        reused,
    );

    for (const marcher of input.marchers) {
        const channels = new Map<CueChannel, CueSegment[]>();
        for (const channel of CUE_CHANNELS) {
            const key = segmentKey(marcher.id, channel);
            const kept = reused(channel)
                ? previous!.channels.get(key)
                : undefined;
            const result =
                kept ??
                resolveMarcherChannel(
                    lookup,
                    marcher,
                    channel,
                    placed.filter(
                        (p) =>
                            p.cue.channel === channel &&
                            !notAllowed.has(p.cue.id) &&
                            appliesTo(p.cue, marcher) &&
                            fits(lookup, p.cue, marcher),
                    ),
                    ripples,
                    counts,
                    state.channelFlags.get(channel)!,
                );
            state.channels.set(key, result);
            channels.set(channel, result.base);
        }
        applyTakeovers(lookup, marcher.id, channels, input.travels, flags);
        for (const [channel, segments] of channels)
            byKey.set(segmentKey(marcher.id, channel), segments);
    }

    const compiled: CompiledCues = {
        segments: (marcherId, channel) =>
            byKey.get(segmentKey(marcherId, channel)) ?? [],
        flags: [
            ...flags.flags,
            ...CUE_CHANNELS.flatMap((c) => state.channelFlags.get(c)!.flags),
        ],
    };
    compileStates.set(compiled, state);
    return compiled;
}

/**
 * Puts each cue on its count, raises the flags that don't depend on one
 * marcher's channel (fits nobody, a phrase on a states-only channel), and
 * works out ripples for the channels being resolved.
 */
function placeCues(
    input: CompileInput,
    lookup: CueValueLookup,
    flags: FlagCollector,
    reused: (channel: CueChannel) => boolean,
) {
    const counts = input.beats.length;
    const countOfBeat = new Map(input.beats.map((b, i) => [b.id, i]));
    const placed: PlacedCue[] = [];
    for (const cue of input.cues) {
        const count = countOfBeat.get(cue.beatId);
        if (count !== undefined) placed.push({ cue, count, at: count });
    }
    placed.sort((a, b) => a.count - b.count || a.cue.id - b.cue.id);

    const time = new TimeMap(input.beats);
    const ripples = new Map<number, Map<number, number>>();
    const notAllowed = new Set<number>();
    for (const { cue, count } of placed) {
        const targeted = input.marchers.filter((m) => appliesTo(cue, m));
        const fitting = targeted.filter((m) => fits(lookup, cue, m));
        if (targeted.length > 0 && fitting.length === 0)
            for (const m of targeted) flags.add("fits_nobody", [cue.id], m.id);
        if (cue.kind === "phrase" && STATES_ONLY.has(cue.channel)) {
            for (const m of fitting)
                flags.add("kind_not_allowed", [cue.id], m.id);
            notAllowed.add(cue.id);
        }
        if (reused(cue.channel)) continue;
        const rippled = rippleCounts(
            cue,
            count,
            fitting,
            time,
            counts,
            input.positionAt,
        );
        if (rippled) ripples.set(cue.id, rippled);
    }
    return { placed, ripples, notAllowed };
}

/** Places a marcher's applicable cues (after ripples) and resolves them. */
function resolveMarcherChannel(
    lookup: CueValueLookup,
    marcher: CueMarcher,
    channel: CueChannel,
    applicable: readonly PlacedCue[],
    ripples: ReadonlyMap<number, ReadonlyMap<number, number>>,
    counts: number,
    flags: FlagCollector,
): ChannelResult {
    const placed = applicable.map((p) => ({
        ...p,
        at: ripples.get(p.cue.id)?.get(marcher.id) ?? p.count,
    }));
    return {
        placed,
        base: resolveChannel(lookup, marcher, channel, placed, counts, flags),
    };
}
