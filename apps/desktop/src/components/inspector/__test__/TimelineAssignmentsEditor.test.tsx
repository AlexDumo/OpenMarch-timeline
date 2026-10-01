import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import type { AssignmentRow, SpanInfo, TransitionRow } from "@openmarch/core";
import type { DbConnection } from "@/db-functions/types";
import { TimelineWriteError } from "@/db-functions/timelineErrors";
import { buildAssignmentEditTarget } from "@/timeline/timelineAssignmentEditor";
import { MAX_CAST_SLOTS } from "@/timeline/timelineCasting";
import { TIMELINE_INSPECTOR_STRINGS } from "../timelineInspectorStrings";
import { TimelineAssignmentsEditor } from "../TimelineAssignmentsEditor";

/**
 * P8.4: the inspector's assignments editor shows the slots, the vacancies and the steals, sends
 * one db-function call per change, skips a change that writes nothing, says why a disabled action
 * is disabled, and toasts a refusal.
 */

const mocks = vi.hoisted(() => ({
    cast: vi.fn(),
    recast: vi.fn(),
    slot: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    toast: vi.fn(),
}));

vi.mock("@/db-functions/timelineAssignmentEdits", () => ({
    castMarchersIntoTransition: mocks.cast,
    recastTransition: mocks.recast,
    setAssignmentSlot: mocks.slot,
    updateAssignment: mocks.update,
    removeAssignment: mocks.remove,
}));
vi.mock("@/timeline/timelineErrorMessages", () => ({
    toastTimelineError: mocks.toast,
}));

const db = { name: "test-db" } as unknown as DbConnection;

const t = (
    key: keyof typeof TIMELINE_INSPECTOR_STRINGS,
    params: Record<string, string | number> = {},
) =>
    TIMELINE_INSPECTOR_STRINGS[key].replace(/\{(\w+)\}/g, (_, name: string) =>
        String(params[name]),
    );

const TRANSITION: TransitionRow = {
    id: 7,
    start: 0,
    end: 8,
    dest: 1,
    slots: 4,
    style: "direct",
    order: "inherit",
    params: null,
};

/** Marcher 1 in slot 0 and marcher 2 in slot 2; slots 1 and 3 vacant. */
const ROWS: AssignmentRow[] = [
    {
        id: 11,
        marcher: 1,
        transition: 7,
        slot: 0,
        start: 0,
        end: 8,
        layer: 0,
    },
    {
        id: 12,
        marcher: 2,
        transition: 7,
        slot: 2,
        start: 0,
        end: 8,
        layer: 0,
    },
];

const span = (
    marcherId: number,
    start: number,
    end: number,
    assignmentId: number,
    transitionId: number,
): SpanInfo => ({
    marcherId,
    start,
    end,
    kind: "founding",
    assignmentId,
    transitionId,
    slot: 0,
});

/** Marcher 2 is stolen over [4, 8) by transition 9's row 30. */
const SPANS: Record<number, SpanInfo[]> = {
    1: [span(1, 0, 8, 11, 7)],
    2: [span(2, 0, 4, 12, 7), span(2, 4, 8, 30, 9)],
};

/** The editor for transition 7; a new target object each call. */
const editor = ({
    transition = TRANSITION,
    rows = ROWS,
    selected = [] as number[],
} = {}) => (
    <TimelineAssignmentsEditor
        target={buildAssignmentEditTarget(transition, {
            assignments: rows,
            labels: new Map([
                [1, "A1"],
                [2, "B2"],
                [3, "C3"],
            ]),
            spansOf: (id) => SPANS[id] ?? [],
        })}
        selectedMarcherIds={selected}
        database={db}
        t={t}
    />
);

const show = (...args: Parameters<typeof editor>) => render(editor(...args));

const click = async (el: HTMLElement) => {
    await act(async () => {
        fireEvent.click(el);
    });
};

const button = (name: string) => screen.getByRole("button", { name });

const commitNumber = async (label: string, value: string) => {
    const input = screen.getByRole("spinbutton", { name: label });
    await act(async () => {
        fireEvent.change(input, { target: { value } });
        fireEvent.keyDown(input, { key: "Enter" });
    });
};

beforeAll(() => {
    // Radix Select uses these, which jsdom lacks
    Element.prototype.scrollIntoView ??= vi.fn();
    Element.prototype.hasPointerCapture ??= vi.fn(() => false);
    Element.prototype.releasePointerCapture ??= vi.fn();
});
afterEach(cleanup);
beforeEach(() => {
    for (const fn of [
        mocks.cast,
        mocks.recast,
        mocks.slot,
        mocks.update,
        mocks.remove,
    ])
        fn.mockReset().mockResolvedValue([]);
    mocks.toast.mockReset();
});

describe("TimelineAssignmentsEditor", () => {
    it("lists every slot: members by drill number, and the vacancies (D-13)", () => {
        show();
        expect(screen.getByText("2 of 4 slots filled")).toBeTruthy();
        expect(
            screen.getByTestId("timeline-assign-vacancies").textContent,
        ).toContain("Vacant slots, where nobody goes (2): 1, 3");
        expect(screen.getByTestId("timeline-slot-0").textContent).toContain(
            "Slot 0: A1",
        );
        expect(screen.getByTestId("timeline-slot-1").textContent).toBe(
            "Slot 1: vacant",
        );
        expect(screen.getByTestId("timeline-slot-2").textContent).toContain(
            "Slot 2: B2",
        );
        expect(screen.getByTestId("timeline-slot-3").textContent).toBe(
            "Slot 3: vacant",
        );
    });

    it("says where a higher layer steals an assignment (R-2, UI-1)", () => {
        show();
        expect(
            within(screen.getByTestId("timeline-slot-0")).getByText(
                "Wins all of its beats.",
            ),
        ).toBeTruthy();
        expect(
            screen.getByTestId("timeline-assign-stolen-12").textContent,
        ).toBe("Stolen from beat 4 to 8 by transition 9 on a higher layer.");
    });

    it("says there are no vacancies when every slot is filled", () => {
        show({
            transition: { ...TRANSITION, slots: 3 },
            rows: [...ROWS, { ...ROWS[0]!, id: 13, marcher: 3, slot: 1 }],
        });
        expect(screen.getByText("No vacant slots.")).toBeTruthy();
        expect(screen.queryByTestId("timeline-assign-vacancies")).toBeNull();
    });

    describe("casting", () => {
        it("is disabled without a selection, and says why", () => {
            show();
            expect(
                button("Cast selected marchers").hasAttribute("disabled"),
            ).toBe(true);
            expect(
                screen.getByTestId("timeline-assign-cast-help").textContent,
            ).toBe("Select marchers to cast them into this transition.");
        });

        it("is disabled when every selected marcher is in already", () => {
            show({ selected: [1, 2] });
            expect(
                button("Cast selected marchers").hasAttribute("disabled"),
            ).toBe(true);
            expect(
                screen.getByTestId("timeline-assign-cast-help").textContent,
            ).toBe("Every selected marcher is already in this transition.");
        });

        it("is disabled with too few vacancies, and names the counts", () => {
            show({
                transition: { ...TRANSITION, slots: 3 },
                selected: [3, 4],
            });
            expect(
                button("Cast selected marchers").hasAttribute("disabled"),
            ).toBe(true);
            expect(
                screen.getByTestId("timeline-assign-cast-help").textContent,
            ).toBe(
                "Selected marchers who need a slot: 2. Vacant slots: 1. Raise the slot count first.",
            );
        });

        it("is disabled past the casting limit, and says so", () => {
            show({
                transition: { ...TRANSITION, slots: MAX_CAST_SLOTS + 1 },
                selected: [3],
            });
            expect(
                button("Cast selected marchers").hasAttribute("disabled"),
            ).toBe(true);
            expect(
                button("Recast by nearest slot").hasAttribute("disabled"),
            ).toBe(true);
            expect(
                screen.getByTestId("timeline-assign-recast-help").textContent,
            ).toContain(`up to ${MAX_CAST_SLOTS} slots`);
            // Only the first slots are listed
            expect(screen.getByText(/more slots aren't listed/)).toBeTruthy();
        });

        it("casts only the selected marchers not in the transition", async () => {
            show({ selected: [2, 3] });
            await click(button("Cast selected marchers"));
            expect(mocks.cast).toHaveBeenCalledWith({
                db,
                transitionId: 7,
                marcherIds: [3],
            });
        });
    });

    it("recasts by nearest slot; with nobody in the transition it is disabled and says why", async () => {
        show();
        await click(button("Recast by nearest slot"));
        expect(mocks.recast).toHaveBeenCalledWith({ db, transitionId: 7 });
        cleanup();
        show({ rows: [] });
        expect(button("Recast by nearest slot").hasAttribute("disabled")).toBe(
            true,
        );
        expect(
            screen.getByTestId("timeline-assign-recast-help").textContent,
        ).toBe("Nobody is in this transition yet.");
    });

    it("moves a marcher to a vacant slot, or trades with an occupied one", async () => {
        const pick = async (name: string) => {
            await act(async () => {
                fireEvent.keyDown(
                    within(screen.getByTestId("timeline-slot-0")).getByRole(
                        "combobox",
                    ),
                    { key: "Enter" },
                );
            });
            const item = await screen.findByRole("option", { name });
            await act(async () => {
                fireEvent.keyDown(item, { key: "Enter" });
            });
        };
        const { rerender } = show();
        await pick("Slot 3 (vacant)");
        await waitFor(() =>
            expect(mocks.slot).toHaveBeenCalledWith({
                db,
                assignmentId: 11,
                slot: 3,
            }),
        );
        rerender(editor());
        await pick("Slot 2 (trade with B2)");
        await waitFor(() =>
            expect(mocks.slot).toHaveBeenLastCalledWith({
                db,
                assignmentId: 11,
                slot: 2,
            }),
        );
    });

    it("changes a layer; unchanged text writes nothing", async () => {
        show();
        await commitNumber("Layer for A1", "0");
        expect(mocks.update).not.toHaveBeenCalled();
        await commitNumber("Layer for A1", "2");
        expect(mocks.update).toHaveBeenCalledWith({
            db,
            assignmentId: 11,
            change: { layer: 2 },
        });
    });

    it("changes the beats", async () => {
        show();
        await commitNumber("First beat for B2", "4");
        expect(mocks.update).toHaveBeenCalledWith({
            db,
            assignmentId: 12,
            change: { startBeat: 4, endBeat: 8 },
        });
    });

    it("removes a marcher, leaving its slot vacant", async () => {
        show();
        await click(button("Remove A1 from this transition"));
        expect(mocks.remove).toHaveBeenCalledWith({ db, assignmentId: 11 });
    });

    it("two quick edits: the second waits for the first to show", async () => {
        const { rerender } = show();
        await click(button("Remove A1 from this transition"));
        await click(button("Remove B2 from this transition"));
        expect(mocks.remove).toHaveBeenCalledTimes(1);
        expect(
            button("Remove B2 from this transition").hasAttribute("disabled"),
        ).toBe(true);
        rerender(editor({ rows: [ROWS[1]!] }));
        await click(button("Remove B2 from this transition"));
        expect(mocks.remove).toHaveBeenCalledTimes(2);
    });

    it("toasts a refusal and keeps the controls usable", async () => {
        const refusal = new TimelineWriteError(
            "E-A3",
            "E-A3: overlapping assignments for one marcher at the same layer",
        );
        mocks.update.mockRejectedValueOnce(refusal);
        show();
        await commitNumber("Layer for A1", "1");
        expect(mocks.toast).toHaveBeenCalledWith(refusal);
        expect(
            button("Remove A1 from this transition").hasAttribute("disabled"),
        ).toBe(false);
    });
});
