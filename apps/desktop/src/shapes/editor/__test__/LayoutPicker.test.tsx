import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { boxTool } from "../../box/boxTool";
import { boxBlock, drawBox, type BoxParams } from "../../box/boxGeometry";
import { padTool, type PadParams } from "../../__test__/fakeRowKind";
import { useLastLayoutStore } from "../../tool/lastLayout";
import type { AnyToolKind, ToolEnv } from "../../tool/toolKind";
import { CompactLayoutPicker, LayoutPicker } from "../LayoutPicker";

/** The box's layout picker (#387): rows, labels, what's on, and what picking does */

afterEach(cleanup);
beforeEach(() => useLastLayoutStore.setState({ family: "shortBack" }));

const env: ToolEnv = {
    stepPx: 10,
    snap: true,
    shift: false,
    gridSnap: (p) => p,
    hitRadius: 3,
};

/** A box of `n`, drawn about square: Short back */
const boxOf = (n: number) => drawBox({ x: 0, y: 0 }, { x: 80, y: 80 }, n, env)!;

const shown = (
    kind: AnyToolKind,
    params: unknown,
    spots: number,
    apply = vi.fn(),
) =>
    render(
        <LayoutPicker
            target={{ kind, params, spots, apply }}
            envFor={() => env}
        />,
    );

const labelsIn = (family: string) =>
    [
        ...screen
            .getByTestId(`shape-layout-row-${family}`)
            .querySelectorAll("button"),
    ].map((b) => b.textContent);

describe("the layout picker", () => {
    it("shows the rows the count makes, in order, and lists the rest on one line", () => {
        shown(boxTool, boxOf(23), 23);
        const rows = [
            ...screen
                .getByTestId("shape-layout-picker")
                .querySelectorAll("[data-testid^=shape-layout-row-]"),
        ].map((r) => r.getAttribute("data-testid"));
        expect(rows).toEqual([
            "shape-layout-row-stagger",
            "shape-layout-row-rounded",
            "shape-layout-row-shortBack",
            "shape-layout-row-notched",
        ]);
        expect(labelsIn("stagger")).toEqual([
            "8 × 3",
            "5 × 5",
            "5 × 5",
            "3 × 8",
        ]);
        expect(screen.getByTestId("shape-layout-missing")).toHaveTextContent(
            "Not for 23: Full (add 1 or remove 2)",
        );
    });

    it("puts the counts in the tooltip and marks the shape's own version", () => {
        shown(boxTool, boxOf(23), 23);
        const stagger = screen.getByTestId("shape-layout-stagger-1");
        expect(stagger).toHaveAttribute(
            "title",
            "Stagger 5 × 5: 5 / 4 / 5 / 4 / 5, front to back",
        );
        // Drawn square, 23 is Short back 6 × 4
        expect(screen.getByTestId("shape-layout-shortBack-1")).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        expect(stagger).toHaveAttribute("aria-pressed", "false");
    });

    it("lays the shape out in the version picked, and remembers its layout", () => {
        const apply = vi.fn();
        shown(boxTool, boxOf(23), 23, apply);
        fireEvent.click(screen.getByTestId("shape-layout-stagger-1"));
        expect(apply).toHaveBeenCalledTimes(1);
        const next = apply.mock.calls[0]![0] as BoxParams;
        expect(boxBlock(next, 23).lines).toEqual([5, 4, 5, 4, 5]);
        expect(useLastLayoutStore.getState().family).toBe("stagger");
    });

    it("shows Full first when the count makes one", () => {
        shown(boxTool, boxOf(24), 24);
        expect(labelsIn("full")).toEqual(["8 × 3", "6 × 4", "4 × 6", "3 × 8"]);
        expect(screen.queryByTestId("shape-layout-missing")).toBeNull();
    });

    it("is hidden for a kind without layouts", () => {
        const pad: PadParams = { center: { x: 0, y: 0 }, gap: 20, rotation: 0 };
        const { container } = shown(padTool, pad, 5);
        expect(container).toBeEmptyDOMElement();
    });
});

describe("the compact picker under the chip", () => {
    it("offers one version per layout, nearest the shape's proportions, its own on", () => {
        const apply = vi.fn();
        render(
            <CompactLayoutPicker
                target={{
                    kind: boxTool,
                    params: boxOf(23),
                    spots: 23,
                    apply,
                }}
                envFor={() => env}
            />,
        );
        const buttons = [
            ...screen
                .getByTestId("shape-layout-compact")
                .querySelectorAll("button"),
        ];
        expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
            "Stagger 5 × 5",
            "Rounded 5 × 5 staggered",
            "Short back 6 × 4, 1 short",
            "Notched 5 × 5 straight",
        ]);
        expect(
            buttons.map((b) => b.getAttribute("aria-pressed") === "true"),
        ).toEqual([false, false, true, false]);
        fireEvent.click(buttons[0]!);
        expect(
            boxBlock(apply.mock.calls[0]![0] as BoxParams, 23).layout.family,
        ).toBe("stagger");
    });
});
