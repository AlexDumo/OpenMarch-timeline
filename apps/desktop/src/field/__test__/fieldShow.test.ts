import { beforeEach, describe, expect, it } from "vitest";
import { defaultSettings, useUiSettingsStore } from "@/stores/UiSettingsStore";
import {
    changedFieldShow,
    equipmentWho,
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
