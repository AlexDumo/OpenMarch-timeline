import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { OrderChoice } from "../../assign";
import { OrderMenu } from "../OrderMenu";

/**
 * Who goes where on the floating editor (#528, #559, 09-who-goes-where.md): one menu of Least
 * travel, Keep order and Reverse order, each pictured as the new line read as numbers, then Inside
 * out, Zipper and Within sections, each described in words. A choice that doesn't fit is greyed
 * out and says why.
 */

afterEach(cleanup);

const renderMenu = (
    current: OrderChoice,
    keepOffered = true,
    readout?: { biggest: string | null; crossings: number },
) => {
    const pick = vi.fn();
    render(
        <OrderMenu
            target={{
                order: {
                    current,
                    why: (choice) =>
                        !keepOffered &&
                        (choice === "keep" || choice === "inside")
                            ? "noOrder"
                            : null,
                    pick,
                    ...(readout && { readout }),
                    key: current,
                },
            }}
        />,
    );
    return pick;
};
const openMenu = () => fireEvent.click(screen.getByTestId("shape-order"));
const sequence = (testId: string) =>
    screen.getByTestId(testId).getAttribute("data-sequence");

describe("who goes where's menu", () => {
    it("lists every answer, with no toggle beside it", () => {
        renderMenu("keep");
        openMenu();
        const items = screen.getAllByRole("menuitemradio");
        expect(items.map((item) => item.getAttribute("data-testid"))).toEqual([
            "shape-order-nearest",
            "shape-order-keep",
            "shape-order-reverse",
            "shape-order-inside",
            "shape-order-zipper",
            "shape-order-sections",
        ]);
        // The pictures are hidden, so each row is named by its label
        expect(
            items.map(
                (item) => item.querySelector("[data-label]")?.textContent,
            ),
        ).toEqual([
            "Least travel",
            "Keep order",
            "Reverse order",
            "Inside out",
            "Zipper",
            "Within sections",
        ]);
        expect(screen.queryByRole("button", { pressed: true })).toBeNull();
    });

    it("says what every answer does in a tip, not under its name", () => {
        renderMenu("keep");
        openMenu();
        expect(screen.queryByTestId("shape-order-inside-note")).toBeNull();
        expect(
            screen.getByTestId("shape-order-inside"),
        ).toHaveAccessibleDescription(
            "The middle of the line goes to the ends of the shape",
        );
        expect(
            screen.getByTestId("shape-order-nearest"),
        ).toHaveAccessibleDescription(
            "Each marcher takes a spot that keeps everyone's walk short",
        );
        expect(screen.queryByTestId("shape-order-zipper-tip")).toBeNull();
        fireEvent.pointerEnter(screen.getByTestId("shape-order-zipper"));
        expect(
            screen.getAllByTestId("shape-order-zipper-tip")[0],
        ).toHaveTextContent("Two lines merge into one, taking turns");
        expect(
            screen.getByTestId("shape-order-zipper-tip-icon"),
        ).not.toHaveAttribute("data-refused");
    });

    it("shows a walking picture above the words in every tip, refused ones too", () => {
        renderMenu("nearest", false);
        openMenu();
        fireEvent.pointerEnter(screen.getByTestId("shape-order-inside"));
        const picture = screen.getAllByTestId(
            "shape-order-inside-animation",
        )[0]!;
        expect(picture).toHaveAttribute("aria-hidden", "true");
        expect(picture.getAttribute("data-sequence")).toBe("3 2 1 4 7 6 5");
        expect(
            picture.querySelectorAll(
                '[data-testid="shape-order-inside-animation-marcher"]',
            ).length,
        ).toBe(7);
        // Screen readers still hear just the words
        expect(
            screen.getByTestId("shape-order-inside"),
        ).toHaveAccessibleDescription(
            /^The middle of the line goes to the ends of the shape\. These marchers have no order yet/,
        );
    });

    it("greys out an answer that doesn't fit, says why, and won't pick it", () => {
        const pick = renderMenu("nearest", false);
        openMenu();
        const keep = screen.getByTestId("shape-order-keep");
        expect(keep).toHaveAttribute("aria-disabled", "true");
        // The reason waits behind a ? instead of showing under the name
        expect(screen.queryByTestId("shape-order-keep-note")).toBeNull();
        expect(screen.getByTestId("shape-order-keep-tip-icon")).toHaveAttribute(
            "data-refused",
            "true",
        );
        expect(keep).toHaveAccessibleDescription(
            /These marchers have no order yet/,
        );
        expect(screen.queryByTestId("shape-order-keep-tip")).toBeNull();
        fireEvent.click(keep);
        expect(pick).not.toHaveBeenCalled();
        // A press shows what it does and why it doesn't fit, beside the row
        expect(
            screen.getAllByTestId("shape-order-keep-tip")[0],
        ).toHaveTextContent(
            /The marchers' order runs along the shape.*These marchers have no order yet/,
        );
        // Reverse order fits any line, as before
        expect(screen.getByTestId("shape-order-reverse")).not.toHaveAttribute(
            "aria-disabled",
        );
    });

    it("says what the current answer gives: the biggest step and paths crossing", () => {
        renderMenu("keep", true, { biggest: "6 to 5", crossings: 2 });
        openMenu();
        expect(screen.getByTestId("shape-order-readout")).toHaveTextContent(
            "Biggest step 6 to 5 · 2 pairs of paths cross",
        );
        cleanup();
        renderMenu("keep", true, { biggest: null, crossings: 0 });
        openMenu();
        expect(screen.getByTestId("shape-order-readout")).toHaveTextContent(
            "No paths cross",
        );
        cleanup();
        renderMenu("keep");
        openMenu();
        expect(screen.queryByTestId("shape-order-readout")).toBeNull();
    });

    it("names Reverse order on a line saved reversed", () => {
        renderMenu("reverse");
        const button = screen.getByTestId("shape-order");
        expect(button).toHaveAttribute("data-value", "reverse");
        expect(button).toHaveAccessibleName("Who goes where: Reverse order");
        openMenu();
        expect(screen.getByTestId("shape-order-reverse")).toHaveAttribute(
            "aria-checked",
            "true",
        );
    });

    it("changes nothing when the answer it's on is picked", () => {
        for (const current of ["nearest", "keep", "reverse"] as const) {
            const pick = renderMenu(current);
            openMenu();
            fireEvent.click(screen.getByTestId(`shape-order-${current}`));
            expect(pick, current).not.toHaveBeenCalled();
            cleanup();
        }
    });

    it("picks another answer as one change", () => {
        const pick = renderMenu("keep");
        openMenu();
        fireEvent.click(screen.getByTestId("shape-order-reverse"));
        expect(pick).toHaveBeenCalledExactlyOnceWith("reverse");
        cleanup();
        const fromReverse = renderMenu("reverse");
        openMenu();
        fireEvent.click(screen.getByTestId("shape-order-nearest"));
        expect(fromReverse).toHaveBeenCalledExactlyOnceWith("nearest");
    });
});

describe("who goes where's pictures", () => {
    it("reads the new line as numbers: 2143, 1234 and 4321", () => {
        renderMenu("keep");
        openMenu();
        expect(sequence("shape-order-nearest-picture")).toBe("2143");
        expect(sequence("shape-order-keep-picture")).toBe("1234");
        expect(sequence("shape-order-reverse-picture")).toBe("4321");
    });

    it("shows the current answer's picture on the button", () => {
        for (const [current, seq] of [
            ["nearest", "2143"],
            ["keep", "1234"],
            ["reverse", "4321"],
        ] as const) {
            renderMenu(current);
            expect(sequence("shape-order-picture"), current).toBe(seq);
            openMenu();
            expect(screen.getByTestId("shape-order-picture").innerHTML).toBe(
                screen.getByTestId(`shape-order-${current}-picture`).innerHTML,
            );
            cleanup();
        }
    });

    it("draws in the text's color, so the highlight and greyed-out states follow", () => {
        renderMenu("nearest");
        const picture = screen.getByTestId("shape-order-picture");
        expect(picture).toHaveAttribute("width", "72");
        expect(picture).toHaveAttribute("height", "26");
        for (const el of picture.querySelectorAll("text, polygon"))
            expect(el.getAttribute("fill")).toBe("currentColor");
        for (const el of picture.querySelectorAll("line"))
            expect(el.getAttribute("stroke")).toBe("currentColor");
    });
});
