import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TolgeeProvider } from "@tolgee/react";
import tolgee from "@/global/singletons/Tolgee";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import FieldDisplayBar from "../FieldDisplayBar";

/** The field's display bar: path overlays, marcher labels, shape outlines, and placeholders. */

const settings = () => useUiSettingsStore.getState().uiSettings;

const open = () =>
    render(
        <TolgeeProvider tolgee={tolgee}>
            <FieldDisplayBar />
        </TolgeeProvider>,
    );

beforeAll(async () => {
    await tolgee.run();
});

beforeEach(() => {
    const { uiSettings, setUiSettings } = useUiSettingsStore.getState();
    setUiSettings({
        ...uiSettings,
        marcherLabels: "auto",
        shapes: "selected",
        nextPaths: false,
    });
});
afterEach(cleanup);

describe("FieldDisplayBar", () => {
    it("holds start flag positions, labels, shapes and the placeholders", () => {
        open();
        for (const id of [
            "start-flag-positions",
            "field-display-labels",
            "field-display-shapes",
            "field-display-sections",
            "field-display-direction",
        ])
            expect(screen.getByTestId(id)).toBeTruthy();
    });

    it("sets the marcher labels", () => {
        open();
        fireEvent.click(screen.getByTestId("field-display-labels"));
        fireEvent.click(screen.getByTestId("field-display-labels-off"));
        expect(settings().marcherLabels).toBe("off");
        expect(
            screen
                .getByTestId("field-display-labels-off")
                .getAttribute("aria-pressed"),
        ).toBe("true");
    });

    it("sets the shape outlines", () => {
        open();
        fireEvent.click(screen.getByTestId("field-display-shapes"));
        fireEvent.click(screen.getByTestId("field-display-shapes-always"));
        expect(settings().shapes).toBe("always");
    });

    it("toggles next paths from the paths popover", () => {
        open();
        fireEvent.click(screen.getByTestId("start-flag-positions"));
        fireEvent.click(screen.getByTestId("field-display-next-paths"));
        expect(settings().nextPaths).toBe(true);
    });

    it("placeholders do nothing", () => {
        open();
        const before = settings();
        fireEvent.click(screen.getByTestId("field-display-sections"));
        fireEvent.click(screen.getByTestId("field-display-direction"));
        expect(settings()).toEqual(before);
        expect(
            screen
                .getByTestId("field-display-sections")
                .getAttribute("aria-disabled"),
        ).toBe("true");
    });
});
