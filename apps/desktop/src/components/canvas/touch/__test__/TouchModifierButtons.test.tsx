import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import { TolgeeProvider } from "@tolgee/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import tolgee from "@/global/singletons/Tolgee";
import { useInputModeStore } from "@/stores/InputModeStore";
import {
    isShiftHeld,
    onScreenRoles,
    useTouchModifierStore,
} from "@/stores/TouchModifierStore";
import "@/shapes/editor/__test__/pointerEvents";
import TouchModifierButtons, {
    parseModifierPosition,
    TOUCH_MODIFIER_POSITION_KEY,
    type SnapToggle,
} from "../TouchModifierButtons";

/**
 * The touch pill over the field: Fine, Equal and From center (held roles), Add (the old Shift)
 * and a magnet for the Snap toggle, each named by what it does, never by a key. Shown only in the
 * touch layout.
 */

const touchMode = (on: boolean) => {
    act(() => {
        useInputModeStore.getState().setPreference(on ? "touch" : "mouse");
    });
};

function renderPill(snap?: SnapToggle) {
    return render(
        <TolgeeProvider tolgee={tolgee} fallback="Loading...">
            <TouchModifierButtons snap={snap} />
        </TolgeeProvider>,
    );
}

const button = (toggle: string) => screen.getByTestId(`touch-toggle-${toggle}`);

/** A quick press and release: a tap */
const tap = (el: HTMLElement) => {
    fireEvent.pointerDown(el, { pointerId: 5, pointerType: "touch" });
    fireEvent.pointerUp(el, { pointerId: 5, pointerType: "touch" });
};

beforeAll(async () => {
    await tolgee.run();
});

afterEach(() => {
    cleanup();
    useTouchModifierStore.getState().clear();
    useInputModeStore.getState().setPreference("auto");
    localStorage.removeItem(TOUCH_MODIFIER_POSITION_KEY);
});

describe("the pill", () => {
    it("shows only in the touch layout", () => {
        touchMode(false);
        renderPill();
        expect(screen.queryByTestId("touch-modifier-buttons")).toBeNull();
        touchMode(true);
        expect(screen.getByTestId("touch-modifier-buttons")).toBeTruthy();
    });

    it("names its buttons by role, never by key", () => {
        touchMode(true);
        renderPill({ on: true, toggle: () => {} });
        const pill = screen.getByTestId("touch-modifier-buttons");
        for (const name of ["Fine", "Equal", "From center", "Add"])
            expect(pill.textContent).toContain(name);
        const labels = [...pill.querySelectorAll("[aria-label]")]
            .map((el) => el.getAttribute("aria-label"))
            .join(" ");
        expect(`${pill.textContent} ${labels}`).not.toMatch(
            /Shift|Alt|Ctrl|Cmd|⇧|⌥|⌘/,
        );
    });

    it("lets go of everything held or latched when the touch layout is left", () => {
        touchMode(true);
        renderPill();
        tap(button("fine"));
        expect(onScreenRoles().has("fine")).toBe(true);
        touchMode(false);
        expect(onScreenRoles().size).toBe(0);
    });
});

describe.each([
    ["fine", "Fine"],
    ["constrain", "Equal"],
    ["fromCenter", "From center"],
] as const)("%s (%s)", (role) => {
    it("a tap latches it on, and another turns it off", () => {
        touchMode(true);
        renderPill();
        expect(button(role).getAttribute("aria-pressed")).toBe("false");
        tap(button(role));
        expect(onScreenRoles()).toEqual(new Set([role]));
        expect(button(role).getAttribute("aria-pressed")).toBe("true");
        tap(button(role));
        expect(onScreenRoles().size).toBe(0);
        expect(button(role).getAttribute("aria-pressed")).toBe("false");
    });

    it("held while another finger works, it's on only while held", () => {
        touchMode(true);
        renderPill();
        fireEvent.pointerDown(button(role), {
            pointerId: 5,
            pointerType: "touch",
        });
        expect(onScreenRoles()).toEqual(new Set([role]));
        expect(button(role).getAttribute("aria-pressed")).toBe("true");
        // The Pencil goes down on the field meanwhile: the hold is being used
        fireEvent.pointerDown(window, { pointerId: 9, pointerType: "pen" });
        fireEvent.pointerUp(button(role), {
            pointerId: 5,
            pointerType: "touch",
        });
        expect(onScreenRoles().size).toBe(0);
        expect(button(role).getAttribute("aria-pressed")).toBe("false");
    });

    it("Enter on the keyboard latches it", () => {
        touchMode(true);
        renderPill();
        fireEvent.keyDown(button(role), { key: "Enter" });
        expect(onScreenRoles()).toEqual(new Set([role]));
    });
});

describe("Add", () => {
    it("a tap latches it, which the Select tab reads as Shift", () => {
        touchMode(true);
        renderPill();
        tap(button("add"));
        expect(isShiftHeld()).toBe(true);
        expect(onScreenRoles().size).toBe(0);
        expect(button("add").getAttribute("aria-pressed")).toBe("true");
    });
});

describe("the magnet", () => {
    it("is pressed while snapping is off, and a tap flips the Snap toggle", () => {
        touchMode(true);
        const toggle = vi.fn();
        const { rerender } = renderPill({ on: true, toggle });
        const magnet = screen.getByTestId("touch-snap");
        expect(magnet.getAttribute("aria-pressed")).toBe("false");
        fireEvent.click(magnet);
        expect(toggle).toHaveBeenCalledTimes(1);
        rerender(
            <TolgeeProvider tolgee={tolgee} fallback="Loading...">
                <TouchModifierButtons snap={{ on: false, toggle }} />
            </TolgeeProvider>,
        );
        expect(
            screen.getByTestId("touch-snap").getAttribute("aria-pressed"),
        ).toBe("true");
    });

    it("isn't shown without a Snap toggle", () => {
        touchMode(true);
        renderPill();
        expect(screen.queryByTestId("touch-snap")).toBeNull();
    });
});

describe("where it sits", () => {
    it("goes back where it was dragged to, from local storage", () => {
        localStorage.setItem(
            TOUCH_MODIFIER_POSITION_KEY,
            JSON.stringify({ left: 40, bottom: 60 }),
        );
        touchMode(true);
        renderPill();
        const pill = screen.getByTestId("touch-modifier-buttons");
        expect(pill.style.left).toBe("40px");
        expect(pill.style.bottom).toBe("60px");
    });

    it("reads a stored spot, and nothing for anything else", () => {
        expect(parseModifierPosition('{"left":12,"bottom":30}')).toEqual({
            left: 12,
            bottom: 30,
        });
        expect(parseModifierPosition(null)).toBeNull();
        expect(parseModifierPosition("")).toBeNull();
        expect(parseModifierPosition("not json")).toBeNull();
        expect(parseModifierPosition('{"left":12}')).toBeNull();
        expect(parseModifierPosition('{"left":"12","bottom":30}')).toBeNull();
        expect(parseModifierPosition('{"left":null,"bottom":30}')).toBeNull();
    });
});
