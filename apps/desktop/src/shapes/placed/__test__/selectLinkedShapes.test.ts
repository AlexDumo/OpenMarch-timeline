import { renderHook } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import tolgee from "@/global/singletons/Tolgee";
import type { FieldEditor } from "@/field/editor/fieldEditor";
import { setActiveFieldEditor } from "@/field/editor/activeFieldEditor";
import {
    actionDisabledReason,
    actionLabelNow,
    isActionEnabled,
} from "@/shortcuts/registry";
import { lineSpots, type LineParams } from "../../line/lineGeometry";
import { lineShape } from "../../line/lineShape";
import { arcShape } from "../../arc/arcShape";
import { useHandleMenuStore } from "../../field/handleMenu";
import type { XY } from "../../types";
import { boxesAt, type PlacedBox, type PlacedRecipe } from "../placedBox";
import { useBoxSelectionStore } from "../boxSelectionStore";
import { openJointMenu } from "../detachLinks";
import { linkedFigure, liveLinks } from "../shapeLinks";
import {
    doubleClickMember,
    doubleClickSelection,
    linkedShapesSelection,
    useSelectLinkedShapes,
} from "../selectLinkedShapes";

/**
 * Select linked shapes (#1236): a linked shape's whole figure, found through the links of each
 * shape in turn, selected by a double-click, the joint's menu, the field's menu and the palette.
 */

// The field's placed shapes, as the store would read them; the resolver they need isn't here
const shown = vi.hoisted(() => ({ boxes: [] as unknown[] }));
vi.mock("../placedBoxStore", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../placedBoxStore")>()),
    placedBoxesAt: () => shown.boxes,
}));

const FIT = { mode: "fit" } as const;
const straight = (from: XY, to: XY): LineParams => ({
    points: [
        { ...from, tension: 0 },
        { ...to, tension: 0 },
    ],
    spacing: FIT,
});
const arc = (from: XY, to: XY): LineParams => ({
    points: [
        { ...from, tension: 0, bend: 180 },
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

/** The recipes as placed shapes at `beat`, each member on its spot, every move ending at 0 */
function placed(recipes: readonly PlacedRecipe[], beat = 0): PlacedBox[] {
    const at = new Map(
        recipes.flatMap((r) =>
            r.members.map((m) => [m.marcherId, { x: m.x, y: m.y }] as const),
        ),
    );
    return boxesAt({
        recipes,
        endBeatOf: () => 0,
        beat,
        positionOf: (id) => at.get(id),
    });
}

const LINE = [11, 12, 13, 14];
const ARC = [21, 22, 23];
const TAIL = [31, 32];
const LONE = [41, 42];

/**
 * A J and its tail: a line down (1), an arc from its bottom end round to the left (2), a line down
 * again from the arc's far end (3), and a line on its own off to the side (4)
 */
const jRecipes = (tailMove = 5) => [
    recipe(1, lineShape, straight({ x: 0, y: 0 }, { x: 0, y: 60 }), LINE),
    recipe(
        2,
        arcShape,
        {
            ...arc({ x: 0, y: 60 }, { x: -40, y: 60 }),
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

const byId = (boxes: readonly PlacedBox[], id: number) =>
    boxes.find((b) => b.recipe.id === id)!;
const ids = (boxes: readonly PlacedBox[]) => boxes.map((b) => b.recipe.id);

describe("linkedFigure", () => {
    it("follows links through each shape in turn: a J and its tail are three shapes", () => {
        const boxes = placed(jRecipes());
        const links = liveLinks(boxes, 0);
        for (const id of [1, 2, 3])
            expect(ids(linkedFigure(byId(boxes, id), links))).toEqual([
                1, 2, 3,
            ]);
        expect(ids(linkedFigure(byId(boxes, 4), links))).toEqual([4]);
    });

    it("visits each shape once round a closed loop", () => {
        const boxes = placed([
            recipe(
                1,
                lineShape,
                straight({ x: 0, y: 0 }, { x: 60, y: 0 }),
                [1, 2],
            ),
            recipe(
                2,
                lineShape,
                {
                    ...straight({ x: 60, y: 0 }, { x: 30, y: 40 }),
                    attach: { start: { recipe: 1, end: "end" } },
                },
                [3, 4],
            ),
            recipe(
                3,
                lineShape,
                {
                    ...straight({ x: 30, y: 40 }, { x: 0, y: 0 }),
                    attach: {
                        start: { recipe: 2, end: "end" },
                        end: { recipe: 1, end: "start" },
                    },
                },
                [5, 6],
            ),
        ]);
        const links = liveLinks(boxes, 0);
        expect(links).toHaveLength(3);
        expect(ids(linkedFigure(byId(boxes, 2), links))).toEqual([1, 2, 3]);
    });

    it("leaves out a shape whose link is dead: on another move, or on a page it's only carried onto", () => {
        const across = placed(jRecipes(6));
        expect(
            ids(linkedFigure(byId(across, 1), liveLinks(across, 0))),
        ).toEqual([1, 2]);
        const later = placed(jRecipes(), 8);
        expect(ids(linkedFigure(byId(later, 1), liveLinks(later, 8)))).toEqual([
            1,
        ]);
    });
});

describe("linkedShapesSelection", () => {
    it("selects the whole figure of any linked shape with a marcher selected", () => {
        const boxes = placed(jRecipes());
        const figure = [...LINE, ...ARC, ...TAIL];
        // The arc selected whole
        expect(linkedShapesSelection(new Set(ARC), boxes, 0)).toEqual(figure);
        // One marcher picked inside the tail
        expect(linkedShapesSelection(new Set([32]), boxes, 0)).toEqual(figure);
        // The joint's marcher (the line's last), and a shape in no link beside it
        expect(linkedShapesSelection(new Set([14, 41]), boxes, 0)).toEqual(
            figure,
        );
    });

    it("selects nothing without a linked shape selected", () => {
        const boxes = placed(jRecipes());
        expect(linkedShapesSelection(new Set(LONE), boxes, 0)).toEqual([]);
        expect(linkedShapesSelection(new Set([99]), boxes, 0)).toEqual([]);
        expect(linkedShapesSelection(new Set(), boxes, 0)).toEqual([]);
        // Dead links link nothing
        const later = placed(jRecipes(), 8);
        expect(linkedShapesSelection(new Set(ARC), later, 8)).toEqual([]);
    });
});

describe("doubleClickSelection", () => {
    const boxes = placed(jRecipes());
    const figure = [...LINE, ...ARC, ...TAIL];

    it("selects a linked shape's whole figure", () => {
        expect(doubleClickSelection(22, new Set(ARC), boxes, 0)).toEqual(
            figure,
        );
        expect(doubleClickSelection(11, new Set(), boxes, 0)).toEqual(figure);
    });

    it("goes inside as before on a shape in no link, a marcher in none, or a figure selected already", () => {
        expect(doubleClickSelection(41, new Set(LONE), boxes, 0)).toBeNull();
        expect(doubleClickSelection(99, new Set(), boxes, 0)).toBeNull();
        expect(doubleClickSelection(22, new Set(figure), boxes, 0)).toBeNull();
    });
});

describe("selecting linked shapes on the field", () => {
    const select = vi.fn();
    let selection: number[] = [];
    beforeAll(async () => {
        await tolgee.run();
    });
    afterEach(() => {
        select.mockReset();
        selection = [];
        setActiveFieldEditor(null);
        useHandleMenuStore.setState({ menu: null });
        useBoxSelectionStore.setState({
            enabled: false,
            inside: null,
            selected: null,
        });
    });
    const field = (boxes: PlacedBox[], selected: number[]) => {
        shown.boxes = boxes;
        selection = selected;
        setActiveFieldEditor({
            select,
            selected: () => selection,
        } as unknown as FieldEditor);
        useBoxSelectionStore.setState({ enabled: true, inside: 3 });
    };

    it("double-click: a linked shape's figure, then inside at the marcher once it's selected", () => {
        const boxes = placed(jRecipes());
        field(boxes, ARC);
        doubleClickMember(22);
        expect(select).toHaveBeenLastCalledWith([...LINE, ...ARC, ...TAIL]);
        expect(useBoxSelectionStore.getState().inside).toBeNull();
        selection = [...LINE, ...ARC, ...TAIL];
        doubleClickMember(22);
        expect(select).toHaveBeenLastCalledWith([22]);
        expect(useBoxSelectionStore.getState().inside).toBe(2);
        // A shape in no link goes inside, as it always did
        doubleClickMember(41);
        expect(select).toHaveBeenLastCalledWith([41]);
        expect(useBoxSelectionStore.getState().inside).toBe(4);
    });

    it("the joint's menu offers Select linked shapes after Detach, and it selects the figure", () => {
        const boxes = placed(jRecipes());
        field(boxes, ARC);
        const link = liveLinks(boxes, 0).find((l) => l.owner.recipe.id === 1)!;
        openJointMenu(link, byId(boxes, 2), { x: 0, y: 0 }, new QueryClient());
        const menu = useHandleMenuStore.getState().menu!;
        expect(menu.sections[0]!.items.map((i) => i.label)).toEqual([
            "Detach from Line",
            "Select linked shapes",
        ]);
        menu.pick("selectLinked");
        expect(select).toHaveBeenLastCalledWith([...LINE, ...ARC, ...TAIL]);
        expect(useHandleMenuStore.getState().menu).toBeNull();
    });

    it("the palette command runs with a linked shape selected, and says why it can't otherwise", () => {
        const boxes = placed(jRecipes());
        field(boxes, ARC);
        const { rerender, unmount } = renderHook(
            ({ selected }) => useSelectLinkedShapes(true, selected),
            { initialProps: { selected: ARC } },
        );
        expect(isActionEnabled("shapeSelectLinked")).toBe(true);
        expect(actionLabelNow("shapeSelectLinked")).toBeUndefined();
        rerender({ selected: LONE });
        expect(isActionEnabled("shapeSelectLinked")).toBe(false);
        expect(actionDisabledReason("shapeSelectLinked")).toBe(
            "Select a linked line, curve or arc first",
        );
        unmount();
    });
});
