import { afterEach, describe, expect, it, vi } from "vitest";
import { EqualsIcon } from "@phosphor-icons/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
    ActionFace,
    RecalculateFace,
    useActionLook,
} from "../RecalculateButton";

/** The button's face, as the floating editor draws it, for `available` */
function Face({ available }: { available: boolean }) {
    const look = useActionLook(available);
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

/** Even out's face, as the floating editor draws it (owner on #459) */
function EvenFace({ available }: { available: boolean }) {
    const look = useActionLook(available);
    return (
        <span data-testid="face" data-flashing={look.flashing || undefined}>
            <ActionFace
                look={look}
                icon={<EqualsIcon size={14} data-testid="even-icon" />}
                label="Even out"
            />
        </span>
    );
}

/** A couple of frames: long enough for an immediate change, not for the spring */
const frames = () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
    });

/** The word's width as drawn now */
const wordWidth = () =>
    (screen.getByText("Even out") as HTMLElement).style.maxWidth;

describe("Even out's look, as Recalculate's (owner on #459)", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("always has its icon, and its word only while it can act", async () => {
        const { rerender } = render(<EvenFace available={false} />);
        expect(screen.getByTestId("even-icon")).toBeInTheDocument();
        expect(screen.queryByText("Even out")).toBeNull();
        await act(async () => rerender(<EvenFace available />));
        expect(screen.getByTestId("even-icon")).toBeInTheDocument();
        expect(screen.getByText("Even out")).toBeInTheDocument();
        expect(flashing()).toBe(true);
    });

    it("springs its word open when it becomes available", async () => {
        const { rerender } = render(<EvenFace available={false} />);
        await act(async () => rerender(<EvenFace available />));
        // Two frames in: still opening
        await frames();
        expect(wordWidth()).not.toBe("7em");
    });

    it("with reduced motion, shows the word at once with no spring; only the color fades", async () => {
        vi.stubGlobal(
            "matchMedia",
            (query: string) =>
                ({
                    matches: query.includes("prefers-reduced-motion"),
                    media: query,
                    addEventListener: () => {},
                    removeEventListener: () => {},
                }) as unknown as MediaQueryList,
        );
        const { rerender } = render(<EvenFace available={false} />);
        await act(async () => rerender(<EvenFace available />));
        await frames();
        expect(wordWidth()).toBe("7em");
        expect(flashing()).toBe(true);
    });
});
