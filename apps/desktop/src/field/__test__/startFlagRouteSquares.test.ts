import { describe, expect, it } from "vitest";
import { createResolver, type Resolver } from "@openmarch/core";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import { GOLDEN_FIXTURES } from "@/timeline/fixtures/goldenFixtures";
import { marcherSetBeats } from "@/timeline/timelineSetFollowing";
import { resolverSpans } from "@/timeline/timelineStore";
import type { StartFlagLevels } from "@/timeline/startFlagLevels";
import {
    planStartFlagOverlay,
    ROUTE_SQUARE_COLOR,
    ROUTE_SQUARE_FILL,
    ROUTE_SQUARE_OUTLINE,
    ROUTE_SQUARE_SIZE,
    type StartFlagOverlay,
    type StartFlagOverlayInput,
} from "../startFlagOverlay";

/**
 * Route squares (holds decision 9, fork #479): on a selected marcher's drawn start flag route, a
 * square at each spot where a coordinate is set (a keyframe: the end of one of its own moves, as
 * `marcherSetBeats` finds them), and none at the counts it only passes through.
 */

const resolverFor = (name: string): Resolver =>
    createResolver(GOLDEN_FIXTURES.find((g) => g.name === name)!.build().show);

const fieldProperties =
    FieldPropertiesTemplates.HIGH_SCHOOL_FOOTBALL_FIELD_WITH_END_ZONES;

/** The shared keyframe computation the timeline's diamonds use, with nothing kept. */
const setBeatsOf = (resolver: Resolver) => (id: number) =>
    marcherSetBeats(resolverSpans(resolver, id), (beat) =>
        resolver.positionAt(id, beat),
    );

function input(
    resolver: Resolver,
    overrides: Partial<StartFlagOverlayInput> = {},
): StartFlagOverlayInput {
    const levels: StartFlagLevels = { dots: "all", paths: "all" };
    return {
        resolver,
        marcherIds: [...resolver.marcherIds()],
        selectedIds: new Set(resolver.marcherIds()),
        fromBeat: 0,
        toBeat: 20,
        levels,
        stepSizeWarnings: false,
        fieldProperties,
        setBeatsOf: setBeatsOf(resolver),
        ...overrides,
    };
}

/** Each square's center: its outline and its white inside share one. */
function squareCenters(plan: StartFlagOverlay): [number, number][] {
    const outlines = plan.dots.strokes.filter(
        (s) => s.color === ROUTE_SQUARE_COLOR,
    );
    return outlines.map((s) => [
        (s.points[0]!.x + s.points[1]!.x) / 2,
        s.points[0]!.y,
    ]);
}

describe("route squares", () => {
    it("puts a square at each set spot on a selected marcher's route, none in between", () => {
        // G4: home (0, 0), a move to (8, 0) ending on 8, a hold, then a move to (8, 8) ending on 20
        const g4 = resolverFor("G4");
        const plan = planStartFlagOverlay(input(g4));
        // Home is always set; 8 and 20 are move ends. Nothing at 4 or 16, which it passes
        expect(squareCenters(plan)).toEqual([
            [0, 0],
            [8, 0],
            [8, 8],
        ]);
    });

    it("only squares the set spots inside the window, playhead included", () => {
        const g4 = resolverFor("G4");
        // [4, 16]: walking at 4 (no square at the start flag) and 16, set on 8
        expect(
            squareCenters(
                planStartFlagOverlay(input(g4, { fromBeat: 4, toBeat: 16 })),
            ),
        ).toEqual([[8, 0]]);
        // [10, 20]: holding at the start flag on the spot set on 8 isn't set there; set on 20
        expect(
            squareCenters(
                planStartFlagOverlay(input(g4, { fromBeat: 10, toBeat: 20 })),
            ),
        ).toEqual([[8, 8]]);
        // [8, 20]: set at both ends of the window
        expect(
            squareCenters(
                planStartFlagOverlay(input(g4, { fromBeat: 8, toBeat: 20 })),
            ),
        ).toEqual([
            [8, 0],
            [8, 8],
        ]);
    });

    it("doesn't square the start flag just because the marcher stands on an earlier set spot", () => {
        // G5: marcher 2 stays home at (0, 0) until a move from 8 ends on 16
        const g5 = resolverFor("G5");
        const end = g5.positionAt(2, 16) as [number, number];
        // Still home at the start flag (1): home was set on 0, not on 1
        expect(
            squareCenters(
                planStartFlagOverlay(input(g5, { fromBeat: 1, toBeat: 16 })),
            ),
        ).toEqual([end]);
        // Partway through the move at the start flag: no square there either
        expect(
            squareCenters(
                planStartFlagOverlay(input(g5, { fromBeat: 12, toBeat: 16 })),
            ),
        ).toEqual([end]);
    });

    it("doesn't square a count where a later move takes over partway", () => {
        // G2: the first move is cut at 8 by a layer-1 move that ends on 16 at (8, 8)
        const g2 = resolverFor("G2");
        const centers = squareCenters(planStartFlagOverlay(input(g2)));
        expect(centers).toEqual([
            [0, 0],
            [8, 8],
        ]);
    });

    it("draws each square as a gray outline with a white inside, over the warnings and under the dots", () => {
        const g4 = resolverFor("G4");
        const plan = planStartFlagOverlay(
            input(g4, { fromBeat: 4, toBeat: 16, stepSizeWarnings: true }),
        );
        const [outline, inside] = plan.dots.strokes.slice(-2);
        expect(outline).toEqual({
            points: [
                { x: 8 - ROUTE_SQUARE_SIZE / 2, y: 0 },
                { x: 8 + ROUTE_SQUARE_SIZE / 2, y: 0 },
            ],
            color: ROUTE_SQUARE_COLOR,
            width: ROUTE_SQUARE_SIZE,
            dash: null,
            round: false,
        });
        const inner = ROUTE_SQUARE_SIZE - 2 * ROUTE_SQUARE_OUTLINE;
        expect(inside).toMatchObject({
            color: ROUTE_SQUARE_FILL,
            width: inner,
            round: false,
        });
        // Field units, as the dots drawn over them
        expect(plan.dots.units).toBe("field");
        expect(plan.paths.strokes.every((s) => s.width < inner)).toBe(true);
    });

    it("squares only the selected marchers' routes", () => {
        // G6: four marchers follow the leader, each move ending on 12
        const g6 = resolverFor("G6");
        const window = { fromBeat: 4, toBeat: 12 };
        const one = planStartFlagOverlay(
            input(g6, { ...window, selectedIds: new Set([2]) }),
        );
        expect(squareCenters(one)).toEqual([
            g6.positionAt(2, 12) as [number, number],
        ]);
        // Every route is drawn, but nothing is selected: no squares
        const none = planStartFlagOverlay(
            input(g6, { ...window, selectedIds: new Set() }),
        );
        expect(squareCenters(none)).toEqual([]);
        expect(none.paths.strokes.length).toBeGreaterThan(0);
        // Without squares the plan is what start flag positions drew before
        expect(none).toEqual(
            planStartFlagOverlay(
                input(g6, {
                    ...window,
                    selectedIds: new Set(),
                    setBeatsOf: undefined,
                }),
            ),
        );
    });

    it("draws no squares where the selected marcher's route isn't drawn", () => {
        const g4 = resolverFor("G4");
        // Dots only: no route, so no squares on it
        const dotsOnly = planStartFlagOverlay(
            input(g4, { levels: { dots: "all", paths: "off" } }),
        );
        expect(dotsOnly.dots.dots).toHaveLength(1);
        expect(squareCenters(dotsOnly)).toEqual([]);
        // Holding through the window: no route, no squares (G4 holds over [8, 12])
        expect(
            planStartFlagOverlay(input(g4, { fromBeat: 8, toBeat: 12 })).dots
                .strokes,
        ).toEqual([]);
    });
});
