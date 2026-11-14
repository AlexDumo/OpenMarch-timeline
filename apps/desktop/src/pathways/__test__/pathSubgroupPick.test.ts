import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdjustProfile } from "@openmarch/core";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import type { FieldPointer } from "@/field/editor/fieldEditor";
import type { PathTarget } from "../pathTarget";

// The store is already loaded by the test setup, so it's loaded again with its writes stubbed
vi.resetModules();
const adjustLane = vi.fn(async () => undefined);
const adjustSubgroup = vi.fn(async () => ({ groupAdjustId: 7 }));
const resetSubgroup = vi.fn(async () => undefined);
const removeSubgroupKey = vi.fn(async () => undefined);
vi.doMock("@/db-functions/timelinePathAdjust", async (importOriginal) => ({
    ...(await importOriginal<
        typeof import("@/db-functions/timelinePathAdjust")
    >()),
    adjustLane,
}));
vi.doMock("@/db-functions/timelineSubgroupAdjust", async (importOriginal) => ({
    ...(await importOriginal<
        typeof import("@/db-functions/timelineSubgroupAdjust")
    >()),
    adjustSubgroup,
    resetSubgroup,
    removeSubgroupKey,
}));
const {
    clearPath,
    deleteOnLane,
    deleteOnSubgroup,
    detachIdsOf,
    openPath,
    selectLane,
    showPath,
    usePathPenStore,
} = await import("../pathPenStore");
const { drawingOf, pathPenMode } = await import("../pathPenMode");
const { laneKey, laneOfKey, sharedKey, sharedKeyOf } =
    await import("../pathEdit");
const { setShapeField } = await import("@/shapes/field/shapeField");

/**
 * Picking several lanes and bending them together, pathways step 26 (AP-R12): Shift-click adds a
 * lane to the pick, a click on a sub-group's lane picks the sub-group and a second click picks
 * that lane alone, a drag on picked lanes writes their shared tweak, and a drag on a lane picked
 * alone its own. Four members 10 to 13, eight steps apart; 10, 11 and 12 may share linked
 * Adjust 7.
 */
const fieldProperties =
    FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;
const STEP = fieldProperties.pixelsPerStep;
const y = 20 * STEP;
const GAP = 8 * STEP;
const ZOOM = 2;

const profile = (
    ...keys: [string, string, number, number][]
): AdjustProfile => ({
    v: 1,
    keys: keys.map(([a, b, f, d]) => ({ a, b, f, d: [0, d] })),
});
const BULGE = profile(
    ["p", "q", 0.2, 0],
    ["p", "q", 0.5, 30],
    ["p", "q", 0.8, 0],
);

const group = (shared: AdjustProfile | null): PathTarget => ({
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
        members: [10, 11, 12, 13].map((m, i) => ({
            marcherId: m,
            transitionId: 8,
            drill: `B${i + 1}`,
            offset: { x: 0, y: (i + 1) * GAP },
            from: { x: 0, y: y + (i + 1) * GAP },
            to: { x: 40 * STEP, y: y + (i + 1) * GAP },
            laneId: m,
            slot: i,
            adjust: null,
            groupAdjustId: shared && m !== 13 ? 7 : null,
            linked: shared && m !== 13 ? shared : null,
        })),
        outside: [],
    },
});

const at = (x: number, ly: number) =>
    ({
        field: { x, y: ly },
        screen: { x: x * ZOOM, y: ly * ZOOM },
        button: 0,
        shift: false,
        alt: false,
        ctrl: false,
        meta: false,
    }) as FieldPointer;
/** Where member `m`'s lane runs at 0.9 of the way from p to q, past any bulge of BULGE */
const onLane = (m: number) => at(28 * STEP, y + (m - 9) * GAP);
const press = (add = false) =>
    ({ isMac: false, onDot: () => false, add }) as never;
const click = (p: FieldPointer, add = false) => {
    pathPenMode.press(p, press(add));
    pathPenMode.release(p, null);
};
const drag = (p: FieldPointer, dy: number) => {
    pathPenMode.press(p, press());
    const to = at(p.field.x, p.field.y + dy);
    pathPenMode.move(to);
    pathPenMode.release(to, null);
};
const session = () => usePathPenStore.getState().session!;
const drawn = () => drawingOf(session())!;
const open = (target: PathTarget) => {
    showPath(target, "2");
    openPath();
};

describe("picking several lanes (step 26)", () => {
    beforeEach(() => {
        setShapeField({
            fieldProperties: () => fieldProperties,
            zoom: () => ZOOM,
            marchers: () => [],
            drawn: () => new Map(),
        });
        for (const f of [
            adjustLane,
            adjustSubgroup,
            resetSubgroup,
            removeSubgroupKey,
        ])
            f.mockClear();
    });
    afterEach(() => {
        clearPath();
        setShapeField(null);
    });

    it("Shift-click adds lanes to the pick and takes them out; each picked lane is heavy", () => {
        open(group(null));
        click(onLane(10));
        expect(session().lane).toEqual({ marcherId: 10, key: null });
        click(onLane(11), true);
        expect(session().subgroup).toEqual({ marcherIds: [10, 11], key: null });
        expect(session().lane).toBeNull();
        expect(drawn().lanesPicked).toEqual([0, 1]);
        expect(drawn().pathLine).toBe("context");
        click(onLane(13), true);
        expect(session().subgroup?.marcherIds).toEqual([10, 11, 13]);
        click(onLane(11), true);
        expect(session().subgroup?.marcherIds).toEqual([10, 13]);
        // Down to one: it is picked alone again
        click(onLane(13), true);
        expect(session().subgroup).toBeNull();
        expect(session().lane).toEqual({ marcherId: 10, key: null });
    });

    it("a drag on picked lanes bends them together: one shared write with every lane", () => {
        open(group(null));
        click(onLane(10));
        click(onLane(12), true);
        drag(onLane(12), 3 * STEP);
        expect(adjustSubgroup).toHaveBeenCalledTimes(1);
        const args = (
            adjustSubgroup.mock.calls[0] as unknown as [
                {
                    lanes: { laneId: number; marcherId: number }[];
                    d: [number, number];
                },
            ]
        )[0];
        expect(args.lanes.map((l) => l.marcherId)).toEqual([10, 12]);
        // landed as a point lands (on the half-step grid), so within half a step of the pointer
        expect(Math.abs(args.d[1] - 3 * STEP)).toBeLessThanOrEqual(STEP / 2);
        expect(adjustLane).not.toHaveBeenCalled();
        // The pick stays, so the shared tweak's keys show once the path is read again
        expect(session().subgroup?.marcherIds).toEqual([10, 12]);
    });

    it("a click on a sub-group's lane picks the sub-group; a second click picks that lane alone", () => {
        open(group(BULGE));
        click(onLane(11));
        expect(session().subgroup).toEqual({
            marcherIds: [10, 11, 12],
            key: null,
        });
        // its shared tweak's keys show on its three lanes (three keys each)
        expect(drawn().adjustHandles).toHaveLength(9);
        click(onLane(11));
        expect(session().subgroup).toBeNull();
        expect(session().lane).toEqual({ marcherId: 11, key: null });
        // Escape lets a picked sub-group go, as it does a lane
        selectLane(null);
        click(onLane(10));
        expect(session().subgroup?.marcherIds).toEqual([10, 11, 12]);
        selectLane(null);
        expect(session().subgroup).toBeNull();
        expect(session().lane).toBeNull();
    });

    it("a drag on an unpicked sub-group lane bends the sub-group; on a lane picked alone, its own tweak, over the shared one", async () => {
        open(group(BULGE));
        drag(onLane(12), 2 * STEP);
        expect(adjustSubgroup).toHaveBeenCalledTimes(1);
        expect(
            (
                adjustSubgroup.mock.calls[0] as unknown as [
                    { lanes: { marcherId: number }[] },
                ]
            )[0].lanes.map((l) => l.marcherId),
        ).toEqual([10, 11, 12]);
        // the write settles before the next press (a save in flight takes none), and the path is
        // read again, which ends the drag's preview
        await new Promise((resolve) => setTimeout(resolve, 0));
        showPath(group(BULGE), "2");
        selectLane({ marcherId: 11, key: null });
        // Halfway from p to q the shared bulge is 30; the pointer takes the lane 2 steps further,
        // so its own tweak there is only those 2 steps (within the half-step landing)
        const shared = 30;
        drag(at(20 * STEP, y + 2 * GAP + shared), 2 * STEP);
        expect(adjustLane).toHaveBeenCalledTimes(1);
        const own = (
            adjustLane.mock.calls[0] as unknown as [{ d: [number, number] }]
        )[0];
        expect(Math.abs(own.d[1] - 2 * STEP)).toBeLessThanOrEqual(STEP / 2);
    });

    it("a drag on a sub-group plus a spot sharing nothing grows the sub-group; across two sub-groups it is refused (review of #908)", () => {
        open(group(BULGE));
        click(onLane(11));
        click(onLane(13), true);
        expect(session().subgroup?.marcherIds).toEqual([10, 11, 12, 13]);
        drag(onLane(13), 2 * STEP);
        expect(adjustSubgroup).toHaveBeenCalledTimes(1);
        expect(
            (
                adjustSubgroup.mock.calls[0] as unknown as [
                    { lanes: { marcherId: number }[] },
                ]
            )[0].lanes.map((l) => l.marcherId),
        ).toEqual([10, 11, 12, 13]);
        adjustSubgroup.mockClear();
        // 13 in a sub-group of its own: one spot of each is refused
        const two = group(BULGE);
        two.group = {
            ...two.group!,
            members: two.group!.members.map((m) =>
                m.marcherId === 13
                    ? { ...m, groupAdjustId: 8, linked: BULGE }
                    : m,
            ),
        };
        showPath(two, "2");
        selectLane(null);
        click(onLane(12));
        click(onLane(13), true);
        drag(onLane(13), 2 * STEP);
        expect(adjustSubgroup).not.toHaveBeenCalled();
    });

    it("a lone sharer (review of #908, S1): its shared keys show, Delete and the bar's Reset reset it by its id; Detach is off for a sub-group that is every spot", async () => {
        const lone = group(null);
        lone.group = {
            ...lone.group!,
            members: lone.group!.members.map((m) =>
                m.marcherId === 12
                    ? { ...m, groupAdjustId: 9, linked: BULGE }
                    : m,
            ),
        };
        open(lone);
        // nothing picked: its shared tweak's three keys show on its lane
        expect(drawn().adjustHandles).toHaveLength(3);
        selectLane({ marcherId: 12, key: null });
        await deleteOnLane(session().lane!);
        expect(resetSubgroup).toHaveBeenCalledWith(
            expect.objectContaining({ groupAdjustId: 9 }),
        );
        // Detach: a picked sub-group sharing a tweak that is every spot of the path has none
        const all = group(BULGE);
        all.group = {
            ...all.group!,
            members: all.group!.members.map((m) => ({
                ...m,
                groupAdjustId: 7,
                linked: BULGE,
            })),
        };
        showPath(all, "2");
        click(onLane(10));
        expect(session().subgroup?.marcherIds).toEqual([10, 11, 12, 13]);
        expect(detachIdsOf([], session())).toEqual([]);
    });

    it("Delete with a sub-group picked resets its shared tweak, or removes its picked key", async () => {
        open(group(BULGE));
        click(onLane(10));
        await deleteOnSubgroup(session().subgroup!);
        expect(resetSubgroup).toHaveBeenCalledWith(
            expect.objectContaining({ groupAdjustId: 7 }),
        );
        await deleteOnSubgroup({ marcherIds: [10, 11, 12], key: 1 });
        expect(removeSubgroupKey).toHaveBeenCalledWith(
            expect.objectContaining({ groupAdjustId: 7, index: 1 }),
        );
        // lanes that don't share a tweak have none to reset
        resetSubgroup.mockClear();
        await deleteOnSubgroup({ marcherIds: [10, 13], key: null });
        expect(resetSubgroup).not.toHaveBeenCalled();
    });

    it("menu keys carry what the lane's menu offers", () => {
        expect(laneOfKey(laneKey(11, "sa"))).toBe(11);
        expect(laneOfKey(laneKey(11))).toBe(11);
        expect(sharedKeyOf(sharedKey(12, 3))).toEqual({
            marcherId: 12,
            index: 3,
        });
        expect(sharedKeyOf(laneKey(12))).toBeNull();
    });
});
