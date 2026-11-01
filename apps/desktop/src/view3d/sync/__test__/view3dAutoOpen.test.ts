import { describe, expect, it } from "vitest";
import { view3dAutoOpenOnShow } from "../view3dAutoOpen";

/** What a show opening does about the 3D View, from the auto-open setting. */
describe("view3dAutoOpenOnShow", () => {
    it("opens when the setting is on", () => {
        expect(view3dAutoOpenOnShow(true, { canAsk: true })).toBe("open");
        expect(view3dAutoOpenOnShow(true, { canAsk: false })).toBe("open");
    });

    it("does nothing when the setting is off", () => {
        expect(view3dAutoOpenOnShow(false, { canAsk: true })).toBe("none");
    });

    it("asks while the setting was never set, where it can", () => {
        expect(view3dAutoOpenOnShow(undefined, { canAsk: true })).toBe("ask");
        expect(view3dAutoOpenOnShow(undefined, { canAsk: false })).toBe("none");
    });
});
