import { describe, expect, it } from "vitest";
import type { DatabaseCue } from "@/db-functions/cues";
import { partOf, planFacingSplit } from "../facingSplit";

const cue = (over: Partial<DatabaseCue>): DatabaseCue => ({
    id: 1,
    type: "facing",
    beatId: 34,
    value: "builtin:facing.side2",
    settings: {},
    length: null,
    transition: 5,
    marcherIds: [25, 26, 27, 28, 29, 30],
    label: "Trumpets",
    notes: null,
    createdAt: "t",
    updatedAt: "t",
    ...over,
});
const relabelFor = (ids: readonly number[]) => `x${ids.length}`;

describe("partOf", () => {
    it("is the selected part only when some but not all are selected", () => {
        const c = cue({});
        expect(partOf(c, [25, 26, 99])).toEqual([25, 26]);
        expect(partOf(c, [99])).toBeNull();
        expect(partOf(c, c.marcherIds)).toBeNull();
    });
});

describe("planFacingSplit", () => {
    it("splits the part into a cue with the same facing, turn and count", () => {
        const plan = planFacingSplit({
            cues: [cue({})],
            cueId: 1,
            marcherIds: [25, 26, 27],
            relabelFor,
        })!;
        expect(plan.deletedCueIds).toEqual([]);
        expect(plan.modifiedCues).toEqual([
            { id: 1, marcherIds: [28, 29, 30], label: "x3" },
        ]);
        expect(plan.newCues).toEqual([
            expect.objectContaining({
                beatId: 34,
                value: "builtin:facing.side2",
                transition: 5,
                marcherIds: [25, 26, 27],
            }),
        ]);
    });

    it("applies a change to the new cue only", () => {
        const plan = planFacingSplit({
            cues: [cue({})],
            cueId: 1,
            marcherIds: [25],
            change: { beatId: 36, transition: 3 },
            relabelFor,
        })!;
        expect(plan.modifiedCues[0]).toEqual({
            id: 1,
            marcherIds: [26, 27, 28, 29, 30],
            label: "x5",
        });
        expect(plan.newCues[0]).toEqual(
            expect.objectContaining({ beatId: 36, transition: 3 }),
        );
    });

    it("joins a cue that sets the same thing where it lands", () => {
        const other = cue({ id: 2, beatId: 36, marcherIds: [40], label: "U" });
        const plan = planFacingSplit({
            cues: [cue({}), other],
            cueId: 1,
            marcherIds: [25],
            change: { beatId: 36 },
            relabelFor,
        })!;
        expect(plan.deletedCueIds).toEqual([2]);
        expect(plan.newCues[0]!.marcherIds).toEqual([25, 40]);
    });

    it("does nothing for the whole cue", () => {
        expect(
            planFacingSplit({
                cues: [cue({})],
                cueId: 1,
                marcherIds: cue({}).marcherIds,
                relabelFor,
            }),
        ).toBeNull();
    });
});
