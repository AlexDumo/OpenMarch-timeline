import { describe, expect, it } from "vitest";
import { parseHornState } from "../hornState";
import { useView3dSceneStore } from "../sceneStore";

describe("horn state", () => {
    it("defaults to up and accepts the four states", () => {
        expect(parseHornState(undefined)).toBe("up");
        expect(parseHornState("sideways")).toBe("up");
        expect(parseHornState("trail")).toBe("trail");
    });

    it("starts up in the scene store and changes on request", () => {
        expect(useView3dSceneStore.getState().hornState).toBe("up");
        useView3dSceneStore.getState().setHornState("carry");
        expect(useView3dSceneStore.getState().hornState).toBe("carry");
        useView3dSceneStore.getState().setHornState("up");
    });
});

describe("step-off foot", () => {
    it("starts on the left foot and changes on request", () => {
        expect(useView3dSceneStore.getState().stepOffFoot).toBe("left");
        useView3dSceneStore.getState().setStepOffFoot("right");
        expect(useView3dSceneStore.getState().stepOffFoot).toBe("right");
        useView3dSceneStore.getState().setStepOffFoot("left");
    });
});

describe("beat lead", () => {
    it("starts at a tenth of a count and changes on request", () => {
        expect(useView3dSceneStore.getState().beatLead).toBe(0.1);
        useView3dSceneStore.getState().setBeatLead(0.2);
        expect(useView3dSceneStore.getState().beatLead).toBe(0.2);
        useView3dSceneStore.getState().setBeatLead(0.1);
    });
});
