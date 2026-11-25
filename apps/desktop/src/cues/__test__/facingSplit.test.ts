// @vitest-environment node
import { describe, expect, it } from "vitest";
import { facingAt } from "@openmarch/core";
import type { DatabaseCue } from "@/db-functions/cues";
import type { CueEdit } from "@/hooks/queries/useCues";
import { compileShowCues } from "../showCues";
import { planAddToCue, withEquipmentSet } from "../equipment";
import { facingValueOf } from "../facing";
import { cueLandedFor, partOf, planFacingEdit } from "../facingSplit";

/** Twelve trumpets over 48 counts. Counts 0–47 are beat ids 100–147. */
const TRUMPETS = Array.from({ length: 12 }, (_, i) => i + 1);
const MARCHERS = [...TRUMPETS, 13, 14].map((id) => ({
    id,
    section: "Trumpet",
}));
const BEATS = [
    { id: 1, position: 0, duration: 0 },
    ...Array.from({ length: 48 }, (_, c) => ({
        id: 100 + c,
        position: c + 1,
        duration: 0.5,
    })),
];
const beatOf = (count: number) => 100 + count;
const countOf = (beatId: number) => beatId - 100;

let nextId = 1;
const cue = (
    count: number,
    value: string,
    marcherIds: readonly number[],
    extra: Partial<DatabaseCue> = {},
): DatabaseCue => ({
    id: nextId++,
    type: "facing",
    beatId: beatOf(count),
    value: `builtin:facing.${value}`,
    settings: {},
    length: null,
    transition: null,
    marcherIds: [...marcherIds],
    label: null,
    notes: null,
    createdAt: "",
    updatedAt: "",
    ...extra,
});
const relabelFor = (ids: readonly number[]) => `x${ids.length}`;

/** `cues` after `edit` is written: new cues get fresh ids */
function written(cues: readonly DatabaseCue[], edit: CueEdit | null) {
    if (!edit) return [...cues];
    return withEquipmentSet(cues, edit).concat(
        edit.newCues.map((n) => ({
            id: nextId++,
            type: n.type,
            beatId: n.beatId,
            value: n.value,
            settings: n.settings ?? {},
            length: n.length ?? null,
            transition: n.transition ?? null,
            marcherIds: [...n.marcherIds],
            label: n.label ?? null,
            notes: n.notes ?? null,
            createdAt: "",
            updatedAt: "",
        })),
    );
}
/** Where `marcherId` faces at `count` */
const facing = (cues: readonly DatabaseCue[], marcherId: number, n: number) =>
    facingAt(compileShowCues(MARCHERS, BEATS, cues).compiled, marcherId, n);
const facingCues = (cues: readonly DatabaseCue[]) =>
    cues.filter((c) => c.type === "facing");

describe("partOf", () => {
    it("is the selected part only when some but not all are selected", () => {
        const c = cue(8, "side2", TRUMPETS);
        expect(partOf(c, [1, 2, 99])).toEqual([1, 2]);
        expect(partOf(c, [99])).toBeNull();
        expect(partOf(c, [])).toBeNull();
        expect(partOf(c, TRUMPETS)).toBeNull();
    });
});

describe("edits follow the selection (#1318)", () => {
    it("moves only the selected part: they split off, the rest keep the cue", () => {
        const all = cue(8, "side2", TRUMPETS, { transition: 4 });
        const plan = planFacingEdit({
            cues: [all],
            cueId: all.id,
            part: [1, 2, 3],
            change: { beatId: beatOf(12) },
            relabelFor,
        })!;
        expect(plan.deletedCueIds).toEqual([]);
        expect(plan.modifiedCues).toEqual([
            { id: all.id, marcherIds: TRUMPETS.slice(3), label: "x9" },
        ]);
        expect(plan.newCues).toEqual([
            expect.objectContaining({
                beatId: beatOf(12),
                value: "builtin:facing.side2",
                transition: 4,
                marcherIds: [1, 2, 3],
            }),
        ]);
        const after = written([all], plan);
        expect(facing(after, 1, 9)).toBe(0);
        expect(facing(after, 4, 9)).toBe(90);
    });

    it("changes only the part's turn length, leaving the rest's turn as it was", () => {
        const all = cue(8, "side2", TRUMPETS, { transition: 4 });
        const after = written(
            [all],
            planFacingEdit({
                cues: [all],
                cueId: all.id,
                part: [1, 2, 3],
                change: { transition: null },
                relabelFor,
            }),
        );
        expect(facingCues(after)).toHaveLength(2);
        expect(after.find((c) => c.marcherIds.includes(4))?.transition).toBe(4);
        expect(
            after.find((c) => c.marcherIds.includes(1))?.transition,
        ).toBeNull();
    });

    it("sets only the part's angle from the turn popover", () => {
        const all = cue(8, "side2", TRUMPETS);
        const after = written(
            [all],
            planFacingEdit({
                cues: [all],
                cueId: all.id,
                part: [1, 2, 3],
                set: facingValueOf({ kind: "back" }),
                relabelFor,
            }),
        );
        expect(facing(after, 1, 10)).toBe(180);
        expect(facing(after, 4, 10)).toBe(90);
    });

    it("edits the whole cue when everyone, or nobody, is selected", () => {
        const all = cue(8, "side2", TRUMPETS);
        for (const part of [null, TRUMPETS])
            expect(
                planFacingEdit({
                    cues: [all],
                    cueId: all.id,
                    part,
                    change: { beatId: beatOf(12) },
                    relabelFor,
                }),
            ).toEqual({
                deletedCueIds: [],
                modifiedCues: [{ id: all.id, beatId: beatOf(12) }],
                newCues: [],
            });
    });

    it("writes nothing when nothing changes", () => {
        const all = cue(8, "side2", TRUMPETS, { transition: 4 });
        expect(
            planFacingEdit({
                cues: [all],
                cueId: all.id,
                part: [1],
                change: { beatId: all.beatId, transition: 4 },
                set: facingValueOf({ kind: "side2" }),
                relabelFor,
            }),
        ).toBeNull();
    });

    it("joins a cue that sets the same thing where the part lands", () => {
        const all = cue(8, "side2", TRUMPETS);
        const other = cue(12, "side2", [13]);
        const plan = planFacingEdit({
            cues: [all, other],
            cueId: all.id,
            part: [1],
            change: { beatId: beatOf(12) },
            relabelFor,
        })!;
        // The part's cue takes the one there in, as a moved cue does
        expect(plan.deletedCueIds).toEqual([other.id]);
        expect(plan.newCues).toEqual([
            expect.objectContaining({
                beatId: beatOf(12),
                marcherIds: [1, 13],
            }),
        ]);
    });

    it("splits back: making the part match the rest again on the same count rejoins them", () => {
        const all = cue(8, "side2", TRUMPETS, { transition: 4 });
        // T1–T3's turn made instant: they split off
        const split = written(
            [all],
            planFacingEdit({
                cues: [all],
                cueId: all.id,
                part: [1, 2, 3],
                change: { transition: null },
                relabelFor,
            }),
        );
        const theirs = cueLandedFor(split, [1, 2, 3], beatOf(8))!;
        expect(theirs.marcherIds).toEqual([1, 2, 3]);
        // Selected alone, they're its whole cue: the turn dragged back to 4 counts rejoins
        const back = written(
            split,
            planFacingEdit({
                cues: split,
                cueId: theirs.id,
                part: partOf(theirs, [1, 2, 3]),
                change: { transition: 4 },
                relabelFor,
            }),
        );
        expect(facingCues(back)).toHaveLength(1);
        expect(facingCues(back)[0]!.marcherIds).toEqual(TRUMPETS);
        expect(facingCues(back)[0]!.transition).toBe(4);
    });

    it("splits back from the popover too: the same angle again rejoins them", () => {
        const all = cue(8, "side2", TRUMPETS);
        const split = written(
            [all],
            planFacingEdit({
                cues: [all],
                cueId: all.id,
                part: [1, 2, 3],
                set: facingValueOf({ kind: "back" }),
                relabelFor,
            }),
        );
        const theirs = cueLandedFor(split, [1, 2, 3], beatOf(8))!;
        const back = written(
            split,
            planFacingEdit({
                cues: split,
                cueId: theirs.id,
                set: facingValueOf({ kind: "side2" }),
                relabelFor,
            }),
        );
        expect(facingCues(back)).toHaveLength(1);
        expect(facingCues(back)[0]).toEqual(
            expect.objectContaining({ id: all.id, marcherIds: TRUMPETS }),
        );
    });

    it("moves back: the part moved back onto the rest's count rejoins them", () => {
        const all = cue(8, "side2", TRUMPETS);
        const split = written(
            [all],
            planFacingEdit({
                cues: [all],
                cueId: all.id,
                part: [1, 2, 3],
                change: { beatId: beatOf(10) },
                relabelFor,
            }),
        );
        const theirs = cueLandedFor(split, [1, 2, 3], beatOf(10))!;
        const back = written(
            split,
            planFacingEdit({
                cues: split,
                cueId: theirs.id,
                change: { beatId: beatOf(8) },
                relabelFor,
            }),
        );
        expect(facingCues(back)).toHaveLength(1);
        expect(facingCues(back)[0]!.marcherIds).toEqual(TRUMPETS);
    });
});

describe("Add selected to this cue, for Facing (#1318)", () => {
    const add = (
        cues: readonly DatabaseCue[],
        target: DatabaseCue,
        ids: readonly number[],
    ) =>
        planAddToCue({
            cues,
            cueId: target.id,
            marcherIds: ids,
            countOf,
            relabelFor,
        });

    it("takes them out of their own cue on the same count, deleting it when it's left empty", () => {
        const rest = cue(8, "side2", TRUMPETS.slice(3));
        const theirs = cue(8, "back", [1, 2, 3]);
        const plan = add([rest, theirs], rest, [1, 2, 3]);
        expect(plan.deletedCueIds).toEqual([theirs.id]);
        expect(plan.newCues).toEqual([]);
        expect(plan.modifiedCues).toEqual([
            { id: rest.id, marcherIds: TRUMPETS, label: "x12" },
        ]);
        const after = written([rest, theirs], plan);
        expect(facing(after, 1, 9)).toBe(90);
    });

    it("takes them out of their cue a couple of counts off, in the same slot", () => {
        const before = cue(0, "side1", TRUMPETS);
        const rest = cue(8, "side2", TRUMPETS.slice(3));
        const theirs = cue(10, "side2", [1, 2, 3], { transition: 2 });
        const after_ = cue(20, "front", TRUMPETS);
        const cues = [before, rest, theirs, after_];
        const plan = add(cues, rest, [1, 2, 3]);
        expect(plan.deletedCueIds).toEqual([theirs.id]);
        const after = written(cues, plan);
        // No leftover turn: T1 does what the cue does, all the way to the next one
        for (const n of [8, 9, 10, 11, 19])
            expect(facing(after, 1, n)).toBe(facing(after, 4, n));
    });

    it("keeps a cue of theirs that's left with others, and their cues outside the slot", () => {
        const before = cue(0, "side1", TRUMPETS);
        const rest = cue(8, "side2", TRUMPETS.slice(3));
        const shared = cue(9, "back", [1, 2, 13]);
        const later = cue(30, "back", [1]);
        const next = cue(20, "front", TRUMPETS);
        const cues = [before, rest, shared, later, next];
        const plan = add(cues, rest, [1, 2]);
        expect(plan.deletedCueIds).toEqual([]);
        expect(plan.modifiedCues).toEqual([
            { id: shared.id, marcherIds: [13], label: "x1" },
            {
                id: rest.id,
                marcherIds: TRUMPETS.slice(3)
                    .concat(1, 2)
                    .sort((a, b) => a - b),
                label: "x11",
            },
        ]);
    });

    it("takes each one out of only their nearest cue when the slot is the whole show", () => {
        // The trumpets' only Facing cue: its slot runs from the start of the show to the end
        const rest = cue(8, "side2", TRUMPETS.slice(3));
        const theirs = cue(10, "side2", [1, 2, 3], { transition: 2 });
        const early = cue(2, "side1", [1, 2, 3]);
        const late = cue(40, "back", [1, 2, 3]);
        const cues = [early, rest, theirs, late];
        const plan = add(cues, rest, [1, 2, 3]);
        expect(plan.deletedCueIds).toEqual([theirs.id]);
        const after = written(cues, plan);
        expect(facing(after, 1, 4)).toBe(facing(cues, 1, 4));
        expect(facing(after, 1, 41)).toBe(180);
    });

    it("leaves Equipment's other counts alone, taking them out of its own count's other cue", () => {
        const eq = (count: number, value: string, ids: number[]) =>
            cue(count, value, ids, {
                type: "equipment",
                value: `builtin:equipment.${value}`,
            });
        const flag = eq(8, "flag", [4, 5]);
        const rifle = eq(8, "rifle", [1]);
        const later = eq(10, "rifle", [1]);
        const plan = add([flag, rifle, later], flag, [1]);
        expect(plan.deletedCueIds).toEqual([rifle.id]);
        expect(plan.modifiedCues).toEqual([
            { id: flag.id, marcherIds: [1, 4, 5], label: "x3" },
        ]);
    });
});
