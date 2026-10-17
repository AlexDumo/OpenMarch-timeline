import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    buildTruth,
    corpsMap,
    formatTruthJson,
    kitMaps,
    rubatoMap,
    scoreMap,
    steadyMap,
} from "../maps";
import { kitMusicXml, toMusicXml } from "../musicxml";
import { scoreShow, type ShowTiming } from "../score.mts";
import type { TempoTruth } from "../truth";

const FIXTURES = path.join(__dirname, "..", "fixtures");

const at = (t: TempoTruth, measure: number, beat = 1) =>
    t.counts.find((c) => c.measure === measure && c.beat === beat)!;

const syncedShow = (t: TempoTruth): ShowTiming => ({
    durations: t.counts.map((c) => c.duration),
    measures: t.measures.map((m) => ({
        firstCount: m.firstCount,
        mark: m.mark ?? null,
    })),
    pages: t.pages,
    audioOffsetSeconds: t.syncedAudioOffsetSeconds,
    measurementOffset: t.firstMeasureNumber,
});

describe("tempo kit maps", () => {
    it.each(kitMaps().map((m) => [m.name, m] as const))(
        "%s: count times add up and every measure is counted",
        (_, map) => {
            const t = buildTruth(map);
            expect(t.counts[0]!.time).toBe(map.leadIn);
            for (let i = 1; i < t.counts.length; i++)
                expect(t.counts[i]!.time).toBeCloseTo(
                    t.counts[i - 1]!.time + t.counts[i - 1]!.duration,
                    9,
                );
            expect(t.measures.reduce((s, m) => s + m.counts, 0)).toBe(
                t.counts.length,
            );
            expect(t.pages[0]).toBe(1);
            expect(new Set(t.pages).size).toBe(t.pages.length);
        },
    );

    it("steady: ♩=138 to C, then ♩=112, with the hit on C", () => {
        const t = buildTruth(steadyMap);
        expect(t.counts).toHaveLength(78 * 4);
        const c = at(t, 41);
        expect(c.mark).toBe("C");
        expect(c.events).toEqual(["hit"]);
        expect(c.time).toBeCloseTo(1.6 + (40 * 4 * 60) / 138, 9);
        expect(c.duration).toBeCloseTo(60 / 112, 12);
        expect(t.end).toBeGreaterThan(150);
        expect(t.end).toBeLessThan(155);
    });

    it("score: pickup is m0, 6/8 counts dotted quarters, ♩.=85 is ♩=127.5, the rit. ends at 100", () => {
        const t = buildTruth(scoreMap());
        expect(t.firstMeasureNumber).toBe(0);
        expect(t.measures[0]).toMatchObject({
            number: 0,
            counts: 1,
            pickup: true,
        });
        expect(at(t, 63)).toMatchObject({ mark: "I", unit: 1.5 });
        expect(at(t, 63).duration).toBeCloseTo(60 / 88, 12);
        expect(at(t, 67).duration).toBeCloseTo(60 / 85, 12);
        expect(at(t, 54, 4).qpm).toBeCloseTo(100, 12);
        expect(at(t, 55)).toMatchObject({ mark: "H", qpm: 132 });
        expect(t.measures.find((m) => m.number === 70)!.meter).toBe("3/4");
        expect(t.measures.filter((m) => m.mark).map((m) => m.mark)).toEqual(
            "ABCDEFGHIJKLM".split(""),
        );
    });

    it("score v1 plays F at 138, v3 moves L two bars later, the live take is slower with a fermata", () => {
        expect(at(buildTruth(scoreMap({ fTempo: 138 })), 41).qpm).toBe(138);
        const v3 = buildTruth(scoreMap({ barsBeforeL: 2 }));
        expect(at(v3, 85).mark).toBe("L");
        const live = buildTruth(scoreMap({ live: true }));
        expect(at(live, 1).qpm).toBeCloseTo(132 * 0.97, 12);
        expect(at(live, 54, 4).qpm).toBeCloseTo(92, 12);
        expect(at(live, 70, 3)).toMatchObject({
            duration: 1.2,
            events: ["fermata"],
        });
        expect(live.counts).toHaveLength(buildTruth(scoreMap()).counts.length);
    });

    it("rubato: fermatas, caesura and the 132→141 break", () => {
        const t = buildTruth(rubatoMap);
        expect(t.counts[0]!.time).toBe(1.84);
        expect(at(t, 5, 4)).toMatchObject({
            duration: 3.2,
            plainDuration: 60 / 72,
        });
        expect(at(t, 13).duration).toBe(6.5);
        expect(t.pages).toContain(at(t, 13).index);
        expect(t.pages).not.toContain(at(t, 5, 4).index);
        expect(at(t, 14, 4).duration).toBeCloseTo(1 + 1.5, 12);
        expect(at(t, 12, 4).qpm).toBeCloseTo(44, 12);
        expect(at(t, 15).qpm).toBe(132);
        expect(at(t, 22, 4).qpm).toBeCloseTo(141, 12);
    });

    it("corps: 2+2+3, 3+2, a 3/2 bar in quarters, 152.5, and ♩.=♩ into 12/8", () => {
        const t = buildTruth(corpsMap);
        const m = (n: number) => t.measures.find((x) => x.number === n)!;
        expect(m(17)).toMatchObject({
            meter: "7/8",
            counts: 3,
            grouping: [2, 2, 3],
        });
        expect(at(t, 17, 3).duration).toBeCloseTo((1.5 * 60) / 176, 12);
        expect(m(25)).toMatchObject({
            meter: "5/8",
            counts: 2,
            grouping: [3, 2],
        });
        expect(m(29)).toMatchObject({ meter: "3/2", counts: 6 });
        expect(at(t, 30).duration).toBeCloseTo(60 / 152.5, 12);
        expect(at(t, 38).duration).toBeCloseTo(60 / 152.5, 12);
        expect(at(t, 38).unit).toBe(1.5);
    });

    it("the committed fixtures match the maps (run `pnpm run tempo-kit` after changing a map)", () => {
        for (const map of kitMaps())
            expect(
                readFileSync(path.join(FIXTURES, `${map.name}.json`), "utf8"),
                map.name,
            ).toBe(formatTruthJson(buildTruth(map)));
        for (const { name, map, dialect } of kitMusicXml())
            expect(readFileSync(path.join(FIXTURES, name), "utf8"), name).toBe(
                toMusicXml(map, dialect),
            );
    });
});

describe("tempo kit MusicXML", () => {
    it.each(kitMusicXml().map((x) => [x.name, x] as const))(
        "%s is well-formed",
        (_, { map, dialect }) => {
            const doc = new DOMParser().parseFromString(
                toMusicXml(map, dialect),
                "application/xml",
            );
            expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
        },
    );

    it("MuseScore style writes decimal sound tempos and dotted beat units", () => {
        const xml = toMusicXml(scoreMap(), "musescore");
        expect(xml).toContain('<sound tempo="127.5"/>');
        expect(xml).toContain(
            "<beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>85</per-minute>",
        );
        expect(xml).toContain('<measure number="0" implicit="yes">');
        expect(toMusicXml(corpsMap, "musescore")).toContain(
            "<beats>7</beats><beat-type>8</beat-type>",
        );
    });

    it("Sibelius style has no sound tempos, text marks, compound meters and a numberless modulation", () => {
        const xml = toMusicXml(scoreMap(), "sibelius");
        expect(xml).not.toContain("<sound");
        expect(xml).toContain("<per-minute>c. 132</per-minute>");
        expect(xml).toContain('<words font-style="italic">rit.</words>');
        expect(xml).toContain('<words font-style="italic">a tempo</words>');
        const corps = toMusicXml(corpsMap, "sibelius");
        expect(corps).toContain("<beats>2+2+3</beats>");
        expect(corps).toContain("<beats>3+2</beats>");
        expect(corps).toContain(
            "<beat-unit>quarter</beat-unit><beat-unit-dot/><beat-unit>quarter</beat-unit></metronome>",
        );
    });

    it("v1 prints the ♩=138 typo at F and v2 fixes it", () => {
        expect(toMusicXml(scoreMap({ fTempo: 138 }), "musescore")).toContain(
            '<sound tempo="138"/>',
        );
        expect(toMusicXml(scoreMap(), "musescore")).not.toContain("138");
    });
});

describe("tempo kit scorer", () => {
    const truth = buildTruth(steadyMap);

    it("scores the truth against itself as zero", () => {
        const r = scoreShow(syncedShow(truth), truth);
        expect(r.counts.maxMs).toBeLessThan(1e-6);
        expect(r.pageStarts.n).toBe(truth.pages.length);
        expect(r.measureMismatches).toEqual([]);
        expect(r.markMismatches).toEqual([]);
    });

    it("reports an audio offset error on every count, in ms and counts", () => {
        // The music starts 1.6 s in; an offset of -1.5 puts every count 100 ms early
        const show = { ...syncedShow(truth), audioOffsetSeconds: -1.5 };
        const r = scoreShow(show, truth);
        expect(r.counts.maxMs).toBeCloseTo(100, 6);
        expect(r.counts.medianMs).toBeCloseTo(100, 6);
        expect(r.counts.meanSignedMs).toBeCloseTo(-100, 6);
        expect(r.counts.maxCounts).toBeCloseTo(0.1 / (60 / 138), 6);
    });

    it("finds a drift that grows, and a missing measure and a renamed mark", () => {
        const show = syncedShow(truth);
        show.durations = show.durations.map(() => 0.5);
        show.measures = show.measures
            .filter((m) => m.firstCount !== at(truth, 2).index)
            .map((m) => (m.mark === "C" ? { ...m, mark: "X" } : m));
        const r = scoreShow(show, truth, { worst: 3 });
        expect(r.counts.maxMs).toBeGreaterThan(1000);
        expect(r.worstCounts).toHaveLength(3);
        expect(r.measureMismatches[0]).toContain("m2 (count 5)");
        expect(r.markMismatches).toEqual([
            'm41: the show has "X", the score "C"',
        ]);
        // m3 onwards is now called one number lower
        expect(r.measureMismatches.some((m) => m.includes("calls it m2"))).toBe(
            true,
        );
    });

    it("compares only the counts both have when the show has fewer", () => {
        const show = syncedShow(truth);
        show.durations = show.durations.slice(0, 100);
        const r = scoreShow(show, truth);
        expect(r.showCounts).toBe(100);
        expect(r.counts.n).toBe(100);
        expect(r.counts.maxMs).toBeLessThan(1e-6);
    });
});
