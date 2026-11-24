/**
 * Switching the band's uniform mode in the 3D View (fork #1257 step 5): each mode has its own
 * atlas key, and while the new mode's atlases compose, the marchers keep the previous mode's art
 * instead of flashing the bare palette.
 */
import { describe, expect, it, vi } from "vitest";

import {
    splitMode,
    withMode,
    type UniformPackValue,
} from "@/view3d/core/marchers/uniformArtwork";
import { stillShown } from "../useMarcherFlats";
import type { FlatsResources } from "../marcherBodies";

vi.mock("../flatsAtlas", () => ({}));

const pack = `library:cadets@${"a".repeat(64)}` as UniformPackValue;

describe("switching uniform modes", () => {
    it("gives each mode its own key, which splits back", () => {
        const plain = withMode(pack, "plain");
        const sash = withMode(pack, "sash-out");
        expect(plain).not.toBe(sash);
        expect(splitMode(sash)).toEqual({ pack, mode: "sash-out" });
        // a draft's key keeps its revision; a pack without modes keeps its plain key
        expect(
            splitMode(withMode(`${pack}~3` as UniformPackValue, "plain")),
        ).toEqual({ pack: `${pack}~3`, mode: "plain" });
        expect(withMode(pack, null)).toBe(pack);
        expect(splitMode(pack)).toEqual({ pack, mode: null });
    });

    it("keeps the previous mode's art on each body type until the new one is ready", () => {
        const art = (n: number) =>
            ({ atlas: { n }, lut: {}, layout: {} }) as never;
        const previous: FlatsResources = new Map([
            [`${withMode(pack, "plain")}|M`, art(1)],
            [`${withMode(pack, "plain")}|L`, art(2)],
        ]);
        const wanted = [
            `${withMode(pack, "sash-out")}|L`,
            `${withMode(pack, "sash-out")}|M`,
        ].join(",");
        const shown = stillShown(previous, wanted);
        expect(shown.get(`${withMode(pack, "sash-out")}|M`)).toBe(
            previous.get(`${withMode(pack, "plain")}|M`),
        );
        expect(shown.get(`${withMode(pack, "sash-out")}|L`)).toBe(
            previous.get(`${withMode(pack, "plain")}|L`),
        );
    });
});
