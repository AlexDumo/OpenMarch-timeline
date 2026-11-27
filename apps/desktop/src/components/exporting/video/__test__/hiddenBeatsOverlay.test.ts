import { describe, expect, it } from "vitest";
import { fromDatabasePages } from "@/global/classes/Page";
import { calculateTimestamps } from "@/global/classes/Beat";
import type Beat from "@/global/classes/Beat";
import type Measure from "@/global/classes/Measure";
import type { DatabasePage } from "@/db-functions/page";
import { OverlayTimeline } from "../videoOverlay";

/**
 * Layout of the file in OpenMarch#1018: 2/4 at 92 bpm, beat 0 is the pre-show beat, and set 1
 * starts on beat 3, so beats 1-2 (measure 1) belong to no page.
 */
describe("video overlay with beats before set 1 (#1018)", () => {
    const beatDur = 60 / 92;
    const beats: Beat[] = calculateTimestamps(
        Array.from({ length: 60 }, (_, i) => ({
            id: i,
            position: i,
            duration: i === 0 ? 0 : beatDur,
            includeInMeasure: i > 0,
            notes: null,
            index: i,
            timestamp: 0,
        })) as unknown as Beat[],
    );
    const measures = Array.from({ length: 29 }, (_, m) => ({
        id: m,
        number: m + 1,
        startBeat: beats[1 + m * 2],
        beats: [beats[1 + m * 2], beats[2 + m * 2]],
        counts: 2,
        rehearsalMark: null,
        notes: null,
        duration: beatDur * 2,
        timestamp: beats[1 + m * 2].timestamp,
    })) as unknown as Measure[];
    const starts = [0, 3, 7, 23, 39];
    const dbPages = starts.map((p, i) => ({
        id: i,
        start_beat: p,
        is_subset: false,
        notes: null,
    })) as unknown as DatabasePage[];
    const pages = fromDatabasePages({
        databasePages: dbPages,
        allMeasures: measures,
        allBeats: beats,
        lastPageCounts: 16,
    });

    it("keeps page timestamps early by the hidden beats; the overlay must not rely on them", () => {
        // Documents the cause: page timestamps add up page durations from 0,
        // so they skip the two beats that belong to no page.
        expect(pages[1].timestamp).toBeCloseTo(0, 3);
        expect(pages[1].beats[0].timestamp).toBeCloseTo(2 * beatDur, 3);
    });

    it("ends the overlay clock on the last beat, not the running page total", () => {
        const last = pages[pages.length - 1];
        const lastBeat = last.beats[last.beats.length - 1];
        const state = new OverlayTimeline(pages, measures).getState(0);
        expect(state.totalSeconds).toBeCloseTo(
            lastBeat.timestamp + lastBeat.duration,
            3,
        );
    });

    it("every beat of set 1 and set 2 reads its own set and count", () => {
        const wrong: string[] = [];
        for (const page of pages.slice(1, 3)) {
            const tl = new OverlayTimeline(pages, measures);
            page.beats.forEach((b, i) => {
                const s = tl.getState(b.timestamp + 0.01);
                if (s.setName !== page.name || s.count !== i + 1)
                    wrong.push(
                        `t=${b.timestamp.toFixed(2)} want set ${page.name} count ${i + 1}, got set ${s.setName} count ${s.count}`,
                    );
            });
        }
        expect(wrong).toEqual([]);
    });
});
