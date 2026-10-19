import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createResolver, type Resolver } from "@openmarch/core";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import { GOLDEN_FIXTURES } from "@/timeline/fixtures/goldenFixtures";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import {
    DEFAULT_START_FLAG_POSITIONS,
    type StartFlagPositionsSettings,
} from "@/timeline/startFlagLevels";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { useStartFlagKeyStore } from "@/stores/StartFlagKeyStore";
import { useWorkspaceViewStore } from "@/stores/WorkspaceViewStore";
import { useEditorModeStore } from "@/stores/EditorModeStore";
import { planStartFlagOverlay } from "../startFlagOverlay";
import { useStartFlagOverlay } from "../three/useStartFlagOverlay";

/**
 * Start flag positions on the field (fork #331, #336): the plans for the edit window [S, P), at
 * the levels in effect, hidden where the spec hides them, and sampled no more than needed.
 */

const fieldProperties =
    FieldPropertiesTemplates.HIGH_SCHOOL_FOOTBALL_FIELD_WITH_END_ZONES;

/** G6: four marchers on a line at beat 4, following the leader to beat 12 */
const g6 = (): Resolver =>
    createResolver(GOLDEN_FIXTURES.find((g) => g.name === "G6")!.build().show);
const MARCHERS = [1, 2, 3, 4];

/** The resolver, counting how often it is asked where a marcher is */
function counted(resolver: Resolver) {
    const calls = { count: 0 };
    const proxy = new Proxy(resolver, {
        get(target, key, receiver) {
            const value = Reflect.get(target, key, receiver);
            if (typeof value !== "function") return value;
            return (...args: unknown[]) => {
                calls.count++;
                return (value as (...a: unknown[]) => unknown).apply(
                    target,
                    args,
                );
            };
        },
    });
    return { resolver: proxy, calls };
}

function ready(resolver: Resolver = g6(), version = 1) {
    useTimelineResolverStore.setState({ status: "ready", resolver, version });
    return resolver;
}

const setWindow = (start: number, end: number) =>
    useTimelineSelectionStore.setState({
        selection: { kind: "range", start, end },
        startBeat: start,
        playheadBeat: end,
        isolation: null,
    });

const setLevels = (settings: StartFlagPositionsSettings) =>
    useUiSettingsStore.getState().setStartFlagPositions(settings);

type Props = Parameters<typeof useStartFlagOverlay>[0];
const props = (overrides: Partial<Props> = {}): Props => ({
    enabled: true,
    isPlaying: false,
    marcherIds: MARCHERS,
    selectedIds: [],
    fieldProperties,
    ...overrides,
});

const expected = (
    resolver: Resolver,
    levels: StartFlagPositionsSettings["always"],
    selectedIds: number[] = [],
    stepSizeWarnings = false,
) =>
    planStartFlagOverlay({
        resolver,
        marcherIds: MARCHERS,
        selectedIds: new Set(selectedIds),
        fromBeat: 4,
        toBeat: 12,
        levels,
        stepSizeWarnings,
        fieldProperties,
    });

beforeEach(() => {
    setWindow(4, 12);
    setLevels({
        always: { dots: "all", paths: "all" },
        hold: { dots: "selected", paths: "off" },
    });
    useUiSettingsStore.getState().setUiSettings({
        ...useUiSettingsStore.getState().uiSettings,
        stepSizeWarnings: false,
    });
    useStartFlagKeyStore.setState({
        held: false,
        latched: false,
        pressedAt: null,
    });
    useWorkspaceViewStore.setState({ view: "editor" });
    useEditorModeStore.setState({ mode: "expert" });
});

afterEach(() => {
    useTimelineResolverStore.setState({
        status: "off",
        resolver: null,
        version: 0,
        error: null,
    });
    setLevels(DEFAULT_START_FLAG_POSITIONS);
});

describe("useStartFlagOverlay", () => {
    it("draws the window from the start flag to the playhead at the Always levels", () => {
        const r = ready();
        const { result } = renderHook(() => useStartFlagOverlay(props()));
        const plan = result.current!;
        expect(plan).toEqual(expected(r, { dots: "all", paths: "all" }));
        expect(plan.dots.dots).toHaveLength(4);
        expect(plan.paths.strokes.length).toBeGreaterThan(0);
    });

    it("draws the Hold N levels while N is held or latched, for the selected marchers", () => {
        const r = ready();
        const { result, rerender } = renderHook(
            (p: Props) => useStartFlagOverlay(p),
            { initialProps: props({ selectedIds: [2, 3] }) },
        );
        act(() => {
            useStartFlagKeyStore.getState().press();
        });
        expect(result.current).toEqual(
            expected(r, { dots: "selected", paths: "off" }, [2, 3]),
        );
        expect(result.current!.dots.dots).toHaveLength(2);
        expect(result.current!.paths.strokes).toEqual([]);
        // The dots follow the selection
        rerender(props({ selectedIds: [4] }));
        expect(result.current!.dots.dots).toHaveLength(1);
        // Nothing selected: nothing drawn
        rerender(props({ selectedIds: [] }));
        expect(result.current!.dots.dots).toEqual([]);
        act(() => {
            useStartFlagKeyStore.getState().release();
        });
        // A tap latches: still the Hold N levels
        expect(result.current!.paths.strokes).toEqual([]);
        act(() => {
            useStartFlagKeyStore.getState().toggleLatched();
        });
        expect(result.current).toEqual(
            expected(r, { dots: "all", paths: "all" }),
        );
    });

    it("draws nothing when the levels in effect are off, at home, isolating, or in Visuals", () => {
        const { resolver, calls } = counted(g6());
        ready(resolver);
        setLevels({
            always: { dots: "off", paths: "off" },
            hold: { dots: "all", paths: "all" },
        });
        const { result } = renderHook(() => useStartFlagOverlay(props()));
        expect(result.current).toBeNull();
        // Off costs nothing
        expect(calls.count).toBe(0);

        act(() => {
            useStartFlagKeyStore.getState().toggleLatched();
        });
        expect(result.current!.dots.dots).toHaveLength(4);

        act(() => {
            useTimelineSelectionStore.setState({ selection: { kind: "home" } });
        });
        expect(result.current).toBeNull();
        act(() => {
            setWindow(4, 12);
        });
        expect(result.current).not.toBeNull();

        act(() => {
            useTimelineSelectionStore.setState({
                isolation: {} as never,
            });
        });
        expect(result.current).toBeNull();
        act(() => {
            useTimelineSelectionStore.setState({ isolation: null });
        });

        act(() => {
            useWorkspaceViewStore.setState({ view: "visuals" });
        });
        expect(result.current).toBeNull();
        act(() => {
            useWorkspaceViewStore.setState({ view: "editor" });
        });
        expect(result.current).not.toBeNull();
    });

    it("follows the start flag and the playhead, and the resolver's edits", () => {
        const r = ready();
        const { result } = renderHook(() => useStartFlagOverlay(props()));
        act(() => {
            setWindow(8, 12);
        });
        expect(result.current).toEqual(
            planStartFlagOverlay({
                resolver: r,
                marcherIds: MARCHERS,
                selectedIds: new Set(),
                fromBeat: 8,
                toBeat: 12,
                levels: { dots: "all", paths: "all" },
                stepSizeWarnings: false,
                fieldProperties,
            }),
        );
        // An edit (a drop) is a new resolver version: the paths are sampled again
        act(() => {
            setWindow(4, 12);
        });
        const before = result.current;
        const { resolver, calls } = counted(r);
        act(() => {
            ready(resolver, 2);
        });
        expect(calls.count).toBeGreaterThan(0);
        expect(result.current).toEqual(before);
    });

    it("draws the step-size warnings only when they're on", () => {
        const r = ready();
        const { result } = renderHook(() => useStartFlagOverlay(props()));
        act(() => {
            useUiSettingsStore.getState().setUiSettings({
                ...useUiSettingsStore.getState().uiSettings,
                stepSizeWarnings: true,
            });
        });
        expect(result.current).toEqual(
            expected(r, { dots: "all", paths: "all" }, [], true),
        );
    });

    it("keeps the plans from before Play while playing, and doesn't sample", () => {
        const { resolver, calls } = counted(g6());
        ready(resolver);
        const { result, rerender } = renderHook(
            (p: Props) => useStartFlagOverlay(p),
            { initialProps: props() },
        );
        const before = result.current;
        calls.count = 0;
        rerender(props({ isPlaying: true }));
        expect(result.current).toBe(before);
        // Selection and the N key change nothing drawn while playing
        rerender(props({ isPlaying: true, selectedIds: [1] }));
        act(() => {
            useStartFlagKeyStore.getState().toggleLatched();
        });
        expect(result.current).toBe(before);
        expect(calls.count).toBe(0);
        // Stopping where it was needs no sampling either
        act(() => {
            useStartFlagKeyStore.getState().toggleLatched();
        });
        rerender(props());
        expect(result.current).toEqual(before);
        expect(calls.count).toBe(0);
    });

    it("doesn't sample again for selection or level changes over marchers already sampled", () => {
        const { resolver, calls } = counted(g6());
        ready(resolver);
        const { result, rerender } = renderHook(
            (p: Props) => useStartFlagOverlay(p),
            { initialProps: props() },
        );
        const all = result.current;
        calls.count = 0;
        // Hold N (selected dots) and back to Always (all dots and paths)
        rerender(props({ selectedIds: [1, 2] }));
        act(() => {
            useStartFlagKeyStore.getState().toggleLatched();
        });
        expect(result.current!.dots.dots).toHaveLength(2);
        rerender(props({ selectedIds: [3] }));
        act(() => {
            useStartFlagKeyStore.getState().toggleLatched();
        });
        expect(result.current).toEqual(all);
        // Only the dot-only samples for the selected marchers were new
        const dotOnly = calls.count;
        rerender(props({ selectedIds: [1, 2] }));
        act(() => {
            useStartFlagKeyStore.getState().toggleLatched();
        });
        rerender(props({ selectedIds: [3] }));
        act(() => {
            useStartFlagKeyStore.getState().toggleLatched();
        });
        expect(calls.count).toBe(dotOnly);
    });
});
