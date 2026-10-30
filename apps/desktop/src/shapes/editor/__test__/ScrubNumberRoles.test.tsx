import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import * as platform from "@/shortcuts/platform";
import type { ShapeField } from "../../field/shapeField";
import { toolEnvFor } from "../../tool/toolEnv";
import { SPACING_FINE_RATE, spacingRate } from "../scrub";
import { ScrubNumber, type ScrubMove } from "../ScrubNumber";

/**
 * A number in the floating editor reads held roles (version A): Shift is fine, hundredths of a step
 * on a spacing (#411, Alt before); $mod is constrain. A role key pressed or released mid-drag
 * scrubs again where the pointer is.
 */

// jsdom has no PointerEvent, so fireEvent's pointer events would lose clientX and the keys
if (typeof window.PointerEvent === "undefined") {
    class TestPointerEvent extends MouseEvent {
        readonly pointerId: number;
        readonly pointerType: string;
        constructor(type: string, init: PointerEventInit = {}) {
            super(type, init);
            this.pointerId = init.pointerId ?? 1;
            this.pointerType = init.pointerType ?? "mouse";
        }
    }
    window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
}

beforeEach(() => {
    vi.spyOn(platform, "isMacPlatform").mockReturnValue(false);
    // jsdom has no pointer capture
    HTMLElement.prototype.setPointerCapture = () => {};
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const field = {
    fieldProperties:
        FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES,
    zoom: () => 1,
    marchers: () => [],
    drawn: () => new Map(),
} as unknown as ShapeField;

function shown() {
    const onScrub = vi.fn<(move: ScrubMove) => void>();
    render(
        <ScrubNumber
            display="2"
            axis="x"
            label="Side-to-side spacing"
            testId="n"
            onScrubStart={() => {}}
            onScrub={onScrub}
            onScrubEnd={() => {}}
            onType={() => true}
        />,
    );
    return { button: screen.getByTestId("n"), onScrub };
}

const lastMove = (onScrub: ReturnType<typeof shown>["onScrub"]) =>
    onScrub.mock.calls.at(-1)![0];

describe("dragging a number", () => {
    it("is fine with Shift, so a spacing goes in hundredths of a step", () => {
        const { button, onScrub } = shown();
        fireEvent.pointerDown(button, { button: 0, clientX: 0, clientY: 0 });
        fireEvent.pointerMove(button, {
            clientX: 10,
            clientY: 0,
            shiftKey: true,
        });
        const move = lastMove(onScrub);
        expect(move.roles).toEqual({
            fine: true,
            constrain: false,
            fromCenter: false,
        });
        const env = toolEnvFor(field, move.roles);
        expect(spacingRate(env.snap, move.axis)).toMatchObject(
            SPACING_FINE_RATE,
        );
    });

    it("isn't fine with Alt, and $mod is constrain", () => {
        const { button, onScrub } = shown();
        fireEvent.pointerDown(button, { button: 0, clientX: 0, clientY: 0 });
        fireEvent.pointerMove(button, {
            clientX: 10,
            clientY: 0,
            altKey: true,
        });
        expect(lastMove(onScrub).roles.fine).toBe(false);
        fireEvent.pointerMove(button, {
            clientX: 12,
            clientY: 0,
            ctrlKey: true,
        });
        expect(lastMove(onScrub).roles).toMatchObject({
            fine: false,
            constrain: true,
        });
    });

    it("scrubs again where it is when Shift goes down or up mid-drag", () => {
        const { button, onScrub } = shown();
        fireEvent.pointerDown(button, { button: 0, clientX: 0, clientY: 0 });
        fireEvent.pointerMove(button, { clientX: 10, clientY: 0 });
        const moves = onScrub.mock.calls.length;
        fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
        expect(onScrub.mock.calls.length).toBe(moves + 1);
        expect(lastMove(onScrub)).toMatchObject({ dx: 10, dy: 0 });
        expect(lastMove(onScrub).roles.fine).toBe(true);
        fireEvent.keyUp(window, { key: "Shift" });
        expect(lastMove(onScrub).roles.fine).toBe(false);
        // Released: the keys aren't followed any more
        fireEvent.pointerUp(button);
        const ended = onScrub.mock.calls.length;
        fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
        expect(onScrub.mock.calls.length).toBe(ended);
    });
});
