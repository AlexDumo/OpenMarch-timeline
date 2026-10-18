import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import tolgee from "@/global/singletons/Tolgee";
import type { SelectionKeyframe } from "@/timeline/timelineSetFollowing";
import {
    BasicTimeline,
    CollapsedTimeline,
    ExpandedTimeline,
} from "../TimelineVariants";
import { timelineStoryModel } from "../TimelineStoryFixtures";

/**
 * The selection's keyframes on the timeline (#303): a diamond at every count where a selected
 * marcher is Set, filled where all of them are, hollow where some are. A click moves the playhead
 * there. They replace the page boxes' hold marks, in Basic and Expert.
 */

beforeAll(async () => {
    await tolgee.run();
});

afterEach(cleanup);

const commonProps = {
    model: timelineStoryModel,
    positionBeat: 11,
    isPlaying: false,
    pixelsPerBeat: 16,
    showTransport: false,
};

/** Page 2's flag (beat 16), mid Page 2A (beat 20), and Page 4's count 2 (beat 26) */
const KEYFRAMES: readonly SelectionKeyframe[] = [
    { beat: 16, set: 3, total: 3 },
    { beat: 20, set: 1, total: 3 },
    { beat: 26, set: 2, total: 3 },
];

const diamonds = () =>
    screen
        .queryAllByTestId(/^timeline-keyframe-/)
        .map((d) => d.getAttribute("data-testid"));

describe.each([
    ["Expert", ExpandedTimeline],
    ["Basic", BasicTimeline],
    ["Expert, compact", CollapsedTimeline],
] as const)("the selection's keyframes in %s", (_, Variant) => {
    it("draw none with nothing selected", () => {
        render(<Variant {...commonProps} />);
        expect(diamonds()).toEqual([]);
        render(<Variant {...commonProps} keyframes={[]} />);
        expect(diamonds()).toEqual([]);
    });

    it("draw a diamond at each Set count, filled where all the selection is Set, hollow where some is", () => {
        render(<Variant {...commonProps} keyframes={KEYFRAMES} />);
        expect(diamonds()).toEqual([
            "timeline-keyframe-16-filled",
            "timeline-keyframe-20-hollow",
            "timeline-keyframe-26-hollow",
        ]);
        // At its exact beat: centered on the beat's x
        expect(
            screen.getByTestId("timeline-keyframe-20-hollow").style.left,
        ).toBe(`${20 * 16}px`);
    });

    it("name each diamond's count and how many selected marchers are Set there", () => {
        render(<Variant {...commonProps} keyframes={KEYFRAMES} />);
        expect(
            screen.getByTestId("timeline-keyframe-16-filled"),
        ).toHaveAccessibleName("Page 2, count 8: 3 of 3 selected marchers Set");
        expect(
            screen.getByTestId("timeline-keyframe-26-hollow"),
        ).toHaveAccessibleName("Page 4, count 2: 2 of 3 selected marchers Set");
    });

    it("say just Set with one marcher selected", () => {
        render(
            <Variant
                {...commonProps}
                keyframes={[{ beat: 20, set: 1, total: 1 }]}
            />,
        );
        expect(
            screen.getByTestId("timeline-keyframe-20-filled"),
        ).toHaveAccessibleName("Page 2A, count 4: Set");
    });

    it("move the playhead to the diamond's count on a click, without a scrub", () => {
        const onSeek = vi.fn();
        render(
            <Variant {...commonProps} keyframes={KEYFRAMES} onSeek={onSeek} />,
        );
        const diamond = screen.getByTestId("timeline-keyframe-20-hollow");
        fireEvent.pointerDown(diamond, { button: 0, clientX: 320 });
        fireEvent.pointerUp(diamond, { button: 0, clientX: 320 });
        fireEvent.click(diamond, { detail: 1 });
        expect(onSeek.mock.calls).toEqual([[20]]);
    });
});

describe("beside the selection's keyframes", () => {
    it("the page boxes still select on a click and scrub on a drag", () => {
        const onSeek = vi.fn();
        const onSelectionChange = vi.fn();
        render(
            <ExpandedTimeline
                {...commonProps}
                keyframes={KEYFRAMES}
                onSeek={onSeek}
                onSelectionChange={onSelectionChange}
            />,
        );
        const box = screen.getByRole("button", { name: "Page 2A" });
        fireEvent.click(box, { detail: 1 });
        expect(onSelectionChange).toHaveBeenCalledWith(
            expect.objectContaining({ kind: "range" }),
        );
        const press = (type: string, clientX: number) =>
            fireEvent(
                box,
                new MouseEvent(type, { bubbles: true, button: 0, clientX }),
            );
        press("pointerdown", 130);
        press("pointermove", 200);
        expect(onSeek).toHaveBeenCalledWith(13, { gesture: "drag" });
        press("pointerup", 200);
    });

    it("the page boxes carry no hold marks or hold words", () => {
        render(<ExpandedTimeline {...commonProps} keyframes={KEYFRAMES} />);
        expect(screen.queryAllByTestId("page-hold-mark")).toEqual([]);
        expect(
            screen.getByRole("button", { name: "Page 2" }),
        ).not.toHaveAttribute("aria-describedby");
    });
});
