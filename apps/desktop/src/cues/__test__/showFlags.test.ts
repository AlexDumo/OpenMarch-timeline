// @vitest-environment node
import { describe, expect, it } from "vitest";
import { whoHolds, type CueInput } from "@openmarch/core";
import type { ShowAsset } from "@/db-functions/showAssets";
import {
    flagCueValues,
    flagNameOfFile,
    flagOfAsset,
    showFlags,
} from "@/showAssets/flags";
import { carryForValue } from "@/view3d/core/marchers/equipmentSpans";
import { compileShowCues } from "../showCues";
import { equipmentValueOfChoice, heldValueAt } from "../equipment";
import {
    equipmentIconsAt,
    iconOfValue,
    isPictureIcon,
} from "../equipmentIcons";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

const flagAsset = (
    id: string,
    name: string,
    shape: string,
    versionHash: string,
): ShowAsset => ({
    id,
    versionHash,
    kind: "flag",
    name,
    parts: { artwork: HASH_C, thumbnail: HASH_C },
    sidecar: { shape, width: 1200, height: 800 },
    credits: {},
    createdAt: "2026-11-25 12:00:00",
});

const OPENER = flagAsset("opener", "Opener silk", "swing", HASH_A);
const BALLAD = flagAsset("ballad", "Ballad silk", "rectangle", HASH_B);
const MODEL: ShowAsset = {
    ...OPENER,
    id: "car",
    kind: "model",
    name: "Car",
    sidecar: {},
};

describe("the show's flags (fork #985)", () => {
    it("reads flag assets, skipping other kinds and unreadable ones", () => {
        const broken = { ...BALLAD, id: "broken", sidecar: { shape: 3 } };
        const flags = showFlags([OPENER, MODEL, broken as ShowAsset, BALLAD]);
        expect(flags.map((f) => f.name)).toEqual([
            "Opener silk",
            "Ballad silk",
        ]);
        expect(flags[0]).toMatchObject({
            value: `library:opener@${HASH_A}`,
            shape: "swing",
            artwork: HASH_C,
            thumbnail: HASH_C,
            width: 1200,
            height: 800,
        });
    });

    it("reads a shape this build doesn't know as the default shape", () => {
        expect(
            flagOfAsset(flagAsset("x", "X", "laterShape", HASH_A))?.shape,
        ).toBe("rectangle");
    });

    it("is an Equipment value of the Guard family that counts as holding a flag", () => {
        const [value] = flagCueValues(showFlags([OPENER]));
        expect(value).toMatchObject({
            id: `library:opener@${HASH_A}`,
            type: "equipment",
            name: "Opener silk",
            label: "Opener silk",
            holds: "flag",
            family: "guard",
        });
    });

    it("names a new flag after its file", () => {
        expect(flagNameOfFile("Ballad silk.png")).toBe("Ballad silk");
        expect(flagNameOfFile("my.flag.v2.PNG")).toBe("my.flag.v2");
        expect(flagNameOfFile(".png")).toBe("Flag");
    });
});

describe("handing out the show's flags with Equipment cues (fork #985)", () => {
    const flags = showFlags([OPENER, BALLAD]);
    const values = flagCueValues(flags);
    const opener = flags[0].value;
    const ballad = flags[1].value;
    const MARCHERS = [
        { id: 1, section: "Color Guard" },
        { id: 2, section: "Color Guard" },
        { id: 3, section: "Trumpet" },
    ];
    const BEATS = [
        { id: 1, position: 0, duration: 0 },
        ...Array.from({ length: 32 }, (_, c) => ({
            id: 100 + c,
            position: c + 1,
            duration: 0.5,
        })),
    ];
    const cue = (
        id: number,
        count: number,
        value: string,
        marcherIds: number[],
    ): CueInput => ({
        id,
        type: "equipment",
        beatId: 100 + count,
        value,
        marcherIds,
        length: null,
        transition: null,
        settings: {},
    });
    const CUES = [cue(1, 0, opener, [1, 2, 3]), cue(2, 16, ballad, [2])];

    it("stores the flag's own reference as the cue's value", () => {
        expect(equipmentValueOfChoice(opener)).toBe(opener);
        expect(equipmentValueOfChoice("rifle")).toBe("builtin:equipment.rifle");
    });

    it("each performer holds the flag their cue names, a trumpet too", () => {
        const show = compileShowCues(MARCHERS, BEATS, CUES, values);
        expect(heldValueAt(show.compiled, 1, 20)).toBe(opener);
        expect(heldValueAt(show.compiled, 2, 8)).toBe(opener);
        expect(heldValueAt(show.compiled, 2, 20)).toBe(ballad);
        expect(heldValueAt(show.compiled, 3, 4)).toBe(opener);
        // holding a show flag is holding a flag
        expect(whoHolds(show.compiled, "flag", 20).sort()).toEqual([1, 2, 3]);
    });

    it("without the show's flags, compile doesn't know the cue and nobody changes", () => {
        const show = compileShowCues(MARCHERS, BEATS, CUES);
        expect(heldValueAt(show.compiled, 3, 4)).not.toBe(opener);
    });

    it("the field draws each holder with their flag's picture, the guard's own flag included", () => {
        const show = compileShowCues(MARCHERS, BEATS, CUES, values);
        const icons = equipmentIconsAt({
            compiled: show.compiled,
            usualValue: show.usualValue,
            sectionOf: (id) => MARCHERS.find((m) => m.id === id)?.section,
            count: 20,
            shown: "changed",
        });
        expect(icons.get(1)).toBe(opener);
        expect(icons.get(2)).toBe(ballad);
        expect(icons.get(3)).toBe(opener);
        expect(isPictureIcon(icons.get(2)!)).toBe(true);
        expect(iconOfValue("builtin:equipment.flag")).toBe("Flag");
        expect(isPictureIcon(iconOfValue("builtin:equipment.flag"))).toBe(
            false,
        );
    });

    it("the 3D View hands a holder the 6 ft flag painted with the flag's own design", () => {
        const tiles = new Map(
            flags.map((f, tile) => [
                f.value,
                { shape: f.shape, artwork: tile },
            ]),
        );
        const flagOf = (v: string) => tiles.get(v);
        // each flag its own tile in the flags' texture
        const swing = carryForValue(opener, "flag", null, flagOf);
        expect(swing?.model).toBe("flag6");
        expect(swing?.artwork).toBe(0);
        expect(swing?.options?.silkShape).toBe("swing");
        const plain = carryForValue(ballad, "flag", null, flagOf);
        expect(plain?.model).toBe("flag6");
        expect(plain?.artwork).toBe(1);
        // the default shape needs no option
        expect(plain?.options?.silkShape).toBeUndefined();
        // a catalog item is unchanged, with no design of its own
        const rifle = carryForValue(
            "builtin:equipment.rifle",
            "rifle",
            null,
            flagOf,
        );
        expect(rifle?.model).toBe("rifle");
        expect(rifle?.artwork).toBeUndefined();
    });
});
