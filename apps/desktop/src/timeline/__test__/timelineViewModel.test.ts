import { describe, expect, it } from "vitest";
import { createResolver, type TimelineSnapshot } from "@openmarch/core";
import type Beat from "@/global/classes/Beat";
import type Page from "@/global/classes/Page";
import {
    createTimelineViewModel,
    type TimelineInput,
} from "@/components/timeline/Timeline";
import { validateTimelineViewModel } from "@/components/timeline/TimelineGeometry";
import { GOLDEN_FIXTURES } from "../fixtures/goldenFixtures";
import { resolverSpans } from "../timelineStore";
import {
    buildTimelineClipTracks,
    createTimelineBeatAxis,
    timelineInputToView,
    timelineTrackId,
    type TimelineViewTables,
} from "../timelineViewModel";

/**
 * The view-model adapter (docs/timeline/phases/08-authoring-ui.md P8.8, ui.md "Mapping the spec
 * onto the view model") on the golden vectors (spec §12.4): one track per stored timeline (ui.md
 * UI-9 "Tracks"). The fixtures put every transition on one timeline; `timelines` splits them to
 * show steals across timelines (UI-1).
 */

const golden = (name: string): TimelineSnapshot => {
    const fixture = GOLDEN_FIXTURES.find((f) => f.name === name);
    if (!fixture) throw new Error(`no golden fixture ${name}`);
    return fixture.build().show;
};

/** The tables for `show`, with each timeline holding the listed transitions (default: one). */
const tablesOf = (
    show: TimelineSnapshot,
    timelines: Record<number, number[]> = {
        1: Object.keys(show.transitions).map(Number),
    },
): TimelineViewTables => {
    const timelineOf = new Map<number, number>();
    for (const [id, transitions] of Object.entries(timelines))
        for (const t of transitions) timelineOf.set(t, Number(id));
    const transitions = Object.values(show.transitions);
    return {
        timelines: Object.entries(timelines).map(([id, ids]) => {
            const own = transitions.filter((t) => ids.includes(t.id));
            return {
                id: Number(id),
                name: `Timeline ${id}`,
                start: Math.min(...own.map((t) => t.start)),
                end: Math.max(...own.map((t) => t.end)),
            };
        }),
        transitions: transitions.map((t) => ({
            id: t.id,
            timelineId: timelineOf.get(t.id)!,
            destShapeId: t.dest,
            slotCount: t.slots,
            start: t.start,
            end: t.end,
        })),
        assignments: show.assignments,
        shapes: Object.keys(show.shapes).map((id) => ({
            id: Number(id),
            name: `S${id}`,
        })),
        marchers: show.marchers.map((m) => ({ id: m.id, label: `M${m.id}` })),
    };
};

const build = (
    show: TimelineSnapshot,
    timelines?: Record<number, number[]>,
) => {
    const resolver = createResolver(show);
    return buildTimelineClipTracks({
        tables: tablesOf(show, timelines),
        spansOf: (m) => resolverSpans(resolver, m),
        diagnostics: resolver.diagnostics(),
    });
};

const track = (tracks: TimelineInput[], id: string) => {
    const found = tracks.find((t) => t.id === id);
    if (!found)
        throw new Error(
            `no track ${id}; have ${tracks.map((t) => t.id).join(", ")}`,
        );
    return found;
};

/** Activity as `[start, end, active]` triples */
const activity = (t: TimelineInput) =>
    t.activitySpans.map((s) => [s.startBeatIndex, s.endBeatIndex, s.active]);

/** Legs as `[start, end, texture]` triples */
const legs = (t: TimelineInput) =>
    t.legs.map((l) => [l.startBeatIndex, l.endBeatIndex, l.texture]);

const codes = (t: TimelineInput) =>
    (t.diagnostics?.messages ?? []).map((m) => m.split(":")[0]);

/** A show's beats as the app has them: the zero-length beat 0, then `count` timed beats */
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

/** The view model the timeline would draw, on the app's beat axis */
const viewModelOf = (tracks: TimelineInput[], beatCount: number) => {
    const beats = appBeats(beatCount);
    const axis = createTimelineBeatAxis(beats);
    return createTimelineViewModel({
        beats,
        pages: [],
        measures: [],
        timelines: tracks,
        waveform: {
            peaksByBeat: Array.from({ length: axis.beatCount }, () => []),
        },
    });
};

describe("buildTimelineClipTracks (UI-9 Tracks)", () => {
    it("draws one track per stored timeline, its clip the timeline's range, in start order", () => {
        const tracks = build(golden("G3"), { 2: [2], 1: [1], 3: [3] });
        expect(
            tracks.map((t) => [t.id, t.startBeatIndex, t.endBeatIndex]),
        ).toEqual([
            [timelineTrackId(1), 0, 16],
            [timelineTrackId(2), 4, 12],
            [timelineTrackId(3), 6, 10],
        ]);
        for (const t of tracks) {
            expect(t.linkId).toBe(t.targetId);
            expect(legs(t)).toEqual([
                [t.startBeatIndex, t.endBeatIndex, "move"],
            ]);
        }
        // One color per timeline
        expect(new Set(tracks.map((t) => t.color)).size).toBe(3);
    });

    it("is inactive where every member is stolen by another timeline (UI-1, UI-4)", () => {
        // G3 (spec R-2's worked example): T2 steals [4, 12) from T1, and T3 steals [6, 10) from T2
        const tracks = build(golden("G3"), { 1: [1], 2: [2], 3: [3] });
        expect(activity(track(tracks, timelineTrackId(1)))).toEqual([
            [0, 4, true],
            [4, 12, false],
            [12, 16, true],
        ]);
        expect(activity(track(tracks, timelineTrackId(2)))).toEqual([
            [4, 6, true],
            [6, 10, false],
            [10, 12, true],
        ]);
        expect(activity(track(tracks, timelineTrackId(3)))).toEqual([
            [6, 10, true],
        ]);
    });

    it("shows a stored timeline with nobody in it, inactive throughout", () => {
        const show = golden("G1");
        const tables = tablesOf(show);
        const tracks = buildTimelineClipTracks({
            tables: {
                ...tables,
                timelines: [
                    ...tables.timelines,
                    { id: 9, name: null, start: 20, end: 24 },
                ],
            },
            spansOf: () => [],
            diagnostics: [],
        });
        const empty = track(tracks, timelineTrackId(9));
        expect(empty.label).toBe("Timeline 9");
        expect(activity(empty)).toEqual([[20, 24, false]]);
    });

    it("badges a timeline with every diagnostic of its transitions (§8.9)", () => {
        const tracks = build(golden("G9"));
        expect(tracks).toHaveLength(1);
        expect(tracks[0]!.diagnostics?.level).toBe("warning");
        expect(codes(tracks[0]!)).toContain("D-VACANT");
        for (const t of build(golden("G1")))
            expect(t.diagnostics).toBeUndefined();
    });

    it("every golden fixture's tracks pass the view model's validator", () => {
        for (const fixture of GOLDEN_FIXTURES) {
            const show = fixture.build().show;
            const tracks = build(show);
            expect(tracks.length, fixture.name).toBeGreaterThan(0);
            const end = Math.max(
                ...Object.values(show.transitions).map((t) => t.end),
            );
            // Beats [0, 1) are hidden on the view axis; a fixture's clips from beat 0 keep the rest
            expect(
                validateTimelineViewModel(viewModelOf(tracks, end)),
                fixture.name,
            ).toEqual([]);
        }
    });
});

describe("resolverSpans", () => {
    it("walks a marcher's spans through explain: spec R-2's worked example (G3)", () => {
        const resolver = createResolver(golden("G3"));
        expect(
            resolverSpans(resolver, 1).map((s) => [
                s.start,
                s.end,
                s.kind,
                s.transitionId,
            ]),
        ).toEqual([
            [-Infinity, 0, "hold", null],
            [0, 4, "founding", 1],
            [4, 6, "founding", 2],
            [6, 10, "founding", 3],
            [10, 12, "resume", 2],
            [12, 16, "resume", 1],
            [16, Infinity, "hold", null],
        ]);
    });

    it("is empty for a marcher the resolver doesn't have", () => {
        expect(resolverSpans(createResolver(golden("G1")), 99)).toEqual([]);
    });
});

describe("the view beat axis (beat 0)", () => {
    it("hides the zero-length beat 0: view beat v is spec beat v + 1", () => {
        const axis = createTimelineBeatAxis(appBeats(8));
        expect(axis.offset).toBe(1);
        expect(axis.beatCount).toBe(8);
        expect(axis.toView(1)).toBe(0);
        expect(axis.toView(0)).toBe(0);
        expect(axis.toView(0.5)).toBe(0);
        expect(axis.toView(9)).toBe(8);
        expect(axis.toSpec(0)).toBe(1);
    });

    it("maps beats one to one when there is no zero-length beat 0", () => {
        const axis = createTimelineBeatAxis([
            { duration: 0.5 },
            { duration: 0.5 },
        ]);
        expect(axis.offset).toBe(0);
        expect(axis.beatCount).toBe(2);
        expect(axis.toView(1)).toBe(1);
    });

    it("drops what falls inside beat 0 and merges the activity around it", () => {
        const axis = createTimelineBeatAxis(appBeats(8));
        const view = timelineInputToView(
            {
                id: "t",
                targetId: 1,
                targetType: "marcher",
                label: "M1",
                color: "#000",
                startBeatIndex: 0,
                endBeatIndex: 6,
                legs: [
                    {
                        id: "a",
                        startBeatIndex: 0,
                        endBeatIndex: 1,
                        texture: "move",
                    },
                    {
                        id: "b",
                        startBeatIndex: 1,
                        endBeatIndex: 6,
                        texture: "move",
                    },
                ],
                activitySpans: [
                    { startBeatIndex: 0, endBeatIndex: 1, active: false },
                    { startBeatIndex: 1, endBeatIndex: 6, active: true },
                ],
            },
            axis,
        );
        expect(view?.legs.map((l) => l.id)).toEqual(["b"]);
        expect(view?.activitySpans).toEqual([
            { startBeatIndex: 0, endBeatIndex: 5, active: true },
        ]);
    });

    it("a track entirely inside beat 0 is dropped", () => {
        const axis = createTimelineBeatAxis(appBeats(4));
        expect(
            timelineInputToView(
                {
                    id: "t",
                    targetId: 1,
                    targetType: "marcher",
                    label: "M1",
                    color: "#000",
                    startBeatIndex: 0,
                    endBeatIndex: 1,
                    legs: [
                        {
                            id: "a",
                            startBeatIndex: 0,
                            endBeatIndex: 1,
                            texture: "move",
                        },
                    ],
                    activitySpans: [
                        { startBeatIndex: 0, endBeatIndex: 1, active: true },
                    ],
                },
                axis,
            ),
        ).toBeNull();
    });

    it("puts the first timed page at view beat 0, with the initial page before it", () => {
        const beats = appBeats(8);
        const page = (
            id: number,
            name: string,
            pageBeats: Beat[],
            previousPageId: number | null,
            counts: number,
        ) =>
            ({
                id,
                name,
                beats: pageBeats,
                previousPageId,
                counts,
            }) as unknown as Page;
        const model = createTimelineViewModel({
            beats,
            pages: [
                page(1, "1", [beats[0]!], null, 0),
                page(2, "2", beats.slice(1, 5), 1, 4),
                page(3, "3", beats.slice(5, 9), 2, 4),
            ],
            measures: [],
            timelines: [],
            waveform: { peaksByBeat: Array.from({ length: 8 }, () => []) },
        });
        expect(model.beatCount).toBe(8);
        expect(
            model.pages.map((p) => [p.label, p.atBeat, p.isInitial]),
        ).toEqual([
            ["1", 0, true],
            ["2", 0, false],
            ["3", 4, false],
        ]);
        expect(validateTimelineViewModel(model)).toEqual([]);
    });
});
