import { describe, expect, it } from "vitest";
import {
    chooseShownWindow,
    fitInside,
    videoSize,
    type RecordableWindows,
} from "../recordingWindows";

const EDITOR = 1;
const VIEW3D = 2;
const SETTINGS = 3;

const windows = (
    focusedId: number | null,
    minimized: number[] = [],
    open = [EDITOR, VIEW3D, SETTINGS],
): RecordableWindows => ({
    focusedId,
    windows: open.map((id) => ({
        id,
        editor: id === EDITOR,
        minimized: minimized.includes(id),
    })),
});

describe("chooseShownWindow", () => {
    it("shows the focused window", () => {
        expect(chooseShownWindow(windows(VIEW3D), EDITOR)).toBe(VIEW3D);
        expect(chooseShownWindow(windows(SETTINGS), VIEW3D)).toBe(SETTINGS);
    });

    it("keeps the last window while another app is in front", () => {
        expect(chooseShownWindow(windows(null), VIEW3D)).toBe(VIEW3D);
    });

    it("moves to the editor when the shown window is minimized", () => {
        expect(chooseShownWindow(windows(null, [VIEW3D]), VIEW3D)).toBe(EDITOR);
    });

    it("moves to the editor when the shown window closes", () => {
        expect(
            chooseShownWindow(windows(null, [], [EDITOR, SETTINGS]), VIEW3D),
        ).toBe(EDITOR);
    });

    it("moves to another window when the editor is minimized too", () => {
        expect(chooseShownWindow(windows(null, [EDITOR, VIEW3D]), VIEW3D)).toBe(
            SETTINGS,
        );
    });

    it("shows nothing when every window is minimized", () => {
        expect(
            chooseShownWindow(
                windows(null, [EDITOR, VIEW3D, SETTINGS]),
                VIEW3D,
            ),
        ).toBeNull();
    });

    it("ignores focus on a minimized window", () => {
        expect(chooseShownWindow(windows(VIEW3D, [VIEW3D]), SETTINGS)).toBe(
            SETTINGS,
        );
    });
});

describe("fitInside", () => {
    it("letterboxes a taller window, centred", () => {
        expect(
            fitInside(
                { width: 1000, height: 1000 },
                { width: 1600, height: 1000 },
            ),
        ).toEqual({ x: 300, y: 0, width: 1000, height: 1000 });
    });

    it("scales a larger window down, keeping its shape", () => {
        expect(
            fitInside(
                { width: 3200, height: 1000 },
                { width: 1600, height: 1000 },
            ),
        ).toEqual({ x: 0, y: 250, width: 1600, height: 500 });
    });
});

describe("videoSize", () => {
    it("keeps a small editor's size", () => {
        expect(videoSize({ width: 1280, height: 800 })).toEqual({
            width: 1280,
            height: 800,
        });
    });

    it("caps a Retina editor at 1920 × 1080, in even pixels", () => {
        expect(videoSize({ width: 2880, height: 1800 })).toEqual({
            width: 1728,
            height: 1080,
        });
        expect(videoSize({ width: 3025, height: 1700 })).toEqual({
            width: 1920,
            height: 1080,
        });
    });
});
