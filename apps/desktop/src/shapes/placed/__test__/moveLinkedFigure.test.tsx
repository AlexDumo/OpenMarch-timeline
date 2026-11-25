import { createElement, type ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import { isActionEnabled, runAction } from "@/shortcuts/registry";
import { resolveNudgeDistance } from "@/shortcuts/nudge";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { lineSpots, type LineParams } from "../../line/lineGeometry";
import { lineShape } from "../../line/lineShape";
import { arcShape } from "../../arc/arcShape";
import { setShapeField } from "../../field/shapeField";
import type { XY } from "../../types";
import {
    boxesAt,
    membershipAfter,
    movedBox,
    type PlacedBox,
    type PlacedRecipe,
} from "../placedBox";
import { useBoxSelectionStore } from "../boxSelectionStore";
import { shapesMoved, wholeShapesOf } from "../movedShapes";
import { liveLinks } from "../shapeLinks";
import { PlacedBoxKeys } from "../PlacedBoxKeys";

/**
 * Moving a linked figure (#1236): a J (a line, an arc linked to its end, a tail linked to the
 * arc's far end) selected whole moves as one, every link holding. The plain nudge rounded each
 * marcher onto the grid on its own, which took the arc's marchers off it: the arc was lost, and
 * both its links with it.
 */

// The saves themselves need the database and the field; what the keys ask for is checked here
const saves = vi.hoisted(() => ({
    moveShapes: vi.fn(() => Promise.resolve()),
    commitBox: vi.fn(() => Promise.resolve()),
}));
vi.mock("../commitBox", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../commitBox")>()),
    moveShapes: saves.moveShapes,
    commitBox: saves.commitBox,
}));

const FIT = { mode: "fit" } as const;
const straight = (from: XY, to: XY): LineParams => ({
    points: [
        { ...from, tension: 0 },
        { ...to, tension: 0 },
    ],
    spacing: FIT,
});

function recipe(
    id: number,
    kind: { id: string; version: number },
    params: LineParams,
    ids: readonly number[],
    timelineId = 5,
): PlacedRecipe {
    const spots = lineSpots(params, ids.length);
    return {
        id,
        timelineId,
        kind: kind.id,
        kindVersion: kind.version,
        params: { ...params, spots: ids.length },
        orderMode: "nearest",
        reverse: false,
        members: ids.map((marcherId, slot) => ({
            marcherId,
            slot,
            x: spots[slot]!.x,
            y: spots[slot]!.y,
        })),
    };
}

/** The recipes as placed shapes, each member on its spot, every move ending at 0 */
function placed(recipes: readonly PlacedRecipe[]): PlacedBox[] {
    const at = new Map(
        recipes.flatMap((r) =>
            r.members.map((m) => [m.marcherId, { x: m.x, y: m.y }] as const),
        ),
    );
    return boxesAt({
        recipes,
        endBeatOf: () => 0,
        beat: 0,
        positionOf: (id) => at.get(id),
    });
}

const LINE = [11, 12, 13, 14];
// Four on the arc: they stand off the grid, at 45° steps round it
const ARC = [21, 22, 23, 24];
const TAIL = [31, 32];
const LONE = [41, 42];
const FIGURE = [...LINE, ...ARC, ...TAIL];

/** A J and its tail, and a line on its own; the tail on move `tailMove` */
const jRecipes = (tailMove = 5) => [
    recipe(1, lineShape, straight({ x: 0, y: 0 }, { x: 0, y: 60 }), LINE),
    recipe(
        2,
        arcShape,
        {
            points: [
                { x: 0, y: 60, tension: 0, bend: 180 },
                { x: -40, y: 60, tension: 0 },
            ],
            spacing: FIT,
            attach: { start: { recipe: 1, end: "end" } },
        },
        ARC,
    ),
    recipe(
        3,
        lineShape,
        {
            ...straight({ x: -40, y: 60 }, { x: -40, y: 100 }),
            attach: { start: { recipe: 2, end: "end" } },
        },
        TAIL,
        tailMove,
    ),
    recipe(4, lineShape, straight({ x: 80, y: 0 }, { x: 80, y: 40 }), LONE),
];

const ids = (boxes: readonly { recipe: { id: number } }[]) =>
    boxes.map((b) => b.recipe.id);
const linkIds = (boxes: readonly PlacedBox[]) =>
    liveLinks(boxes, 0).map((l) => [l.attacher.recipe.id, l.owner.recipe.id]);

/** `box` saved as `params`, its members moved `by` with it, read back as a recipe */
const savedAs = (box: PlacedBox, params: unknown, by: XY): PlacedRecipe => ({
    ...box.recipe,
    params: params as PlacedRecipe["params"],
    members: box.recipe.members.map((m) => ({
        ...m,
        x: m.x + by.x,
        y: m.y + by.y,
    })),
});

describe("wholeShapesOf", () => {
    const boxes = placed(jRecipes());

    it("is the shapes a selection is made of, whole, when it's several", () => {
        expect(ids(wholeShapesOf(new Set(FIGURE), boxes))).toEqual([1, 2, 3]);
        expect(
            ids(wholeShapesOf(new Set([...LONE, ...ARC, ...LINE]), boxes)),
        ).toEqual([1, 2, 4]);
    });

    it("is empty for one shape, a shape not whole, a marcher in none, or shapes on two moves", () => {
        expect(wholeShapesOf(new Set(ARC), boxes)).toEqual([]);
        expect(wholeShapesOf(new Set([...LINE, 21, 22]), boxes)).toEqual([]);
        expect(wholeShapesOf(new Set([...LINE, ...ARC, 99]), boxes)).toEqual(
            [],
        );
        expect(wholeShapesOf(new Set(), boxes)).toEqual([]);
        expect(wholeShapesOf(new Set(FIGURE), placed(jRecipes(6)))).toEqual([]);
    });
});

describe("shapesMoved", () => {
    const boxes = placed(jRecipes());
    const [line, arc, tail] = boxes;
    const by = { x: 3.3, y: 0 };

    it("rounding each marcher on its own, as the plain nudge did, takes the arc's marchers off it", () => {
        const rounded = new Map(
            boxes.flatMap((b) =>
                b.recipe.members.map(
                    (m) =>
                        [
                            m.marcherId,
                            { x: Math.round(m.x + by.x), y: m.y },
                        ] as const,
                ),
            ),
        );
        // The line stands on one x, so it moves; the arc's marchers each move a different way
        expect(membershipAfter(line!, rounded).type).toBe("move");
        expect(membershipAfter(arc!, rounded).type).toBe("leave");
    });

    it("moves every shape of the figure the same distance, and every link holds", () => {
        expect(linkIds(boxes)).toEqual([
            [2, 1],
            [3, 2],
        ]);
        const first = movedBox(line!, by).params;
        const others = shapesMoved([line!, arc!, tail!], first, []);
        expect(ids(others.map((o) => o.box))).toEqual([2, 3]);
        const after = placed([
            savedAs(line!, first, by),
            ...others.map((o) => savedAs(o.box, o.params, by)),
            boxes[3]!.recipe,
        ]);
        // Every shape still reads back as a shape, its members on their spots
        expect(ids(after)).toEqual([1, 2, 3, 4]);
        expect(linkIds(after)).toEqual([
            [2, 1],
            [3, 2],
        ]);
        const [a, b] = (after[1]!.params as LineParams).points;
        expect([a!.x, a!.y, b!.x, b!.y].map((v) => v.toFixed(6))).toEqual(
            [3.3, 60, -36.7, 60].map((v) => v.toFixed(6)),
        );
    });

    it("stretches a linked shape left out of the selection, as an edit of one shape does", () => {
        const first = movedBox(line!, by).params;
        const others = shapesMoved([line!, arc!], first, liveLinks(boxes, 0));
        expect(ids(others.map((o) => o.box))).toEqual([2, 3]);
        const tailAfter = others[1]!.params as LineParams;
        // Its end at the joint goes with the arc; its far end stays
        expect(tailAfter.points[0]!.x).toBeCloseTo(-36.7);
        expect(tailAfter.points[0]!.y).toBeCloseTo(60);
        expect(tailAfter.points[1]).toMatchObject({ x: -40, y: 100 });
    });
});

describe("the nudge keys with a linked figure selected", () => {
    const fieldProperties =
        FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);

    beforeEach(() => {
        setShapeField({
            fieldProperties: () => fieldProperties,
            zoom: () => 1,
            marchers: () => [],
            drawn: () => new Map(),
        });
    });
    afterEach(() => {
        cleanup();
        setShapeField(null);
        saves.moveShapes.mockClear();
        saves.commitBox.mockClear();
        useBoxSelectionStore.setState({
            selected: null,
            shapes: [],
            inside: null,
        });
    });

    it("moves the figure's shapes together, through moveShapes, by the nudge's distance", () => {
        const figure = placed(jRecipes()).slice(0, 3);
        useBoxSelectionStore.setState({ selected: null, shapes: figure });
        render(createElement(PlacedBoxKeys), { wrapper });
        expect(isActionEnabled("moveSelectedMarchersRight")).toBe(true);
        runAction("moveSelectedMarchersRight");
        const steps = resolveNudgeDistance(
            { direction: "right", step: "grid", snap: true },
            useUiSettingsStore.getState().uiSettings.coordinateRounding,
        );
        expect(saves.moveShapes).toHaveBeenCalledTimes(1);
        expect(saves.moveShapes).toHaveBeenCalledWith(
            figure,
            { x: steps * fieldProperties.pixelsPerStep, y: 0 },
            expect.anything(),
            queryClient,
        );
        expect(saves.commitBox).not.toHaveBeenCalled();
    });

    it("still moves one shape selected whole through its own save", () => {
        const [line] = placed(jRecipes());
        useBoxSelectionStore.setState({ selected: line!, shapes: [] });
        render(createElement(PlacedBoxKeys), { wrapper });
        runAction("moveSelectedMarchersLeft");
        expect(saves.commitBox).toHaveBeenCalledTimes(1);
        expect(saves.moveShapes).not.toHaveBeenCalled();
    });
});
