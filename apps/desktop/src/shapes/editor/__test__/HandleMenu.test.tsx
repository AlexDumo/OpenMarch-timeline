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
import { setPointMarcher, type LineParams } from "../../line/lineGeometry";
import {
    closeHandleMenu,
    openHandleMenu,
    useHandleMenuStore,
} from "../../field/handleMenu";
import { filesDistribution } from "../../distribute/distribution";

/**
 * A Line point's right-click menu as rendered (#569, look #568): the corner type an either/or
 * that stays open as it changes, the marcher answers one labelled set showing the line's setting
 * softly or an override plainly, even greyed out, and one Escape closing the menu with a reason
 * tip open
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

const L: LineParams = {
    points: [corner(0, 0), corner(40, 0), corner(40, 40)],
    spacing: { mode: "fit" },
};

function renderMenu() {
    render(
        <TolgeeProvider tolgee={tolgee} fallback="Loading...">
            <HandleMenu />
        </TolgeeProvider>,
    );
}

function show(params: LineParams, pick = vi.fn()) {
    const sections = lineTool.menu!.sections(params, 8, "p1")!;
    act(() =>
        useHandleMenuStore.setState({
            menu: { at: { x: 0, y: 0 }, key: "p1", sections, pick },
        }),
    );
    renderMenu();
}

const byTestId = (id: string) => screen.getByTestId(id);

describe("a Line point's menu (#569)", () => {
    it("keeps a greyed-out marcher answer an answer, ticked or not", () => {
        show(filled);
        for (const id of ["marcher-always", "marcher-even"]) {
            const el = byTestId(`shape-menu-${id}`);
            expect(el.getAttribute("aria-disabled")).toBe("true");
            expect(el.getAttribute("role")).toBe("menuitemradio");
            // The line's setting counts for nothing on a filled line: nothing ticked
            expect(el.getAttribute("aria-checked")).toBe("false");
        }
        cleanup();
        show(setPointMarcher(filled, 8, 1, true, {}));
        const always = byTestId("shape-menu-marcher-always");
        expect(always.getAttribute("aria-disabled")).toBe("true");
        expect(always.getAttribute("aria-checked")).toBe("true");
        expect(byTestId("shape-menu-marcher-always-override")).toBeTruthy();
        expect(
            byTestId("shape-menu-marcher-line").getAttribute("aria-disabled"),
        ).toBe("true");
    });

    it("reads the marcher answers as one set by its name", () => {
        show(L);
        const set = screen.getByRole("group", {
            name: "Marcher on this point",
        });
        expect(
            [...set.querySelectorAll('[role="menuitemradio"]')].map((el) =>
                el.getAttribute("data-testid"),
            ),
        ).toEqual(["shape-menu-marcher-always", "shape-menu-marcher-even"]);
    });

    it("shows the line's setting softly while the point has no answer of its own", () => {
        show(L);
        const always = byTestId("shape-menu-marcher-always");
        expect(always.getAttribute("aria-checked")).toBe("true");
        expect(always.textContent).toContain("line setting");
        expect(always.querySelector('[data-tick="setting"]')).toBeTruthy();
        expect(screen.queryByTestId("shape-menu-marcher-always-override")).toBe(
            null,
        );
        expect(screen.queryByTestId("shape-menu-marcher-line")).toBeNull();
    });

    it("shows an override as one, with Remove override that hands the point back", () => {
        const pick = vi.fn();
        show(setPointMarcher(L, 8, 1, false, {}), pick);
        const even = byTestId("shape-menu-marcher-even");
        expect(even.getAttribute("aria-checked")).toBe("true");
        expect(even.querySelector('[data-tick="override"]')).toBeTruthy();
        expect(byTestId("shape-menu-marcher-even-override").textContent).toBe(
            "Override",
        );
        expect(screen.queryByTestId("shape-menu-marcher-even-note")).toBeNull();
        const remove = byTestId("shape-menu-marcher-line");
        expect(remove.textContent).toBe("Remove override");
        expect(remove.getAttribute("role")).toBe("menuitem");
        expect(remove.querySelector("svg")).toBeTruthy();
        fireEvent.click(remove);
        expect(pick).toHaveBeenCalledWith("marcher-line");
    });

    it("shows the corner type as a labelled either/or with its double-click hint", () => {
        show(L);
        const set = screen.getByRole("group", { name: "Corner type" });
        const answers = [...set.querySelectorAll('[role="menuitemradio"]')];
        expect(answers.map((el) => el.textContent)).toEqual([
            "Corner",
            "Smooth",
        ]);
        expect(answers.map((el) => el.getAttribute("aria-checked"))).toEqual([
            "true",
            "false",
        ]);
        const hint = byTestId("shape-menu-hint");
        expect(hint.textContent).toBe("Double-click a point to swap");
        expect(set.getAttribute("aria-describedby")).toBe(hint.id);
    });

    it("swaps the corner type without closing, showing Roundness on a smooth point", () => {
        let params = L;
        const pick = vi.fn((_key: string, value: string) => {
            params = lineTool.menu!.pick(params, 8, "p1", value, {
                stepPx: 10,
                snap: false,
                pull: false,
                constrain: false,
                gridSnap: (p) => p,
                hitRadius: 3,
            })!.params;
            return { params, n: 8 };
        });
        act(() => {
            openHandleMenu(
                lineTool,
                params,
                8,
                { type: "handle", key: "p1" } as never,
                { x: 0, y: 0 },
                pick,
            );
        });
        renderMenu();
        expect(screen.queryByTestId("shape-menu-roundness")).toBeNull();
        act(() => {
            fireEvent.click(byTestId("shape-menu-smooth"));
        });
        expect(pick).toHaveBeenCalledWith("p1", "smooth");
        expect(byTestId("shape-menu")).toBeTruthy();
        expect(byTestId("shape-menu-smooth").getAttribute("aria-checked")).toBe(
            "true",
        );
        expect(byTestId("shape-menu-roundness")).toBeTruthy();
        // The answer it has already does nothing
        act(() => {
            fireEvent.click(byTestId("shape-menu-smooth"));
        });
        expect(pick).toHaveBeenCalledTimes(1);
    });

    it("puts a trash can on Delete point", () => {
        show(L);
        const del = byTestId("shape-menu-delete");
        expect(del.textContent).toBe("Delete point");
        expect(del.querySelector("svg")).toBeTruthy();
    });

    it("closes with one Escape while a reason tip is open", () => {
        show(filled);
        fireEvent.click(byTestId("shape-menu-marcher-always"));
        expect(screen.getByRole("tooltip")).toBeTruthy();
        fireEvent.keyDown(document.activeElement ?? document.body, {
            key: "Escape",
        });
        expect(useHandleMenuStore.getState().menu).toBeNull();
        expect(screen.queryByTestId("shape-menu")).toBeNull();
    });
});
