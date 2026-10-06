import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Beat from "@/global/classes/Beat";
import type Page from "@/global/classes/Page";
import { Timeline, TimelineWaveformProvider } from "../Timeline";
import type {
    TimelineAppendCounts,
    TimelineMusicPastEnd,
} from "../TimelineViewModel";

/**
 * E1, a show as long as its music, on the timeline: **+ N counts** after the last page's flag,
 * the music past the last count drawn dimmed, and the note that offers extending the counts.
 */

afterEach(cleanup);

/** The zero-length beat 0, then `count` timed beats */
const appBeats = (count: number): Beat[] =>
    Array.from({ length: count + 1 }, (_, index) => ({
        id: index + 1,
        position: index,
        duration: index === 0 ? 0 : 0.5,
        includeInMeasure: true,
        notes: null,
        index,
        timestamp: index === 0 ? 0 : (index - 1) * 0.5,
    }));

const BEATS = appBeats(16);

const page = (id: number, name: string, beats: Beat[]): Page =>
    ({
        id,
        name,
        counts: id === 1 ? 0 : beats.length,
        notes: null,
        order: id - 1,
        nextPageId: id < 3 ? id + 1 : null,
        previousPageId: id === 1 ? null : id - 1,
        isSubset: false,
        duration: beats.length * 0.5,
        beats,
        measures: null,
        measureBeatToStartOn: null,
        measureBeatToEndOn: null,
        timestamp: beats[0]!.timestamp,
    }) as unknown as Page;
// Page "2" ends at the last count: its flag is at view beat 16
const PAGES = [
    page(1, "0", [BEATS[0]!]),
    page(2, "1", BEATS.slice(1, 9)),
    page(3, "2", BEATS.slice(9, 17)),
];

const PX = 16;

const show = ({
    positionBeat = 5,
    isPlaying = false,
    appendCounts,
    musicPastEnd,
    onAddPageFlag,
    pastEnd = 0,
}: {
    positionBeat?: number;
    isPlaying?: boolean;
    appendCounts?: TimelineAppendCounts;
    musicPastEnd?: TimelineMusicPastEnd;
    onAddPageFlag?: () => void;
    pastEnd?: number;
}) =>
    render(
        <TimelineWaveformProvider
            waveform={{
                peaksByBeat: Array.from({ length: 16 }, () => [0.5, 0.5]),
                peaksPastEnd: Array.from({ length: pastEnd }, () => [1, 1]),
            }}
        >
            <Timeline
                mode="expanded"
                beats={BEATS}
                pages={PAGES}
                measures={[]}
                timelines={[]}
                showTransport={false}
                pixelsPerBeat={PX}
                playback={{ positionBeat, isPlaying }}
                selection={null}
                onSelectionChange={vi.fn()}
                onAddPageFlag={onAddPageFlag}
                appendCounts={appendCounts}
                musicPastEnd={musicPastEnd}
            />
        </TimelineWaveformProvider>,
    );

const appendCounts = (onAppend = vi.fn()): TimelineAppendCounts => ({
    label: "16 counts",
    title: "Add a page of 16 counts after the last page",
    onAppend,
});

const pill = () => screen.queryByTestId("timeline-append-counts");

describe("+ N counts after the last page (E1)", () => {
    it("sits just after the last flag, says what it adds, and adds it", () => {
        const onAppend = vi.fn();
        show({ appendCounts: appendCounts(onAppend) });
        const button = screen.getByRole("button", {
            name: "Add a page of 16 counts after the last page",
        });
        expect(button.textContent).toContain("16 counts");
        expect(parseFloat(button.style.left)).toBe(16 * PX + 8);
        fireEvent.click(button);
        expect(onAppend).toHaveBeenCalledTimes(1);
    });

    it("moves past + at the playhead instead of hiding under it", () => {
        show({
            appendCounts: appendCounts(),
            onAddPageFlag: vi.fn(),
            positionBeat: 16,
        });
        const plus = screen.getByTestId("timeline-add-page-flag");
        expect(parseFloat(pill()!.style.left)).toBeGreaterThanOrEqual(
            parseFloat(plus.style.left) + 16,
        );
    });

    it("doesn't show while playing, or without the command", () => {
        show({ appendCounts: appendCounts(), isPlaying: true });
        expect(pill()).toBeNull();
        cleanup();
        show({});
        expect(pill()).toBeNull();
    });
});

describe("the music past the last count (E1)", () => {
    it("draws it dimmed after the last count, and leaves room for it", () => {
        show({ pastEnd: 30 });
        const lane = screen.getByTestId("timeline-waveform-past-end");
        const surface = screen.getByTestId("timeline-pointer-surface");
        // After home's box and the 16 counts
        expect(parseFloat(lane.style.left)).toBe(
            parseFloat(surface.style.left) + 16 * PX,
        );
        expect(parseFloat(lane.style.width)).toBe(30 * PX);
        // The music past the end can't be scrubbed: it has no counts yet
        expect(parseFloat(surface.style.width)).toBe(16 * PX);
        expect(
            parseFloat(surface.parentElement!.style.width),
        ).toBeGreaterThanOrEqual(46 * PX);
    });

    it("offers extending the counts, in words, while paused", () => {
        const onExtend = vi.fn();
        const musicPastEnd = {
            message: "Counts end at 0:08; the music runs to 0:23.",
            actionLabel: "Extend counts to the end",
            onExtend,
        };
        show({ pastEnd: 30, musicPastEnd });
        const note = screen.getByTestId("timeline-music-past-end");
        expect(note.textContent).toContain(musicPastEnd.message);
        expect(parseFloat(note.style.left)).toBeGreaterThan(16 * PX);
        fireEvent.click(
            screen.getByRole("button", { name: "Extend counts to the end" }),
        );
        expect(onExtend).toHaveBeenCalledTimes(1);
        cleanup();
        show({ pastEnd: 30, musicPastEnd, isPlaying: true });
        expect(screen.queryByTestId("timeline-music-past-end")).toBeNull();
    });
});
