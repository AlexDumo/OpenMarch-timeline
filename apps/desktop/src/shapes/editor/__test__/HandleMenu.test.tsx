import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import { TolgeeProvider } from "@tolgee/react";
import tolgee from "@/global/singletons/Tolgee";
import HandleMenu from "../HandleMenu";
import { lineTool } from "../../line/lineTool";
import type { LineParams } from "../../line/lineGeometry";
import { closeHandleMenu, useHandleMenuStore } from "../../field/handleMenu";
import { filesDistribution } from "../../distribute/distribution";

/**
 * A Line point's right-click menu as rendered (#569): its marcher answers read as one labelled set
 * of answers even greyed out, and one Escape closes the menu with a reason tip open
 */

beforeAll(async () => {
    await tolgee.run();
});

afterEach(() => {
    act(closeHandleMenu);
    cleanup();
});

const corner = (x: number, y: number) => ({ x, y, tension: 0 });
/** A closed square filled as files: its points' marcher answers greyed out */
const filled: LineParams = {
    points: [corner(0, 0), corner(40, 0), corner(40, 40), corner(0, 40)],
    closed: true,
    spacing: { mode: "fit" },
    distribution: filesDistribution(2),
};

function show(params: LineParams, pick = vi.fn()) {
    const sections = lineTool.menu!.sections(params, 8, "p1")!;
    act(() =>
        useHandleMenuStore.setState({
            menu: { at: { x: 0, y: 0 }, key: "p1", sections, pick },
        }),
    );
    render(
        <TolgeeProvider tolgee={tolgee} fallback="Loading...">
            <HandleMenu />
        </TolgeeProvider>,
    );
}

describe("a Line point's menu (#569)", () => {
    it("keeps a greyed-out marcher answer an answer, ticked or not", () => {
        show(filled);
        const line = screen.getByTestId("shape-menu-marcher-line");
        expect(line.getAttribute("aria-disabled")).toBe("true");
        expect(line.getAttribute("role")).toBe("menuitemradio");
        expect(line.getAttribute("aria-checked")).toBe("true");
        const always = screen.getByTestId("shape-menu-marcher-always");
        expect(always.getAttribute("role")).toBe("menuitemradio");
        expect(always.getAttribute("aria-checked")).toBe("false");
    });

    it("reads the marcher answers as one set by its name", () => {
        show({ ...filled, distribution: undefined });
        const set = screen.getByRole("group", {
            name: "Marcher on this point",
        });
        expect(
            [...set.querySelectorAll('[role="menuitemradio"]')].map((el) =>
                el.getAttribute("data-testid"),
            ),
        ).toEqual([
            "shape-menu-marcher-line",
            "shape-menu-marcher-always",
            "shape-menu-marcher-even",
        ]);
    });

    it("closes with one Escape while a reason tip is open", () => {
        show(filled);
        fireEvent.click(screen.getByTestId("shape-menu-marcher-always"));
        expect(screen.getByRole("tooltip")).toBeTruthy();
        fireEvent.keyDown(document.activeElement ?? document.body, {
            key: "Escape",
        });
        expect(useHandleMenuStore.getState().menu).toBeNull();
        expect(screen.queryByTestId("shape-menu")).toBeNull();
    });
});
