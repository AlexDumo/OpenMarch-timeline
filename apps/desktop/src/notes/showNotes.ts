/**
 * The show's notes (ADR 0002 D-22, props-spec "Notes"): quiet checks, shown on the thing and in a
 * show-wide list. Never a modal, never a block: a note names what and where, and at most offers a
 * one-click fix. Nothing here changes data.
 *
 * Notes name counts as designers count them ("Flag not put down, count 9 of page 5"). Beats are
 * ordinals, as the timeline resolver counts them.
 *
 * First producers (C2.6): hand conflicts, crew distance, crew-less moves (when the show's "Warn
 * when a prop moves without a crew" is on) and put-down drift. Later phases add fit, print,
 * budget, platform, obstacle, Garment-fit, Horn/Equipment-mismatch and Silk-aspect notes.
 */
import {
    crewOutOfReach,
    handConflicts,
    putDownDrifts,
    type ItemOrigin,
    type PlacementChange,
    type XY,
} from "@openmarch/core";

export type ShowNoteKind =
    | "hand_conflict"
    | "crew_distance"
    | "crewless_move"
    | "put_down_drift";

/** The one-click fix a note offers, if any. */
export type ShowNoteAction = { kind: "snap_to_holder"; placementId: number };

export interface ShowNote {
    /** Stable across recomputes while the note lasts */
    id: string;
    kind: ShowNoteKind;
    /** The item the note is shown on */
    itemId: number;
    /** Where it starts, as a beat ordinal */
    beat: number;
    /** Where it ends, or null if it lasts to the end of the show */
    until: number | null;
    /** The other item: the one drawn in a hand conflict */
    otherItemId?: number;
    /** The performers it names: the hand's owner, the far crew, the holders */
    marcherIds: number[];
    action?: ShowNoteAction;
}

export interface NoteItem {
    id: number;
    /** The item's `marchers` row, which the resolver positions */
    marcherId: number;
    kind: "prop" | "equipment";
    origin?: ItemOrigin;
}

export interface ShowNotesInput {
    items: readonly NoteItem[];
    /** Each item's Placement changes, beats as ordinals */
    changesByItem: ReadonlyMap<number, readonly PlacementChange[]>;
    /** How many beats the show has: ordinals run from 0 to `beatCount - 1` */
    beatCount: number;
    /** The resolver's position, null for a marcher it doesn't have */
    positionAt: (marcherId: number, beat: number) => XY | null;
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

/** The spans an item is placed, from each placed change (or a created item's start) to the next. */
function placedSpans(
    changes: readonly PlacementChange[],
    origin: ItemOrigin | undefined,
    beatCount: number,
): PlacedSpan[] {
    const sorted = [...changes].sort((a, b) => a.beat - b.beat || a.id - b.id);
    const spans: PlacedSpan[] = [];
    const last = beatCount - 1;
    const firstBeat = sorted[0]?.beat ?? beatCount;
    if ((origin?.kind ?? "created") === "created" && firstBeat > 0)
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

function handConflictNotes(input: ShowNotesInput): ShowNote[] {
    return handConflicts(
        input.items.map((item) => ({
            itemId: item.id,
            origin: item.origin,
            changes: input.changesByItem.get(item.id) ?? [],
        })),
    ).map(
        (c): ShowNote => ({
            id: `hand_conflict:${c.itemId}:${c.byItemId}:${c.marcherId}:${c.side}:${c.from ?? "start"}`,
            kind: "hand_conflict",
            itemId: c.itemId,
            beat: c.from ?? 0,
            until: c.until,
            otherItemId: c.byItemId,
            marcherIds: [c.marcherId],
        }),
    );
}

function crewNotes(input: ShowNotesInput, item: NoteItem): ShowNote[] {
    const notes: ShowNote[] = [];
    const changes = input.changesByItem.get(item.id) ?? [];
    for (const span of placedSpans(changes, item.origin, input.beatCount)) {
        if (span.crew.length > 0) {
            // Crew distance: from the first count a crew member is out of reach
            for (let beat = span.from; beat <= span.to; beat++) {
                const at = input.positionAt(item.marcherId, beat);
                if (!at) break;
                const positions = new Map<number, XY>();
                for (const id of span.crew) {
                    const p = input.positionAt(id, beat);
                    if (p) positions.set(id, p);
                }
                const far = crewOutOfReach(
                    at,
                    span.crew,
                    positions,
                    input.crewReach,
                );
                if (far.length > 0) {
                    notes.push({
                        id: `crew_distance:${item.id}:${span.from}`,
                        kind: "crew_distance",
                        itemId: item.id,
                        beat,
                        until: null,
                        marcherIds: far.map((f) => f.marcherId),
                    });
                    break;
                }
            }
        } else if (input.warnPropMovesWithoutCrew && item.kind === "prop") {
            // A crew-less move: the first count the prop is somewhere new
            let before = input.positionAt(item.marcherId, span.from);
            for (let beat = span.from + 1; before && beat <= span.to; beat++) {
                const at = input.positionAt(item.marcherId, beat);
                if (!at) break;
                if (moved(before, at)) {
                    notes.push({
                        id: `crewless_move:${item.id}:${span.from}`,
                        kind: "crewless_move",
                        itemId: item.id,
                        beat,
                        until: null,
                        marcherIds: [],
                    });
                    break;
                }
                before = at;
            }
        }
    }
    return notes;
}

function driftNotes(input: ShowNotesInput, item: NoteItem): ShowNote[] {
    return putDownDrifts(
        input.changesByItem.get(item.id) ?? [],
        item.origin ?? { kind: "created" },
        item.marcherId,
        input.positionAt,
    ).map(
        (d): ShowNote => ({
            id: `put_down_drift:${item.id}:${d.changeId}`,
            kind: "put_down_drift",
            itemId: item.id,
            beat: d.beat,
            until: null,
            marcherIds: d.holders.map((h) => h.marcherId),
            action: { kind: "snap_to_holder", placementId: d.changeId },
        }),
    );
}

/** Every note in the show, by count, then item. */
export function collectShowNotes(input: ShowNotesInput): ShowNote[] {
    const notes = [
        ...handConflictNotes(input),
        ...input.items.flatMap((item) => [
            ...crewNotes(input, item),
            ...driftNotes(input, item),
        ]),
    ];
    return notes.sort(
        (a, b) =>
            a.beat - b.beat || a.itemId - b.itemId || a.id.localeCompare(b.id),
    );
}

/** The notes shown on one item. */
export const notesForItem = (
    notes: readonly ShowNote[],
    itemId: number,
): ShowNote[] => notes.filter((n) => n.itemId === itemId);

/** The notes that apply at a moment, for a note count beside the 3D View. */
export const notesAt = (notes: readonly ShowNote[], beat: number): ShowNote[] =>
    notes.filter((n) => n.beat <= beat && (n.until === null || beat < n.until));

/** A page's beats as ordinals, `[start, end)`, and its name, as `readPageGrid` gives them. */
export interface NotePage {
    start: number;
    end: number;
    name?: string;
}

/** A count as designers say it: count `count` of page `page`. */
export interface NoteCount {
    page: string;
    count: number;
    /** Past the last flag: `count` is how far past it */
    after?: boolean;
}

/**
 * The page and count of a beat, counted as the timeline's readout counts (UI-12): a page's counts
 * run from 1 on the beat after the previous flag to N on its own flag; before the first timed
 * page is the first page, count 0; past the last flag, how far past it.
 */
export function noteCountAt(
    pages: readonly NotePage[],
    beat: number,
): NoteCount {
    const [initial, ...timed] = pages;
    const page = timed.find((p) => p.start < beat && beat <= p.end);
    if (page) return { page: page.name ?? "", count: beat - page.start };
    const last = timed[timed.length - 1];
    if (last && beat > last.end)
        return { page: last.name ?? "", count: beat - last.end, after: true };
    return { page: initial?.name ?? "", count: 0 };
}
