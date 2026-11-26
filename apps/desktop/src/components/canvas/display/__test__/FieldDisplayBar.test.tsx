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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useView3dWindowStore } from "@/stores/View3dWindowStore";
import { useFieldShowActionHandlers } from "@/field/useFieldShowActionHandlers";
import { useFieldVenueAction } from "@/field/three/venueUnderlay/useFieldVenueAction";
import { useVenueFieldStyle } from "@/hooks/queries/useVenueFieldStyle";
import { toggleFieldShown } from "@/field/fieldShow";
import { useActionHandler } from "@/shortcuts/useActionHandler";
import { registerActionHandler } from "@/shortcuts/registry";
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

// The show's performers, for Equipment icons' sections
vi.mock("@/hooks/queries/useMarchers", () => ({
    allMarchersQueryOptions: () => ({
        queryKey: ["test-marchers"],
        queryFn: async () => [
            { id: 1, section: "Color Guard" },
            { id: 2, section: "Trumpet" },
            { id: 3, section: "Trumpet" },
        ],
    }),
}));

/** The switches' actions, registered where the app registers them */
function Handlers() {
    useFieldShowActionHandlers();
    useFieldVenueAction(useVenueFieldStyle());
    useActionHandler("toggleMarcherOrder", () => toggleFieldShown("lineOrder"));
    return null;
}

const open = () =>
    render(
        <QueryClientProvider client={new QueryClient()}>
            <TolgeeProvider tolgee={tolgee}>
                <Handlers />
                <FieldDisplayBar />
            </TolgeeProvider>
        </QueryClientProvider>,
    );

beforeAll(async () => {
    await tolgee.run();
});

beforeEach(() => {
    const { uiSettings, setUiSettings } = useUiSettingsStore.getState();
    setUiSettings({
        ...uiSettings,
        marcherLabels: "names",
        marcherLabelSize: "auto",
        shapes: "selected",
        lineOrder: "off",
        equipmentIconSections: [],
        fieldShowLast: {},
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
    useView3dWindowStore.setState({ open: false });
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

    it("lays out one row per thing shown, one switch each, no Off segments or Auto", () => {
        open();
        const p = panel();
        expect(
            within(p)
                .getAllByRole("switch")
                .map((s) => s.getAttribute("aria-label")),
        ).toEqual([
            "Drill numbers",
            "Equipment icons",
            "Facing",
            "Figures",
            "Shape outlines",
            "Venue",
        ]);
        // The choices beside the switches that are on: no Off, no Auto
        expect(
            within(p).getByRole("group", { name: "Drill numbers" }),
        ).toBeTruthy();
        expect(
            within(p).getByRole("group", { name: "Shape outlines" }),
        ).toBeTruthy();
        expect(within(p).queryByText("Off")).toBeNull();
        expect(within(p).queryByText("Auto")).toBeNull();
        // Mode rows only in their mode
        expect(
            within(p).queryByText("While Follow-the-leader is on"),
        ).toBeNull();
        expect(within(p).queryByText("While the 3D View is open")).toBeNull();
        // Set-once looks are a link away
        expect(within(p).getByText("Settings › Field")).toBeTruthy();
    });

    it("Drill numbers: the switch hides its choice and brings back the one last shown", () => {
        open();
        panel();
        fireEvent.click(screen.getByTestId("field-display-labels-numbers"));
        expect(settings().marcherLabels).toBe("numbers");
        // The examples read as words to a screen reader
        expect(
            screen.getByRole("radio", { name: "Numbers only" }),
        ).toBeTruthy();
        fireEvent.click(screen.getByRole("switch", { name: "Drill numbers" }));
        expect(settings().marcherLabels).toBe("off");
        expect(screen.queryByTestId("field-display-labels")).toBeNull();
        fireEvent.click(screen.getByRole("switch", { name: "Drill numbers" }));
        expect(settings().marcherLabels).toBe("numbers");
        expect(checked("field-display-labels-numbers")).toBe("true");
    });

    it("Shape outlines: Selected or All while on", () => {
        open();
        panel();
        fireEvent.click(screen.getByTestId("field-display-shapes-always"));
        expect(settings().shapes).toBe("always");
        fireEvent.click(screen.getByRole("switch", { name: "Shape outlines" }));
        expect(settings().shapes).toBe("off");
        fireEvent.click(screen.getByRole("switch", { name: "Shape outlines" }));
        expect(settings().shapes).toBe("always");
    });

    it("Equipment icons: who from a menu, Holding something else, Everyone or some sections (owner, 2026-11-25)", async () => {
        open();
        panel();
        const who = screen.getByTestId("field-display-equipment-who");
        expect(who.textContent).toBe("Holding something else");
        const openMenu = () =>
            fireEvent.keyDown(
                screen.getByTestId("field-display-equipment-who"),
                { key: "Enter" },
            );
        openMenu();
        const menu = await screen.findByTestId("field-display-equipment-menu");
        // The show's sections, once read
        await within(menu).findByText("Color Guard");
        expect(
            within(menu)
                .getAllByRole("menuitemcheckbox")
                .map((item) => item.textContent),
        ).toEqual([
            // Said under the item, not in a tooltip (owner, 2026-11-25)
            "Holding something else" +
                "Only performers not holding their own instrument, like a trumpet holding a flag.",
            "Everyone",
            "Trumpet",
            "Color Guard",
        ]);
        // Ticking a section keeps the menu open for the next
        fireEvent.click(
            screen.getByTestId("field-display-equipment-section-Color Guard"),
        );
        expect(settings().equipmentIconSections).toEqual(["Color Guard"]);
        expect(screen.getByTestId("field-display-equipment-menu")).toBeTruthy();
        expect(who.textContent).toBe("Color Guard");
        fireEvent.click(
            screen.getByTestId("field-display-equipment-section-Trumpet"),
        );
        expect(who.textContent).toBe("Color Guard, Trumpet");
        // Everyone means everyone: the sections go
        fireEvent.click(screen.getByTestId("field-display-equipment-everyone"));
        expect(settings()).toMatchObject({
            equipmentIcons: "everyone",
            equipmentIconSections: [],
        });
        expect(
            screen.getByTestId("field-display-equipment-who").textContent,
        ).toBe("Everyone");
    });

    it("Equipment icons: off and back on keeps who", () => {
        useUiSettingsStore.getState().setUiSettings({
            ...settings(),
            equipmentIcons: "everyone",
        });
        open();
        panel();
        const sw = screen.getByRole("switch", { name: "Equipment icons" });
        fireEvent.click(sw);
        expect(settings().equipmentIcons).toBe("off");
        expect(screen.queryByTestId("field-display-equipment-who")).toBeNull();
        fireEvent.click(sw);
        expect(settings().equipmentIcons).toBe("everyone");
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

    it("shows Line order with its key under a While line, only with Follow-the-leader on", () => {
        useUiSettingsStore.getState().setUiSettings({
            ...settings(),
            followTheLeader: true,
            lineOrder: "off",
        });
        open();
        const p = panel();
        expect(
            within(p).getByText("While Follow-the-leader is on"),
        ).toBeTruthy();
        const sw = within(p).getByRole("switch", { name: "Line order" });
        fireEvent.click(sw);
        expect(settings().lineOrder).toBe("selected");
        fireEvent.click(screen.getByTestId("field-display-order-always"));
        expect(settings().lineOrder).toBe("always");
    });

    it("shows the 3D View camera only while the 3D View is open", () => {
        useView3dWindowStore.setState({ open: true });
        open();
        const p = panel();
        expect(within(p).getByText("While the 3D View is open")).toBeTruthy();
        fireEvent.click(screen.getByRole("switch", { name: "3D View camera" }));
        expect(settings().view3dCameraOnField).toBe(true);
        expect(settings().fieldVenue).toBe("off");
    });

    it("turns the venue on in the look Settings › Field picks", () => {
        venue.kit = "hs";
        useUiSettingsStore.getState().setUiSettings({
            ...settings(),
            fieldVenueLast: "soft",
        });
        open();
        panel();
        fireEvent.click(screen.getByRole("switch", { name: "Venue" }));
        expect(settings().fieldVenue).toBe("soft");
        // No look or surroundings in the panel: they're Settings › Field's
        expect(screen.queryByTestId("field-display-venue-look")).toBeNull();
        fireEvent.click(screen.getByRole("switch", { name: "Venue" }));
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

    it("dots the button while anything differs from how it ships, and Reset puts it all back", () => {
        open();
        const button = screen.getByTestId("field-display-overlays");
        expect(screen.queryByTestId("field-display-overlays-dot")).toBeNull();
        panel();
        expect(screen.queryByTestId("field-display-overlays-reset")).toBeNull();
        fireEvent.click(screen.getByRole("switch", { name: "Drill numbers" }));
        fireEvent.click(screen.getByRole("switch", { name: "Facing" }));
        fireEvent.click(screen.getByTestId("field-display-shapes-always"));
        expect(screen.getByTestId("field-display-overlays-dot")).toBeTruthy();
        expect(button.getAttribute("aria-label")).toBe(
            "Show on field, some changed",
        );
        fireEvent.click(screen.getByTestId("field-display-overlays-reset"));
        expect(settings()).toMatchObject({
            marcherLabels: "names",
            facingArrows: false,
            shapes: "selected",
            equipmentIcons: "changed",
            equipmentIconSections: [],
            fieldVenue: "off",
        });
        expect(screen.queryByTestId("field-display-overlays-dot")).toBeNull();
    });

    it("leaves Settings › Field's looks alone: a label size or icon place isn't a change here", () => {
        useUiSettingsStore.getState().setUiSettings({
            ...settings(),
            marcherLabelSize: "large",
            equipmentIconPlace: "dot",
        });
        open();
        expect(screen.queryByTestId("field-display-overlays-dot")).toBeNull();
    });

    it("opens Settings at Field from the footer", () => {
        const opened = vi.fn();
        const unregister = registerActionHandler("openSettings", {
            run: opened,
            isEnabled: () => true,
        });
        open();
        panel();
        fireEvent.click(screen.getByTestId("field-display-settings-link"));
        expect(opened).toHaveBeenCalled();
        expect(localStorage.getItem("openmarch:settingsSection")).toBe("field");
        unregister();
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
