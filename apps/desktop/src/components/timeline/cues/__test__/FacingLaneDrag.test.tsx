import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TolgeeProvider } from "@tolgee/react";
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import tolgee from "@/global/singletons/Tolgee";
import type { DatabaseCue } from "@/db-functions/cues";
import type { CueEdit } from "@/hooks/queries/useCues";
import type Marcher from "@/global/classes/Marcher";
import { compileShowCues } from "@/cues/showCues";
import { facingLane } from "@/cues/facing";
import { useCueSelectionStore } from "@/cues/cueSelectionStore";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { FacingLaneView, turnBarLabel } from "../FacingLane";
import { useTurnPopoverStore } from "@/cues/turnPopoverStore";
import { setActiveFieldEditor } from "@/field/editor/activeFieldEditor";
import type { FieldEditor } from "@/field/editor/fieldEditor";
import { useTimelinePointer } from "../../TimelinePrimitives";
import type { TimelineBeatRange } from "../../TimelineViewModel";

// The edits a drag writes, instead of the database
const written: CueEdit[] = [];
vi.mock("@/hooks/queries/useCues", async (original) => ({
    ...(await original<typeof import("@/hooks/queries/useCues")>()),
    editCuesMutationOptions: () => ({
        mutationFn: async (edit: CueEdit) => {
            written.push(edit);
        },
    }),
}));

/**
 * The simulated users' timeline (fork #992 follow-up): 16 px a count, four counts a measure, page
 * flags every 8. Beat ids are 100 + count; spec beat 0 is home. Two guard members take rifles on
 * count 4 and flags on count 12.
 */
const PPB = 16;
const COUNTS = 48;
const beats = [
    { id: 1, position: 0, duration: 0 },
    ...Array.from({ length: COUNTS }, (_, c) => ({
        id: 100 + c,
        position: c + 1,
        duration: 0.5,
    })),
];
const marchers = [1, 2].map(
    (id) =>
        ({
            id,
            section: "Color Guard",
            drill_prefix: "G",
            drill_order: id,
            name: "",
            type: "marcher",
        }) as unknown as Marcher,
);
const cue = (
    id: number,
    count: number,
    value: string,
    extra: Partial<DatabaseCue> = {},
): DatabaseCue => ({
    id,
    type: "facing",
    beatId: 100 + count,
    value: `builtin:facing.${value}`,
    settings: {},
    length: null,
    transition: null,
    marcherIds: [1, 2],
    label: null,
    notes: null,
    createdAt: `2026-11-24 10:00:0${id}`,
    updatedAt: "",
    ...extra,
});
/** Spec beat of a count: count c is spec beat c + 1 (spec beat 0 is home) */
const spec = (count: number) => count + 1;
const pageBeats = [0, spec(8), spec(16), spec(24), spec(32), spec(40)];
const downbeats = Array.from({ length: 12 }, (_, m) => spec(m * 4));

const snapBeats = [...new Set([...pageBeats, ...downbeats])];
/** The timeline's pointer surface around the lanes: its click and scrub, as on the audio lane */
function Surface({
    onSeek,
    children,
}: {
    onSeek: (beat: number) => void;
    children: ReactNode;
}) {
    const pointer = useTimelinePointer({
        onSeek,
        pixelsPerBeat: PPB,
        beatCount: beats.length,
        seekSnapBeats: snapBeats,
        snapBeats: pageBeats,
    });
    return (
        <div
            data-testid="timeline-pointer-surface"
            {...pointer.pointerHandlers}
        >
            {children}
        </div>
    );
}

function renderLane(
    cues: DatabaseCue[],
    timeline: {
        onSeek?: (beat: number) => void;
        onSelectRange?: (range: TimelineBeatRange) => void;
        /** Who's selected: the lane draws their rows (both guard members unless said) */
        selectedIds?: readonly number[];
    } = {},
) {
    const compiled = compileShowCues(marchers, beats, cues);
    const show = { ...compiled, cues, marchers };
    const lane = facingLane({
        compiled: compiled.compiled,
        cues,
        marcherIds: [1, 2],
    });
    return render(
        <TolgeeProvider tolgee={tolgee}>
            <QueryClientProvider client={new QueryClient()}>
                <Surface onSeek={timeline.onSeek ?? (() => {})}>
                    <FacingLaneView
                        geometry={{
                            top: 0,
                            width: 2000,
                            pixelsPerBeat: PPB,
                            beatCount: beats.length,
                            snapBeats,
                            pageBeats,
                            downbeats,
                            leadingInset: 0,
                            onSelectRange: timeline.onSelectRange,
                        }}
                        lane={lane}
                        show={show}
                        beats={beats}
                        selectedIds={timeline.selectedIds ?? [1, 2]}
                    />
                </Surface>
            </QueryClientProvider>
        </TolgeeProvider>,
    );
}

/** Drags `handle` sideways by `dx` px, as a mouse does, and lets go (the lane listens on the window). */
async function dragBy(handle: Element, dx: number) {
    const pointer = { pointerId: 1, pointerType: "mouse", button: 0 };
    await act(async () => {
        fireEvent.pointerDown(handle, { ...pointer, clientX: 500 });
    });
    await act(async () => {
        for (const x of [500 + dx / 2, 500 + dx])
            fireEvent.pointerMove(window, { ...pointer, clientX: x });
        fireEvent.pointerUp(window, { ...pointer, clientX: 500 + dx });
    });
}

const mouse = { pointerId: 1, pointerType: "mouse", button: 0 };
async function clickAt(target: Element, clientX: number) {
    await act(async () => {
        fireEvent.pointerDown(target, { ...mouse, clientX });
    });
    await act(async () => {
        fireEvent.pointerUp(target, { ...mouse, clientX });
        fireEvent.pointerUp(window, { ...mouse, clientX });
    });
}

beforeAll(async () => {
    await tolgee.run();
    HTMLElement.prototype.setPointerCapture ??= () => {};
    if (!("PointerEvent" in window)) {
        class PointerEventShim extends MouseEvent {
            readonly pointerId: number;
            readonly pointerType: string;
            constructor(type: string, init: PointerEventInit = {}) {
                super(type, init);
                this.pointerId = init.pointerId ?? 0;
                this.pointerType = init.pointerType ?? "mouse";
            }
        }
        Object.assign(window, { PointerEvent: PointerEventShim });
    }
});
beforeEach(() => {
    written.length = 0;
    useCueSelectionStore.getState().pick(null);
    useTimelineSelectionStore.setState({ playheadBeat: spec(8) });
});
afterEach(cleanup);

describe("the Facing lane (#993)", () => {
    const q = (container: HTMLElement, testId: string, cueId = 1) =>
        container.querySelector(
            `[data-cue-id="${cueId}"] [data-testid="${testId}"], [data-testid="${testId}"][data-cue-id="${cueId}"]`,
        )!;

    it("draws the turn as its own piece before the cue's diamond, with the length handle on the turn only", () => {
        const { container } = renderLane([
            cue(1, 12, "side2", { transition: 7 }),
        ]);
        const turn = q(container, "facing-lane-turn");
        const hold = q(container, "facing-lane-hold");
        // 6 counts at 16 px: "↺ 90° · 6 counts" doesn't fit, "↺ 90°" does
        expect(turn.textContent).toBe("↺ 90°");
        expect(turn.getAttribute("title")).toBe("↺ 90° · 6 counts");
        expect(hold.textContent).toContain("Side 2 · 90°");
        expect(
            turn.querySelector('[data-testid="facing-lane-turn-start"]'),
        ).not.toBeNull();
        expect(
            hold.querySelector('[data-testid="facing-lane-diamond"]'),
        ).not.toBeNull();
        // Nothing on the result changes the turn: no grip, and no tab while it has a turn
        expect(
            hold.querySelector('[data-testid="facing-lane-turn-start"]'),
        ).toBeNull();
        expect(
            hold.querySelector('[data-testid="facing-lane-turn-tab"]'),
        ).toBeNull();
    });

    it("gives an instant cue a tab that pulls a turn out, keeping the cue on its count", async () => {
        const { container } = renderLane([cue(1, 13, "side2")]);
        const tab = q(container, "facing-lane-turn-tab");
        expect(tab.getAttribute("aria-label")).toBe("Drag to turn over counts");
        await dragBy(tab, -32);
        // Two counts before count 13, stored inclusively as 3
        expect(written.at(-1)?.modifiedCues).toEqual([
            { id: 1, transition: 3 },
        ]);
    });

    it.each([
        ["facing-lane-turn-start", -16, 4],
        ["facing-lane-turn-start", 32, null],
        ["facing-lane-turn", 16, 2],
    ] as const)(
        "a 2-count turn dragged by its %s %i px (16 px a count) stores %s",
        async (testId, dx, transition) => {
            const { container } = renderLane([
                cue(1, 13, "side2", { transition: 3 }),
            ]);
            await dragBy(q(container, testId), dx);
            expect(written.at(-1)?.modifiedCues).toEqual([
                { id: 1, transition },
            ]);
        },
    );

    it("never starts the turn before the cue before it", async () => {
        const { container } = renderLane([
            cue(2, 5, "back"),
            cue(1, 13, "side2"),
        ]);
        await dragBy(q(container, "facing-lane-turn-tab"), -400);
        // From count 5 into count 13: 8 counts, stored as 9
        expect(written.at(-1)?.modifiedCues).toEqual([
            { id: 1, transition: 9 },
        ]);
    });

    it.each(["facing-lane-diamond", "facing-lane-hold"] as const)(
        "moves the cue, its turn with it, when its %s is dragged",
        async (testId) => {
            const { container } = renderLane([
                cue(1, 13, "back", { transition: 3 }),
            ]);
            await dragBy(q(container, testId), 32);
            expect(written.at(-1)?.modifiedCues).toEqual([
                { id: 1, beatId: 100 + 15 },
            ]);
        },
    );

    it("labels a turn by which way, how far and how long, shorter where it's narrow", () => {
        const words = {
            full: (icon: string, amount: string, counts: number) =>
                `${icon} ${amount} · ${counts} counts`,
            short: (icon: string, amount: string) => `${icon} ${amount}`,
        };
        // A positive turn goes to the performers' left: anticlockwise, as the dial draws it
        const piece = { from: 6, to: 8, fromDegrees: 0, degrees: 180 };
        expect(turnBarLabel(piece, 200, words)).toEqual({
            label: "↺ 180° · 2 counts",
            fullLabel: "↺ 180° · 2 counts",
        });
        expect(turnBarLabel(piece, 50, words).label).toBe("↺ 180°");
        expect(turnBarLabel(piece, 20, words)).toEqual({
            label: "↺",
            fullLabel: "↺ 180° · 2 counts",
        });
        expect(
            turnBarLabel({ ...piece, fromDegrees: 90, degrees: 0 }, 200, words)
                .label,
        ).toBe("↻ −90° · 2 counts");
    });

    it("picks a bar on a click and selects its turn and result; an empty-space click is the timeline's", async () => {
        const onSeek = vi.fn();
        const onSelectRange = vi.fn();
        const { container } = renderLane(
            [cue(1, 13, "back", { transition: 3 }), cue(2, 20, "front")],
            { onSeek, onSelectRange },
        );
        await clickAt(
            container.querySelector('[data-testid="facing-lane-turn"]')!,
            12 * PPB,
        );
        expect(useCueSelectionStore.getState().cueId).toBe(1);
        // From where its turn starts to the next Facing cue for its performers, in view beats
        expect(onSelectRange).toHaveBeenCalledWith({
            startBeatIndex: 11,
            endBeatIndex: 20,
        });
        expect(onSeek).not.toHaveBeenCalled();
        await clickAt(
            container.querySelector('[data-testid="facing-lane-row"]')!,
            30 * PPB,
        );
        expect(onSeek.mock.calls.at(-1)?.[0]).toBe(30);
    });

    // The simulated users' finding (#993): clicking the popover's fields moved the playhead, and an
    // instant turn's From showed where it ends
    it("keeps presses in the turn popover off the timeline, and shows an instant turn's start in From", async () => {
        const onSeek = vi.fn();
        useCueSelectionStore.getState().pick(null);
        const cues = [cue(1, 5, "side2"), cue(2, 13, "back")];
        const view = renderLane(cues, { onSeek });
        await act(async () => {
            useCueSelectionStore.getState().pick(cues[1]!);
            useTurnPopoverStore.getState().open(2);
        });
        const counts = await view.findByTestId("turn-counts");
        await clickAt(counts, 300);
        expect(onSeek).not.toHaveBeenCalled();
        // From side 2 (90°), the back is 180°
        expect(view.getByTestId("turn-from").textContent).toBe("90°");
        await act(async () => useTurnPopoverStore.getState().close());
    });

    // The simulated director's finding (#993, round 2): the double-click that opens the popover
    // began with a click that selected the bar's counts, throwing the playhead to the show's end
    it("leaves the playhead where it was when a double-click opens the popover", async () => {
        useTimelineSelectionStore.getState().selectRange(3, 9);
        // As the timeline does: a bar's click selects its counts
        const onSelectRange = vi.fn((range: TimelineBeatRange) =>
            useTimelineSelectionStore
                .getState()
                .selectRange(range.startBeatIndex, range.endBeatIndex),
        );
        const view = renderLane([cue(1, 13, "back", { transition: 3 })], {
            onSelectRange,
        });
        const turn = view.container.querySelector(
            '[data-testid="facing-lane-turn"]',
        )!;
        await clickAt(turn, 12 * PPB);
        expect(useTimelineSelectionStore.getState().playheadBeat).not.toBe(9);
        await act(async () => {
            fireEvent.doubleClick(turn);
        });
        expect(await view.findByTestId("turn-popover")).toBeTruthy();
        const { startBeat, playheadBeat } =
            useTimelineSelectionStore.getState();
        expect([startBeat, playheadBeat]).toEqual([3, 9]);
        await act(async () => useTurnPopoverStore.getState().close());
    });
});

describe("one row of keyframes (#1315)", () => {
    // G1 turns to side 2 over 4 counts and G2 faces the back at once, both on count 12
    const shared = () => [
        cue(1, 12, "side2", { marcherIds: [1], transition: 5 }),
        cue(2, 12, "back", { marcherIds: [2] }),
        cue(3, 20, "front", { marcherIds: [1] }),
    ];
    const select = vi.fn();
    beforeEach(() => {
        select.mockReset();
        setActiveFieldEditor({ select } as unknown as FieldEditor);
    });
    afterEach(() => setActiveFieldEditor(null));
    const keyAt = (container: HTMLElement, count: number) =>
        container.querySelector(
            `[data-testid="facing-lane-key"][data-count="${count}"]`,
        )!;

    it("draws one keyframe per count, shared by the cues on it, and no rows with nothing selected", () => {
        const { container } = renderLane(shared(), { selectedIds: [] });
        const keys = container.querySelectorAll(
            '[data-testid="facing-lane-key"]',
        );
        expect([...keys].map((k) => k.getAttribute("data-count"))).toEqual([
            "12",
            "20",
        ]);
        expect(keyAt(container, 12).getAttribute("data-cues")).toBe("1,2");
        expect(
            keyAt(container, 12).querySelector(
                '[data-testid="facing-lane-key-shared"]',
            )?.textContent,
        ).toBe("2");
        expect(keyAt(container, 12).getAttribute("aria-label")).toContain(
            "2 groups change facing here",
        );
        expect(
            container.querySelectorAll('[data-testid="facing-lane-row"]'),
        ).toHaveLength(0);
    });

    it("shows the turns of the selection's groups only", () => {
        const { container } = renderLane(shared(), { selectedIds: [2] });
        const rows = container.querySelectorAll(
            '[data-testid="facing-lane-row"]',
        );
        expect([...rows].map((r) => r.getAttribute("data-marchers"))).toEqual([
            "2",
        ]);
        // G1's keyframe at count 20 is dimmed: nobody selected changes there
        expect(keyAt(container, 20).hasAttribute("data-active")).toBe(false);
        expect(keyAt(container, 12).hasAttribute("data-active")).toBe(true);
    });

    it("selects who changes on a keyframe when it's clicked, adding them with Shift", async () => {
        const { container } = renderLane(shared(), { selectedIds: [] });
        await clickAt(keyAt(container, 12), 500);
        expect(select).toHaveBeenLastCalledWith([1, 2]);
        // A keyframe with one cue picks it, so the cue commands act on it
        await clickAt(keyAt(container, 20), 500);
        expect(select).toHaveBeenLastCalledWith([1]);
        expect(useCueSelectionStore.getState().cueId).toBe(3);
        cleanup();
        const view = renderLane(shared(), { selectedIds: [2] });
        await act(async () => {
            fireEvent.pointerDown(keyAt(view.container, 20), {
                ...mouse,
                clientX: 500,
                shiftKey: true,
            });
        });
        await act(async () => {
            fireEvent.pointerUp(window, { ...mouse, clientX: 500 });
        });
        expect(select).toHaveBeenLastCalledWith([2, 1]);
        expect(written).toEqual([]);
    });

    it("moves every cue on a keyframe's count when it's dragged, each keeping its turn", async () => {
        const { container } = renderLane(shared(), { selectedIds: [] });
        await dragBy(keyAt(container, 12), 32);
        expect(written.at(-1)?.modifiedCues).toEqual([
            { id: 1, beatId: 100 + 14 },
            { id: 2, beatId: 100 + 14 },
        ]);
        // A drag selects nobody
        expect(select).not.toHaveBeenCalled();
    });
});
