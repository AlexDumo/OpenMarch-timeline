// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
    RESOLUTION_STORAGE_KEY,
    SEAT_VIEW_STORAGE_KEY,
    loadResolution,
    loadSeatView,
    maxPixelRatio,
    parseResolution,
    parseSeatView,
    saveResolution,
    saveSeatView,
} from "../renderPrefs";

function memoryStorage(): Storage {
    const data = new Map<string, string>();
    return {
        get length() {
            return data.size;
        },
        clear: () => data.clear(),
        getItem: (key) => data.get(key) ?? null,
        key: (index) => [...data.keys()][index] ?? null,
        removeItem: (key) => void data.delete(key),
        setItem: (key, value) => void data.set(key, String(value)),
    };
}

const broken = {
    getItem: () => {
        throw new Error("blocked");
    },
    setItem: () => {
        throw new Error("blocked");
    },
} as unknown as Storage;

describe("resolution", () => {
    it("defaults to sharp for missing or unknown values", () => {
        expect(parseResolution(null)).toBe("sharp");
        expect(parseResolution("4k")).toBe("sharp");
        expect(loadResolution(memoryStorage())).toBe("sharp");
        expect(loadResolution(broken)).toBe("sharp");
    });

    it("round-trips a saved choice", () => {
        const storage = memoryStorage();
        saveResolution("balanced", storage);
        expect(storage.getItem(RESOLUTION_STORAGE_KEY)).toBe("balanced");
        expect(loadResolution(storage)).toBe("balanced");
        expect(() => saveResolution("fast", broken)).not.toThrow();
    });

    it("caps the pixel ratio", () => {
        expect(maxPixelRatio("sharp")).toBe(2);
        expect(maxPixelRatio("balanced")).toBe(1.5);
        expect(maxPixelRatio("fast")).toBe(1);
    });
});

describe("seat view", () => {
    it("is on unless it was turned off", () => {
        expect(parseSeatView(null)).toBe(true);
        expect(parseSeatView("on")).toBe(true);
        expect(parseSeatView("maybe")).toBe(true);
        expect(parseSeatView("off")).toBe(false);
        expect(loadSeatView(memoryStorage())).toBe(true);
        expect(loadSeatView(broken)).toBe(true);
    });

    it("round-trips a saved choice", () => {
        const storage = memoryStorage();
        saveSeatView(false, storage);
        expect(storage.getItem(SEAT_VIEW_STORAGE_KEY)).toBe("off");
        expect(loadSeatView(storage)).toBe(false);
        saveSeatView(true, storage);
        expect(loadSeatView(storage)).toBe(true);
        expect(() => saveSeatView(false, broken)).not.toThrow();
    });
});
