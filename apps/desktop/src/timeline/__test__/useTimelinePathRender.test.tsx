import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createResolver } from "@openmarch/core";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import type { MarcherVisualMap } from "@/hooks/queries";
import { GOLDEN_FIXTURES } from "../fixtures/goldenFixtures";
import { useTimelineResolverStore } from "../timelineStore";
import { pathsIntoPage } from "../timelinePaths";
import {
    useTimelinePathRender,
    type PathRenderPage,
} from "../useTimelinePathRender";
import { useTimelineStepSizes } from "../useTimelineStepSizes";

/**
 * The hooks that put the resolver's paths on the canvas and in the inspector
 * (docs/timeline/phases/07-page-parity.md P7.10).
 */

const fieldProperties =
    FieldPropertiesTemplates.HIGH_SCHOOL_FOOTBALL_FIELD_WITH_END_ZONES;

/** G8 (an arc over beats 0 to 8) split into pages 1 to 3, ending at beats 0, 4 and 8 */
const PAGES: PathRenderPage[] = [
    { id: 1, counts: 0, beats: [], previousPageId: null, nextPageId: 2 },
    {
        id: 2,
        counts: 4,
        beats: [{ index: 3 }],
        previousPageId: 1,
        nextPageId: 3,
    },
    {
        id: 3,
        counts: 4,
        beats: [{ index: 7 }],
        previousPageId: 2,
        nextPageId: null,
    },
];

const stubCanvas = () =>
    ({
        renderTimelinePathVisuals: vi.fn(),
        removeTimelinePathways: vi.fn(),
        sendCanvasMarchersToFront: vi.fn(),
        requestRenderAll: vi.fn(),
    }) as unknown as OpenMarchCanvas & {
        renderTimelinePathVisuals: ReturnType<typeof vi.fn>;
        removeTimelinePathways: ReturnType<typeof vi.fn>;
    };

const resolver = () =>
    createResolver(GOLDEN_FIXTURES.find((g) => g.name === "G8")!.build().show);

afterEach(() => {
    useTimelineResolverStore.setState({
        status: "off",
        resolver: null,
        version: 0,
        error: null,
    });
});

const MARCHER_IDS = [1];
const VISUALS = {} as MarcherVisualMap;

const props = (
    canvas: OpenMarchCanvas,
    enabled: boolean,
    selectedPage: PathRenderPage = PAGES[1]!,
) => ({
    canvas,
    enabled,
    selectedPage,
    pages: PAGES,
    marcherIds: MARCHER_IDS,
    marcherVisuals: VISUALS,
    fieldProperties,
    previousPathsEnabled: true,
    nextPathsEnabled: true,
    stepSizeWarningsEnabled: true,
});

describe("useTimelinePathRender", () => {
    it("draws the moves into and out of the selected page from the resolver", () => {
        const r = resolver();
        useTimelineResolverStore.setState({
            status: "ready",
            resolver: r,
            version: 1,
        });
        const canvas = stubCanvas();
        renderHook(() => useTimelinePathRender(props(canvas, true)));

        expect(canvas.renderTimelinePathVisuals).toHaveBeenCalledTimes(1);
        const args = canvas.renderTimelinePathVisuals.mock.calls[0]![0];
        expect(args.previousPaths).toEqual(
            pathsIntoPage(r, [1], PAGES[1], PAGES[0]),
        );
        expect(args.nextPaths).toEqual(
            pathsIntoPage(r, [1], PAGES[2], PAGES[1]),
        );
        expect(args.currentPageCounts).toBe(4);
        expect(args.nextPageCounts).toBe(4);
        expect(canvas.removeTimelinePathways).not.toHaveBeenCalled();
    });

    it("redraws when the resolver's version changes", () => {
        useTimelineResolverStore.setState({
            status: "ready",
            resolver: resolver(),
            version: 1,
        });
        const canvas = stubCanvas();
        renderHook(() => useTimelinePathRender(props(canvas, true)));
        act(() => useTimelineResolverStore.setState({ version: 2 }));
        expect(canvas.renderTimelinePathVisuals).toHaveBeenCalledTimes(2);
    });

    it("removes the curved paths and draws nothing when disabled", () => {
        useTimelineResolverStore.setState({
            status: "ready",
            resolver: resolver(),
            version: 1,
        });
        const canvas = stubCanvas();
        const { rerender } = renderHook(
            ({ enabled }) => useTimelinePathRender(props(canvas, enabled)),
            { initialProps: { enabled: true } },
        );
        rerender({ enabled: false });
        expect(canvas.removeTimelinePathways).toHaveBeenCalledTimes(1);
        expect(canvas.renderTimelinePathVisuals).toHaveBeenCalledTimes(1);
    });
});

describe("useTimelineStepSizes", () => {
    it("is undefined when disabled, so page mode keeps its own", () => {
        useTimelineResolverStore.setState({
            status: "ready",
            resolver: resolver(),
            version: 1,
        });
        const { result } = renderHook(() =>
            useTimelineStepSizes({
                enabled: false,
                marcherIds: [1],
                page: PAGES[1],
                previousPage: PAGES[0],
                fieldProperties,
            }),
        );
        expect(result.current).toEqual({
            stepSize: undefined,
            minMax: undefined,
        });
    });

    it("gives one marcher's step size from the resolver", () => {
        useTimelineResolverStore.setState({
            status: "ready",
            resolver: resolver(),
            version: 1,
        });
        const { result } = renderHook(() =>
            useTimelineStepSizes({
                enabled: true,
                marcherIds: [1],
                page: PAGES[1],
                previousPage: PAGES[0],
                fieldProperties,
            }),
        );
        expect(result.current.stepSize?.marcher_id).toBe(1);
        expect(
            Number.isFinite(result.current.stepSize!.stepsPerFiveYards),
        ).toBe(true);
        expect(result.current.minMax).toBeUndefined();
    });

    it("has nothing on the first page", () => {
        useTimelineResolverStore.setState({
            status: "ready",
            resolver: resolver(),
            version: 1,
        });
        const { result } = renderHook(() =>
            useTimelineStepSizes({
                enabled: true,
                marcherIds: [1],
                page: PAGES[0],
                previousPage: null,
                fieldProperties,
            }),
        );
        expect(result.current.stepSize).toBeUndefined();
    });
});
