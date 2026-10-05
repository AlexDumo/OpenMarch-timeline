import { afterEach, describe, expect, it } from "vitest";
import { createResolver, type TimelineSnapshot } from "@openmarch/core";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { planCanvasEdit } from "../timelineCoordinateWrites";
import {
    applyIsolationPlan,
    editingPositionAt,
    type IsolationPlan,
} from "../timelineIsolationPlan";

/** Marcher 1 moves to (0, 160) over [0, 16); marcher 2 holds at (50, 50). */
const snapshot = (): TimelineSnapshot => ({
    marchers: [
        { id: 1, home: [0, 0] },
        { id: 2, home: [50, 50] },
    ],
    shapes: {},
    transitions: {
        1: {
            id: 1,
            start: 0,
            end: 16,
            dest: null,
            points: [[0, 160]],
            slots: 1,
            style: "direct",
            order: "slot",
            params: null,
        },
    },
    assignments: [
        {
            id: 1,
            marcher: 1,
            transition: 1,
            slot: 0,
            start: 0,
            end: 16,
            layer: 0,
        },
    ],
});

const plan = (): IsolationPlan => ({
    timelineId: 7,
    plan: createResolver(snapshot()),
    members: new Set([1]),
});

/** A "real show" where marcher 1 stays home, as if another move had taken it */
const real = {
    positionAt: (id: number) => (id === 1 ? [0, 0] : [50, 50]) as const,
};

describe("isolation plan (docs/timeline/research/ownership/09-isolation.md)", () => {
    afterEach(() => useTimelineSelectionStore.getState().reset());

    it("members are drawn and edited at the plan; others at the real show", () => {
        expect(editingPositionAt(real, 1, 16, plan())).toEqual([0, 160]);
        expect(editingPositionAt(real, 2, 16, plan())).toEqual([50, 50]);
        expect(editingPositionAt(real, 1, 16, null)).toEqual([0, 0]);
        const positions = new Float64Array([0, 0, 50, 50]);
        applyIsolationPlan(positions, [1, 2], 8, plan());
        expect([...positions]).toEqual([0, 80, 50, 50]);
    });

    it("isolation edits the isolated timeline's end, stolen members included", () => {
        expect(
            planCanvasEdit({
                selection: { kind: "range", start: 4, end: 9 },
                isolation: {
                    timelineId: 7,
                    start: 1,
                    end: 17,
                    restore: {
                        startBeat: 0,
                        startPinned: false,
                        playheadBeat: 0,
                    },
                },
            }),
        ).toEqual({
            ok: true,
            target: { kind: "timeline", timelineId: 7, ghosts: true },
            beat: 17,
        });
    });
});
