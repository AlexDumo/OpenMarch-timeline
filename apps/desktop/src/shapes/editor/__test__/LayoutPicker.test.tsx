import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    within,
} from "@testing-library/react";
import { boxTool } from "../../box/boxTool";
import { boxBlock, drawBox, type BoxParams } from "../../box/boxGeometry";
import { padTool, type PadParams } from "../../__test__/fakeRowKind";
import { useLastLayoutStore } from "../../tool/lastLayout";
import type { AnyToolKind, ToolEnv } from "../../tool/toolKind";
import { quarterTurn } from "../chip";
import { LayoutMenu, LayoutPicker } from "../LayoutPicker";
import userEvent from "@testing-library/user-event";

/** The app tooltip a control shows on hover */
async function tooltipOf(el: HTMLElement): Promise<string | null> {
    await userEvent.hover(el);
    return (await screen.findByRole("tooltip")).textContent;
}

/**
 * The box's layout picker (#387) and the chip's layout menu (owner lab feedback, 2026-10-23):
 * every layout in its place, the ones the count can't make greyed with what they need, what's
 * on, and what picking does.
 */

afterEach(cleanup);
beforeEach(() => useLastLayoutStore.setState({ family: "shortBack" }));

const env: ToolEnv = {
    stepPx: 10,
    snap: true,
    shift: false,
    gridSnap: (p) => p,
    hitRadius: 3,
};

/** A box of `n`, drawn about square: Short back (6 × 4, 1 short, for 23) */
const boxOf = (n: number) => drawBox({ x: 0, y: 0 }, { x: 80, y: 80 }, n, env)!;

const target = (
    params: unknown,
    spots: number,
    apply = vi.fn(),
    kind: AnyToolKind = boxTool,
) => ({ kind, params, spots, apply });

const shown = (
    params: unknown,
    spots: number,
    apply = vi.fn(),
    kind: AnyToolKind = boxTool,
) =>
    render(
        <LayoutPicker
            target={target(params, spots, apply, kind)}
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
    it("keeps every layout in its place, in the fixed order", () => {
        shown(boxOf(23), 23);
        const rows = [
            ...screen
                .getByTestId("shape-layout-picker")
                .querySelectorAll("[data-testid^=shape-layout-row-]"),
        ].map((r) => r.getAttribute("data-testid"));
        expect(rows).toEqual([
            "shape-layout-row-full",
            "shape-layout-row-stagger",
            "shape-layout-row-rounded",
            "shape-layout-row-shortBack",
            "shape-layout-row-notched",
        ]);
        expect(labelsIn("stagger")).toEqual(["8 × 3", "5 × 5", "3 × 9"]);
        expect(screen.queryByText(/Not for/)).toBeNull();
    });

    it("greys out a layout the count can't make, as a picture with what it needs", async () => {
        shown(boxOf(23), 23);
        const full = screen.getByTestId("shape-layout-full-missing");
        expect(full).toHaveAttribute("aria-disabled", "true");
        expect(full).toHaveTextContent("add 1 / remove 2");
        expect(await tooltipOf(full)).toBe(
            "Full needs 24 or 21 marchers: add 1 / remove 2",
        );
        expect(full.querySelector("svg")).not.toBeNull();
    });

    it("puts the counts in the tooltip and marks the shape's own version", async () => {
        shown(boxOf(23), 23);
        const stagger = screen.getByTestId("shape-layout-stagger-1");
        expect(await tooltipOf(stagger)).toBe(
            "Stagger 5 × 5: 5 / 4 / 5 / 4 / 5, front to back",
        );
        // Drawn square, 23 is Short back 6 × 4
        expect(screen.getByTestId("shape-layout-shortBack-2")).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        expect(stagger).toHaveAttribute("aria-pressed", "false");
    });

    it("marks a version turned a quarter as that version", () => {
        const full = boxTool.closed!.withDistribution(
            boxOf(24),
            24,
            {
                mode: "files",
                layout: { family: "full", files: 8, byFile: false },
                stagger: [0, 1],
            },
            env,
        );
        shown(quarterTurn(boxTool, full, 24, env), 24);
        expect(screen.getByTestId("shape-layout-full-0")).toHaveAttribute(
            "aria-pressed",
            "true",
        );
    });

    it("lays the shape out in the version picked, and remembers its layout", () => {
        const apply = vi.fn();
        shown(boxOf(23), 23, apply);
        fireEvent.click(screen.getByTestId("shape-layout-stagger-1"));
        expect(apply).toHaveBeenCalledTimes(1);
        const next = apply.mock.calls[0]![0] as BoxParams;
        expect(boxBlock(next, 23).lines).toEqual([5, 4, 5, 4, 5]);
        expect(useLastLayoutStore.getState().family).toBe("stagger");
    });

    it("is hidden for a kind without layouts", () => {
        const pad: PadParams = { center: { x: 0, y: 0 }, gap: 20, rotation: 0 };
        const { container } = shown(pad, 5, vi.fn(), padTool);
        expect(container).toBeEmptyDOMElement();
    });
});

describe("the chip's layout menu", () => {
    const menu = (params: unknown, spots: number, apply = vi.fn()) =>
        render(
            <LayoutMenu
                target={target(params, spots, apply)}
                envFor={() => env}
            />,
        );
    const open = () => {
        act(() => {
            fireEvent.click(screen.getByTestId("shape-layout-menu"));
        });
        return screen.getByTestId("shape-layout-menu-content");
    };

    it("shows the box's layout on its button", () => {
        menu(boxOf(23), 23);
        expect(screen.getByTestId("shape-layout-menu")).toHaveTextContent(
            "Short back",
        );
        expect(screen.queryByTestId("shape-layout-menu-wanted")).toBeNull();
    });

    it("lists every layout, greying out those the count can't make with what they need", () => {
        menu(boxOf(23), 23);
        const content = open();
        const rows = [
            ...content.querySelectorAll(
                "[data-testid^=shape-layout-menu-row-]",
            ),
        ];
        expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
            "shape-layout-menu-row-full",
            "shape-layout-menu-row-stagger",
            "shape-layout-menu-row-rounded",
            "shape-layout-menu-row-shortBack",
            "shape-layout-menu-row-notched",
        ]);
        const full = within(content).getByTestId("shape-layout-menu-row-full");
        expect(full).toHaveAttribute("aria-disabled", "true");
        expect(full).toHaveTextContent("add 1 / remove 2");
    });

    it("shows the box's own layout's versions, and another's on hover or its arrow", () => {
        menu(boxOf(23), 23);
        const content = open();
        const versions = () =>
            [
                ...within(content)
                    .getByTestId("shape-layout-menu-versions")
                    .querySelectorAll("button"),
            ].map((b) => b.getAttribute("aria-label"));
        expect(versions()[0]).toMatch(/^Short back /);
        fireEvent.pointerEnter(
            within(content).getByTestId("shape-layout-menu-row-stagger"),
        );
        expect(versions()).toEqual([
            "Stagger 8 × 3",
            "Stagger 5 × 5",
            "Stagger 3 × 9",
        ]);
        fireEvent.click(
            within(content).getByTestId("shape-layout-menu-expand-rounded"),
        );
        expect(versions()).toEqual([
            "Rounded 9 × 3 straight",
            "Rounded 5 × 5 staggered",
        ]);
    });

    it("lays the box out in a version picked, and closes", () => {
        const apply = vi.fn();
        menu(boxOf(23), 23, apply);
        const content = open();
        fireEvent.pointerEnter(
            within(content).getByTestId("shape-layout-menu-row-stagger"),
        );
        fireEvent.click(
            within(content).getByTestId("shape-layout-menu-version-stagger-1"),
        );
        expect(
            boxBlock(apply.mock.calls[0]![0] as BoxParams, 23).lines,
        ).toEqual([5, 4, 5, 4, 5]);
        expect(screen.queryByTestId("shape-layout-menu-content")).toBeNull();
        expect(useLastLayoutStore.getState().family).toBe("stagger");
    });

    it("picks a layout's version nearest the box's proportions from its row", () => {
        const apply = vi.fn();
        menu(boxOf(23), 23, apply);
        const content = open();
        fireEvent.click(
            within(content).getByTestId("shape-layout-menu-row-notched"),
        );
        expect(
            boxBlock(apply.mock.calls[0]![0] as BoxParams, 23).layout.family,
        ).toBe("notched");
    });

    it("shows a layout the count can't make greyed on its button, with what it needs", () => {
        const wanted = boxTool.closed!.withDistribution(
            boxOf(23),
            23,
            {
                mode: "files",
                layout: { family: "full", files: 6, byFile: false },
                stagger: [0, 1],
            },
            env,
        );
        menu(wanted, 23);
        const tag = screen.getByTestId("shape-layout-menu-wanted");
        expect(tag).toHaveTextContent("Full");
        expect(tag).toHaveTextContent("add 1 / remove 2");
    });
});
