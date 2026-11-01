// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { GeometryChange, PlacementChange, XY } from "@openmarch/core";
import { PIXELS_PER_METER } from "@/items/itemOutlines";
import type { PropInput } from "@/view3d/core/props/propLayout";
import {
    platformNotes,
    STEP_NOTE_HEIGHT,
    type PlatformNotesInput,
} from "../platformNotes";

const IN = 0.0254;
const box = (
    width: number,
    depth: number,
    height: number,
    beat = 0,
): GeometryChange => ({
    beat,
    outlineType: "rectangle",
    width,
    depth,
    height,
    rotation: 0,
    customOutline: null,
    transitionLength: 1,
    rollsOut: false,
    leadingEdge: null,
});

const prop = (
    id: number,
    surface: PropInput["surface"],
    changes: GeometryChange[],
    placements: PlacementChange[] = [],
): PropInput => ({ id, surface, changes, placements });

/** Meters to field units */
const at = (x: number, z: number): XY => [
    x * PIXELS_PER_METER,
    z * PIXELS_PER_METER,
];

// Performers
const P12 = 1;
const T4 = 2;

// Props, by their marchers rows, and their item ids
const STAGE = 101;
const RISER = 102;
const WALL = 103;
const itemIds = new Map([
    [STAGE, 201],
    [RISER, 202],
    [WALL, 203],
]);

/** Walks along x one meter a beat from `from` */
const walk =
    (from: number, z = 0) =>
    (beat: number): XY =>
        at(from + beat, z);

const run = (
    props: PropInput[],
    performers: Record<number, (beat: number) => XY>,
    propAt: Record<number, (beat: number) => XY> = {},
    beatCount = 12,
) => {
    const input: PlatformNotesInput = {
        props,
        itemIdOf: (marcherId) => itemIds.get(marcherId)!,
        performers: Object.keys(performers).map(Number),
        beatCount,
        positionAt: (id, beat) =>
            performers[id]?.(beat) ??
            propAt[id]?.(beat) ??
            (itemIds.has(id) ? at(0, 0) : null),
        unitsPerMeter: PIXELS_PER_METER,
    };
    return platformNotes(input);
};

describe("platformNotes", () => {
    it("notes a step up of more than 16 in, at the count it happens", () => {
        // a 24 in stage, 4 m across: P12 walks onto it between beats 3 and 4
        const notes = run([prop(STAGE, "platform", [box(4, 4, 24 * IN)])], {
            [P12]: walk(-5.5),
        });
        expect(notes).toEqual([
            expect.objectContaining({
                id: `platform_step:${P12}:4`,
                kind: "platform_step",
                beat: 4,
                until: 5,
                what: expect.objectContaining({
                    itemIds: [itemIds.get(STAGE)],
                    marcherIds: [P12],
                }),
                detail: expect.objectContaining({ rise: expect.any(Number) }),
            }),
            expect.objectContaining({
                kind: "platform_step",
                beat: 8,
                detail: expect.objectContaining({
                    rise: expect.closeTo(-24 * IN),
                }),
            }),
        ]);
        expect(notes[0]!.detail!.rise).toBeCloseTo(24 * IN);
    });

    it("lets steps of 16 in or less pass, and stacked platforms make steps", () => {
        expect(
            run(
                [
                    prop(STAGE, "platform", [box(6, 6, 16 * IN)]),
                    prop(RISER, "platform", [box(2, 2, 16 * IN)]),
                ],
                { [P12]: walk(-5.5) },
            ),
        ).toEqual([]);
        expect(STEP_NOTE_HEIGHT).toBeCloseTo(16 * IN);
    });

    it("notes a performer inside an obstacle once, over the counts they are in it", () => {
        const notes = run([prop(WALL, "obstacle", [box(3, 3, 2)])], {
            [T4]: walk(-3.6),
        });
        expect(notes).toEqual([
            expect.objectContaining({
                id: `inside_obstacle:${T4}:${WALL}:3`,
                kind: "inside_obstacle",
                beat: 3,
                until: 6,
                what: expect.objectContaining({
                    itemIds: [itemIds.get(WALL)],
                    marcherIds: [T4],
                }),
            }),
        ]);
    });

    it("notes a dot that leaves a platform while it moves", () => {
        // the stage rolls off along +x faster than P12, who stands still on it at first
        const notes = run(
            [prop(STAGE, "platform", [box(2, 2, 8 * IN)])],
            { [P12]: () => at(0, 0) },
            { [STAGE]: (beat) => at(beat * 0.6, 0) },
        );
        expect(notes).toEqual([
            expect.objectContaining({
                kind: "leaves_moving_platform",
                beat: 2,
                what: expect.objectContaining({
                    itemIds: [itemIds.get(STAGE)],
                    marcherIds: [P12],
                }),
            }),
        ]);
    });

    it("says nothing about stepping off a platform that stands still", () => {
        expect(
            run([prop(STAGE, "platform", [box(2, 2, 8 * IN)])], {
                [P12]: walk(0),
            }).filter((n) => n.kind === "leaves_moving_platform"),
        ).toEqual([]);
    });

    it("says nothing without platforms or obstacles", () => {
        expect(
            run([prop(STAGE, "floor", [box(4, 4, 0)])], { [P12]: walk(-5.5) }),
        ).toEqual([]);
    });
});
