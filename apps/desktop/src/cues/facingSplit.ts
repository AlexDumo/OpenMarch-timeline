/**
 * Edits follow the selection (fork #1318): when some but not all of a Facing cue's performers are
 * selected, an edit to that cue (moving it, its turn's length, its angle) changes only the
 * selected ones. They split off into a cue of their own with the change applied; the rest keep
 * the old cue. One write, so one undo step. Everyone or nobody selected, the edit changes the
 * whole cue. An edit that makes the split-off performers match a cue on the same count again
 * joins them to it, so splitting back is the same gesture.
 */
import { create } from "zustand";
import type {
    DatabaseCue,
    ModifiedCueArgs,
    NewCueArgs,
} from "@/db-functions/cues";
import type { CueEdit } from "@/hooks/queries/useCues";
import {
    editedPerformers,
    planCueChange,
    sameSetting,
    withEquipmentSet,
    type CueChange,
} from "./equipment";

/**
 * The selected performers of `cue` when they are some but not all of them (the cue is partly
 * selected), else null
 */
export function partOf(
    cue: Pick<DatabaseCue, "marcherIds">,
    selectedIds: readonly number[],
): number[] | null {
    const selected = new Set(selectedIds);
    const part = cue.marcherIds.filter((id) => selected.has(id));
    return part.length > 0 && part.length < cue.marcherIds.length ? part : null;
}

/** A stand-in id for the cue a split makes, before it's written */
const SPLIT_ID = -1;

/**
 * The newest other Facing cue on `cue`'s count that sets the same thing the same way (angle and
 * turn), which `cue`'s performers join
 */
function matchOnCount(
    cues: readonly DatabaseCue[],
    cue: DatabaseCue,
): DatabaseCue | null {
    return cues
        .filter(
            (c) =>
                c.id !== cue.id &&
                c.type === "facing" &&
                c.beatId === cue.beatId &&
                c.length === cue.length &&
                sameSetting(c, cue),
        )
        .reduce<DatabaseCue | null>(
            (newest, c) => (newest === null || c.id > newest.id ? c : newest),
            null,
        );
}

/**
 * One edit to Facing cue `cueId`: `change` (its count, its turn's length) and `set` (where it
 * turns them to). With `part` (some of its performers, `partOf`), only they change: they split
 * off into a cue of their own with the edit applied, and the rest keep the old cue. Where the
 * edited cue lands, its performers win as a lane drag's do (`planCueChange`), and a cue on that
 * count that sets the same thing the same way is joined. One write, so one undo step. Null when
 * nothing changes or the cue isn't there.
 */
export function planFacingEdit({
    cues,
    cueId,
    part = null,
    change = {},
    set,
    relabelFor,
}: {
    cues: readonly DatabaseCue[];
    cueId: number;
    /** The selected part of the cue's performers; null edits the whole cue */
    part?: readonly number[] | null;
    change?: CueChange;
    set?: { value: string; settings: Record<string, unknown> };
    relabelFor: (marcherIds: readonly number[]) => string | null;
}): CueEdit | null {
    const cue = cues.find((c) => c.id === cueId);
    if (!cue) return null;
    const sets =
        set !== undefined &&
        (set.value !== cue.value ||
            JSON.stringify(set.settings) !== JSON.stringify(cue.settings));
    const moves =
        (change.beatId !== undefined && change.beatId !== cue.beatId) ||
        (change.length !== undefined && change.length !== cue.length) ||
        (change.transition !== undefined &&
            change.transition !== cue.transition);
    if (!sets && !moves) return null;
    const rest = part ? editedPerformers(cue, part, "remove") : null;
    const splits = rest !== null && rest.length > 0;
    // The cue the edit acts on: the whole cue, or the selected part split off
    let now: DatabaseCue[] = [...cues];
    let targetId = cueId;
    if (splits) {
        const ids = cue.marcherIds.filter((id) => part!.includes(id));
        now = now
            .map((c) =>
                c.id === cueId
                    ? { ...c, marcherIds: rest, label: relabelFor(rest) }
                    : c,
            )
            .concat({
                ...cue,
                id: SPLIT_ID,
                marcherIds: ids,
                label: relabelFor(ids),
            });
        targetId = SPLIT_ID;
    }
    if (sets)
        now = now.map((c) =>
            c.id === targetId
                ? { ...c, value: set!.value, settings: set!.settings }
                : c,
        );
    if (moves)
        now = withEquipmentSet(
            now,
            planCueChange({ cues: now, cueId: targetId, change, relabelFor }),
        );
    // Where it lands, a cue that sets the same thing the same way takes them in (a move joins
    // one already; a new angle or a split that matches one there too)
    const target = now.find((c) => c.id === targetId);
    const match = target ? matchOnCount(now, target) : null;
    if (target && match) {
        const joined = editedPerformers(match, target.marcherIds, "add");
        now = now
            .filter((c) => c.id !== targetId)
            .map((c) =>
                c.id === match.id && joined
                    ? { ...c, marcherIds: joined, label: relabelFor(joined) }
                    : c,
            );
        targetId = match.id;
    }
    return diffCues(cues, now);
}

/** The write that turns `before` into `after` (a cue with a negative id is new) */
function diffCues(
    before: readonly DatabaseCue[],
    after: readonly DatabaseCue[],
): CueEdit | null {
    const edit = {
        deletedCueIds: [] as number[],
        modifiedCues: [] as ModifiedCueArgs[],
        newCues: [] as NewCueArgs[],
    };
    const next = new Map(after.map((c) => [c.id, c]));
    for (const was of before) {
        const now = next.get(was.id);
        if (!now) {
            edit.deletedCueIds.push(was.id);
            continue;
        }
        const fields: ModifiedCueArgs = {
            id: was.id,
            ...(now.beatId !== was.beatId && { beatId: now.beatId }),
            ...(now.value !== was.value && { value: now.value }),
            ...(JSON.stringify(now.settings) !==
                JSON.stringify(was.settings) && { settings: now.settings }),
            ...(now.length !== was.length && { length: now.length }),
            ...(now.transition !== was.transition && {
                transition: now.transition,
            }),
            ...(now.marcherIds.join() !== was.marcherIds.join() && {
                marcherIds: now.marcherIds,
            }),
            ...(now.label !== was.label && { label: now.label }),
        };
        if (Object.keys(fields).length > 1) edit.modifiedCues.push(fields);
    }
    for (const made of after)
        if (made.id < 0)
            edit.newCues.push({
                type: made.type,
                beatId: made.beatId,
                value: made.value,
                settings: made.settings,
                marcherIds: made.marcherIds,
                length: made.length,
                transition: made.transition,
                label: made.label,
                notes: made.notes,
            });
    const empty =
        edit.deletedCueIds.length === 0 &&
        edit.modifiedCues.length === 0 &&
        edit.newCues.length === 0;
    return empty ? null : edit;
}

/** A selection's key: its ids in order, so two selections of the same performers match */
export const selectionKey = (ids: readonly number[]): string =>
    [...ids].sort((a, b) => a - b).join(",");

/**
 * What a split just did, for the Facing lane (not saved):
 *
 * - `follow`: who was edited and the count they landed on. Once their cue there is drawn the lane
 *   picks it, so the next edit (and the turn popover, reopened on it when the edit came from
 *   there) acts on them.
 * - `rest`: who stayed in the old cue. The lane keeps their row drawn, dimmed, under the
 *   selection's, so the split is seen, until the selection changes (`selection` is its key when
 *   the split was made).
 */
export const useFacingSplitStore = create<{
    readonly follow: {
        readonly ids: readonly number[];
        readonly beatId: number;
        readonly popover: boolean;
    } | null;
    readonly rest: {
        readonly ids: readonly number[];
        readonly selection: string;
    } | null;
    /**
     * An edit of `part` that lands them on `beatId`; with `rest` (who stayed in the old cue), a
     * split, made with `selectedIds` selected
     */
    readonly edited: (args: {
        part: readonly number[];
        beatId: number;
        rest: readonly number[] | null;
        selectedIds: readonly number[];
        popover: boolean;
    }) => void;
    readonly followed: () => void;
    readonly clearRest: () => void;
}>((setState) => ({
    follow: null,
    rest: null,
    edited: ({ part, beatId, rest, selectedIds, popover }) =>
        setState((s) => ({
            follow: { ids: [...part], beatId, popover },
            rest:
                rest && rest.length > 0
                    ? { ids: [...rest], selection: selectionKey(selectedIds) }
                    : s.rest,
        })),
    followed: () => setState({ follow: null }),
    clearRest: () => setState({ rest: null }),
}));

/** The performers of the cue a split last left behind, while the selection is still the same */
export function useSplitRest(
    selectedIds: readonly number[],
): readonly number[] {
    const rest = useFacingSplitStore((s) => s.rest);
    return rest && rest.selection === selectionKey(selectedIds)
        ? rest.ids
        : EMPTY_IDS;
}
const EMPTY_IDS: readonly number[] = [];

/** The Facing cue on `beatId` that turns every one of `ids` (the newest, when there are two) */
export function cueLandedFor(
    cues: readonly DatabaseCue[],
    ids: readonly number[],
    beatId: number,
): DatabaseCue | null {
    return cues
        .filter(
            (c) =>
                c.type === "facing" &&
                c.beatId === beatId &&
                ids.every((id) => c.marcherIds.includes(id)),
        )
        .reduce<DatabaseCue | null>(
            (newest, c) => (newest === null || c.id > newest.id ? c : newest),
            null,
        );
}
