import { afterEach, describe, expect, it } from "vitest";
import { POWER_STORAGE_KEY } from "../drawPolicy";
import { QUALITY_STORAGE_KEY } from "../qualityPreference";
import { RESOLUTION_STORAGE_KEY } from "../renderPrefs";
import { startPrefsSync, useView3dSceneStore } from "../sceneStore";

/** What the browser does in this window when another one saves a key. */
function savedElsewhere(key: string, value: string) {
    localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent("storage", { key }));
}

describe("startPrefsSync", () => {
    let stop = () => {};
    afterEach(() => {
        stop();
        localStorage.clear();
    });

    it("picks up quality, power and resolution saved in Settings", () => {
        stop = startPrefsSync();
        savedElsewhere(QUALITY_STORAGE_KEY, "low");
        savedElsewhere(
            POWER_STORAGE_KEY,
            JSON.stringify({ pauseWhenIdle: false, saveOnBattery: true }),
        );
        savedElsewhere(RESOLUTION_STORAGE_KEY, "fast");

        const s = useView3dSceneStore.getState();
        expect(s.qualityMode).toBe("low");
        expect(s.quality).toBe("low");
        expect(s.powerPrefs.pauseWhenIdle).toBe(false);
        expect(s.resolution).toBe("fast");
    });

    it("keeps an automatic drop to low when the quality is unchanged", () => {
        stop = startPrefsSync();
        savedElsewhere(QUALITY_STORAGE_KEY, "auto");
        useView3dSceneStore.getState()._autoLower();
        savedElsewhere(RESOLUTION_STORAGE_KEY, "balanced");
        savedElsewhere(QUALITY_STORAGE_KEY, "auto");
        expect(useView3dSceneStore.getState().quality).toBe("low");
        expect(useView3dSceneStore.getState().autoLowered).toBe(true);
    });

    it("stops listening", () => {
        useView3dSceneStore.setState({ resolution: "sharp" });
        startPrefsSync()();
        savedElsewhere(RESOLUTION_STORAGE_KEY, "fast");
        expect(useView3dSceneStore.getState().resolution).toBe("sharp");
    });
});
