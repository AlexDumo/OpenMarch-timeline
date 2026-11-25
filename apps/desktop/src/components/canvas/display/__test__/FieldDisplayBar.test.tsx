import {
    cleanup,
    fireEvent,
    render,
    screen,
    within,
} from "@testing-library/react";
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { TolgeeProvider } from "@tolgee/react";
import tolgee from "@/global/singletons/Tolgee";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { useInputModeStore } from "@/stores/InputModeStore";
import {
    FIELD_SELECT_TOOL_KEY,
    useFieldSelectToolStore,
} from "@/field/fieldSelectTool";
import FieldDisplayBar from "../FieldDisplayBar";

/** The field's display bar: start flag positions, and Show on field's one flat panel. */

const settings = () => useUiSettingsStore.getState().uiSettings;

// The Venue button reads the show's venue: a stadium unless a test says otherwise
const venue = vi.hoisted(() => ({ kit: "hs" }));
vi.mock("@/hooks/queries/useVenueFieldStyle", async () => {
    const { KIT_FIELD_STYLE } = await import("@/view3d/core/kits/fieldStyle");
    return {
        useVenueFieldStyle: () =>
            KIT_FIELD_STYLE[venue.kit as keyof typeof KIT_FIELD_STYLE],
    };
});

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
        equipmentIcons: "changed",
        equipmentIconPlace: "beside",
        facingArrows: false,
        fieldVenue: "off",
        followTheLeader: false,
        view3dCameraOnField: false,
    });
});
afterEach(() => {
    cleanup();
    useInputModeStore.setState({ mode: "pointer" });
    useFieldSelectToolStore.getState().setTool("box");
});

describe("FieldDisplayBar", () => {
    const panel = () => {
        fireEvent.click(screen.getByTestId("field-display-overlays"));
        return screen.getByTestId("field-display-overlays-panel");
    };
    const checked = (id: string) =>
        screen.getByTestId(id).getAttribute("aria-checked");

    it("holds start flag positions and one Show on field button, no per-setting buttons", () => {
        open();
        const bar = screen.getByTestId("field-display-bar");
        expect(within(bar).getAllByRole("button")).toHaveLength(2);
        expect(within(bar).getByTestId("start-flag-positions")).toBeTruthy();
        expect(
            within(bar)
                .getByTestId("field-display-overlays")
                .getAttribute("aria-label"),
        ).toBe("Show on field");
        for (const id of [
            "field-display-labels",
            "field-display-shapes",
            "field-display-facing",
            "field-display-venue",
        ])
            expect(screen.queryByTestId(id)).toBeNull();
    });

    it("picks Box or Lasso above the display bar, and keeps it on this device", () => {
        open();
        const group = screen.getByRole("group", { name: "Select tool" });
        const box = within(group).getByRole("radio", { name: "Box select" });
        const lasso = within(group).getByRole("radio", {
            name: "Lasso select",
        });
        expect(box.getAttribute("aria-checked")).toBe("true");
        fireEvent.click(lasso);
        expect(useFieldSelectToolStore.getState().tool).toBe("lasso");
        expect(lasso.getAttribute("aria-checked")).toBe("true");
        expect(box.getAttribute("aria-checked")).toBe("false");
        expect(localStorage.getItem(FIELD_SELECT_TOOL_KEY)).toBe("lasso");
        // It stays until Box is picked: one of two, not a toggle
        fireEvent.click(lasso);
        expect(useFieldSelectToolStore.getState().tool).toBe("lasso");
        expect(lasso.getAttribute("aria-checked")).toBe("true");
        fireEvent.click(box);
        expect(useFieldSelectToolStore.getState().tool).toBe("box");
    });

    it("leaves the Select tool to the pill in the touch layout", () => {
        useInputModeStore.setState({ mode: "touch" });
        open();
        expect(screen.queryByTestId("field-select-tool")).toBeNull();
        expect(screen.getByTestId("field-display-overlays")).toBeTruthy();
    });

    it("lays the panel out flat: Performers, then Field, no further popups", () => {
        open();
        const p = panel();
        const headings = within(p)
            .getAllByRole("heading")
            .map((h) => h.textContent);
        expect(headings).toEqual(["Show on field", "Performers", "Field"]);
        // Each choice is a segmented switch or a switch in the panel itself
        for (const name of [
            "Drill numbers",
            "What they hold",
            "Icon goes",
            "Shape outlines",
        ])
            expect(within(p).getByRole("group", { name })).toBeTruthy();
        for (const name of ["Facing", "Venue"])
            expect(within(p).getByRole("switch", { name })).toBeTruthy();
        // Order only with Follow-the-leader on
        expect(within(p).queryByRole("group", { name: "Order" })).toBeNull();
    });

    it("sets the drill numbers and keeps the panel open", () => {
        open();
        panel();
        fireEvent.click(screen.getByTestId("field-display-labels-off"));
        expect(settings().marcherLabels).toBe("off");
        expect(checked("field-display-labels-off")).toBe("true");
        // The examples read as words to a screen reader
        expect(
            screen.getByRole("radio", { name: "Drill numbers" }),
        ).toBeTruthy();
        fireEvent.click(screen.getByTestId("field-display-labels-numbers"));
        expect(settings().marcherLabels).toBe("numbers");
    });

    it("sets the shape outlines", () => {
        open();
        panel();
        fireEvent.click(screen.getByTestId("field-display-shapes-always"));
        expect(settings().shapes).toBe("always");
    });

    it("What they hold: who, then where, in the same panel (#992)", () => {
        open();
        panel();
        fireEvent.click(screen.getByTestId("field-display-equipment-everyone"));
        expect(settings().equipmentIcons).toBe("everyone");
        fireEvent.click(
            screen.getByTestId("field-display-equipment-place-dot"),
        );
        expect(settings().equipmentIconPlace).toBe("dot");
        expect(checked("field-display-equipment-place-dot")).toBe("true");
    });

    it("greys Icon goes out while the icons are off and says why (#992)", () => {
        open();
        panel();
        fireEvent.click(screen.getByTestId("field-display-equipment-off"));
        const onNumber = screen.getByTestId(
            "field-display-equipment-place-label",
        ) as HTMLButtonElement;
        expect(onNumber.disabled).toBe(true);
        expect(
            screen.getByText(
                "Equipment icons are off. Choose Changed only or Everyone to show them.",
            ),
        ).toBeTruthy();
        fireEvent.click(onNumber);
        expect(settings().equipmentIconPlace).toBe("beside");
    });

    it("Facing: a switch, off by default (#1316)", () => {
        open();
        panel();
        const facing = screen.getByRole("switch", { name: "Facing" });
        expect(facing.getAttribute("aria-checked")).toBe("false");
        fireEvent.click(facing);
        expect(settings().facingArrows).toBe(true);
        fireEvent.click(facing);
        expect(settings().facingArrows).toBe(false);
    });

    it("shows Order with its key only with Follow-the-leader on", () => {
        useUiSettingsStore.getState().setUiSettings({
            ...settings(),
            followTheLeader: true,
            lineOrder: "off",
        });
        open();
        const p = panel();
        expect(within(p).getByRole("group", { name: "Order" })).toBeTruthy();
        fireEvent.click(screen.getByTestId("field-display-order-always"));
        expect(settings().lineOrder).toBe("always");
    });

    it("turns the venue on in the look last picked, with its look and surroundings under it", () => {
        venue.kit = "hs";
        useUiSettingsStore.getState().setUiSettings({
            ...settings(),
            fieldVenueLast: "soft",
        });
        open();
        panel();
        expect(screen.queryByTestId("field-display-venue-look")).toBeNull();
        fireEvent.click(screen.getByRole("switch", { name: "Venue" }));
        expect(settings().fieldVenue).toBe("soft");
        expect(checked("field-display-venue-look-soft")).toBe("true");
        fireEvent.click(screen.getByTestId("field-display-venue-look-full"));
        expect(settings().fieldVenue).toBe("full");
        expect(settings().fieldVenueLast).toBe("full");
        fireEvent.click(
            screen.getByTestId("field-display-venue-around-stands"),
        );
        expect(settings().fieldVenueAround).toBe("stands");
        fireEvent.click(screen.getByRole("switch", { name: "3D View camera" }));
        expect(settings().view3dCameraOnField).toBe(true);
        fireEvent.click(screen.getByRole("switch", { name: "Venue" }));
        expect(settings().fieldVenue).toBe("off");
        expect(screen.queryByTestId("field-display-venue-look")).toBeNull();
    });

    it("shows the 3D View camera with the venue on or off", () => {
        open();
        panel();
        fireEvent.click(screen.getByRole("switch", { name: "3D View camera" }));
        expect(settings().view3dCameraOnField).toBe(true);
        expect(settings().fieldVenue).toBe("off");
    });

    it("greys Venue out for the Field only venue and says why", () => {
        venue.kit = "blank";
        open();
        panel();
        const sw = screen.getByRole("switch", {
            name: "Venue",
        }) as HTMLButtonElement;
        expect(sw.disabled).toBe(true);
        expect(screen.getByText(/venue is Field only/)).toBeTruthy();
        venue.kit = "hs";
    });

    it("checks None, not the greyed-out Turf edge, where there's no turf", () => {
        venue.kit = "gym";
        useUiSettingsStore.getState().setUiSettings({
            ...settings(),
            fieldVenue: "faint",
            fieldVenueAround: undefined,
        });
        open();
        panel();
        expect(checked("field-display-venue-around-field")).toBe("true");
        expect(checked("field-display-venue-around-edge")).toBe("false");
        expect(
            (
                screen.getByTestId(
                    "field-display-venue-around-edge",
                ) as HTMLButtonElement
            ).disabled,
        ).toBe(true);
        expect(
            screen.getByText("Only stadiums have a turf edge."),
        ).toBeTruthy();
        venue.kit = "hs";
    });

    it("dots the button while anything differs from how it ships, and Reset puts it all back", () => {
        open();
        const button = screen.getByTestId("field-display-overlays");
        expect(screen.queryByTestId("field-display-overlays-dot")).toBeNull();
        panel();
        expect(screen.queryByTestId("field-display-overlays-reset")).toBeNull();
        fireEvent.click(screen.getByTestId("field-display-labels-off"));
        fireEvent.click(screen.getByRole("switch", { name: "Facing" }));
        fireEvent.click(screen.getByTestId("field-display-shapes-always"));
        expect(screen.getByTestId("field-display-overlays-dot")).toBeTruthy();
        expect(button.getAttribute("aria-label")).toBe(
            "Show on field, some changed",
        );
        fireEvent.click(screen.getByTestId("field-display-overlays-reset"));
        expect(settings()).toMatchObject({
            marcherLabels: "auto",
            facingArrows: false,
            shapes: "selected",
            equipmentIcons: "changed",
            fieldVenue: "off",
        });
        expect(screen.queryByTestId("field-display-overlays-dot")).toBeNull();
    });

    it("toggles next paths from the paths popover", () => {
        open();
        fireEvent.click(screen.getByTestId("start-flag-positions"));
        // Its shortcut shows as keycaps beside it
        expect(
            screen.getByTestId("field-display-next-paths").closest("label")
                ?.textContent,
        ).toMatch(/Next paths\s*M/);
        fireEvent.click(screen.getByTestId("field-display-next-paths"));
        expect(settings().nextPaths).toBe(true);
    });
});
