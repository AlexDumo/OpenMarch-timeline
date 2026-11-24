// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Vector3Tuple } from "three";
import type { ViewCamera } from "../cameraList";
import {
    aimOf,
    camerasFile,
    camerasFileName,
    focalLengthFromFov,
    fovFromFocalLength,
    parseCamerasFile,
    targetFromAim,
} from "../cameraSettings";

describe("lens", () => {
    it("reads a field of view as a full-frame focal length and back", () => {
        // A 50 mm lens on full frame takes in about 27° top to bottom.
        expect(fovFromFocalLength(50)).toBeCloseTo(26.99, 2);
        expect(focalLengthFromFov(fovFromFocalLength(85))).toBeCloseTo(85, 9);
    });
});

describe("aim", () => {
    const eye: Vector3Tuple = [10, 20, 30];

    it("pans toward side 2 from looking at the back of the field", () => {
        expect(aimOf(eye, [10, 20, 0]).panDeg).toBeCloseTo(0);
        expect(aimOf(eye, [40, 20, 30]).panDeg).toBeCloseTo(90);
        expect(aimOf(eye, [-20, 20, 30]).panDeg).toBeCloseTo(-90);
        expect(aimOf(eye, [10, 0, 10]).tiltDeg).toBeCloseTo(-45);
    });

    it("turns the look-at point about the camera and keeps the distance", () => {
        const target: Vector3Tuple = [0, 0, -20];
        const aim = aimOf(eye, target);
        const back = targetFromAim(eye, aim);
        back.forEach((v, i) => expect(v).toBeCloseTo(target[i], 9));
        const turned = targetFromAim(eye, { ...aim, panDeg: aim.panDeg + 30 });
        expect(aimOf(eye, turned).distance).toBeCloseTo(aim.distance, 9);
        expect(aimOf(eye, turned).tiltDeg).toBeCloseTo(aim.tiltDeg, 9);
    });
});

describe("cameras file", () => {
    const cameras: ViewCamera[] = [
        {
            id: "pressBox",
            labelKey: "view3d.camera.pressBox",
            kind: "seat",
            position: [0, 15, 40],
            target: [0, 0, -25],
        },
        {
            id: "view1",
            labelKey: "",
            name: "Drum major",
            kind: "saved",
            position: [1, 2, 3],
            target: [4, 5, 6],
            fovDeg: 30,
            rollDeg: 5,
            follow: { marcherId: 3, mode: "third" },
        },
    ];

    it("writes every camera as a full view and reads it back", () => {
        const file = camerasFile(
            cameras,
            "hs",
            (c) => c.name ?? "Press box",
            45,
        );
        expect(file.cameras[0]).toEqual({
            kind: "view",
            id: "pressBox",
            name: "Press box",
            position: [0, 15, 40],
            target: [0, 0, -25],
            fovDeg: 45,
        });
        const read = parseCamerasFile(JSON.stringify(file));
        expect(read).toEqual({ ok: true, cameras: file.cameras, venue: "hs" });
    });

    it("says why a file can't be imported", () => {
        expect(parseCamerasFile("{")).toEqual({ ok: false, reason: "notJson" });
        expect(parseCamerasFile('{"a":1}')).toEqual({
            ok: false,
            reason: "notCameras",
        });
        expect(
            parseCamerasFile(
                JSON.stringify({
                    format: "openmarch.cameras",
                    version: 1,
                    cameras: [{ kind: "view", id: "a", name: "A" }],
                }),
            ),
        ).toEqual({ ok: false, reason: "invalid" });
    });

    it("names the file after the show", () => {
        expect(camerasFileName("Fall show.dots")).toBe(
            "Fall show cameras.json",
        );
        expect(camerasFileName(undefined)).toBe("OpenMarch cameras.json");
    });
});
