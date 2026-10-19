import { describe, expect, it } from "vitest";
import type { CueInput } from "@openmarch/core";
import {
    hornEventAt,
    sectionCueCarry,
} from "@/view3d/core/marchers/hornChannel";
import { sectionUniform } from "@/view3d/core/marchers/looks";
import { useView3dSceneStore } from "../../sceneStore";
import { compileWindowCues } from "../marchers/marcherMotion";
import {
    DEFAULT_HOLD,
    windowHornEvents,
    windowLookHold,
    windowStepOffFoot,
} from "../previewOverrides";

// 16 counts; beat 58 is count 8
const beats = Array.from({ length: 16 }, (_, k) => ({
    id: 50 + k,
    timestamp: k * 0.5,
    duration: 0.5,
}));
const marchers = [
    { id: 1, section: "Trumpet" },
    { id: 2, section: "Flag" },
    { id: 3, section: "Rifle" },
];
const hornsDown: CueInput = {
    id: 2,
    channel: "horn_equipment",
    kind: "state",
    target: { kind: "band" },
    beatId: 58,
    value: "builtin:horn.down",
};
const compile = (cues: CueInput[] = [], foot: "left" | "right" = "left") =>
    compileWindowCues(marchers, beats, foot, { cues }, (id) =>
        sectionCueCarry(marchers.find((m) => m.id === id)!.section),
    );
const hornAt = (events: ReturnType<typeof windowHornEvents>, c: number) =>
    events[hornEventAt(events, c)].state;
const options = { secondsPerCount: () => 0.5 };

describe("the window's preview overrides", () => {
    it("start off and never touch the show", () => {
        const s = useView3dSceneStore.getState();
        expect(s.hornState).toBeNull();
        expect(s.guardEquipment).toBeNull();
        expect(s.stepOffFoot).toBeNull();
        s.setHornState("trail");
        s.setGuardEquipment("sabre");
        s.setStepOffFoot("right");
        expect(useView3dSceneStore.getState()).toMatchObject({
            hornState: "trail",
            guardEquipment: "sabre",
            stepOffFoot: "right",
        });
        s.setHornState(null);
        s.setGuardEquipment(null);
        s.setStepOffFoot(null);
    });
});

describe("horn state", () => {
    it("follows the cues from horns up with no override", () => {
        const events = windowHornEvents(
            compile([hornsDown]).segments(1, "horn_equipment"),
            null,
            options,
        );
        expect(hornAt(events, 0)).toBe("up");
        expect(hornAt(events, 12)).toBe("carry");
        expect(windowLookHold(null)).toBe(DEFAULT_HOLD);
    });

    it("plays horns up for a show without cues", () => {
        const events = windowHornEvents(
            compile().segments(1, "horn_equipment"),
            null,
            options,
        );
        expect(events.map((e) => e.state)).toEqual(["up"]);
    });

    it("holds the preview for the whole show, whatever the cues say", () => {
        const segments = compile([hornsDown]).segments(1, "horn_equipment");
        const trail = windowHornEvents(segments, "trail", options);
        expect(hornAt(trail, 0)).toBe("trail");
        expect(hornAt(trail, 12)).toBe("trail");
        // even a preview of the default hold ignores the horns-down cue
        const up = windowHornEvents(segments, "up", options);
        expect(hornAt(up, 12)).toBe("up");
        expect(windowLookHold("trail")).toBe("trail");
    });
});

describe("guard equipment", () => {
    it("fits cues by each section's own equipment", () => {
        expect(sectionCueCarry("Trumpet")).toBe("winds");
        expect(sectionCueCarry("Flag")).toBe("flag");
        expect(sectionCueCarry("Rifle")).toBe("rifle");
        expect(sectionCueCarry("Mystery")).toBe("none");
    });

    it("gives each section its own piece with no override", () => {
        expect(sectionUniform("Flag").options.carry?.family).toBe("flag");
        expect(sectionUniform("Rifle").options.carry?.family).toBe("rifle");
    });

    it("previews one piece in the hands without changing which cues fit", () => {
        const look = sectionUniform(
            "Flag",
            windowLookHold(null),
            undefined,
            undefined,
            "rifle",
        );
        expect(look.options.carry?.family).toBe("rifle");
        // compile still fits the flag section's cues by its flag
        const port: CueInput = {
            id: 3,
            channel: "horn_equipment",
            kind: "state",
            target: { kind: "band" },
            beatId: 58,
            value: "builtin:flag.port",
        };
        const flagSegments = compile([port]).segments(2, "horn_equipment");
        const rifleSegments = compile([port]).segments(3, "horn_equipment");
        expect(flagSegments.some((s) => s.value === "builtin:flag.port")).toBe(
            true,
        );
        expect(rifleSegments.some((s) => s.value === "builtin:flag.port")).toBe(
            false,
        );
    });
});

describe("step-off foot", () => {
    it("is the show's saved foot unless the window previews one", () => {
        expect(windowStepOffFoot(null, "right")).toBe("right");
        expect(windowStepOffFoot("left", "right")).toBe("left");
    });

    it("lets a Feet cue's own foot win over the show's or the preview's", () => {
        const rightFoot: CueInput = {
            id: 4,
            channel: "feet",
            kind: "state",
            target: { kind: "band" },
            beatId: 58,
            value: "builtin:feet.step",
            settings: { stepOffFoot: "right" },
        };
        for (const foot of ["left", "right"] as const) {
            const feet = compile(
                [rightFoot],
                windowStepOffFoot(foot, "left"),
            ).segments(1, "feet");
            const footAt = (c: number) =>
                [...feet].reverse().find((seg) => seg.from <= c)?.settings
                    .stepOffFoot;
            expect(footAt(2)).toBe(foot);
            expect(footAt(12)).toBe("right");
        }
    });
});
