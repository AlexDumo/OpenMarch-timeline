import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TolgeeProvider } from "@tolgee/react";
import tolgee from "@/global/singletons/Tolgee";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { useStartFlagKeyStore } from "@/stores/StartFlagKeyStore";
import { useShortcutOverridesStore } from "@/stores/ShortcutOverridesStore";
import { DEFAULT_START_FLAG_POSITIONS } from "@/timeline/startFlagLevels";
import { StartFlagPositionsButton } from "../StartFlagPositionsButton";
import { TransportTooltipProvider } from "../ShortcutTooltip";

/** Start flag positions' transport control (fork #331, #336). */

const saved = () => useUiSettingsStore.getState().uiSettings.startFlagPositions;

const open = () => {
    render(
        <TolgeeProvider tolgee={tolgee}>
            <TransportTooltipProvider>
                <StartFlagPositionsButton />
            </TransportTooltipProvider>
        </TolgeeProvider>,
    );
    fireEvent.click(screen.getByTestId("start-flag-positions"));
};

const choose = (
    state: "always" | "hold",
    part: "dots" | "paths",
    level: "off" | "selected" | "all",
) =>
    fireEvent.click(screen.getByTestId(`start-flag-${state}-${part}-${level}`));

const chosen = (state: "always" | "hold", part: "dots" | "paths") =>
    (["off", "selected", "all"] as const).filter(
        (level) =>
            screen
                .getByTestId(`start-flag-${state}-${part}-${level}`)
                .getAttribute("data-state") === "on",
    );

beforeAll(async () => {
    await tolgee.run();
});

beforeEach(() => {
    useUiSettingsStore
        .getState()
        .setStartFlagPositions(DEFAULT_START_FLAG_POSITIONS);
    useStartFlagKeyStore.setState({
        held: false,
        latched: false,
        pressedAt: null,
    });
    useShortcutOverridesStore.setState({ overrides: {} });
});
afterEach(cleanup);

describe("the start flag positions popover", () => {
    it("shows both states and raises dots with paths", () => {
        open();
        expect(chosen("always", "dots")).toEqual(["selected"]);
        expect(chosen("always", "paths")).toEqual(["off"]);
        expect(chosen("hold", "dots")).toEqual(["all"]);
        expect(chosen("hold", "paths")).toEqual(["all"]);

        choose("always", "paths", "all");
        expect(saved().always).toEqual({ dots: "all", paths: "all" });
        expect(chosen("always", "dots")).toEqual(["all"]);
        // The other state is left alone
        expect(saved().hold).toEqual({ dots: "all", paths: "all" });
    });

    it("lowers paths with dots", () => {
        open();
        choose("hold", "dots", "selected");
        expect(saved().hold).toEqual({ dots: "selected", paths: "selected" });
        choose("hold", "dots", "off");
        expect(saved().hold).toEqual({ dots: "off", paths: "off" });
        expect(chosen("hold", "paths")).toEqual(["off"]);
        // Raising dots leaves paths where they are
        choose("hold", "dots", "all");
        expect(saved().hold).toEqual({ dots: "all", paths: "off" });
    });

    it("lights the button while something is drawn, and marks the Hold N state", () => {
        open();
        const button = screen.getByTestId("start-flag-positions");
        expect(button).toHaveAttribute("data-drawing", "true");
        expect(button).toHaveAttribute("data-hold", "false");
        choose("always", "dots", "off");
        expect(button).toHaveAttribute("data-drawing", "false");
        act(() => {
            useStartFlagKeyStore.getState().press();
        });
        expect(button).toHaveAttribute("data-drawing", "true");
        expect(button).toHaveAttribute("data-hold", "true");
    });

    it("names the Hold block after its key, and says when no key is set", () => {
        open();
        expect(
            screen.getByRole("region", { name: "Hold N" }),
        ).toBeInTheDocument();
        cleanup();
        useShortcutOverridesStore.setState({
            overrides: { toggleStartFlagPositions: [] },
        });
        open();
        expect(
            screen.getByRole("region", { name: "Hold (no key set)" }),
        ).toBeInTheDocument();
        act(() => {
            useStartFlagKeyStore.getState().toggleLatched();
        });
        expect(
            screen
                .getByTestId("start-flag-positions")
                .getAttribute("aria-label"),
        ).toBe(
            "Start flag positions: Hold (no key set) · Dots: All · Paths: All",
        );
    });
});
