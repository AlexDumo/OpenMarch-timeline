/**
 * Equipment cues (ADR 0015 D-3, D-6; fork #992): what a performer holds, set for the selection at
 * the playhead from a fixed catalog of real items. The rules here are pure, so the commands, the
 * field menu, the lane and their tests read the same answers.
 */
import {
    cueValueAt,
    EQUIPMENT_NONE,
    EQUIPMENT_USUAL,
    type CompiledCues,
} from "@openmarch/core";
import type {
    DatabaseCue,
    ModifiedCueArgs,
    NewCueArgs,
} from "@/db-functions/cues";
import { itemValueId } from "./equipmentItems";

/**
 * What an Equipment command sets: a catalog item's key ("trumpet", "rifle"), "usual" for the
 * performer's own instrument (their section's default) or "none".
 */
export type EquipmentChoice = string;

/** The value an Equipment cue for `choice` stores. */
export const equipmentValueOfChoice = (choice: EquipmentChoice): string =>
    choice === "usual"
        ? EQUIPMENT_USUAL
        : choice === "none"
          ? EQUIPMENT_NONE
          : itemValueId(choice);

/**
 * The cue that sets `choice` for `marcherIds` on `beatId`, lasting, as Equipment naturally is
 * (ADR 0015 D-2). Any performer can hold any item.
 */
export function planEquipmentCues({
    choice,
    marcherIds,
    beatId,
    label,
}: {
    choice: EquipmentChoice;
    marcherIds: readonly number[];
    beatId: number;
    label: string | null;
}): NewCueArgs[] {
    if (marcherIds.length === 0) return [];
    return [
        {
            type: "equipment",
            beatId,
            value: equipmentValueOfChoice(choice),
            marcherIds: [...marcherIds],
            label,
        },
    ];
}

/** The Equipment value a performer holds at `count` (their section's default before any cue). */
export const heldValueAt = (
    compiled: CompiledCues,
    marcherId: number,
    count: number,
): string | null => cueValueAt(compiled, marcherId, "equipment", count);

/** The Equipment cues on `beatId` (newest last). */
export const equipmentCuesOn = (
    cues: readonly DatabaseCue[],
    beatId: number,
): DatabaseCue[] =>
    cues.filter((c) => c.type === "equipment" && c.beatId === beatId);

/**
 * The performers a cue would have after adding or removing the selection, or null when nothing
 * changes. Removing everyone leaves an empty list: the caller deletes the cue then.
 */
export function editedPerformers(
    cue: Pick<DatabaseCue, "marcherIds">,
    selected: readonly number[],
    edit: "add" | "remove",
): number[] | null {
    const current = new Set(cue.marcherIds);
    const next = new Set(current);
    for (const id of selected)
        if (edit === "add") next.add(id);
        else next.delete(id);
    if (next.size === current.size && [...next].every((id) => current.has(id)))
        return null;
    return [...next].sort((a, b) => a - b);
}

/** How many recent Equipment choices the field menu keeps. */
export const RECENT_EQUIPMENT_LIMIT = 4;

/** The recent catalog items after choosing `key`: it goes first, at most four, no repeats. */
export function withRecent(
    recent: readonly string[],
    key: EquipmentChoice,
): string[] {
    if (key === "usual" || key === "none") return [...recent];
    return [key, ...recent.filter((k) => k !== key)].slice(
        0,
        RECENT_EQUIPMENT_LIMIT,
    );
}

/**
 * What setting an Equipment value writes, as one undo step: performers taken out of the other cues
 * on that beat (a cue left with nobody is deleted), then the matching cue joined or a new one made.
 * Every list is empty when nothing changes.
 */
export interface EquipmentSet {
    readonly modifiedCues: ModifiedCueArgs[];
    readonly deletedCueIds: number[];
    readonly newCues: NewCueArgs[];
}

export const equipmentSetIsEmpty = (plan: EquipmentSet): boolean =>
    plan.modifiedCues.length === 0 &&
    plan.deletedCueIds.length === 0 &&
    plan.newCues.length === 0;

/** A plan that changes nothing yet. */
export const emptyPlan = (): EquipmentSet => ({
    modifiedCues: [],
    deletedCueIds: [],
    newCues: [],
});

/**
 * Where `marcherIds` land on `beatId` with a cue of `value` and kind `length` (fork #992): a
 * performer is in at most one Equipment cue of a kind on a beat, so they leave every other cue of
 * that kind there (a cue left with nobody is deleted), written into `plan`. Returns the cue of that
 * value they join, the newest when there are two (the compile's winner), or null when there's none.
 * `except` (a cue being moved) is left out of the beat's cues.
 */
export function landOn({
    cues,
    type = "equipment",
    beatId,
    length,
    value,
    matches = (c) => c.value === value,
    marcherIds,
    except,
    relabelFor,
    plan,
}: {
    cues: readonly DatabaseCue[];
    /** The cue type: a performer is in at most one cue of a type and kind on a beat */
    type?: string;
    beatId: number;
    length: number | null;
    value: string;
    /** Whether a cue there sets the same thing, so they join it; the same value by default */
    matches?: (cue: DatabaseCue) => boolean;
    marcherIds: readonly number[];
    except?: number;
    relabelFor: (marcherIds: readonly number[]) => string | null;
    plan: EquipmentSet;
}): DatabaseCue | null {
    const sameKind = cues.filter(
        (c) =>
            c.id !== except &&
            c.type === type &&
            c.beatId === beatId &&
            c.length === length,
    );
    const target = sameKind
        .filter(matches)
        .reduce<DatabaseCue | null>(
            (newest, c) => (newest === null || c.id > newest.id ? c : newest),
            null,
        );
    for (const cue of sameKind) {
        if (cue === target) continue;
        const rest = editedPerformers(cue, marcherIds, "remove");
        if (rest === null) continue;
        if (rest.length === 0) plan.deletedCueIds.push(cue.id);
        else
            plan.modifiedCues.push({
                id: cue.id,
                marcherIds: rest,
                label: relabelFor(rest),
            });
    }
    return target;
}

/**
 * Setting `choice` for `marcherIds` on `beatId` replaces what they hold there (fork #992): a
 * performer is in at most one Equipment cue of a kind (lasting, or momentary of one length) on a
 * beat. So the selection leaves every other cue of that kind on the beat, and a cue left with no
 * performers is deleted. Then they join the cue with that value (the newest, which is the one that
 * wins), or a new cue is made; performers already in it stay. `labelFor` names a new cue's
 * performers; `relabelFor` renames a cue whose performers changed (defaults to `labelFor`).
 */
export function planEquipmentSet({
    cues,
    choice,
    marcherIds,
    beatId,
    labelFor,
    relabelFor = labelFor,
    length = null,
}: {
    cues: readonly DatabaseCue[];
    choice: EquipmentChoice;
    marcherIds: readonly number[];
    beatId: number;
    /** The label for a new cue with these performers */
    labelFor: (marcherIds: readonly number[]) => string | null;
    /** The label for a cue now holding these performers */
    relabelFor?: (marcherIds: readonly number[]) => string | null;
    /** Null for a lasting cue (what the Equipment commands make) */
    length?: number | null;
}): EquipmentSet {
    const plan = emptyPlan();
    if (marcherIds.length === 0) return plan;
    const value = equipmentValueOfChoice(choice);
    const target = landOn({
        cues,
        beatId,
        length,
        value,
        marcherIds,
        relabelFor,
        plan,
    });
    if (target) {
        const joined = editedPerformers(target, marcherIds, "add");
        if (joined)
            plan.modifiedCues.push({
                id: target.id,
                marcherIds: joined,
                label: relabelFor(joined),
            });
    } else {
        plan.newCues.push(
            ...planEquipmentCues({
                choice,
                marcherIds,
                beatId,
                label: labelFor(marcherIds),
            }).map((c) => (length === null ? c : { ...c, length })),
        );
    }
    return plan;
}

/**
 * What moving a cue changes: the beat it's on, how long it lasts (null: lasting), and how many
 * counts its change takes (a Facing turn's; null: instant).
 */
export interface CueChange {
    readonly beatId?: number;
    readonly length?: number | null;
    readonly transition?: number | null;
}

/** Two cues that set the same thing: the same value, settings and turn */
export const sameSetting = (a: DatabaseCue, b: DatabaseCue): boolean =>
    a.value === b.value &&
    a.transition === b.transition &&
    JSON.stringify(a.settings) === JSON.stringify(b.settings);

/**
 * Moving cue `cueId` to another count, or changing how long it lasts (fork #992): its performers
 * win where it lands, as setting equipment there would. They leave the other Equipment cues of the
 * new kind on that count (a cue left with nobody is deleted), and a cue of the same value there is
 * merged into this one, which keeps its id. One write, so one undo step. Nothing when nothing
 * changes or the cue isn't there. Other types of cue only move.
 */
export function planCueChange({
    cues,
    cueId,
    change,
    relabelFor,
}: {
    cues: readonly DatabaseCue[];
    cueId: number;
    change: CueChange;
    /** The label for a cue now holding these performers */
    relabelFor: (marcherIds: readonly number[]) => string | null;
}): EquipmentSet {
    const plan = emptyPlan();
    const cue = cues.find((c) => c.id === cueId);
    if (!cue) return plan;
    const beatId = change.beatId ?? cue.beatId;
    const length = change.length === undefined ? cue.length : change.length;
    const transition =
        change.transition === undefined ? cue.transition : change.transition;
    if (
        beatId === cue.beatId &&
        length === cue.length &&
        transition === cue.transition
    )
        return plan;
    const fields: ModifiedCueArgs = {
        id: cue.id,
        ...(beatId !== cue.beatId && { beatId }),
        ...(length !== cue.length && { length }),
        ...(transition !== cue.transition && { transition }),
    };
    if (cue.type !== "equipment" && cue.type !== "facing") {
        plan.modifiedCues.push(fields);
        return plan;
    }
    // A Facing cue joins one that sets the same angle and turn (#993)
    const moved = { ...cue, transition };
    const target = landOn({
        cues,
        type: cue.type,
        beatId,
        length,
        value: cue.value,
        matches:
            cue.type === "facing"
                ? (c) => sameSetting(c, moved)
                : (c) => c.value === cue.value,
        marcherIds: cue.marcherIds,
        except: cue.id,
        relabelFor,
        plan,
    });
    if (target) {
        const merged = editedPerformers(cue, target.marcherIds, "add");
        plan.deletedCueIds.push(target.id);
        plan.modifiedCues.push(
            merged
                ? { ...fields, marcherIds: merged, label: relabelFor(merged) }
                : fields,
        );
    } else plan.modifiedCues.push(fields);
    return plan;
}

/**
 * Moves every cue in `cueIds` to `beatId` as one write (the Facing lane's shared keyframe, fork
 * #1315): each moves as `planCueChange` moves it alone, keeping its turn, one after another, and
 * the plan is what changed in the end. Nothing when nothing changes.
 */
export function planCuesMove({
    cues,
    cueIds,
    beatId,
    relabelFor,
}: {
    cues: readonly DatabaseCue[];
    cueIds: readonly number[];
    beatId: number;
    relabelFor: (marcherIds: readonly number[]) => string | null;
}): EquipmentSet {
    let now: DatabaseCue[] = [...cues];
    for (const cueId of cueIds) {
        // A cue an earlier one merged into is gone
        if (!now.some((c) => c.id === cueId)) continue;
        now = withEquipmentSet(
            now,
            planCueChange({ cues: now, cueId, change: { beatId }, relabelFor }),
        );
    }
    const plan = emptyPlan();
    const after = new Map(now.map((c) => [c.id, c]));
    for (const cue of cues) {
        const next = after.get(cue.id);
        if (!next) {
            plan.deletedCueIds.push(cue.id);
            continue;
        }
        const ids = next.marcherIds.join() !== cue.marcherIds.join();
        const fields: ModifiedCueArgs = {
            id: cue.id,
            ...(next.beatId !== cue.beatId && { beatId: next.beatId }),
            ...(ids && { marcherIds: next.marcherIds }),
            ...(next.label !== cue.label && { label: next.label }),
        };
        if (Object.keys(fields).length > 1) plan.modifiedCues.push(fields);
    }
    return plan;
}

/**
 * `cues` as they would be after `plan` is written, for drawing a drag's preview from the very edit
 * its drop writes: deleted cues gone, modified ones changed. A plan that makes new cues (setting
 * equipment) isn't previewed; a cue change makes none.
 */
export function withEquipmentSet(
    cues: readonly DatabaseCue[],
    plan: {
        readonly deletedCueIds: readonly number[];
        readonly modifiedCues: readonly ModifiedCueArgs[];
    },
): DatabaseCue[] {
    const deleted = new Set(plan.deletedCueIds);
    const modified = new Map(plan.modifiedCues.map((m) => [m.id, m]));
    return cues
        .filter((c) => !deleted.has(c.id))
        .map((c) => {
            const change = modified.get(c.id);
            if (!change) return c;
            return {
                ...c,
                ...(change.beatId !== undefined && { beatId: change.beatId }),
                ...(change.length !== undefined && { length: change.length }),
                ...(change.transition !== undefined && {
                    transition: change.transition,
                }),
                ...(change.marcherIds !== undefined && {
                    marcherIds: [...change.marcherIds],
                }),
                ...(change.label !== undefined && { label: change.label }),
            };
        });
}

/**
 * "Add selected to this cue" (fork #992, #1318): `marcherIds` join cue `cueId` and leave the cue
 * of theirs it replaces, so they do what it does there rather than keep a cue of their own beside
 * it. A cue left with nobody is deleted; one write, so one undo step.
 *
 * - **Equipment:** their other cue of the same kind (lasting, or momentary of one length) on its
 *   count, as setting that equipment there would.
 * - **Facing:** every Facing cue of theirs in its slot: after the cue's performers' previous
 *   Facing cue and before their next (the start and end of the show when there's none), its own
 *   count included. A cue of theirs a couple of counts off is the same turn, written apart.
 *
 * Nothing when they're all in it already or the cue isn't there.
 */
export function planAddToCue({
    cues,
    cueId,
    marcherIds,
    countOf,
    relabelFor,
}: {
    cues: readonly DatabaseCue[];
    cueId: number;
    marcherIds: readonly number[];
    /** A beat's count, for the Facing cue's slot */
    countOf: (beatId: number) => number | undefined;
    /** The label for a cue now holding these performers */
    relabelFor: (marcherIds: readonly number[]) => string | null;
}): EquipmentSet {
    const plan = emptyPlan();
    const cue = cues.find((c) => c.id === cueId);
    if (!cue) return plan;
    const joined = editedPerformers(cue, marcherIds, "add");
    if (!joined) return plan;
    const added = marcherIds.filter((id) => !cue.marcherIds.includes(id));
    // A Facing cue's slot: between its performers' Facing cues before and after it
    const at = countOf(cue.beatId);
    const theirs = cues.flatMap((c) => {
        const count = countOf(c.beatId);
        return c.type === "facing" &&
            c.id !== cue.id &&
            count !== undefined &&
            c.marcherIds.some((id) => cue.marcherIds.includes(id))
            ? [count]
            : [];
    });
    const previous =
        at === undefined
            ? Infinity
            : Math.max(-Infinity, ...theirs.filter((count) => count < at));
    const next =
        at === undefined
            ? -Infinity
            : Math.min(Infinity, ...theirs.filter((count) => count > at));
    const replaced = (other: DatabaseCue): boolean => {
        if (other.id === cue.id || other.type !== cue.type) return false;
        if (cue.type === "equipment")
            return other.beatId === cue.beatId && other.length === cue.length;
        if (cue.type !== "facing") return false;
        const there = countOf(other.beatId);
        return there !== undefined && there > previous && there < next;
    };
    for (const other of cues) {
        if (!replaced(other)) continue;
        const rest = editedPerformers(other, added, "remove");
        if (rest === null) continue;
        if (rest.length === 0) plan.deletedCueIds.push(other.id);
        else
            plan.modifiedCues.push({
                id: other.id,
                marcherIds: rest,
                label: relabelFor(rest),
            });
    }
    plan.modifiedCues.push({
        id: cue.id,
        marcherIds: joined,
        label: relabelFor(joined),
    });
    return plan;
}
