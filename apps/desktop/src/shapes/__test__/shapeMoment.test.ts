import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { boxTool } from "../box/boxTool";
import { openTool } from "../tool/toolMachine";
import {
    goBackTo,
    isAwayFrom,
    isolationChangedSince,
    momentLabel,
    momentOf,
} from "../tool/shapeMoment";
import {
    closeShapeTool,
    isShapeAway,
    openShapeTool,
    useShapeToolStore,
} from "../tool/shapeToolStore";
import {
    discardShapeTool,
    forgetDiscardedShape,
    restoreDiscardedShape,
} from "../tool/shapeLeave";
import type { ToolState } from "../tool/toolMachine";

const store = () => useTimelineSelectionStore.getState();

/** Page boxes for flags at 9, 17 and 25 */
const BOXES = [
    { start: 1, end: 9 },
    { start: 9, end: 17 },
    { start: 17, end: 25 },
];

const marchers = [1, 2].map((id) => ({
    id,
    at: { x: 100 * id, y: 100 },
    drillRank: id,
}));
/** Discarding keeps only a drawn shape, so this one has numbers */
const drawn = (): ToolState => ({
    ...openTool(boxTool, marchers),
    params: {} as never,
});

beforeEach(() => {
    store().reset();
    store().setPageBoxes(BOXES);
});

afterEach(() => {
    closeShapeTool();
    forgetDiscardedShape();
});

describe.each([
    ["Expert", true],
    ["Basic", false],
] as const)("an open shape's moment (#416), %s", (_mode, startStays) => {
    beforeEach(() => store().setStartStays(startStays));

    it("is away once the playhead moves, and back by Go back", () => {
        store().selectRange(9, 12);
        const moment = momentOf();
        expect(isAwayFrom(moment)).toBe(false);

        store().seek(20);
        expect(isAwayFrom(moment)).toBe(true);

        goBackTo(moment);
        expect(isAwayFrom(moment)).toBe(false);
        expect(store().startBeat).toBe(9);
        expect(store().playheadBeat).toBe(12);
    });

    it("at home, Go back goes home", () => {
        const moment = momentOf();
        expect(momentLabel(moment)).toBe("home");
        store().seek(5);
        expect(isAwayFrom(moment)).toBe(true);
        goBackTo(moment);
        expect(store().selection).toEqual({ kind: "home" });
        expect(isAwayFrom(moment)).toBe(false);
    });

    it("coming back by another route counts too", () => {
        store().selectRange(9, 12);
        const moment = momentOf();
        store().selectRange(1, 9);
        store().selectRange(9, 12);
        expect(isAwayFrom(moment)).toBe(false);
    });
});

describe("an open shape's moment (#416)", () => {
    it("labels the shape's count", () => {
        store().selectRange(9, 12);
        expect(momentLabel(momentOf())).toBe("count 12");
    });

    it("isolating a move is a change of isolation, not only of moment", () => {
        store().setStoredTimelines([
            { id: 7, start: 9, end: 17, marcherIds: new Set([1]) },
        ]);
        store().selectRange(9, 17);
        const moment = momentOf();
        expect(isolationChangedSince(moment)).toBe(false);
        store().seek(20);
        expect(isolationChangedSince(moment)).toBe(false);
        store().isolate(7);
        expect(isolationChangedSince(moment)).toBe(true);
    });

    it("an open shape is away only while a shape is open and its moment is elsewhere", () => {
        expect(isShapeAway()).toBe(false);
        store().selectRange(9, 12);
        openShapeTool(drawn(), null);
        expect(isShapeAway()).toBe(false);
        store().seek(20);
        expect(isShapeAway()).toBe(true);
        closeShapeTool();
        expect(isShapeAway()).toBe(false);
        expect(useShapeToolStore.getState().moment).toBeNull();
    });

    it("a shape discarded while away comes back on undo with its own moment", () => {
        store().selectRange(9, 12);
        openShapeTool(drawn(), null);
        const moment = useShapeToolStore.getState().moment;
        store().seek(20);
        discardShapeTool();
        expect(restoreDiscardedShape()).toBe(true);
        expect(useShapeToolStore.getState().moment).toEqual(moment);
        expect(isShapeAway()).toBe(true);
    });
});
