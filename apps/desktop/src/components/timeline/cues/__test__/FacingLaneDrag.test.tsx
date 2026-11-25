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
import { FacingLaneView } from "../FacingLane";
import { useTurnPopoverStore } from "@/cues/turnPopoverStore";
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
                        folded={false}
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
    const grip = (container: HTMLElement, which: "result" | "turn") =>
        container.querySelector(`[data-testid="facing-lane-${which}-start"]`)!;

    it("draws the turn leading into the cue, striped, then the result solid, each with a start grip", () => {
        // A transition of 3, counted inclusively: a 2-count turn into count 12
        const { container } = renderLane([
            cue(1, 12, "side2", { transition: 3 }),
        ]);
        const turn = container.querySelector(
            '[data-testid="facing-lane-turn"]',
        )!;
        expect(turn.textContent).toBe("0° → 90°");
        const hold = container.querySelector(
            '[data-testid="facing-lane-hold"]',
        )!;
        expect(hold.textContent).toContain("Side 2 · 90°");
        expect(turn.contains(grip(container, "turn"))).toBe(true);
        expect(hold.contains(grip(container, "result"))).toBe(true);
    });

    it("grows the turn backwards when the result's start is dragged left, keeping its count", async () => {
        const { container } = renderLane([cue(1, 13, "side2")]);
        await dragBy(grip(container, "result"), -32);
        // Two counts before count 13, stored inclusively as 3
        expect(written.at(-1)?.modifiedCues).toEqual([
            { id: 1, transition: 3 },
        ]);
    });

    it.each([
        [-16, 4],
        [32, null],
    ] as const)(
        "a 2-count turn whose start is dragged %i px (16 px a count) stores %s",
        async (dx, transition) => {
            const { container } = renderLane([
                cue(1, 13, "side2", { transition: 3 }),
            ]);
            await dragBy(grip(container, "turn"), dx);
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
        await dragBy(
            container.querySelector(
                '[data-testid="facing-lane-hold"][data-cue-id="1"] [data-testid="facing-lane-result-start"]',
            )!,
            -400,
        );
        // From count 5 into count 13: 8 counts, stored as 9
        expect(written.at(-1)?.modifiedCues).toEqual([
            { id: 1, transition: 9 },
        ]);
    });

    it("moves the cue, its turn with it, when its bar is dragged", async () => {
        const { container } = renderLane([
            cue(1, 13, "back", { transition: 3 }),
        ]);
        await dragBy(
            container.querySelector('[data-testid="facing-lane-turn"]')!,
            32,
        );
        expect(written.at(-1)?.modifiedCues).toEqual([
            { id: 1, beatId: 100 + 15 },
        ]);
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
});
