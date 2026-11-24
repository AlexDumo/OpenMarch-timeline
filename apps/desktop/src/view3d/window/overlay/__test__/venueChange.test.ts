// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
    defaultVenueForKit,
    parseVenueSettingsJson,
} from "@/view3d/core/venueSettings";
import { uniformArtworkOf } from "@/view3d/core/marchers/uniformArtwork";
import type { LightingPreset } from "@/view3d/core/types";
import { applyVenueChange, venueChanged } from "../venueChange";

const hsDusk = {
    ...defaultVenueForKit("hs"),
    lighting: "dusk" as const,
    params: {
        homeColor: "#112233",
        awayColor: "#445566",
        endZoneText: "HOME",
        endZoneColor: "#778899",
    },
};

describe("applyVenueChange", () => {
    it("keeps lighting the new kit supports, and the params", () => {
        const next = applyVenueChange(hsDusk, { kind: "kit", kit: "college" });
        expect(next).toEqual({ ...hsDusk, kit: "college" });
    });

    it("uses the new kit's default when it can't keep the lighting", () => {
        expect(
            applyVenueChange(hsDusk, { kind: "kit", kit: "gym" }).lighting,
        ).toBe("house");
        expect(
            applyVenueChange(hsDusk, { kind: "kit", kit: "pro" }).lighting,
        ).toBe("roofClosed");
    });

    it("changes lighting and crowd", () => {
        expect(
            applyVenueChange(hsDusk, { kind: "lighting", lighting: "night" }),
        ).toEqual({ ...hsDusk, lighting: "night" });
        expect(
            applyVenueChange(hsDusk, { kind: "crowd", crowd: false }),
        ).toEqual({ ...hsDusk, crowd: false });
    });

    it("moves lighting the kit doesn't support to its default", () => {
        const next = applyVenueChange(hsDusk, {
            kind: "lighting",
            lighting: "roofClosed",
        });
        expect(next.lighting).toBe("day");
    });

    it("merges params, keeping the ones not given", () => {
        const next = applyVenueChange(hsDusk, {
            kind: "params",
            params: { endZoneText: "EAGLES", homeColor: "#00aa00" },
        });
        expect(next.params).toEqual({
            ...hsDusk.params,
            endZoneText: "EAGLES",
            homeColor: "#00aa00",
        });
    });

    it("rejects a color that isn't #rrggbb", () => {
        expect(() =>
            applyVenueChange(hsDusk, {
                kind: "params",
                params: { awayColor: "red" },
            }),
        ).toThrow();
    });

    it("throws on settings that aren't valid", () => {
        expect(() =>
            applyVenueChange(hsDusk, {
                kind: "lighting",
                lighting: "disco" as LightingPreset,
            }),
        ).toThrow();
    });
});

describe("uniforms change", () => {
    it("sets the show's uniform preset and keeps everything else", () => {
        const next = applyVenueChange(hsDusk, {
            kind: "uniforms",
            uniforms: "military",
        });
        expect(next).toEqual({ ...hsDusk, uniforms: "military" });
    });

    it("sets the guard's preset apart from the band's", () => {
        const next = applyVenueChange(
            { ...hsDusk, uniforms: "westPoint" },
            { kind: "guardUniforms", guardUniforms: "fade" },
        );
        expect(next).toEqual({
            ...hsDusk,
            uniforms: "westPoint",
            guardUniforms: "fade",
        });
    });
});

describe("the winds' settings", () => {
    it("sets the brass finish and the tubas' horn, keeping the rest", () => {
        const silver = applyVenueChange(hsDusk, {
            kind: "brassFinish",
            brassFinish: "silver",
        });
        expect(silver).toEqual({ ...hsDusk, brassFinish: "silver" });
        const sousaphones = applyVenueChange(silver, {
            kind: "tuba",
            tuba: "sousaphone",
        });
        expect(sousaphones).toEqual({
            ...hsDusk,
            brassFinish: "silver",
            tuba: "sousaphone",
        });
    });

    it("counts a change from the defaults, and only that", () => {
        // absent means lacquer and marching tubas
        expect(venueChanged(hsDusk, { ...hsDusk, brassFinish: "brass" })).toBe(
            false,
        );
        expect(venueChanged(hsDusk, { ...hsDusk, tuba: "contra" })).toBe(false);
        expect(venueChanged(hsDusk, { ...hsDusk, brassFinish: "silver" })).toBe(
            true,
        );
        expect(venueChanged(hsDusk, { ...hsDusk, tuba: "sousaphone" })).toBe(
            true,
        );
    });
});

describe("venueChanged", () => {
    it("compares kit, lighting, crowd, uniforms and params", () => {
        expect(venueChanged(hsDusk, { ...hsDusk })).toBe(false);
        expect(venueChanged(hsDusk, { ...hsDusk, uniforms: "fade" })).toBe(
            true,
        );
        // absent means the default preset
        expect(venueChanged(hsDusk, { ...hsDusk, uniforms: "westPoint" })).toBe(
            false,
        );
        expect(
            venueChanged(hsDusk, { ...hsDusk, guardUniforms: "prism" }),
        ).toBe(true);
        expect(venueChanged(hsDusk, { ...hsDusk, guardUniforms: "sash" })).toBe(
            false,
        );
        expect(venueChanged(hsDusk, { ...hsDusk, crowd: false })).toBe(true);
        expect(venueChanged(hsDusk, { ...hsDusk, lighting: "day" })).toBe(true);
        expect(venueChanged(hsDusk, { ...hsDusk, kit: "bighs" })).toBe(true);
        expect(
            venueChanged(hsDusk, {
                ...hsDusk,
                params: { ...hsDusk.params, endZoneText: "AWAY" },
            }),
        ).toBe(true);
        expect(
            venueChanged(hsDusk, { ...hsDusk, params: { ...hsDusk.params } }),
        ).toBe(false);
    });
});

describe("the band's flats uniform (fork #1255)", () => {
    const venue = defaultVenueForKit("hs");

    it("is set by picking the sample and cleared by picking a preset", () => {
        const flats = applyVenueChange(venue, {
            kind: "uniformArtwork",
            uniformArtwork: "sample",
        });
        expect(flats.uniformArtwork).toBe("sample");
        expect(venueChanged(venue, flats)).toBe(true);
        const preset = applyVenueChange(flats, {
            kind: "uniforms",
            uniforms: "sash",
        });
        expect("uniformArtwork" in preset).toBe(false);
        expect(preset.uniforms).toBe("sash");
    });

    it("holds a built-in id or a show asset's id, and older venues parse without it", () => {
        expect(
            parseVenueSettingsJson(
                JSON.stringify({ ...venue, uniformArtwork: 12 }),
            )?.uniformArtwork,
        ).toBe(12);
        expect(
            parseVenueSettingsJson(
                JSON.stringify({ ...venue, uniformArtwork: "later-pack" }),
            )?.uniformArtwork,
        ).toBe("later-pack");
        expect(parseVenueSettingsJson(JSON.stringify(venue))).toBeDefined();
        // ids this build can't draw fall back to the preset
        expect(uniformArtworkOf(12)).toBeNull();
        expect(uniformArtworkOf("later-pack")).toBeNull();
        expect(uniformArtworkOf("sample")).toBe("sample");
    });
});

describe("the band's uniform mode (fork #1257 step 5)", () => {
    const pack = `library:cadets@${"a".repeat(64)}` as const;
    const other = `library:away@${"b".repeat(64)}` as const;
    const wearing = applyVenueChange(defaultVenueForKit("hs"), {
        kind: "uniformArtwork",
        uniformArtwork: pack,
    });

    it("switches the mode the band wears, as a venue change", () => {
        const sash = applyVenueChange(wearing, {
            kind: "uniformMode",
            uniformMode: "sash-out",
        });
        expect(sash).toEqual({ ...wearing, uniformMode: "sash-out" });
        expect(venueChanged(wearing, sash)).toBe(true);
        const unzipped = applyVenueChange(sash, {
            kind: "uniformMode",
            uniformMode: "unzipped",
        });
        expect(unzipped.uniformMode).toBe("unzipped");
        expect(unzipped.uniformArtwork).toBe(pack);
    });

    it("starts another uniform, or a preset, in its default mode", () => {
        const sash = { ...wearing, uniformMode: "sash-out" };
        expect(
            applyVenueChange(sash, {
                kind: "uniformArtwork",
                uniformArtwork: other,
            }).uniformMode,
        ).toBeUndefined();
        expect(
            applyVenueChange(sash, { kind: "uniforms", uniforms: "westPoint" })
                .uniformMode,
        ).toBeUndefined();
    });

    it("parses without it, and drops a value that isn't a mode id on its own", () => {
        expect(
            parseVenueSettingsJson(JSON.stringify(wearing))?.uniformMode,
        ).toBeUndefined();
        const bad = parseVenueSettingsJson(
            JSON.stringify({ ...wearing, uniformMode: "Sash Out!" }),
        );
        expect(bad?.uniformMode).toBeUndefined();
        expect(bad?.uniformArtwork).toBe(pack);
    });
});
