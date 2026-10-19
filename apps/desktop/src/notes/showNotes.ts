/**
 * The show's checks (ADR 0002 D-22, props-spec section 11 "Notes"): one quiet list of everything
 * the show may want to look at, shown in the inspector as "Show checks" and on the thing. Never a
 * modal, never a block: a note names what and where, and at most offers a one-click fix. Nothing
 * here changes data.
 *
 * One shape, `ShowNote`, from three producers:
 * - items: hand conflicts (Carry's equipment included), short-handed holds, crew distance,
 *   crew-less moves (when the show's "Warn when a prop moves without a crew" is on) and put-down
 *   drift;
 * - cues: the cue compiler's notes (`CompiledCues.notes`: `carry_mismatch`, `silk_aspect`);
 * - timeline: the resolver's diagnostics (D-VACANT, D-REBASE and the rest).
 *
 * Beats are ordinals, as the timeline resolver counts them. The words come at display time
 * (`ShowNotesList`), with counts as the transport says them ("Page 1 count 7").
 */
import {
    crewOutOfReach,
    handConflicts,
    putDownDrifts,
    shortHandedHolds,
    type CarryChange,
    type CueNote,
    type Hand,
    type PlacementChange,
    type PutDownAnchor,
    type XY,
} from "@openmarch/core";

export type ShowNoteKind =
    // items
    | "hand_conflict"
    | "short_handed_hold"
    | "crew_distance"
    | "crewless_move"
    | "put_down_drift"
    // cues
    | "carry_mismatch"
    | "silk_aspect";

export type ShowNoteSource = "items" | "cues";

/** The one-click fix a note offers, if any. */
export type ShowNoteAction = { kind: "snap_to_holder"; placementId: number };

/** What a note names: clicking it selects these. */
export interface ShowNoteWhat {
    /** The items, the one it is shown on first */
    itemIds: readonly number[];
    /** The performers: the hand's owner, the far crew, the holders, the cue's marchers */
    marcherIds: readonly number[];
    cueIds: readonly number[];
}

export interface ShowNote {
    /** Stable across recomputes while the note lasts */
    id: string;
    kind: ShowNoteKind;
    source: ShowNoteSource;
    /** Where: the beat ordinal it starts on, null for one with no count */
    beat: number | null;
    /** Where it ends (exclusive), or null if it lasts to the end of the show */
    until: number | null;
    what: ShowNoteWhat;
    /** What the words need besides names and counts */
    detail?: {
        /** Hand conflict: the hands lost */
        hand?: Hand;
        /** Hand conflict: the performer's Carry equipment has the hand */
        byCarry?: boolean;
        /** Short-handed hold: hands needed and given */
        needed?: number;
        held?: number;
        /** A warning rather than information */
        level?: "warning" | "info";
    };
    action?: ShowNoteAction;
}

const what = (w: Partial<ShowNoteWhat>): ShowNoteWhat => ({
    itemIds: w.itemIds ?? [],
    marcherIds: w.marcherIds ?? [],
    cueIds: w.cueIds ?? [],
});

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export interface NoteItem {
    id: number;
    /** The item's `marchers` row, which the resolver positions */
    marcherId: number;
    kind: "prop" | "equipment";
}

export interface ItemNotesInput {
    items: readonly NoteItem[];
    /** Each item's Placement changes, beats as ordinals */
    changesByItem: ReadonlyMap<number, readonly PlacementChange[]>;
    /** How many beats the show has: ordinals run from 0 to `beatCount - 1` */
    beatCount: number;
    /** The resolver's position (put-downs included), null for a marcher it doesn't have */
    positionAt: (marcherId: number, beat: number) => XY | null;
    /**
     * The beats where a marcher's motion may change: its moves' ends and, for an item, its
     * put-downs. Between two of them a marcher stands still or walks one move, so crew distance
     * is checked only there (a direct path can't leave reach and come back).
     */
    breaksOf: (marcherId: number) => readonly number[];
    /** An item's put-downs as the resolver decides them (`putDownAnchors`) */
    putDownsOf: (marcherId: number) => readonly PutDownAnchor[];
    /** The resolver's position without put-downs, which an own-move put-down is checked on */
    basePositionAt: (marcherId: number, beat: number) => XY | null;
    /** What Carry cues give performers, as hands in use */
    carries?: readonly CarryChange[];
    /** How far a crew member may be from its prop, in field units */
    crewReach: number;
    /** The show setting "Warn when a prop moves without a crew" */
    warnPropMovesWithoutCrew: boolean;
}

/** Two crew members a step apart are both "with" the prop; this is how many steps they may be. */
export const CREW_REACH_STEPS = 2;

const SAME = 1e-6;
const moved = (a: XY, b: XY) =>
    Math.abs(a[0] - b[0]) > SAME || Math.abs(a[1] - b[1]) > SAME;

interface PlacedSpan {
    /** First ordinal */
    from: number;
    /** Last ordinal, inclusive */
    to: number;
    crew: readonly number[];
}

/** The spans an item is placed, from each placed change (or the show's start) to the next. */
function placedSpans(
    changes: readonly PlacementChange[],
    beatCount: number,
): PlacedSpan[] {
    const sorted = [...changes].sort(
        (a, b) =>
            a.beat - b.beat || (a.rank ?? 0) - (b.rank ?? 0) || a.id - b.id,
    );
    const spans: PlacedSpan[] = [];
    const last = beatCount - 1;
    const firstBeat = sorted[0]?.beat ?? beatCount;
    if (firstBeat > 0)
        spans.push({ from: 0, to: Math.min(firstBeat - 1, last), crew: [] });
    sorted.forEach((c, i) => {
        // Only the newest change on a beat counts
        const next = sorted[i + 1];
        if (next && next.beat === c.beat) return;
        if (c.state !== "placed") return;
        const end = next ? next.beat - 1 : last;
        if (end >= c.beat) spans.push({ from: c.beat, to: end, crew: c.crew });
    });
    return spans;
}

/**
 * Hand conflicts, one note per item not drawn on one performer: both hands lost at once are one
 * note, and an item that stays displaced while other items take the hand in turn stays one note
 * (a 4-item ripple into one performer's hands is 3 notes, not 12).
 */
function handConflictNotes(input: ItemNotesInput): ShowNote[] {
    const spans = handConflicts(
        input.items.map((item) => ({
            itemId: item.id,
            changes: input.changesByItem.get(item.id) ?? [],
        })),
        input.carries ?? [],
    ).sort(
        (a, b) =>
            (a.from ?? -Infinity) - (b.from ?? -Infinity) ||
            a.itemId - b.itemId,
    );
    interface Open {
        itemId: number;
        marcherId: number;
        from: number | null;
        until: number | null;
        sides: Set<string>;
        others: Set<number>;
        byCarry: boolean;
    }
    const open = new Map<string, Open[]>();
    const out: Open[] = [];
    for (const span of spans) {
        const key = `${span.itemId}:${span.marcherId}`;
        const list = open.get(key) ?? [];
        // Still displaced on this performer (from the same count, or right on from the last
        // span): the same note
        const from = span.from ?? -Infinity;
        const same = list.find(
            (o) =>
                from >= (o.from ?? -Infinity) &&
                (o.until === null || from <= o.until),
        );
        const entry: Open = same ?? {
            itemId: span.itemId,
            marcherId: span.marcherId,
            from: span.from,
            until: span.until,
            sides: new Set(),
            others: new Set(),
            byCarry: false,
        };
        entry.sides.add(span.side);
        if (span.byItemId === null) entry.byCarry = true;
        else entry.others.add(span.byItemId);
        if (same) {
            if (span.until === null || same.until === null) same.until = null;
            else same.until = Math.max(same.until, span.until);
        } else {
            list.push(entry);
            open.set(key, list);
            out.push(entry);
        }
    }
    return out.map(
        (o): ShowNote => ({
            id: `hand_conflict:${o.itemId}:${o.marcherId}:${o.from ?? "start"}`,
            kind: "hand_conflict",
            source: "items",
            beat: o.from ?? 0,
            until: o.until,
            what: what({
                itemIds: [o.itemId, ...o.others],
                marcherIds: [o.marcherId],
            }),
            detail: {
                hand: o.sides.size === 2 ? "both" : ([...o.sides][0] as Hand),
                ...(o.byCarry ? { byCarry: true } : {}),
            },
        }),
    );
}

function shortHandedNotes(input: ItemNotesInput): ShowNote[] {
    return shortHandedHolds(
        input.items.map((item) => ({
            itemId: item.id,
            changes: input.changesByItem.get(item.id) ?? [],
        })),
    ).map((s): ShowNote => {
        const change = input.changesByItem
            .get(s.itemId)
            ?.find((c) => c.id === s.changeId);
        return {
            id: `short_handed_hold:${s.itemId}:${s.changeId}`,
            kind: "short_handed_hold",
            source: "items",
            beat: s.from,
            until: s.until,
            what: what({
                itemIds: [s.itemId],
                marcherIds: change?.holders.map((h) => h.marcherId) ?? [],
            }),
            detail: { needed: s.needed, held: s.held },
        };
    });
}

/** The beats to check a span at: its ends, and every break of the item and its crew inside. */
function checkBeats(
    input: ItemNotesInput,
    span: PlacedSpan,
    marcherIds: readonly number[],
): number[] {
    const beats = new Set<number>([span.from, span.to]);
    for (const id of marcherIds)
        for (const b of input.breaksOf(id)) {
            const beat = Math.round(b);
            if (beat > span.from && beat < span.to) beats.add(beat);
        }
    return [...beats].sort((a, b) => a - b);
}

function farCrewAt(
    input: ItemNotesInput,
    item: NoteItem,
    crew: readonly number[],
    beat: number,
): number[] | null {
    const at = input.positionAt(item.marcherId, beat);
    if (!at) return null;
    const positions = new Map<number, XY>();
    for (const id of crew) {
        const p = input.positionAt(id, beat);
        if (p) positions.set(id, p);
    }
    return crewOutOfReach(at, crew, positions, input.crewReach).map(
        (f) => f.marcherId,
    );
}

/**
 * Crew distance: the first count a crew member is out of reach. Checked at the span's ends and
 * motion breaks; where a break is out of reach and the one before isn't, the first count between
 * them is found by halving.
 */
function crewDistanceNote(
    input: ItemNotesInput,
    item: NoteItem,
    span: PlacedSpan,
): ShowNote | null {
    const beats = checkBeats(input, span, [item.marcherId, ...span.crew]);
    let before: number | null = null;
    for (const beat of beats) {
        const far = farCrewAt(input, item, span.crew, beat);
        if (far === null) return null;
        if (far.length === 0) {
            before = beat;
            continue;
        }
        let first = beat;
        let farAt = far;
        if (before !== null) {
            let lo = before;
            let hi = beat;
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                const f = farCrewAt(input, item, span.crew, mid);
                if (f && f.length > 0) {
                    hi = mid;
                    farAt = f;
                } else lo = mid;
            }
            first = hi;
        }
        return {
            id: `crew_distance:${item.id}:${span.from}`,
            kind: "crew_distance",
            source: "items",
            beat: first,
            until: span.to + 1,
            what: what({ itemIds: [item.id], marcherIds: farAt }),
        };
    }
    return null;
}

/** A crew-less move: the first count the prop is somewhere new, from its motion breaks. */
function crewlessMoveNote(
    input: ItemNotesInput,
    item: NoteItem,
    span: PlacedSpan,
): ShowNote | null {
    const beats = checkBeats(input, span, [item.marcherId]);
    let prevBeat = beats[0]!;
    let prev = input.positionAt(item.marcherId, prevBeat);
    for (const beat of beats.slice(1)) {
        const at = input.positionAt(item.marcherId, beat);
        if (!prev || !at) return null;
        if (moved(prev, at)) {
            // It leaves on the count after the last one it still stood at
            const still = prev;
            let lo = prevBeat;
            let hi = beat;
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                const p = input.positionAt(item.marcherId, mid);
                if (p && moved(still, p)) hi = mid;
                else lo = mid;
            }
            return {
                id: `crewless_move:${item.id}:${span.from}`,
                kind: "crewless_move",
                source: "items",
                beat: hi,
                until: span.to + 1,
                what: what({ itemIds: [item.id] }),
            };
        }
        prevBeat = beat;
        prev = at;
    }
    return null;
}

function crewNotes(input: ItemNotesInput, item: NoteItem): ShowNote[] {
    const notes: ShowNote[] = [];
    const changes = input.changesByItem.get(item.id) ?? [];
    for (const span of placedSpans(changes, input.beatCount)) {
        const note =
            span.crew.length > 0
                ? crewDistanceNote(input, item, span)
                : input.warnPropMovesWithoutCrew && item.kind === "prop"
                  ? crewlessMoveNote(input, item, span)
                  : null;
        if (note) notes.push(note);
    }
    return notes;
}

function driftNotes(input: ItemNotesInput, item: NoteItem): ShowNote[] {
    const base = {
        positionAt: (id: number, beat: number): XY =>
            input.basePositionAt(id, beat) ?? [Number.NaN, Number.NaN],
    };
    return putDownDrifts(base, item.marcherId, input.putDownsOf(item.marcherId))
        .filter((d) => Number.isFinite(d.distance))
        .map(
            (d): ShowNote => ({
                id: `put_down_drift:${item.id}:${d.changeId}`,
                kind: "put_down_drift",
                source: "items",
                beat: d.beat,
                until: d.beat + 1,
                what: what({
                    itemIds: [item.id],
                    marcherIds: d.holders.map((h) => h.marcherId),
                }),
                action: { kind: "snap_to_holder", placementId: d.changeId },
            }),
        );
}

/** The items' notes. */
export function itemNotes(input: ItemNotesInput): ShowNote[] {
    return [
        ...handConflictNotes(input),
        ...shortHandedNotes(input),
        ...input.items.flatMap((item) => [
            ...crewNotes(input, item),
            ...driftNotes(input, item),
        ]),
    ];
}

// ---------------------------------------------------------------------------
// Cues and the timeline
// ---------------------------------------------------------------------------

/**
 * The cue compiler's notes, each at its cue's count. `cueBeat` gives a cue's beat ordinal, null
 * for a cue it doesn't know.
 */
export function cueNotes(
    notes: readonly CueNote[],
    cueBeat: (cueId: number) => number | null,
): ShowNote[] {
    return notes.map((n): ShowNote => {
        const beats = n.cueIds
            .map(cueBeat)
            .filter((b): b is number => b !== null);
        const beat = beats.length > 0 ? Math.min(...beats) : null;
        return {
            id: `${n.kind}:${[...n.cueIds].sort((a, b) => a - b).join(",")}`,
            kind: n.kind,
            source: "cues",
            beat,
            until: beat === null ? null : beat + 1,
            what: what({ cueIds: n.cueIds, marcherIds: n.marcherIds }),
        };
    });
}

/** Every note, by count (those with none first), then source, then id. */
export function sortShowNotes(notes: readonly ShowNote[]): ShowNote[] {
    const order: Record<ShowNoteSource, number> = {
        items: 0,
        cues: 1,
    };
    return [...notes].sort(
        (a, b) =>
            (a.beat ?? -1) - (b.beat ?? -1) ||
            order[a.source] - order[b.source] ||
            a.id.localeCompare(b.id),
    );
}

/** The notes shown on one item. */
export const notesForItem = (
    notes: readonly ShowNote[],
    itemId: number,
): ShowNote[] => notes.filter((n) => n.what.itemIds[0] === itemId);

/** How many notes apply at a moment, for the 3D View's note count. */
export const notesAt = (
    notes: readonly Pick<ShowNote, "beat" | "until">[],
    beat: number,
): number =>
    notes.filter(
        (n) =>
            n.beat !== null &&
            n.beat <= beat &&
            (n.until === null || beat < n.until),
    ).length;
