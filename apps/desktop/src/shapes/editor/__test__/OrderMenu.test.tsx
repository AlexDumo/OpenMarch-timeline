import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { OrderChoice } from "../../assign";
import { OrderMenu } from "../OrderMenu";

/**
 * Who goes where on the floating editor (#528, #559): a menu of the ways to assign marchers and a
 * Reverse toggle beside it, greyed out on Least travel
 */

afterEach(cleanup);

const renderMenu = (current: OrderChoice, keepOffered = true) => {
    const pick = vi.fn();
    render(<OrderMenu target={{ order: { current, keepOffered, pick } }} />);
    return pick;
};
const openMenu = () => fireEvent.click(screen.getByTestId("shape-order"));
const sequence = (testId: string) =>
    screen.getByTestId(testId).getAttribute("data-sequence");

describe("who goes where's menu", () => {
    it("lists only the ways to assign marchers, not Reverse", () => {
        renderMenu("keep");
        openMenu();
        const items = screen.getAllByRole("menuitemradio");
        expect(items.map((item) => item.getAttribute("data-testid"))).toEqual([
            "shape-order-nearest",
            "shape-order-keep",
        ]);
    });

    it("has only Least travel when Keep order isn't offered", () => {
        renderMenu("nearest", false);
        openMenu();
        expect(screen.getAllByRole("menuitemradio")).toHaveLength(1);
    });

    it("names Keep order on a reversed line, with the toggle on", () => {
        renderMenu("reverse");
        const button = screen.getByTestId("shape-order");
        expect(button).toHaveAttribute("data-value", "keep");
        expect(button).toHaveAccessibleName("Who goes where: Keep order");
        expect(screen.getByTestId("shape-order-reverse")).toHaveAttribute(
            "aria-pressed",
            "true",
        );
    });

    it("changes nothing when the way it's on is picked, reversed or not", () => {
        const pick = renderMenu("reverse");
        openMenu();
        fireEvent.click(screen.getByTestId("shape-order-keep"));
        expect(pick).not.toHaveBeenCalled();
    });

    it("picks a way as one change", () => {
        const pick = renderMenu("reverse");
        openMenu();
        fireEvent.click(screen.getByTestId("shape-order-nearest"));
        expect(pick).toHaveBeenCalledExactlyOnceWith("nearest");
        cleanup();
        const fromNearest = renderMenu("nearest");
        openMenu();
        fireEvent.click(screen.getByTestId("shape-order-keep"));
        expect(fromNearest).toHaveBeenCalledExactlyOnceWith("keep");
    });
});

describe("Reverse", () => {
    it("turns Keep order round, and back, as one change each", () => {
        const pick = renderMenu("keep");
        const toggle = screen.getByTestId("shape-order-reverse");
        expect(toggle).toHaveAttribute("aria-pressed", "false");
        fireEvent.click(toggle);
        expect(pick).toHaveBeenCalledExactlyOnceWith("reverse");
        cleanup();
        const back = renderMenu("reverse");
        fireEvent.click(screen.getByTestId("shape-order-reverse"));
        expect(back).toHaveBeenCalledExactlyOnceWith("keep");
    });

    it("is greyed out on Least travel, saying why, and does nothing", async () => {
        const pick = renderMenu("nearest");
        const toggle = screen.getByTestId("shape-order-reverse");
        expect(toggle).toHaveAttribute("aria-disabled", "true");
        expect(toggle).toHaveAttribute("aria-pressed", "false");
        fireEvent.click(toggle);
        expect(pick).not.toHaveBeenCalled();
        fireEvent.focus(toggle);
        expect(
            (await screen.findAllByText("Least travel has no order to reverse"))
                .length,
        ).toBeGreaterThan(0);
    });
});

describe("who goes where's pictures", () => {
    it("reads the new line as numbers, Keep order's turning round with Reverse", () => {
        renderMenu("keep");
        openMenu();
        expect(sequence("shape-order-nearest-picture")).toBe("2143");
        expect(sequence("shape-order-keep-picture")).toBe("1234");
        expect(sequence("shape-order-picture")).toBe("1234");
        cleanup();
        renderMenu("reverse");
        openMenu();
        expect(sequence("shape-order-nearest-picture")).toBe("2143");
        expect(sequence("shape-order-keep-picture")).toBe("4321");
        expect(sequence("shape-order-picture")).toBe("4321");
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
