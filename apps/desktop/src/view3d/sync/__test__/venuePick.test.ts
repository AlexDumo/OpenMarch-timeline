/**
 * A 3D View venue pick made against an older venue than the editor holds (fork #1257 hardening):
 * after the 4 s arrive timer ends a draft, a pick must not write back a version of the uniform
 * that a burst's save replaced, nor override an Undo the window hadn't seen.
 */
import { describe, expect, it } from "vitest";
import { defaultVenueForField } from "@/view3d/core/venueSettings";
import FootballTemplates from "@/global/classes/fieldTemplates/Football";
import { applyVenueChange } from "@/view3d/window/overlay/venueChange";
import {
    parseVenuePickBase,
    pickOnStoredUniform,
    venuePickBase,
} from "../venuePick";

const A = "0f0e0d0c-0b0a-4908-8706-050403020100";
const B = "1f0e0d0c-0b0a-4908-8706-050403020100";
const v = (id: string, n: number) => `library:${id}@${String(n).repeat(64)}`;
const venue = defaultVenueForField(
    FootballTemplates.HIGH_SCHOOL_FOOTBALL_FIELD_WITH_END_ZONES,
);
const wearing = (artwork: string, mode?: string) => ({
    ...venue,
    uniformArtwork: artwork,
    ...(mode ? { uniformMode: mode } : {}),
});

describe("a venue pick rebased on the editor's venue", () => {
    it("keeps the newer version a save put on the band when the pick is about something else", () => {
        const seen = wearing(v(A, 1));
        const next = applyVenueChange(seen, {
            kind: "crowd",
            crowd: !seen.crowd,
        });
        const out = pickOnStoredUniform(
            next,
            venuePickBase(seen),
            wearing(v(A, 2)),
        );
        expect(out.uniformArtwork).toBe(v(A, 2));
        expect(out.crowd).toBe(!seen.crowd);
    });

    it("lets a picked mode stand on the newer version of the same uniform", () => {
        const seen = wearing(v(A, 1), "home");
        const next = applyVenueChange(seen, {
            kind: "uniformMode",
            uniformMode: "away",
        });
        const out = pickOnStoredUniform(
            next,
            venuePickBase(seen),
            wearing(v(A, 2), "home"),
            (value) => (value === v(A, 2) ? ["home", "away"] : undefined),
        );
        expect(out.uniformArtwork).toBe(v(A, 2));
        expect(out.uniformMode).toBe("away");
    });

    it("drops a picked mode the newer version doesn't have, as setUniformPack does", () => {
        const seen = wearing(v(A, 1), "home");
        const next = applyVenueChange(seen, {
            kind: "uniformMode",
            uniformMode: "away",
        });
        const stored = wearing(v(A, 2), "home");
        // the edit that made version 2 removed "away"
        const without = pickOnStoredUniform(
            next,
            venuePickBase(seen),
            stored,
            (value) => (value === v(A, 2) ? ["home"] : undefined),
        );
        expect(without.uniformArtwork).toBe(v(A, 2));
        expect(without.uniformMode).toBeUndefined();
        // not known: dropped too, the default mode is safe
        const unknown = pickOnStoredUniform(next, venuePickBase(seen), stored);
        expect(unknown.uniformMode).toBeUndefined();
        // a pick made on the version the venue still wears needs no check
        const same = pickOnStoredUniform(
            next,
            venuePickBase(seen),
            wearing(v(A, 1), "home"),
        );
        expect(same.uniformMode).toBe("away");
    });

    it("keeps what an Undo put back when the picked mode was for another uniform", () => {
        const seen = wearing(v(A, 1), "home");
        const next = applyVenueChange(seen, {
            kind: "uniformMode",
            uniformMode: "away",
        });
        const out = pickOnStoredUniform(
            next,
            venuePickBase(seen),
            wearing(v(B, 1), "parade"),
        );
        expect(out.uniformArtwork).toBe(v(B, 1));
        expect(out.uniformMode).toBe("parade");
    });

    it("lets a picked uniform or preset stand", () => {
        const seen = wearing(v(A, 1), "home");
        const stored = wearing(v(A, 2), "home");
        const other = pickOnStoredUniform(
            applyVenueChange(seen, {
                kind: "uniformArtwork",
                uniformArtwork: v(B, 1) as `library:${string}`,
            }),
            venuePickBase(seen),
            stored,
        );
        expect(other.uniformArtwork).toBe(v(B, 1));
        expect(other.uniformMode).toBeUndefined();
        const preset = pickOnStoredUniform(
            applyVenueChange(seen, {
                kind: "uniforms",
                uniforms: venue.uniforms,
            }),
            venuePickBase(seen),
            stored,
        );
        expect(preset.uniformArtwork).toBeUndefined();
        expect(preset.uniformMode).toBeUndefined();
    });

    it("reads only a well-formed base from the window", () => {
        expect(
            parseVenuePickBase({ uniformArtwork: v(A, 1), uniformMode: null }),
        ).toEqual({ uniformArtwork: v(A, 1), uniformMode: null });
        expect(parseVenuePickBase({ uniformArtwork: {} })).toBeUndefined();
        expect(parseVenuePickBase(null)).toBeUndefined();
        expect(parseVenuePickBase("x")).toBeUndefined();
    });
});
