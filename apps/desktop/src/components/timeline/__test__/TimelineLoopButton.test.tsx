import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { TimelineLoopButton } from "../TimelineControls";
import { TransportTooltipProvider } from "../ShortcutTooltip";

const store = () => useTimelineSelectionStore.getState();
const BOXES = [
    { start: 1, end: 9 },
    { start: 9, end: 17 },
];

const renderButton = () =>
    render(
        <TransportTooltipProvider>
            <TimelineLoopButton />
        </TransportTooltipProvider>,
    );

describe("the Loop button (UI-22)", () => {
    beforeEach(() => {
        store().reset();
        store().setPageBoxes(BOXES);
        store().selectRange(9, 17);
    });
    afterEach(cleanup);

    it("toggles looping between the flags, and leaves them", () => {
        renderButton();
        const button = screen.getByTestId("timeline-loop");
        expect(button).toHaveAttribute("aria-pressed", "false");
        fireEvent.click(button);
        expect(store().looping).toBe(true);
        expect(store().startBeat).toBe(9);
        expect(store().endBeat).toBe(17);
        expect(button).toHaveAttribute("aria-pressed", "true");
        fireEvent.click(button);
        expect(store().looping).toBe(false);
    });

    it("turns looping on and off for an isolated move too (owner 2026-10-14)", () => {
        store().setStoredTimelines([
            { id: 1, start: 9, end: 17, marcherIds: new Set([1]) },
        ]);
        store().isolate(1);
        renderButton();
        const button = screen.getByTestId("timeline-loop");
        expect(button).toHaveAttribute("aria-pressed", "false");
        expect(button).not.toHaveAttribute("aria-disabled");
        fireEvent.click(button);
        expect(store().looping).toBe(true);
        expect(button).toHaveAttribute("aria-pressed", "true");
    });
});
