import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelinePageFlagHandles } from "../TimelinePageFlagHandles";
import type { TimelinePageMarker } from "../TimelineViewModel";

/**
 * The E10 page flag handles (Tempo lab `drillChoices`): one drag or one arrow press is one write,
 * and writes queue behind the timeline write lock, as main's UI-16 grips do.
 */

afterEach(cleanup);

// jsdom has no PointerEvent, so fireEvent's pointer events would lose clientX
if (typeof window.PointerEvent === "undefined") {
    class TestPointerEvent extends MouseEvent {
        readonly pointerId: number;
        constructor(type: string, init: PointerEventInit = {}) {
            super(type, init);
            this.pointerId = init.pointerId ?? 1;
        }
    }
    window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
}

// Page 1 from beat 0 to 8, page 2 from 8 to 16; 10px a beat
const PAGES: TimelinePageMarker[] = [
    { id: 1, label: "1", atBeat: 0, isInitial: false },
    { id: 2, label: "2", atBeat: 8, isInitial: false },
];

const renderHandles = (onMove: (id: string | number, to: number) => unknown) =>
    render(
        <div>
            <TimelinePageFlagHandles
                pages={PAGES}
                measures={[]}
                beatCount={16}
                pixelsPerBeat={10}
                move={{ onMove: onMove as never }}
            />
        </div>,
    );

const grip = (container: HTMLElement, pageId: number) =>
    container.querySelector<HTMLElement>(
        `[data-testid="timeline-page-flag-handle"][data-page-id="${pageId}"]`,
    )!;

const dragGrip = (element: HTMLElement, fromX: number, toX: number) => {
    fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientX: fromX });
    fireEvent.pointerMove(element, { pointerId: 1, clientX: toX });
    fireEvent.pointerUp(element, { pointerId: 1, clientX: toX });
};

describe("TimelinePageFlagHandles", () => {
    it("writes a drag released while an arrow-key move is still being written", async () => {
        let finishKey!: () => void;
        const onMove = vi
            .fn()
            .mockImplementationOnce(
                () => new Promise<void>((resolve) => (finishKey = resolve)),
            )
            .mockResolvedValue(undefined);
        const { container } = renderHandles(onMove);

        fireEvent.keyDown(grip(container, 1), { key: "ArrowRight" });
        expect(onMove).toHaveBeenCalledWith(1, 9);

        // Page 2's flag, at beat 16, dragged to beat 12 before the key's write settles
        dragGrip(grip(container, 2), 160, 120);
        expect(onMove).toHaveBeenCalledTimes(2);
        expect(onMove).toHaveBeenLastCalledWith(2, 12);

        await act(async () => finishKey());
    });

    it("arrow keys still wait for a pending write, so a held key can't send a move twice", async () => {
        let finishDrag!: () => void;
        const onMove = vi
            .fn()
            .mockImplementationOnce(
                () => new Promise<void>((resolve) => (finishDrag = resolve)),
            )
            .mockResolvedValue(undefined);
        const { container } = renderHandles(onMove);

        dragGrip(grip(container, 2), 160, 120);
        expect(onMove).toHaveBeenCalledWith(2, 12);
        fireEvent.keyDown(grip(container, 1), { key: "ArrowRight" });
        expect(onMove).toHaveBeenCalledTimes(1);

        await act(async () => finishDrag());
        fireEvent.keyDown(grip(container, 1), { key: "ArrowRight" });
        expect(onMove).toHaveBeenCalledTimes(2);
        expect(onMove).toHaveBeenLastCalledWith(1, 9);
    });
});
