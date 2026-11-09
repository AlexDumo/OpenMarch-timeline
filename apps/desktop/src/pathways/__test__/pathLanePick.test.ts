import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdjustProfile } from "@openmarch/core";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import type { FieldPointer } from "@/field/editor/fieldEditor";
import type { PathTarget } from "../pathTarget";

// The store is already loaded by the test setup, so it's loaded again with its writes stubbed
vi.resetModules();
const removeAdjustKey = vi.fn(async () => undefined);
const resetLaneAdjust = vi.fn(async () => undefined);
vi.doMock("@/db-functions/timelinePathAdjust", async (importOriginal) => ({
    ...(await importOriginal<
        typeof import("@/db-functions/timelinePathAdjust")
    >()),
    removeAdjustKey,
    resetLaneAdjust,
}));
const {
    clearPath,
    deleteOnLane,
    openPath,
    selectLane,
    showPath,
    usePathPenStore,
} = await import("../pathPenStore");
const { pathPenMode } = await import("../pathPenMode");
const { setShapeField } = await import("@/shapes/field/shapeField");

/**
 * What stays picked on a lane through a Delete and a read of the path (review of #781): Delete
 * never falls through to Remove path, a picked key is followed by its anchor, and a plain lane
 * writes nothing. Members 10 and 11; `dy` apart 0 stacks their lanes.
 */
const fieldProperties =
    FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;
const STEP = fieldProperties.pixelsPerStep;
const y = 20 * STEP;

const profile = (
    ...keys: [string, string, number, number][]
): AdjustProfile => ({
    v: 1,
    keys: keys.map(([a, b, f, d]) => ({ a, b, f, d: [0, d] })),
});

const group = (adjust: AdjustProfile | null, dy = 4 * STEP): PathTarget => ({
    timelineId: 1,
    transitionId: 8,
    marcherId: 10,
    start: 0,
    end: 16,
    from: { x: 0, y },
    to: { x: 40 * STEP, y },
    routeId: 9,
    points: [
        { id: "p", at: [10 * STEP, y] },
        { id: "q", at: [30 * STEP, y] },
    ],
    ends: { from: { x: 0, y }, to: { x: 40 * STEP, y } },
    group: {
        members: [10, 11].map((m, i) => ({
            marcherId: m,
            transitionId: 8,
            drill: `B${i + 1}`,
            offset: { x: 0, y: dy },
            from: { x: 0, y: y + dy },
            to: { x: 40 * STEP, y: y + dy },
            laneId: m,
            slot: i,
            adjust: m === 11 ? adjust : null,
        })),
        outside: [],
    },
});

const lane = () => usePathPenStore.getState().session?.lane;
const open = (target: PathTarget) => {
    showPath(target, "2");
    openPath();
};
const bulge = profile(
    ["p", "q", 0.2, 0],
    ["p", "q", 0.5, 30],
    ["p", "q", 0.8, 0],
);

describe("a picked lane through Delete and a read of the path", () => {
    beforeEach(() => {
        removeAdjustKey.mockClear();
        resetLaneAdjust.mockClear();
    });
    afterEach(() => clearPath());

    it("follows the picked key when a key is added before it", () => {
        open(group(bulge));
        selectLane({ marcherId: 11, key: 1 });
        showPath(
            group(
                profile(
                    ["from", "p", 0.5, 12],
                    ["p", "q", 0.2, 0],
                    ["p", "q", 0.5, 30],
                    ["p", "q", 0.8, 0],
                ),
            ),
            "2",
        );
        expect(lane()).toEqual({ marcherId: 11, key: 2 });
    });

    it("keeps the picked key when a drag changes only how far it displaces", () => {
        open(group(bulge));
        selectLane({ marcherId: 11, key: 1 });
        showPath(
            group(
                profile(
                    ["p", "q", 0.2, 0],
                    ["p", "q", 0.5, 50],
                    ["p", "q", 0.8, 0],
                ),
            ),
            "2",
        );
        expect(lane()).toEqual({ marcherId: 11, key: 1 });
    });

    it("lets the key go, and keeps the lane, when an undo takes it away", () => {
        open(group(bulge));
        selectLane({ marcherId: 11, key: 1 });
        showPath(group(null), "2");
        expect(lane()).toEqual({ marcherId: 11, key: null, keyGone: true });
    });

    it("a second Delete after a key goes writes nothing, and the lane stays picked", async () => {
        open(group(bulge));
        selectLane({ marcherId: 11, key: 1 });
        await deleteOnLane(lane()!);
        expect(removeAdjustKey).toHaveBeenCalledTimes(1);
        expect(lane()).toEqual({ marcherId: 11, key: null, keyGone: true });
        await deleteOnLane(lane()!);
        expect(removeAdjustKey).toHaveBeenCalledTimes(1);
        expect(resetLaneAdjust).not.toHaveBeenCalled();
        expect(lane()).toEqual({ marcherId: 11, key: null, keyGone: true });
    });

    it("picking the lane again after a key went lets Delete reset it", async () => {
        open(group(bulge));
        selectLane({ marcherId: 11, key: 1 });
        await deleteOnLane(lane()!);
        selectLane({ marcherId: 11, key: null });
        expect(lane()?.keyGone).toBeUndefined();
        await deleteOnLane(lane()!);
        expect(resetLaneAdjust).toHaveBeenCalledTimes(1);
    });

    it("Delete on a plain lane writes nothing", async () => {
        open(group(null));
        selectLane({ marcherId: 10, key: null });
        await deleteOnLane(lane()!);
        expect(resetLaneAdjust).not.toHaveBeenCalled();
        expect(lane()).toEqual({ marcherId: 10, key: null });
    });
});

describe("the hover note on lanes", () => {
    const ZOOM = 2;
    beforeEach(() =>
        setShapeField({
            fieldProperties: () => fieldProperties,
            zoom: () => ZOOM,
            marchers: () => [],
            drawn: () => new Map(),
        }),
    );
    afterEach(() => {
        clearPath();
        setShapeField(null);
    });
    const over = (x: number, ly: number) =>
        pathPenMode.cursorAt(
            {
                field: { x, y: ly },
                screen: { x: x * ZOOM, y: ly * ZOOM },
                button: 0,
            } as FieldPointer,
            { reachesInside: () => false, isMac: false, onDot: () => false },
        );
    const hover = () => usePathPenStore.getState().session?.hoverLane;

    it("counts lanes lying on top of each other", () => {
        open(group(null));
        over(20 * STEP, y + 4 * STEP);
        expect(hover()?.stacked).toBe(2);
    });

    it("moves its note along the lane once the pointer has run far enough", () => {
        open(group(null));
        over(20 * STEP, y + 4 * STEP);
        const first = hover()!.at;
        over(20 * STEP + 2, y + 4 * STEP);
        expect(hover()!.at).toBe(first);
        over(26 * STEP, y + 4 * STEP);
        expect(hover()!.at.x).toBeCloseTo(26 * STEP);
    });
});
