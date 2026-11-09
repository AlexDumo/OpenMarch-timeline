import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldEditor, FieldModePress } from "@/field/editor/fieldEditor";
import { NO_KEYS } from "@/input/modifierRoles";
import type { CanvasEditPlan } from "@/timeline/timelineCoordinateWrites";
import type { PlacedBox } from "../placed/placedBox";

/**
 * The moments around a placed shape's save (#776): the page can change, and another drag can
 * start, between an edit and its save being read back.
 */

const h = vi.hoisted(() => ({
    plan: null as unknown,
    beat: 16,
    release: () => {},
    written: [] as { plan: unknown; keepPlayhead: unknown }[],
}));

vi.mock("@/global/singletons/Tolgee", () => ({
    default: { t: (_k: string, d: string) => d },
}));
vi.mock("@/global/database/db", () => ({ db: {} }));
vi.mock("@/context/SelectedMarchersContext", () => ({
    useSelectedMarchers: () => ({ selectedMarchers: [] }),
}));
vi.mock("../field/shapeFieldContext", () => ({
    currentShapeField: () => ({}),
    shapeContextFor: () => ({}),
}));
vi.mock("@/timeline/timelineCoordinateWrites", () => ({
    planCanvasEdit: () => h.plan,
    timelinePositionsSettled: () =>
        new Promise<void>((resolve) => {
            h.release = resolve;
        }),
}));
vi.mock("@/stores/TimelineSelectionStore", () => ({
    displayedBeat: () => h.beat,
    useTimelineSelectionStore: Object.assign(
        (select: (s: unknown) => unknown) => select({ selection: {} }),
        { getState: () => ({}) },
    ),
}));
vi.mock("../tool/shapePlacement", () => ({
    writePlacement: async (
        _p: unknown,
        _q: unknown,
        _f: string,
        plan: unknown,
        keepPlayhead: unknown,
    ) => {
        h.written.push({ plan, keepPlayhead });
        return true;
    },
}));
vi.mock("../placed/liveBox", async (original) => ({
    ...(await original<typeof import("../placed/liveBox")>()),
    liveTargets: (box: PlacedBox) => ({
        members: box.recipe.members,
        spots: 1,
    }),
    openLive: (box: PlacedBox) => ({ box, params: box.params, gesture: null }),
    pressLive: (live: object) => ({ ...live, gesture: { type: "move" } }),
}));
vi.mock("../placed/placedOrder", () => ({
    placedOrderChoice: () => "nearest",
}));
vi.mock("../assign", () => ({ orderFields: () => ({}) }));
vi.mock("../placed/placedBoxStore", () => ({
    placedBoxesAt: (): PlacedBox[] => [boxOf(1)],
    placedBoxesRead: async () => {},
}));
vi.mock("../placed/boxSelection", () => ({ useBoxSelection: () => {} }));
vi.mock("../field/heldGesture", () => ({
    pressShapeKeys: () => ({
        held: { roles: () => ({}), move: () => ({}), end: () => {} },
        reachInside: false,
    }),
}));
vi.mock("../tool/toolEnv", () => ({ toolEnvFor: () => ({}) }));

function boxOf(id: number, marcherIds: readonly number[] = [1, 2]): PlacedBox {
    return {
        kind: { ordered: false },
        params: { center: { x: 0, y: 0 } },
        spots: marcherIds.length,
        endBeat: 16,
        recipe: {
            id,
            timelineId: id,
            params: {},
            members: marcherIds.map((marcherId, slot) => ({
                marcherId,
                slot,
                x: 0,
                y: 0,
            })),
        },
    } as unknown as PlacedBox;
}

const range = (start: number, end: number): CanvasEditPlan => ({
    ok: true,
    target: { kind: "range", start, end },
    beat: end,
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const queryClient = {} as never;

async function savingStore() {
    return import("../placed/boxSelectionStore");
}

beforeEach(() => {
    h.plan = range(0, 16);
    h.beat = 16;
    h.written.length = 0;
});

describe("a save when the page changes before it runs", () => {
    async function commitThenChangePage() {
        const { commitBox } = await import("../placed/commitBox");
        const done = commitBox(
            boxOf(1),
            { center: { x: 4, y: 0 } },
            queryClient,
        );
        await flush();
        h.plan = range(16, 32);
        h.beat = 32;
        return { done };
    }

    const finish = async (done: Promise<void>) => {
        h.release();
        await flush();
        h.release();
        await done;
    };

    it("is written to the page it was made on, and leaves the playhead on the new one", async () => {
        const page1 = h.plan;
        const { done } = await commitThenChangePage();
        await finish(done);
        expect(h.written).toEqual([{ plan: page1, keepPlayhead: true }]);
    });

    it("lets a save that wasn't overtaken take the playhead to the edit", async () => {
        const { commitBox } = await import("../placed/commitBox");
        const page1 = h.plan;
        const done = commitBox(
            boxOf(1),
            { center: { x: 4, y: 0 } },
            queryClient,
        );
        await flush();
        await finish(done);
        expect(h.written).toEqual([{ plan: page1, keepPlayhead: false }]);
    });
});

describe("the shape being saved, on another page", () => {
    it("is shown only at the beats it's saved for", async () => {
        const { savingBoxAt } = await savingStore();
        const box = boxOf(1);
        const saving = { box, beats: [8, 16] };
        expect(savingBoxAt(saving, 8)).toBe(box);
        expect(savingBoxAt(saving, 16)).toBe(box);
        expect(savingBoxAt(saving, 32)).toBeNull();
    });

    it("is saved for the beat it was made at", async () => {
        const { commitBox } = await import("../placed/commitBox");
        const { useSavingBoxStore } = await savingStore();
        const done = commitBox(
            boxOf(1),
            { center: { x: 4, y: 0 } },
            queryClient,
        );
        expect(useSavingBoxStore.getState().beats).toContain(16);
        await flush();
        h.release();
        await flush();
        h.release();
        await done;
        expect(useSavingBoxStore.getState()).toMatchObject({
            box: null,
            beats: [],
        });
    });
});

describe("a drag held while an earlier save reads back", () => {
    const pointer = {
        field: { x: 0, y: 0 },
        screen: { x: 0, y: 0 },
        button: 0,
        ...NO_KEYS,
    };
    const press: FieldModePress = { reachesInside: () => false, isMac: false };
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    async function setup() {
        const { useShapeFieldModes } =
            await import("../field/useShapeFieldModes");
        const { useBoxSelectionStore } = await savingStore();
        const { LiveBoxMode } = await import("../placed/liveBoxMode");
        const setMode = vi.fn();
        const editor = { setMode } as unknown as FieldEditor;
        act(() => useBoxSelectionStore.setState({ selected: boxOf(1) }));
        renderHook(() => useShapeFieldModes(editor, false), { wrapper });
        const mode = setMode.mock.lastCall![0] as InstanceType<
            typeof LiveBoxMode
        >;
        const selectCopy = (box: PlacedBox) =>
            act(() => useBoxSelectionStore.setState({ selected: box }));
        return { setMode, mode, selectCopy };
    }

    afterEach(async () => {
        const { useBoxSelectionStore } = await savingStore();
        act(() => useBoxSelectionStore.setState({ selected: null }));
    });

    it("isn't cancelled by this page's own copy arriving", async () => {
        const { setMode, mode, selectCopy } = await setup();
        mode.press(pointer, press);
        setMode.mockClear();
        selectCopy(boxOf(2));
        expect(setMode).not.toHaveBeenCalled();
    });

    it("gets a new mode for a new recipe with no drag held", async () => {
        const { setMode, mode, selectCopy } = await setup();
        setMode.mockClear();
        selectCopy(boxOf(2));
        expect(setMode.mock.lastCall![0]).not.toBe(mode);
    });

    it("ends for other marchers", async () => {
        const { setMode, mode, selectCopy } = await setup();
        mode.press(pointer, press);
        selectCopy(boxOf(2, [3, 4]));
        expect(setMode.mock.lastCall![0]).not.toBe(mode);
    });

    it("ends when the shape is another page's", async () => {
        const { setMode, mode, selectCopy } = await setup();
        mode.press(pointer, press);
        h.beat = 32;
        selectCopy(boxOf(2));
        expect(setMode.mock.lastCall![0]).not.toBe(mode);
    });
});
