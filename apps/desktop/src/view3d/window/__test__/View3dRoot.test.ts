import { describe, expect, it } from "vitest";
import { readView3dWindowParams, viewportFallback } from "../View3dRoot";

describe("readView3dWindowParams", () => {
    it("reads the show name, theme and language main passes", () => {
        expect(
            readView3dWindowParams(
                "?view=3d&show=Fall%20Show%202026&theme=light&lang=fr",
            ),
        ).toEqual({
            showName: "Fall Show 2026",
            theme: "light",
            language: "fr",
        });
    });

    it("falls back to dark, English and an empty name", () => {
        expect(readView3dWindowParams("?view=3d")).toEqual({
            showName: "",
            theme: "dark",
            language: "en",
        });
        expect(readView3dWindowParams("?view=3d&theme=neon&lang=")).toEqual({
            showName: "",
            theme: "dark",
            language: "en",
        });
    });
});

describe("viewportFallback", () => {
    it("draws the scene only on a GPU", () => {
        expect(viewportFallback("hardware")).toBeNull();
        expect(viewportFallback("software")).toBe(
            "view3d.window.gpuUnavailable",
        );
        expect(viewportFallback("none")).toBe(
            "view3d.window.graphicsUnavailable",
        );
    });

    it("draws in software when the viewer allows it", () => {
        expect(viewportFallback("software", true)).toBeNull();
        expect(viewportFallback("none", true)).toBe(
            "view3d.window.graphicsUnavailable",
        );
    });
});
