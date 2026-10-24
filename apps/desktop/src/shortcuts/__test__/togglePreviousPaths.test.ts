import { describe, expect, it } from "vitest";
import { defaultSettings } from "@/stores/UiSettingsStore";
import { togglePreviousPaths } from "../handlers/useUiActionHandlers";

// N (#403): the page's previous paths, or an open shape's pathways (its walks and start rings)
describe("togglePreviousPaths", () => {
    it("toggles the page's previous paths with no shape open", () => {
        const next = togglePreviousPaths(defaultSettings, false);
        expect(next.previousPaths).toBe(true);
        expect(next.shapeWalks).toBe(defaultSettings.shapeWalks);
    });

    it("toggles the open shape's pathways instead, leaving previous paths alone", () => {
        const hidden = togglePreviousPaths(defaultSettings, true);
        expect(hidden.shapeWalks).toBe(false);
        expect(hidden.previousPaths).toBe(false);
        expect(togglePreviousPaths(hidden, true).shapeWalks).toBe(true);
    });

    it("treats a setting saved before pathways existed as shown", () => {
        const { shapeWalks: _, ...older } = defaultSettings;
        expect(togglePreviousPaths(older, true).shapeWalks).toBe(false);
    });
});
