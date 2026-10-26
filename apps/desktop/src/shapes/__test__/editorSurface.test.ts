import { describe, expect, it } from "vitest";
import { editorSurface } from "../editor/editorSurface";

/** The lab's three looks for the floating editor at rest (#426), and the default */
describe("floating editor surface", () => {
    it("reads the lab version, glass by default", () => {
        expect(editorSurface(null)).toBe("glass");
        expect(editorSurface("glass")).toBe("glass");
        expect(editorSurface("clear")).toBe("clear");
        expect(editorSurface("solid")).toBe("solid");
        expect(editorSurface("rings")).toBe("glass");
    });
});
