import { beforeEach, describe, expect, it } from "vitest";
import { defaultSettings, useUiSettingsStore } from "@/stores/UiSettingsStore";
import {
    changedFieldShow,
    equipmentSectionChoices,
    equipmentWho,
    equipmentWhoInShow,
    resetFieldShow,
    setEquipmentIcons,
    setFieldChoice,
    setFieldShown,
    toggleEquipmentSection,
    toggleFieldShown,
} from "../fieldShow";

/** Show on field's rules (fork #1332), as the panel, the View menu and the palette run them */

const settings = () => useUiSettingsStore.getState().uiSettings;
const nowhere = { followTheLeader: false, view3dOpen: false };

beforeEach(() => {
    useUiSettingsStore.getState().setUiSettings({ ...defaultSettings });
});

describe("Show on field", () => {
    it("turns a switch back on to the choice it showed when switched off", () => {
        setFieldChoice("shapes", "always");
        toggleFieldShown("shapes");
        expect(settings().shapes).toBe("off");
        expect(settings().fieldShowLast?.shapes).toBe("always");
        toggleFieldShown("shapes");
        expect(settings().shapes).toBe("always");
    });

    it("Figures: on to figures alone the first time, back to With dots after; Reset puts dots back", () => {
        toggleFieldShown("performerFigures");
        expect(settings().performerFigures).toBe("figures");
        expect(changedFieldShow(settings(), nowhere)).toContain(
            "performerFigures",
        );
        setFieldChoice("performerFigures", "withDots");
        toggleFieldShown("performerFigures");
        expect(settings().performerFigures).toBe("off");
        toggleFieldShown("performerFigures");
        expect(settings().performerFigures).toBe("withDots");
        resetFieldShow();
        expect(settings().performerFigures).toBe("off");
        expect(changedFieldShow(settings(), nowhere)).not.toContain(
            "performerFigures",
        );
    });

    it("turns Line order on to Selected the first time", () => {
        setFieldShown("lineOrder", true);
        expect(settings().lineOrder).toBe("selected");
        setFieldShown("lineOrder", true);
        expect(settings().lineOrder).toBe("selected");
    });

    it("Equipment icons: some sections, then Everyone drops them; Off and on brings sections back", () => {
        toggleEquipmentSection("Color Guard");
        toggleEquipmentSection("Battery");
        expect(equipmentWho(settings())).toEqual({
            kind: "sections",
            sections: ["Color Guard", "Battery"],
        });
        setFieldShown("equipmentIcons", false);
        expect(settings().equipmentIcons).toBe("off");
        // Picking a section turns them back on
        toggleEquipmentSection("Battery");
        expect(settings().equipmentIcons).toBe("changed");
        expect(equipmentWho(settings())).toEqual({
            kind: "sections",
            sections: ["Color Guard"],
        });
        setEquipmentIcons("everyone");
        expect(equipmentWho(settings())).toEqual({ kind: "everyone" });
        expect(settings().equipmentIconSections).toEqual([]);
    });

    it("Equipment icons: a section picked in another show can still be cleared, and the button names only this show's", () => {
        toggleEquipmentSection("Color Guard");
        toggleEquipmentSection("Battery");
        const who = equipmentWho(settings());
        const show = ["Trumpet", "Battery"];
        // The button names the picked sections this show has
        expect(equipmentWhoInShow(who, show)).toEqual({
            kind: "sections",
            sections: ["Battery"],
        });
        // With none of them in the show, it still names the pick rather than nothing
        expect(equipmentWhoInShow(who, ["Trumpet"])).toEqual(who);
        expect(equipmentWhoInShow({ kind: "everyone" }, show)).toEqual({
            kind: "everyone",
        });
        // The menu lists the show's sections, then the picked one the show doesn't have
        const picked = who.kind === "sections" ? who.sections : [];
        expect(equipmentSectionChoices(show, picked)).toEqual([
            { section: "Trumpet", inShow: true },
            { section: "Battery", inShow: true },
            { section: "Color Guard", inShow: false },
        ]);
        // Clearing its tick there takes it out
        toggleEquipmentSection("Color Guard");
        expect(equipmentWho(settings())).toEqual({
            kind: "sections",
            sections: ["Battery"],
        });
    });

    it("counts a mode's row only in its mode, and resets every row", () => {
        useUiSettingsStore.getState().setUiSettings({
            ...settings(),
            lineOrder: "always",
            view3dCameraOnField: true,
        });
        expect(changedFieldShow(settings(), nowhere)).toEqual([]);
        expect(
            changedFieldShow(settings(), {
                followTheLeader: true,
                view3dOpen: true,
            }),
        ).toEqual(["lineOrder", "view3dCameraOnField"]);
        toggleEquipmentSection("Color Guard");
        toggleFieldShown("marcherLabels");
        expect(changedFieldShow(settings(), nowhere)).toEqual([
            "marcherLabels",
            "equipmentIconSections",
        ]);
        resetFieldShow();
        expect(
            changedFieldShow(settings(), {
                followTheLeader: true,
                view3dOpen: true,
            }),
        ).toEqual([]);
        expect(settings().fieldShowLast).toEqual({});
    });
});
