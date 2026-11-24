// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { DatabaseCue } from "@/db-functions/cues";
import {
    cueEdgeDrag,
    cueNeighbours,
    endAtCount,
    turnEndAtCount,
    turnEndDrag,
} from "../cueEdges";
import { compileShowCues } from "../showCues";
import { equipmentLane } from "../equipmentLane";

/** A cue on beat 10; the row's next cue starts on beat 30. */
const momentary = { start: 10, length: 8 };
const lasting = { start: 10, length: null };
const until = 30;

describe("dragging a cue's end edge (#992)", () => {
    it("changes a momentary cue's length", () => {
        expect(
            cueEdgeDrag({ edge: "end", cue: momentary, until, delta: 4 }),
        ).toEqual({ start: 10, length: 12, end: 22 });
        expect(
            cueEdgeDrag({ edge: "end", cue: momentary, until, delta: -3 }),
        ).toEqual({ start: 10, length: 5, end: 15 });
    });

    it("makes a lasting cue momentary, ending where it's dropped", () => {
        expect(
            cueEdgeDrag({ edge: "end", cue: lasting, until, delta: -12 }),
        ).toEqual({ start: 10, length: 8, end: 18 });
    });

    it("makes it lasting again on reaching or passing the row's next cue", () => {
        expect(
            cueEdgeDrag({ edge: "end", cue: momentary, until, delta: 12 }),
        ).toEqual({ start: 10, length: null, end: 30 });
        expect(
            cueEdgeDrag({ edge: "end", cue: momentary, until, delta: 40 }),
        ).toEqual({ start: 10, length: null, end: 30 });
        // A lasting cue dragged nowhere, or past its end, stays lasting
        expect(
            cueEdgeDrag({ edge: "end", cue: lasting, until, delta: 0 }),
        ).toEqual({ start: 10, length: null, end: 30 });
    });

    it("never ends before it starts: at least 1 count", () => {
        expect(
            cueEdgeDrag({ edge: "end", cue: momentary, until, delta: -50 }),
        ).toEqual({ start: 10, length: 1, end: 11 });
        expect(
            cueEdgeDrag({ edge: "end", cue: lasting, until, delta: -50 }),
        ).toEqual({ start: 10, length: 1, end: 11 });
    });
});

describe("dragging a cue's start edge (#992)", () => {
    it("moves a momentary cue's start and keeps its end", () => {
        expect(
            cueEdgeDrag({ edge: "start", cue: momentary, until, delta: 3 }),
        ).toEqual({ start: 13, length: 5, end: 18 });
        expect(
            cueEdgeDrag({ edge: "start", cue: momentary, until, delta: -4 }),
        ).toEqual({ start: 6, length: 12, end: 18 });
    });

    it("moves a lasting cue's start; it still lasts until the next cue", () => {
        expect(
            cueEdgeDrag({ edge: "start", cue: lasting, until, delta: 5 }),
        ).toEqual({ start: 15, length: null, end: 30 });
    });

    it("stops a count before the end, and no earlier than the first beat", () => {
        expect(
            cueEdgeDrag({ edge: "start", cue: momentary, until, delta: 20 }),
        ).toEqual({ start: 17, length: 1, end: 18 });
        expect(
            cueEdgeDrag({ edge: "start", cue: lasting, until, delta: 50 }),
        ).toEqual({ start: 29, length: null, end: 30 });
        expect(
            cueEdgeDrag({ edge: "start", cue: momentary, until, delta: -20 }),
        ).toEqual({ start: 1, length: 17, end: 18 });
    });
});

/** A real catalog item per cue id, so the compile reads them. */
const ITEMS = ["rifle", "sabre", "flag", "tuba", "trumpet", "snare"];
/** An Equipment cue for performers 1 and 2 on count `count` (beat ids are 100 + count). */
const cueAt = (
    id: number,
    count: number,
    length: number | null = null,
    marcherIds = [1, 2],
): DatabaseCue => ({
    id,
    type: "equipment",
    beatId: 100 + count,
    value: `builtin:equipment.${ITEMS[id - 1]}`,
    settings: {},
    length,
    transition: null,
    marcherIds,
    label: null,
    notes: null,
    createdAt: "",
    updatedAt: "",
});
const countOf = (beatId: number) => beatId - 100;
/** The show's last count */
const SHOW_END = 96;

/** Drags `cue`'s `edge` by `delta` among `cues`, as the lane does. */
function drag(
    cues: DatabaseCue[],
    cue: DatabaseCue,
    edge: "start" | "end",
    delta: number,
) {
    const near = cueNeighbours({ cues, cue, countOf });
    return cueEdgeDrag({
        edge,
        cue: { start: countOf(cue.beatId), length: cue.length },
        until: near.nextLasting ?? SHOW_END,
        nextMomentary: near.nextMomentary,
        previous: near.previous,
        delta,
    });
}

// Review of #1041 (after d6c26b3d3): the bugs in the edge maths, each as its scenario
describe("cue edges among the performers' other cues (#992 review)", () => {
    it("a momentary cue after a lasting one stays momentary, and can be lengthened", () => {
        // Rifle lasting @10, Sabre momentary @20 for 4, Flag lasting @60
        const sabre = cueAt(2, 20, 4);
        const cues = [cueAt(1, 10), sabre, cueAt(3, 60)];
        expect(drag(cues, sabre, "end", 0)).toEqual({
            start: 20,
            length: 4,
            end: 24,
        });
        expect(drag(cues, sabre, "end", 2)).toEqual({
            start: 20,
            length: 6,
            end: 26,
        });
        // Only the next lasting cue makes it lasting again
        expect(drag(cues, sabre, "end", 40)).toEqual({
            start: 20,
            length: null,
            end: 60,
        });
    });

    it("reaching a momentary next cue stops there and stays momentary", () => {
        // Sabre momentary @10 for 4, Rifle momentary @30 for 2, nothing else
        const sabre = cueAt(1, 10, 4);
        const cues = [sabre, cueAt(2, 30, 2)];
        expect(drag(cues, sabre, "end", 16)).toEqual({
            start: 10,
            length: 20,
            end: 30,
        });
        expect(drag(cues, sabre, "end", 30)).toEqual({
            start: 10,
            length: 20,
            end: 30,
        });
    });

    it("a lasting cue's start edge stops just after the previous cue, keeping its end", () => {
        // Rifle lasting @5, Sabre lasting @10, Flag lasting @60
        const sabre = cueAt(2, 10);
        const cues = [cueAt(1, 5), sabre, cueAt(3, 60)];
        expect(drag(cues, sabre, "start", -7)).toEqual({
            start: 6,
            length: null,
            end: 60,
        });
    });

    it("End cue at playhead follows the same rule: refused past the next lasting cue", () => {
        // Rifle lasting @10, Sabre lasting @20, playhead on 30
        const rifle = cueAt(1, 10);
        const cues = [rifle, cueAt(2, 20)];
        expect(
            endAtCount({
                cues,
                cue: rifle,
                countOf,
                count: 30,
                showEnd: SHOW_END,
            }),
        ).toEqual({ refused: "pastNext" });
        expect(
            endAtCount({
                cues,
                cue: rifle,
                countOf,
                count: 15,
                showEnd: SHOW_END,
            }),
        ).toEqual({ length: 5 });
        // At the next lasting cue's count: it already ends there
        expect(
            endAtCount({
                cues,
                cue: rifle,
                countOf,
                count: 20,
                showEnd: SHOW_END,
            }),
        ).toEqual({ refused: "endsThere" });
        expect(
            endAtCount({
                cues,
                cue: rifle,
                countOf,
                count: 10,
                showEnd: SHOW_END,
            }),
        ).toEqual({ refused: "beforeStart" });
    });

    it("finds the neighbours among cues for any of the cue's performers, not other people's", () => {
        const cue = cueAt(5, 20, 4);
        const near = cueNeighbours({
            cues: [
                cueAt(1, 10),
                cueAt(2, 15, 2, [3]),
                cue,
                cueAt(3, 30, 2, [2]),
                cueAt(4, 50, null, [1]),
                cueAt(6, 40, null, [9]),
            ],
            cue,
            countOf,
        });
        expect(near).toEqual({
            previous: 10,
            nextLasting: 50,
            nextMomentary: 30,
        });
    });

    it("what the drags write is what the lane then shows", () => {
        const guard = [1, 2].map((id) => ({
            id,
            section: "Color Guard",
            drill_prefix: "G",
            drill_order: id,
        }));
        const beats = [
            { id: 1, position: 0, duration: 0 },
            ...Array.from({ length: 96 }, (_, c) => ({
                id: 100 + c,
                position: c + 1,
                duration: 0.5,
            })),
        ];
        const pieces = (cues: DatabaseCue[]) => {
            const show = compileShowCues(guard, beats, cues);
            return equipmentLane({
                compiled: show.compiled,
                cues,
                usual: show.usual,
            }).rows[0]!.pieces.map((p) => [p.from, p.to, p.cueId]);
        };
        // Scenario 1, Sabre lengthened to 6 counts: the rifle comes back after it
        const sabre = cueAt(2, 20, 4);
        const one = [cueAt(1, 10), sabre, cueAt(3, 60)];
        const longer = drag(one, sabre, "end", 2);
        expect(
            pieces([cueAt(1, 10), cueAt(2, 20, longer.length), cueAt(3, 60)]),
        ).toEqual([
            [0, 10, null],
            [10, 20, 1],
            [20, 26, 2],
            [26, 60, 1],
            [60, 96, 3],
        ]);
        // Scenario 3, Sabre's start dragged back: it keeps counts 10 to 59
        const lasting = cueAt(2, 10);
        const three = [cueAt(1, 5), lasting, cueAt(3, 60)];
        const earlier = drag(three, lasting, "start", -7);
        expect(
            pieces([cueAt(1, 5), cueAt(2, earlier.start), cueAt(3, 60)]),
        ).toEqual([
            [0, 5, null],
            [5, 6, 1],
            [6, 60, 2],
            [60, 96, 3],
        ]);
    });
});

describe("a Facing turn's end (#993)", () => {
    it("sets how many counts the turn takes, never before its start nor past the next turn", () => {
        const at = (delta: number, transition: number | null = null) =>
            turnEndDrag({ start: 8, transition, until: 12, delta });
        expect(at(2)).toEqual({ transition: 2, end: 10 });
        expect(at(-3, 2)).toEqual({ transition: null, end: 8 });
        expect(at(9)).toEqual({ transition: 4, end: 12 });
        expect(at(-1, 2)).toEqual({ transition: 1, end: 9 });
    });

    it("ends a turn at the playhead, or says why not", () => {
        const facing = (
            id: number,
            beatId: number,
            transition: number | null = null,
        ) =>
            ({
                id,
                type: "facing",
                beatId,
                value: "builtin:facing.back",
                settings: {},
                length: null,
                transition,
                marcherIds: [1],
                label: null,
                notes: null,
                createdAt: "",
                updatedAt: "",
            }) satisfies DatabaseCue;
        const cue = facing(1, 108);
        const cues = [cue, facing(2, 112)];
        const countOf = (beatId: number) => beatId - 100;
        const end = (count: number, c = cue) =>
            turnEndAtCount({ cues, cue: c, countOf, count, showEnd: 32 });
        expect(end(10)).toEqual({ transition: 2 });
        expect(end(7)).toEqual({ refused: "beforeStart" });
        expect(end(13)).toEqual({ refused: "pastNext" });
        expect(end(8)).toEqual({ refused: "endsThere" });
        expect(end(8, facing(1, 108, 2))).toEqual({ transition: null });
        expect(end(10, facing(1, 108, 2))).toEqual({ refused: "endsThere" });
    });
});
