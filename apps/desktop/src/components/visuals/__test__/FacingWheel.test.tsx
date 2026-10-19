import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TolgeeProvider } from "@tolgee/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import tolgee from "@/global/singletons/Tolgee";
import FacingWheel, { wheelAngle } from "../FacingWheel";

describe("wheelAngle", () => {
    it("reads the wheel as the field: audience down, side 2 right", () => {
        expect(wheelAngle(0, 10)).toBe(0);
        expect(wheelAngle(10, 0)).toBe(90);
        expect(wheelAngle(0, -10)).toBe(180);
        expect(wheelAngle(-10, 0)).toBe(270);
    });

    it("steps when asked", () => {
        expect(wheelAngle(10, 9, 45)).toBe(45);
        expect(wheelAngle(-1, 10, 45)).toBe(0);
    });
});

describe("the facing wheel's keys", () => {
    beforeAll(async () => {
        await tolgee.run();
    });
    afterEach(cleanup);

    it("turns with the arrows, and the app's shortcuts don't also get them", () => {
        const onCommit = vi.fn();
        // the app's shortcuts listen on the window (`ShortcutDispatcher`)
        const app = vi.fn();
        window.addEventListener("keydown", app);
        render(
            <TolgeeProvider tolgee={tolgee} fallback="Loading...">
                <FacingWheel degrees={0} onCommit={onCommit} />
            </TolgeeProvider>,
        );
        const wheel = screen.getByTestId("visuals-facing-wheel");
        fireEvent.keyDown(wheel, { key: "ArrowLeft" });
        fireEvent.keyDown(wheel, { key: "ArrowRight", shiftKey: true });
        window.removeEventListener("keydown", app);
        expect(onCommit.mock.calls).toEqual([[355], [45]]);
        expect(app).not.toHaveBeenCalled();
    });
});
