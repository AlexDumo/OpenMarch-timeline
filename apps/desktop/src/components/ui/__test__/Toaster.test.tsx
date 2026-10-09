import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { toast } from "sonner";
import Toaster from "../Toaster";

/**
 * A toast's action stays on one line beside its text (defined-coordinates 08: "Start from Page 4"
 * wrapped into a column).
 */

afterEach(() => {
    toast.dismiss();
    cleanup();
});

describe("Toaster", () => {
    it("keeps an action's label on one line, with a focus ring", async () => {
        render(<Toaster />);
        act(() => {
            toast.info("Pages 3–4 are no longer stops", {
                action: { label: "Keep Pages 3–4 as stops", onClick: () => {} },
            });
        });
        const button = await screen.findByRole("button", {
            name: "Keep Pages 3–4 as stops",
        });
        expect(button.className).toMatch(/\bwhitespace-nowrap\b/);
        expect(button.className).toMatch(/\bshrink-0\b/);
        expect(button.className).toMatch(/focus-visible:ring/);
    });

    it("puts a second button (cancel) on the same line as the action", async () => {
        render(<Toaster />);
        act(() => {
            toast.info("OT1 and OT8 kept their spot", {
                action: { label: "Move them too", onClick: () => {} },
                cancel: { label: "Only Page 2", onClick: () => {} },
            });
        });
        const action = await screen.findByRole("button", {
            name: "Move them too",
        });
        const cancel = await screen.findByRole("button", {
            name: "Only Page 2",
        });
        expect(cancel.parentElement).toBe(action.parentElement);
        for (const button of [action, cancel]) {
            expect(button.className).toMatch(/\bwhitespace-nowrap\b/);
            expect(button.className).toMatch(/\bshrink-0\b/);
        }
    });
});
