/**
 * PROTOTYPE (design experiment, not for merge): splitting some of a Facing cue's performers into
 * their own cue. Three variants behind a dev-only switch, read from the URL (`?facingSplit=A`) or
 * localStorage (`openmarch.facingSplitVariant` = "A" | "B" | "C"); anything else is the shipped
 * behavior.
 *
 * - **A, edits follow the selection:** an edit in a partly-selected row applies only to the
 *   selected performers, splitting them into their own cue (one undo step).
 * - **B, explicit split:** edits change the whole cue; "Split selected into their own cue" in the
 *   cue's menu and the command palette.
 * - **C, split chip:** B, plus a small control on the partly-selected row.
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
    withEquipmentSet,
    type CueChange,
} from "./equipment";

export {
    facingSplitVariant,
    useFacingSplitVariant,
    type FacingSplitVariant,
} from "./facingSplitVariant";

/**
 * The selected performers of `cue` when they are some but not all of them (the row is partly
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

/** A stand-in id for the cue the split makes, before it's written */
const SPLIT_ID = -1;

/**
 * Takes `marcherIds` out of cue `cueId` into a cue of their own with the same facing, turn and
 * count, then applies `change` (count, turn) and `set` (angle) to the new cue only, as the lane's
 * own edits would (`planCueChange`: they win where it lands, and join a cue there that sets the
 * same thing). One write, so one undo step. Null when the cue isn't there or nobody is split off.
 */
export function planFacingSplit({
    cues,
    cueId,
    marcherIds,
    change = {},
    set,
    relabelFor,
}: {
    cues: readonly DatabaseCue[];
    cueId: number;
    marcherIds: readonly number[];
    change?: CueChange;
    set?: { value: string; settings: Record<string, unknown> };
    relabelFor: (marcherIds: readonly number[]) => string | null;
}): CueEdit | null {
    const cue = cues.find((c) => c.id === cueId);
    if (!cue) return null;
    const rest = editedPerformers(cue, marcherIds, "remove");
    if (!rest || rest.length === 0) return null;
    const ids = cue.marcherIds.filter((id) => marcherIds.includes(id));
    const split: DatabaseCue = {
        ...cue,
        id: SPLIT_ID,
        marcherIds: ids,
        label: relabelFor(ids),
        ...(set ?? {}),
    };
    let now: DatabaseCue[] = cues
        .map((c) =>
            c.id === cueId
                ? { ...c, marcherIds: rest, label: relabelFor(rest) }
                : c,
        )
        .concat(split);
    if (Object.keys(change).length > 0)
        now = withEquipmentSet(
            now,
            planCueChange({ cues: now, cueId: SPLIT_ID, change, relabelFor }),
        );
    // What changed against the show as it is
    const edit = {
        deletedCueIds: [] as number[],
        modifiedCues: [] as ModifiedCueArgs[],
        newCues: [] as NewCueArgs[],
    };
    const after = new Map(now.map((c) => [c.id, c]));
    for (const before of cues) {
        const next = after.get(before.id);
        if (!next) {
            edit.deletedCueIds.push(before.id);
            continue;
        }
        const fields = {
            id: before.id,
            ...(next.beatId !== before.beatId && { beatId: next.beatId }),
            ...(next.transition !== before.transition && {
                transition: next.transition,
            }),
            ...(next.marcherIds.join() !== before.marcherIds.join() && {
                marcherIds: next.marcherIds,
            }),
            ...(next.label !== before.label && { label: next.label }),
        };
        if (Object.keys(fields).length > 1) edit.modifiedCues.push(fields);
    }
    const made = after.get(SPLIT_ID);
    if (made) {
        const args: NewCueArgs = {
            type: made.type,
            beatId: made.beatId,
            value: made.value,
            settings: made.settings,
            marcherIds: made.marcherIds,
            length: made.length,
            transition: made.transition,
            label: made.label,
            notes: made.notes,
        };
        edit.newCues.push(args);
    }
    return edit;
}

/**
 * The cue a split just made, to pick once it's drawn (and reopen the turn popover on it when the
 * split came from the popover), so the next edit acts on the performers split off
 */
export const useSplitFollowStore = create<{
    readonly ids: readonly number[] | null;
    readonly popover: boolean;
    readonly follow: (ids: readonly number[], popover: boolean) => void;
    readonly clear: () => void;
}>((setState) => ({
    ids: null,
    popover: false,
    follow: (ids, popover) => setState({ ids: [...ids], popover }),
    clear: () => setState({ ids: null, popover: false }),
}));

/** The newest Facing cue for exactly `ids` */
export function cueFor(
    cues: readonly DatabaseCue[],
    ids: readonly number[],
): DatabaseCue | null {
    const key = [...ids].sort((a, b) => a - b).join();
    return (
        cues
            .filter((c) => c.type === "facing" && c.marcherIds.join() === key)
            .reduce<DatabaseCue | null>(
                (newest, c) =>
                    newest === null || c.id > newest.id ? c : newest,
                null,
            ) ?? null
    );
}
