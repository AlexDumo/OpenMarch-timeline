import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { boxTool } from "../../box/boxTool";
import { drawBox, type BoxParams } from "../../box/boxGeometry";
import { withMode } from "../../distribute/modes";
import { outlineGapOf, withOddGap } from "../../distribute/outlineGap";
import { flipBox } from "../boxEdits";
import type { ToolEnv } from "../../tool/toolKind";
import { OutlineGap } from "../OutlineGap";

/** The editor's outline gap menu (#390, #435): the side as seen, and leaves a gap / spreads evenly */

afterEach(cleanup);

const env: ToolEnv = {
    stepPx: 10,
    snap: true,
    shift: false,
    gridSnap: (p) => p,
    hitRadius: 3,
};

/** `n` marchers in an outlined box, 6 × 3 for 13 */
const outline = (n: number) =>
    withMode(
        boxTool,
        drawBox({ x: 0, y: 0 }, { x: 60, y: 40 }, n, env)!,
        n,
        "outline",
        env,
    ) as BoxParams;

/** The gap menu for `params`, opened when the shape has a gap */
const shown = (
    params: unknown,
    spots: number,
    apply = vi.fn(),
    clickToMove = false,
) => {
    const view = render(
        <OutlineGap
            target={{ kind: boxTool, params, spots, apply }}
            envFor={() => env}
            clickToMove={clickToMove}
        />,
    );
    const menu = screen.queryByTestId("outline-gap-menu");
    if (menu) fireEvent.click(menu);
    return view;
};

const on = (testId: string) =>
    expect(screen.getByTestId(testId)).toHaveAttribute("data-state", "on");

describe("the outline gap", () => {
    it("tells an open shape a click on the field moves the gap, in the words of its style, and a placed one nothing", () => {
        shown(outline(13), 13, vi.fn(), true);
        // Spreads evenly by default
        expect(screen.getByTestId("outline-gap-tip")).toHaveTextContent(
            "Click a marcher on another side (not a corner) to spread that side instead.",
        );
        cleanup();
        const gapped = withOddGap(
            boxTool,
            outline(13),
            13,
            { side: "back", at: null, style: "gap" },
            env,
        );
        shown(gapped, 13, vi.fn(), true);
        expect(screen.getByTestId("outline-gap-tip")).toHaveTextContent(
            "Click a marcher on the outline (not a corner) to move the gap there.",
        );
        cleanup();
        shown(outline(13), 13);
        expect(screen.queryByTestId("outline-gap-tip")).toBeNull();
    });

    it("names the leftover side on its button", () => {
        shown(outline(13), 13);
        expect(screen.getByTestId("outline-gap-menu")).toHaveTextContent(
            "Leftover: Back",
        );
    });

    it("shows the gap's side and style for an odd count, the back spread evenly by default", () => {
        shown(outline(13), 13);
        const sides = screen.getByRole("group", { name: "Gap side" });
        expect(
            [...sides.querySelectorAll("button")].map((b) => b.textContent),
        ).toEqual(["Back", "Front", "Left", "Right"]);
        on("outline-gap-back");
        on("outline-gap-spread");
    });

    it("is hidden with no gap: an even count, or Files", () => {
        expect(shown(outline(14), 14).container).toBeEmptyDOMElement();
        cleanup();
        const files = drawBox({ x: 0, y: 0 }, { x: 60, y: 40 }, 13, env)!;
        expect(shown(files, 13).container).toBeEmptyDOMElement();
    });

    it("moves the gap to the middle of the side picked, as one change", () => {
        const apply = vi.fn();
        shown(outline(13), 13, apply);
        fireEvent.click(screen.getByTestId("outline-gap-front"));
        expect(apply).toHaveBeenCalledTimes(1);
        expect(
            outlineGapOf(boxTool, apply.mock.calls[0]![0], 13)!.stored,
        ).toEqual({ side: "front", at: null, style: "spread" });
    });

    it("leaves a gap on that side", () => {
        const apply = vi.fn();
        shown(outline(13), 13, apply);
        fireEvent.click(screen.getByTestId("outline-gap-gap"));
        expect(
            outlineGapOf(boxTool, apply.mock.calls[0]![0], 13)!.stored,
        ).toMatchObject({ side: "back", style: "gap" });
    });

    it("names the sides as the field shows them on a flipped box", () => {
        const flipped = flipBox(outline(13), 13, "across", "c", env);
        const apply = vi.fn();
        shown(flipped, 13, apply);
        // Flipped side to side, Left on the field is the shape's own right
        fireEvent.click(screen.getByTestId("outline-gap-left"));
        expect(
            outlineGapOf(boxTool, apply.mock.calls[0]![0], 13)!.stored.side,
        ).toBe("right");
    });
});
