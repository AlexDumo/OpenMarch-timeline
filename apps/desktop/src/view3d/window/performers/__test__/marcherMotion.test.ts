import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Manifest } from "@/view3d/vendor/om-pose/step-blend.js";
import type { MarcherTimeline } from "@/utilities/Keyframes";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import { buildCountClock } from "@/view3d/core/marchers/countClock";
import { planShow } from "../marchers/marcherMotion";

const manifest = JSON.parse(
    fs.readFileSync(
        path.resolve(__dirname, "../../../assets/om-pose/manifest.json"),
        "utf8",
    ),
) as Manifest;
const fp = FieldPropertiesTemplates.HIGH_SCHOOL_FOOTBALL_FIELD_NO_END_ZONES;
// 16 counts at 120 bpm
const clock = buildCountClock(
    Array.from({ length: 16 }, (_, k) => ({
        timestamp: k * 0.5,
        duration: 0.5,
    })),
);

/** A marcher holding at (x, y) px, moving dy px over counts 4-12. */
function timeline(x: number, y: number, dy: number): MarcherTimeline {
    return {
        sortedTimestamps: [0, 2000, 6000, 8000],
        pathMap: new Map([
            [0, { x, y }],
            [2000, { x, y }],
            [6000, { x, y: y + dy }],
            [8000, { x, y: y + dy }],
        ]),
    };
}

describe("planning the show", () => {
    const ids = [1, 2, 3];
    const lines = [
        timeline(800, 500, 90),
        timeline(830, 500, 90),
        timeline(860, 500, 0),
    ];
    const first = planShow(ids, lines, [1, 1, 1], clock, fp, manifest, 0);

    it("plans every marcher the first time", () => {
        expect(first.replanned).toBe(3);
        expect(first.plans.every((p) => p !== null)).toBe(true);
    });

    it("marks time for the marcher who holds while others move", () => {
        const clips = first.plans[2]!.events.map((e) => e.clip);
        expect(clips).toContain("stepoff_marktime");
        expect(clips).toContain("marktime");
    });

    it("reuses the plans of marchers whose drill didn't change", () => {
        const edited = [lines[0], timeline(830, 500, 120), lines[2]];
        const next = planShow(
            ids,
            edited,
            [1, 1, 1],
            clock,
            fp,
            manifest,
            0,
            first,
        );
        expect(next.replanned).toBe(1);
        expect(next.plans[0]).toBe(first.plans[0]);
        expect(next.plans[1]).not.toBe(first.plans[1]);
        expect(next.plans[2]).toBe(first.plans[2]);
    });

    it("plans everyone again when the band's rests change", () => {
        // marcher 1 and 2 stop moving: nobody moves, so marcher 3 stands at attention
        const still = [timeline(800, 500, 0), timeline(830, 500, 0), lines[2]];
        const next = planShow(
            ids,
            still,
            [1, 1, 1],
            clock,
            fp,
            manifest,
            0,
            first,
        );
        expect(next.replanned).toBe(3);
        expect(next.plans[2]!.events.map((e) => e.clip)).toEqual(["attention"]);
    });

    it("plans everyone again when the tempo changes", () => {
        const faster = buildCountClock(
            Array.from({ length: 16 }, (_, k) => ({
                timestamp: k * 0.4,
                duration: 0.4,
            })),
        );
        const next = planShow(
            ids,
            lines,
            [1, 1, 1],
            faster,
            fp,
            manifest,
            0,
            first,
        );
        expect(next.replanned).toBe(3);
    });
});
