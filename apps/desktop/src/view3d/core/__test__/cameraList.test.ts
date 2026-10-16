import { describe, expect, it } from "vitest";
import type { CameraSeat } from "../types";
import {
    cameraListSchema,
    defaultCameraList,
    editCameraList,
    MAX_CAMERAS,
    newCameraId,
    newCameraName,
    resolveCameras,
    type SavedCamera,
    type ViewPose,
} from "../cameraList";
import {
    defaultVenueForKit,
    parseVenueSettings,
    parseVenueSettingsJson,
    withSavedCameras,
} from "../venueSettings";

const seat = (id: string): CameraSeat => ({
    id,
    labelKey: `view3d.camera.${id}`,
    kind: "seat",
    position: [0, 10, 20],
    target: [0, 0, -20],
});
const kitCameras = [seat("pressBox"), seat("frontRow"), seat("topDown")];
const pose: ViewPose = {
    position: [1.23456, 2, 3],
    target: [4, 5, 6.0004],
    fovDeg: 50,
};

describe("resolveCameras", () => {
    it("lists the kit's defaults when the show has no list", () => {
        expect(resolveCameras(kitCameras, undefined)).toEqual(kitCameras);
    });

    it("follows the show's order, names and saved views, and skips missing kit cameras", () => {
        const saved: SavedCamera[] = [
            {
                kind: "view",
                id: "view1",
                name: "Drum major",
                position: [1, 2, 3],
                target: [4, 5, 6],
                fovDeg: 40,
            },
            { kind: "kit", id: "topDown", name: "Overhead" },
            { kind: "kit", id: "gone" },
            { kind: "kit", id: "pressBox" },
        ];
        const cameras = resolveCameras(kitCameras, saved);
        expect(cameras.map((c) => c.id)).toEqual([
            "view1",
            "topDown",
            "pressBox",
        ]);
        expect(cameras[0]).toMatchObject({
            kind: "saved",
            name: "Drum major",
            position: [1, 2, 3],
            fovDeg: 40,
        });
        expect(cameras[1]).toMatchObject({
            name: "Overhead",
            labelKey: "view3d.camera.topDown",
        });
        expect(cameras[2].name).toBeUndefined();
    });

    it("lists nothing for an empty list", () => {
        expect(resolveCameras(kitCameras, [])).toEqual([]);
    });
});

describe("editCameraList", () => {
    const list = defaultCameraList(kitCameras);

    it("adds a saved view at the end, rounded to millimeters", () => {
        const next = editCameraList(list, {
            kind: "add",
            id: "view1",
            name: " Camera 1 ",
            pose,
        });
        expect(next).toHaveLength(4);
        expect(next[3]).toEqual({
            kind: "view",
            id: "view1",
            name: "Camera 1",
            position: [1.235, 2, 3],
            target: [4, 5, 6],
            fovDeg: 50,
        });
    });

    it("doesn't add past the limit", () => {
        let full: SavedCamera[] = [];
        for (let i = 0; i < MAX_CAMERAS; i++)
            full = editCameraList(full, {
                kind: "add",
                id: newCameraId(full),
                name: "x",
                pose,
            });
        expect(full).toHaveLength(MAX_CAMERAS);
        expect(
            editCameraList(full, { kind: "add", id: "extra", name: "x", pose }),
        ).toHaveLength(MAX_CAMERAS);
    });

    it("renames, and an empty name gives a default camera its label back", () => {
        const named = editCameraList(list, {
            kind: "rename",
            id: "frontRow",
            name: "Judges",
        });
        expect(named[1]).toEqual({
            kind: "kit",
            id: "frontRow",
            name: "Judges",
        });
        expect(
            editCameraList(named, {
                kind: "rename",
                id: "frontRow",
                name: " ",
            })[1],
        ).toEqual({ kind: "kit", id: "frontRow" });
    });

    it("keeps a saved view's name when renamed to nothing", () => {
        const added = editCameraList([], {
            kind: "add",
            id: "view1",
            name: "Mine",
            pose,
        });
        expect(
            editCameraList(added, { kind: "rename", id: "view1", name: "" })[0],
        ).toMatchObject({ name: "Mine" });
    });

    it("turns a default camera into a saved view with its label on setView", () => {
        const next = editCameraList(
            list,
            { kind: "setView", id: "pressBox", pose },
            () => "Press box",
        );
        expect(next[0]).toMatchObject({
            kind: "view",
            id: "pressBox",
            name: "Press box",
            fovDeg: 50,
        });
        expect(next.slice(1)).toEqual(list.slice(1));
    });

    it("moves within bounds and removes", () => {
        expect(
            editCameraList(list, { kind: "move", id: "topDown", by: -1 }).map(
                (c) => c.id,
            ),
        ).toEqual(["pressBox", "topDown", "frontRow"]);
        expect(
            editCameraList(list, { kind: "move", id: "pressBox", by: -1 }),
        ).toEqual(list);
        expect(
            editCameraList(list, { kind: "remove", id: "frontRow" }).map(
                (c) => c.id,
            ),
        ).toEqual(["pressBox", "topDown"]);
    });
});

describe("new camera ids and names", () => {
    it("picks the first free number", () => {
        expect(
            newCameraId([
                { kind: "kit", id: "view1" },
                { kind: "kit", id: "view3" },
            ]),
        ).toBe("view2");
        expect(newCameraName(["Camera 1", "Press box"], "Camera")).toBe(
            "Camera 2",
        );
    });
});

describe("camera lists in the venue settings", () => {
    const hs = defaultVenueForKit("hs");

    it("rejects duplicate ids", () => {
        expect(
            cameraListSchema.safeParse([
                { kind: "kit", id: "pressBox" },
                { kind: "kit", id: "pressBox" },
            ]).success,
        ).toBe(false);
    });

    it("stores a list per kit and drops `cameras` when the last one resets", () => {
        const withList = withSavedCameras(hs, "hs", [
            { kind: "kit", id: "pressBox" },
        ]);
        expect(parseVenueSettings(withList).cameras).toEqual({
            hs: [{ kind: "kit", id: "pressBox" }],
        });
        const both = withSavedCameras(withList, "gym", []);
        expect(Object.keys(both.cameras ?? {})).toEqual(["hs", "gym"]);
        const reset = withSavedCameras(
            withSavedCameras(both, "gym", undefined),
            "hs",
            undefined,
        );
        expect(reset).toEqual(hs);
        expect("cameras" in reset).toBe(false);
    });

    it("reads files saved before camera lists", () => {
        expect(parseVenueSettingsJson(JSON.stringify(hs))).toEqual(hs);
    });

    it("rejects a saved view without a pose", () => {
        expect(() =>
            parseVenueSettings({
                ...hs,
                cameras: { hs: [{ kind: "view", id: "v", name: "v" }] },
            }),
        ).toThrow();
    });
});
