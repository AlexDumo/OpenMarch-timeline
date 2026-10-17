/**
 * What Visuals mode's cue band draws for the focused who on the current tab
 * (performer-behavior.md section 7.1): the editable lane (cues whose target
 * is the focused who), read-only rows for broader cues above and exceptions
 * inside below, and the result row, what the who does count by count and
 * where it came from. Counts are compile's (`@openmarch/core` cues): count
 * `c` is the c-th beat with a duration, and the number `c` is its click.
 * Pure, so the band and its tests read the same answers.
 */
import {
    CUE_LIBRARY,
    cueLibraryValue,
    defaultCueValue,
    type CompiledCues,
    type CueTarget,
    type PerformerCarry,
} from "@openmarch/core";
import type { DatabaseCue } from "@/db-functions/cues";
import {
    sectionKey,
    type VisualsChannel,
    type VisualsWho,
    type WhoMarcher,
} from "./visualsWho";

/** Where a cue sits on its lane, in counts. */
export interface LaneCue {
    id: number;
    kind: "state" | "phrase";
    /** The cue's count: a state's arrival, a phrase's first count. */
    count: number;
    /** A state's ramp start (its transition's first click); a phrase's first count. */
    from: number;
    /** A state's count; a phrase's count after its last. */
    to: number;
    /**
     * Where the cue's value holds to on its row: for a state, the next cue's
     * start (or the show's end); for a phrase, its end.
     */
    holdTo: number;
    label: string;
}

/** One read-only row: every cue on the channel for one other target. */
export interface LaneRow {
    key: string;
    target: CueTarget;
    cues: LaneCue[];
}

export interface Lanes {
    /** The target the editable lane writes, or null (an empty selection). */
    target: CueTarget | null;
    own: LaneCue[];
    /** Broader targets than the focused who's, broadest first. */
    broader: LaneRow[];
    /** Narrower (or overlapping) targets inside the focused who. */
    exceptions: LaneRow[];
}

export type ResultSource = "own" | "broader" | "exception" | "default";

/** One stretch of the result row. */
export interface ResultSpan {
    from: number;
    to: number;
    /** The value's label, or null where the who is mixed. */
    label: string | null;
    /** Where it came from; null where mixed. */
    source: ResultSource | null;
    mixed: boolean;
}

/** Each beat's count (beats with a duration, in order), and back. */
export interface CountIndex {
    countOfBeatId: ReadonlyMap<number, number>;
    beatIdOfCount: readonly number[];
}

export function countIndex(
    beats: readonly { id: number; position: number; duration: number }[],
): CountIndex {
    const counted = beats
        .filter((b) => b.duration > 0)
        .sort((a, b) => a.position - b.position);
    return {
        countOfBeatId: new Map(counted.map((b, i) => [b.id, i])),
        beatIdOfCount: counted.map((b) => b.id),
    };
}

const RANK: Record<CueTarget["kind"], number> = {
    band: 0,
    section: 1,
    tag: 2,
    set: 3,
};

/** The target a cue made for `who` gets; null for an empty selection. */
export function targetOfWho(
    who: VisualsWho,
    selectedIds: readonly number[],
): CueTarget | null {
    switch (who.kind) {
        case "band":
            return { kind: "band" };
        case "section":
            return { kind: "section", section: who.section };
        case "tag":
            return { kind: "tag", tagId: who.tagId };
        case "selection":
            return selectedIds.length > 0
                ? {
                      kind: "set",
                      marcherIds: [...selectedIds].sort((a, b) => a - b),
                  }
                : null;
    }
}

/** A stable key per target; sections match ignoring case and outer spaces. */
export function targetKey(target: CueTarget): string {
    switch (target.kind) {
        case "band":
            return "band";
        case "section":
            return `section:${sectionKey(target.section)}`;
        case "tag":
            return `tag:${target.tagId}`;
        case "set":
            return `set:${[...target.marcherIds].sort((a, b) => a - b).join(",")}`;
    }
}

/** The marchers a cue's target holds. */
export function targetMarcherIds(
    target: CueTarget,
    marchers: readonly WhoMarcher[],
    marcherIdsByTagId: ReadonlyMap<number, readonly number[]>,
): Set<number> {
    switch (target.kind) {
        case "band":
            return new Set(marchers.map((m) => m.id));
        case "section": {
            const key = sectionKey(target.section);
            return new Set(
                marchers
                    .filter((m) => sectionKey(m.section) === key)
                    .map((m) => m.id),
            );
        }
        case "tag":
            return new Set(marcherIdsByTagId.get(target.tagId) ?? []);
        case "set":
            return new Set(target.marcherIds);
    }
}

/** A cue's place on its lane; null for a cue on a beat with no count. */
export function laneCue(cue: DatabaseCue, counts: CountIndex): LaneCue | null {
    const count = counts.countOfBeatId.get(cue.beatId);
    if (count === undefined) return null;
    const value = cueLibraryValue(cue.value);
    const label = value?.label ?? cue.value;
    if (cue.kind === "phrase") {
        const length = Math.max(2, cue.length ?? value?.minLength ?? 2);
        return {
            id: cue.id,
            kind: "phrase",
            count,
            from: count,
            to: count + length,
            holdTo: count + length,
            label,
        };
    }
    const transition = Math.max(
        1,
        cue.transitionLength ?? value?.defaultTransition ?? 1,
    );
    return {
        id: cue.id,
        kind: "state",
        count,
        from: Math.max(0, count - transition + 1),
        to: count,
        holdTo: count + 1,
        label,
    };
}

/**
 * The lanes for `focusIds` on `channel`: the cues whose target is the
 * focused who's (the editable lane), and the other targets that reach any
 * focused marcher, as broader rows (a less specific target: band before
 * section before tag before set) or exceptions (as specific or more).
 */
export function visualsLanes({
    cues,
    channel,
    target,
    focusIds,
    marchers,
    marcherIdsByTagId,
    counts,
}: {
    cues: readonly DatabaseCue[];
    channel: VisualsChannel;
    target: CueTarget | null;
    focusIds: ReadonlySet<number>;
    marchers: readonly WhoMarcher[];
    marcherIdsByTagId: ReadonlyMap<number, readonly number[]>;
    counts: CountIndex;
}): Lanes {
    const ownKey = target ? targetKey(target) : null;
    const ownRank = target ? RANK[target.kind] : RANK.set;
    const own: LaneCue[] = [];
    const rows = new Map<string, LaneRow>();
    for (const cue of cues) {
        if (cue.channel !== channel) continue;
        const placed = laneCue(cue, counts);
        if (!placed) continue;
        const key = targetKey(cue.target);
        if (key === ownKey) {
            own.push(placed);
            continue;
        }
        const reach = targetMarcherIds(cue.target, marchers, marcherIdsByTagId);
        if (![...reach].some((id) => focusIds.has(id))) continue;
        const row = rows.get(key) ?? { key, target: cue.target, cues: [] };
        row.cues.push(placed);
        rows.set(key, row);
    }
    const end = counts.beatIdOfCount.length;
    /** Sorted by count, each state holding until the next cue on the row. */
    const holding = (row: LaneCue[]) => {
        row.sort((a, b) => a.count - b.count);
        row.forEach((cue, i) => {
            if (cue.kind === "state")
                cue.holdTo = Math.max(cue.to + 1, row[i + 1]?.from ?? end);
        });
        return row;
    };
    holding(own);
    const sorted = [...rows.values()]
        .map((row) => ({ ...row, cues: holding(row.cues) }))
        .sort(
            (a, b) =>
                RANK[a.target.kind] - RANK[b.target.kind] ||
                a.key.localeCompare(b.key),
        );
    return {
        target,
        own,
        broader: sorted.filter((r) => RANK[r.target.kind] < ownRank),
        exceptions: sorted.filter((r) => RANK[r.target.kind] >= ownRank),
    };
}

/**
 * What the focused marchers do on `channel` at each count's click, merged
 * into spans: one value and where it came from, or mixed where they differ.
 */
export function resultRow({
    compiled,
    channel,
    focusIds,
    countCount,
    lanes,
}: {
    compiled: CompiledCues;
    channel: VisualsChannel;
    focusIds: ReadonlySet<number>;
    countCount: number;
    lanes: Lanes;
}): ResultSpan[] {
    const sourceOf = new Map<number, ResultSource>();
    for (const c of lanes.own) sourceOf.set(c.id, "own");
    for (const row of lanes.broader)
        for (const c of row.cues) sourceOf.set(c.id, "broader");
    for (const row of lanes.exceptions)
        for (const c of row.cues) sourceOf.set(c.id, "exception");

    // Per count: the first marcher's (label, cue) and whether anyone differs
    const label: (string | null)[] = new Array(countCount).fill(null);
    const cueId: (number | null)[] = new Array(countCount).fill(null);
    const seen = new Array<boolean>(countCount).fill(false);
    const mixed = new Array<boolean>(countCount).fill(false);
    for (const id of focusIds) {
        const segments = compiled.segments(id, channel);
        let s = 0;
        for (let k = 0; k < countCount; k++) {
            while (s < segments.length && segments[s]!.to <= k) s++;
            const seg = segments[s];
            const here =
                seg && seg.from <= k
                    ? { label: seg.label, cue: seg.cueId }
                    : { label: null, cue: null };
            if (!seen[k]) {
                seen[k] = true;
                label[k] = here.label;
                cueId[k] = here.cue;
            } else if (label[k] !== here.label || cueId[k] !== here.cue)
                mixed[k] = true;
        }
    }

    const spans: ResultSpan[] = [];
    for (let k = 0; k < countCount; k++) {
        if (!seen[k]) continue;
        const span: ResultSpan = mixed[k]
            ? { from: k, to: k + 1, label: null, source: null, mixed: true }
            : {
                  from: k,
                  to: k + 1,
                  label: label[k],
                  source:
                      cueId[k] === null
                          ? "default"
                          : (sourceOf.get(cueId[k]!) ?? "exception"),
                  mixed: false,
              };
        const last = spans[spans.length - 1];
        if (
            last &&
            last.to === k &&
            last.mixed === span.mixed &&
            last.label === span.label &&
            last.source === span.source
        )
            last.to = k + 1;
        else spans.push(span);
    }
    return spans;
}

/**
 * The value a click on the lane adds: the channel's first state that fits
 * everyone focused and isn't what they do by default (so the new cue shows),
 * else the default. A drag adds the channel's first phrase that fits them,
 * or null when the channel has none (Feet and Facing).
 */
export function newCueValue(
    channel: VisualsChannel,
    kind: "state" | "phrase",
    carries: readonly PerformerCarry[],
): string | null {
    const fitsAll = (fits: readonly PerformerCarry[]) =>
        carries.every((c) => fits.includes(c));
    const candidates = CUE_LIBRARY.filter(
        (v) => v.channel === channel && v.kind === kind && fitsAll(v.fits),
    );
    if (kind === "phrase") return candidates[0]?.id ?? null;
    const defaults = new Set(carries.map((c) => defaultCueValue(channel, c)));
    return (
        candidates.find((v) => !defaults.has(v.id))?.id ??
        candidates[0]?.id ??
        null
    );
}
