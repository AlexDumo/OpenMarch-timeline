import { describe, expect, it } from "vitest";
import {
    DEFAULT_TIMELINE_HEIGHT,
    MIN_CANVAS_HEIGHT,
    MIN_TIMELINE_HEIGHT,
    TIMELINE_SPLIT_GUTTER,
    clampTimelineHeight,
    parseTimelineHeight,
} from "../timelineSplit";
import {
    UI_SETTINGS_STORAGE_KEY,
    defaultSettings,
    useUiSettingsStore,
} from "@/stores/UiSettingsStore";

describe("clampTimelineHeight", () => {
    it("keeps a height in range", () => {
        expect(clampTimelineHeight(300, 1000)).toBe(300);
    });
    it("holds the timeline minimum", () => {
        expect(clampTimelineHeight(10, 1000)).toBe(MIN_TIMELINE_HEIGHT);
    });
    it("leaves the canvas its minimum", () => {
        expect(clampTimelineHeight(5000, 1000)).toBe(
            1000 - MIN_CANVAS_HEIGHT - TIMELINE_SPLIT_GUTTER,
        );
    });
    it("lets the timeline minimum win in a short window", () => {
        expect(clampTimelineHeight(400, 250)).toBe(MIN_TIMELINE_HEIGHT);
    });
    it("falls back to the default for non-numbers", () => {
        expect(clampTimelineHeight(NaN, 1000)).toBe(DEFAULT_TIMELINE_HEIGHT);
    });
});

describe("timeline height persistence", () => {
    it("rejects unusable saved values", () => {
        expect(parseTimelineHeight("tall")).toBe(DEFAULT_TIMELINE_HEIGHT);
        expect(parseTimelineHeight(-4)).toBe(DEFAULT_TIMELINE_HEIGHT);
        expect(parseTimelineHeight(undefined)).toBe(DEFAULT_TIMELINE_HEIGHT);
        expect(parseTimelineHeight(321)).toBe(321);
    });
    it("saves to the settings in storage", () => {
        useUiSettingsStore.getState().setTimelineHeight(333);
        expect(useUiSettingsStore.getState().uiSettings.timelineHeight).toBe(
            333,
        );
        const stored = JSON.parse(
            localStorage.getItem(UI_SETTINGS_STORAGE_KEY) ?? "{}",
        ) as { timelineHeight?: number };
        expect(stored.timelineHeight).toBe(333);
        useUiSettingsStore
            .getState()
            .setTimelineHeight(defaultSettings.timelineHeight);
    });
});
