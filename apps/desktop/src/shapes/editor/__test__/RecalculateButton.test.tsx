import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { RecalculateFace, useRecalculateLook } from "../RecalculateButton";

/** The button's face, as the floating editor draws it, for `available` */
function Face({ available }: { available: boolean }) {
    const look = useRecalculateLook(available);
    return (
        <span data-testid="face" data-flashing={look.flashing || undefined}>
            <RecalculateFace look={look} />
        </span>
    );
}

afterEach(cleanup);

const flashing = () => screen.getByTestId("face").hasAttribute("data-flashing");

/**
 * Recalculate's look (#429): the word only while it can act, and a flash of the accent only when
 * it becomes available, not when it shows up available or redraws (owner)
 */
describe("Recalculate's look", () => {
    it("shows just the icon while it would change nothing", () => {
        render(<Face available={false} />);
        expect(screen.queryByText("Recalculate")).toBeNull();
        expect(flashing()).toBe(false);
    });

    it("shown already available, has its word and doesn't flash", () => {
        render(<Face available />);
        expect(screen.getByText("Recalculate")).toBeInTheDocument();
        expect(flashing()).toBe(false);
    });

    it("flashes once when it becomes available, not on a redraw or when it goes", async () => {
        const { rerender } = render(<Face available={false} />);
        await act(async () => rerender(<Face available />));
        expect(screen.getByText("Recalculate")).toBeInTheDocument();
        expect(flashing()).toBe(true);

        cleanup();
        const again = render(<Face available />);
        await act(async () => again.rerender(<Face available />));
        expect(flashing()).toBe(false);
        await act(async () => again.rerender(<Face available={false} />));
        expect(flashing()).toBe(false);
    });
});
