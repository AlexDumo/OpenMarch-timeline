/**
 * Editing a uniform's modes (step 5 of fork #1257): every edit leaves a pack the format accepts,
 * and the rules in `modeEdits.ts` hold, using Cadets 2019 (plain, sash out, sash out unzipped).
 */
import { describe, expect, it } from "vitest";
import {
    readUniformPack,
    writeUniformPack,
    type UniformPackLayer,
} from "../format";
import {
    addMode,
    addModeRefusal,
    contentsOf,
    moveMode,
    newLayerId,
    removeMode,
    renameMode,
    setModeColor,
    setModeItem,
    setModeLayer,
    setModeParts,
    tidyContents,
    type PackContents,
} from "../modeEdits";
import { fakePng, sampleManifest } from "./fixtures";

const base = sampleManifest("Cadets 2019");
const start = (): PackContents => ({
    ...contentsOf(base),
    items: [
        {
            id: "crest",
            file: "items/crest.png",
            panel: "front",
            at: [17, 25.32],
            width: 6,
        },
    ],
});
const layer = (id: string): UniformPackLayer => ({
    id,
    name: id,
    file: `layers/${id}.png`,
    covers: "page",
});

/** The pack file the contents make, read back: proves the format accepts them */
const written = (contents: PackContents) => {
    const files: Record<string, Uint8Array> = {};
    contents.layers.forEach((l, i) => (files[l.file] = fakePng(3360, 2816, i)));
    for (const item of contents.items) files[item.file] = fakePng(64, 64);
    return readUniformPack(writeUniformPack({ ...base, ...contents }, files))
        .manifest;
};

/** Plain, then sash out (with the sash overlay), then sash out unzipped */
function cadets() {
    const a = addMode(start(), {
        name: "Sash out",
        defaultName: "Plain",
        layer: layer("sash"),
    });
    const b = addMode(a.contents, {
        name: "Sash out, unzipped",
        defaultName: "Plain",
        layer: layer("open-front"),
    });
    // unzipped is sash out plus the open front
    const contents = setModeLayer(b.contents, b.id, "sash", true);
    return { contents, sash: a.id, unzipped: b.id };
}

describe("uniform mode edits", () => {
    it("adds the default mode with the first one, so nothing drawn changes", () => {
        const { contents, id: sash } = addMode(start(), {
            name: "Sash out",
            defaultName: "Plain",
            layer: layer("sash"),
        });
        expect(contents.modes.map((m) => [m.id, m.name, m.layers])).toEqual([
            ["plain", "Plain", ["base"]],
            [sash, "Sash out", ["base", "sash"]],
        ]);
        expect(contents.modes[1].items).toEqual(["crest"]);
        expect(written(contents).formatVersion).toBe(3);
    });

    it("builds Cadets 2019's three modes", () => {
        const { contents, unzipped } = cadets();
        expect(contents.modes.map((m) => m.name)).toEqual([
            "Plain",
            "Sash out",
            "Sash out, unzipped",
        ]);
        expect(contents.modes.find((m) => m.id === unzipped)?.layers).toEqual([
            "base",
            "sash",
            "open-front",
        ]);
        expect(written(contents).modes).toHaveLength(3);
    });

    it("adds a mode without a layer as a copy of the default, to recolor", () => {
        const { contents, id } = addMode(start(), {
            name: "Ballad",
            defaultName: "Plain",
        });
        const recolored = setModeColor(
            contents,
            base.palette,
            id,
            "primary",
            "#112233",
        );
        const mode = recolored.modes.find((m) => m.id === id)!;
        expect(mode.layers).toEqual(["base"]);
        expect(mode.palette).toEqual({ primary: "#112233" });
        // the uniform's own color is no change, so the override goes
        const back = setModeColor(
            recolored,
            base.palette,
            id,
            "primary",
            base.palette.primary.toUpperCase(),
        );
        expect(back.modes.find((m) => m.id === id)!.palette).toBeUndefined();
        expect(written(recolored).modes?.[1].palette).toEqual({
            primary: "#112233",
        });
    });

    it("stores only the parts a mode changes", () => {
        const { contents, id } = addMode(start(), {
            name: "Hats off",
            defaultName: "Plain",
        });
        const on = (
            Object.keys(base.options) as (keyof typeof base.options)[]
        ).filter((p) => base.options[p] && p !== "hat");
        const next = setModeParts(contents, base.options, id, on);
        expect(next.modes.find((m) => m.id === id)!.options).toEqual(
            base.options.hat ? { hat: false } : undefined,
        );
    });

    it("removes a mode with the layers no other mode draws", () => {
        const { contents, unzipped } = cadets();
        const next = removeMode(contents, unzipped);
        expect(next.layers.map((l) => l.id)).toEqual(["base", "sash"]);
        expect(written(next).modes).toHaveLength(2);
    });

    it("removing the last mode keeps exactly what it drew", () => {
        const { contents, sash, unzipped } = cadets();
        const one = removeMode(removeMode(contents, "plain"), unzipped);
        expect(one.modes.map((m) => m.id)).toEqual([sash]);
        const none = removeMode(one, sash);
        expect(none.modes).toEqual([]);
        expect(none.layers.map((l) => l.id)).toEqual(["base", "sash"]);
        expect(written(none).formatVersion).toBe(2);
    });

    it("keeps a mode's last layer, and never drops a layer turned off", () => {
        const { contents, sash } = cadets();
        const off = setModeLayer(contents, sash, "sash", false);
        expect(off.modes.find((m) => m.id === sash)!.layers).toEqual(["base"]);
        expect(off.layers).toHaveLength(3);
        const still = setModeLayer(off, sash, "base", false);
        expect(still.modes.find((m) => m.id === sash)!.layers).toEqual([
            "base",
        ]);
    });

    it("moves a mode, which can make it the default", () => {
        const { contents, sash } = cadets();
        expect(moveMode(contents, sash, -1).modes[0].id).toBe(sash);
        expect(moveMode(contents, "plain", -1)).toBe(contents);
    });

    it("renames, keeping the old name for an empty one", () => {
        const { contents, sash } = cadets();
        expect(renameMode(contents, sash, "  Sash on  ").modes[1].name).toBe(
            "Sash on",
        );
        expect(renameMode(contents, sash, "   ").modes[1].name).toBe(
            "Sash out",
        );
    });

    it("shows a new item in every mode, and drops a removed one from them", () => {
        const { contents, sash } = cadets();
        const hidden = setModeItem(contents, sash, "crest", false);
        expect(hidden.modes.find((m) => m.id === sash)!.items).toEqual([]);
        const added = tidyContents(
            {
                ...hidden,
                items: [
                    ...hidden.items,
                    {
                        id: "number",
                        file: "items/number.png",
                        panel: "back",
                        at: [17, 28.47],
                        height: 8,
                    },
                ],
            },
            hidden,
        );
        expect(added.modes.every((m) => m.items.includes("number"))).toBe(true);
        const removed = tidyContents({ ...added, items: [] }, added);
        expect(removed.modes.every((m) => m.items.length === 0)).toBe(true);
        expect(written(removed).formatVersion).toBe(3);
    });

    it("refuses a ninth mode and gives new layers unused ids and files", () => {
        let contents = start();
        for (let n = 1; n < 8; n++)
            contents = addMode(contents, {
                name: `Mode ${n}`,
                defaultName: "Plain",
            }).contents;
        expect(contents.modes).toHaveLength(8);
        expect(addModeRefusal(contents, { withLayer: false })).toBe(
            "modesFull",
        );
        expect(() =>
            addMode(contents, { name: "Nine", defaultName: "Plain" }),
        ).toThrow();
        expect(
            newLayerId([layer("sash")], "Sash", ["layers/sash-2.png"]),
        ).toEqual({ id: "sash-3", file: "layers/sash-3.png" });
    });
});
