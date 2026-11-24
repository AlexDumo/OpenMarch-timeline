// @vitest-environment node
import { describe, expect, it } from "vitest";
import { facingAt } from "@openmarch/core";
import type { DatabaseCue } from "@/db-functions/cues";
import { compileShowCues } from "../showCues";
import { planCueChange } from "../equipment";
import {
    facingAlready,
    facingLane,
    facingValueOf,
    planFacingSet,
    turnLabel,
} from "../facing";

/** Four trumpets over 32 counts. Beat 0 is the fixed first beat; counts 0–31 are ids 100–131. */
const MARCHERS = [1, 2, 3, 4].map((id) => ({ id, section: "Trumpet" }));
const BEATS = [
    { id: 1, position: 0, duration: 0 },
    ...Array.from({ length: 32 }, (_, c) => ({
        id: 100 + c,
        position: c + 1,
        duration: 0.5,
    })),
];
const beatOf = (count: number) => 100 + count;

let nextId = 1;
const stored = (
    count: number,
    value: string,
    marcherIds: number[],
    extra: Partial<DatabaseCue> = {},
): DatabaseCue => ({
    id: nextId++,
    type: "facing",
    beatId: beatOf(count),
    value,
    settings: {},
    length: null,
    transition: null,
    marcherIds,
    label: null,
    notes: null,
    createdAt: "",
    updatedAt: "",
    ...extra,
});
const label = () => null;

describe("setting a facing (#993)", () => {
    it("writes one lasting, instant cue at the playhead for the selection", () => {
        const plan = planFacingSet({
            cues: [],
            choice: { kind: "side2" },
            marcherIds: [1, 2],
            beatId: beatOf(8),
            labelFor: () => "Trumpets",
        });
        expect(plan.newCues).toEqual([
            {
                type: "facing",
                beatId: beatOf(8),
                value: "builtin:facing.side2",
                settings: {},
                marcherIds: [1, 2],
                label: "Trumpets",
            },
        ]);
    });

    it("stores Angle… as its exact degrees", () => {
        expect(facingValueOf({ kind: "angle", degrees: -270 })).toEqual({
            value: "builtin:facing.angle",
            settings: { degrees: -270 },
        });
    });

    it("takes the selection out of the other Facing cues on that count", () => {
        const back = stored(8, "builtin:facing.back", [1, 2, 3]);
        const plan = planFacingSet({
            cues: [back],
            choice: { kind: "side1" },
            marcherIds: [1, 2],
            beatId: beatOf(8),
            labelFor: label,
        });
        expect(plan.modifiedCues).toEqual([
            { id: back.id, marcherIds: [3], label: null },
        ]);
        expect(plan.newCues).toHaveLength(1);
    });

    it("joins a cue on that count that sets the same facing", () => {
        const side = stored(8, "builtin:facing.side1", [3]);
        const plan = planFacingSet({
            cues: [side],
            choice: { kind: "side1" },
            marcherIds: [1],
            beatId: beatOf(8),
            labelFor: label,
        });
        expect(plan.newCues).toEqual([]);
        expect(plan.modifiedCues).toEqual([
            { id: side.id, marcherIds: [1, 3], label: null },
        ]);
    });

    it("never joins an angle of other degrees", () => {
        const angle = stored(8, "builtin:facing.angle", [3], {
            settings: { degrees: 45 },
        });
        const plan = planFacingSet({
            cues: [angle],
            choice: { kind: "angle", degrees: 90 },
            marcherIds: [1],
            beatId: beatOf(8),
            labelFor: label,
        });
        expect(plan.newCues).toHaveLength(1);
        expect(plan.modifiedCues).toEqual([]);
    });

    it("says when everyone selected already faces that way, from any number of spins", () => {
        const cues = [
            stored(2, "builtin:facing.angle", [1], {
                settings: { degrees: 360 },
            }),
            stored(2, "builtin:facing.side2", [2]),
        ];
        const show = compileShowCues(MARCHERS, BEATS, cues);
        const at = (
            choice: Parameters<typeof facingAlready>[0]["choice"],
            ids: number[],
        ) =>
            facingAlready({
                compiled: show.compiled,
                choice,
                marcherIds: ids,
                count: 8,
            });
        expect(at({ kind: "front" }, [1])).toBe(true);
        expect(at({ kind: "front" }, [1, 2])).toBe(false);
        expect(at({ kind: "side2" }, [2])).toBe(true);
        expect(at({ kind: "turnLeft" }, [1])).toBe(false);
        expect(at({ kind: "angle", degrees: 360 }, [1])).toBe(true);
        expect(at({ kind: "angle", degrees: 0 }, [1])).toBe(false);
        expect(at({ kind: "front" }, [])).toBe(false);
    });
});

describe("stretching a turn (#993)", () => {
    it("sets how many counts a turn takes, and back to instant", () => {
        const turn = stored(8, "builtin:facing.back", [1]);
        const cues = [turn];
        const relabelFor = () => null;
        expect(
            planCueChange({
                cues,
                cueId: turn.id,
                change: { transition: 2 },
                relabelFor,
            }).modifiedCues,
        ).toEqual([{ id: turn.id, transition: 2 }]);
        const stretched = { ...turn, transition: 2 };
        expect(
            planCueChange({
                cues: [stretched],
                cueId: turn.id,
                change: { transition: null },
                relabelFor,
            }).modifiedCues,
        ).toEqual([{ id: turn.id, transition: null }]);
        const show = compileShowCues(MARCHERS, BEATS, [stretched]);
        expect(facingAt(show.compiled, 1, 9)).toBe(90);
    });

    it("moves a turn onto a count where its performers have another: theirs is replaced", () => {
        const a = stored(8, "builtin:facing.back", [1, 2]);
        const b = stored(12, "builtin:facing.side1", [1]);
        const plan = planCueChange({
            cues: [a, b],
            cueId: a.id,
            change: { beatId: beatOf(12) },
            relabelFor: label,
        });
        expect(plan.deletedCueIds).toEqual([b.id]);
        expect(plan.modifiedCues).toEqual([{ id: a.id, beatId: beatOf(12) }]);
    });
});

describe("the Facing lane (#993)", () => {
    it("draws a row per facing history: turns striped, holds solid", () => {
        const cues = [
            stored(8, "builtin:facing.side2", [1, 2], { transition: 2 }),
            stored(8, "builtin:facing.angle", [3], {
                settings: { degrees: 360 },
                transition: 4,
            }),
        ];
        const show = compileShowCues(MARCHERS, BEATS, cues);
        const lane = facingLane({
            compiled: show.compiled,
            cues,
            marcherIds: [1, 2, 3, 4],
        });
        expect(lane.rows.map((r) => r.marcherIds)).toEqual([[1, 2], [3]]);
        expect(
            lane.rows[0]!.pieces.map((p) => [
                p.from,
                p.to,
                p.kind,
                p.fromDegrees,
                p.degrees,
                p.cueId,
            ]),
        ).toEqual([
            [0, 8, "hold", 0, 0, null],
            [8, 10, "turn", 0, 90, cues[0]!.id],
            [10, 32, "hold", 90, 90, cues[0]!.id],
        ]);
        // an instant turn has no stripe: its hold starts on its count
        const instant = [stored(4, "builtin:facing.back", [4])];
        const one = facingLane({
            compiled: compileShowCues(MARCHERS, BEATS, instant).compiled,
            cues: instant,
            marcherIds: [4],
        });
        expect(one.rows[0]!.pieces.map((p) => [p.from, p.to, p.kind])).toEqual([
            [0, 4, "hold"],
            [4, 32, "hold"],
        ]);
    });

    it("names a turn by its angles, and a hold by its facing", () => {
        const names = {
            front: "Front",
            back: "Back",
            side1: "Side 1",
            side2: "Side 2",
        };
        expect(
            turnLabel({ kind: "turn", fromDegrees: 0, degrees: 90 }, names),
        ).toBe("0° → 90°");
        expect(
            turnLabel({ kind: "hold", fromDegrees: 90, degrees: 90 }, names),
        ).toBe("Side 2 · 90°");
        expect(
            turnLabel({ kind: "hold", fromDegrees: 360, degrees: 360 }, names),
        ).toBe("Front · 360°");
        expect(
            turnLabel({ kind: "hold", fromDegrees: 45, degrees: 45 }, names),
        ).toBe("45°");
        expect(
            turnLabel({ kind: "hold", fromDegrees: -90, degrees: -90 }, names),
        ).toBe("Side 1 · −90°");
    });
});
