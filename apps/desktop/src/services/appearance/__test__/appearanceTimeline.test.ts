import { describe, expect, it, vi } from "vitest";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import type Marcher from "@/global/classes/Marcher";
import type { SectionAppearance, TagAppearance } from "@/db-functions";
import { dbToMarcherAppearanceTimelines } from "../db-to-timeline";
import { getAppearanceAtTime } from "../get-appearance-at-time";
import { applyAppearancesAt } from "@/hooks/useAppearanceAnimation";
import type CanvasMarcher from "@/global/classes/canvasObjects/CanvasMarcher";

/**
 * Appearance by time (ported from `coordinates-v2`; docs/timeline/ui.md UI-9 No selected page,
 * P8.12): each page's tag and section appearance takes effect at its flag and is sampled by time.
 */

const fieldProperties =
    FieldPropertiesTemplates.HIGH_SCHOOL_FOOTBALL_FIELD_WITH_END_ZONES;

const RED = { r: 200, g: 10, b: 20, a: 1 };
const BLUE = { r: 0, g: 0, b: 255, a: 1 };

const marchers = [
    { id: 1, section: "Trumpet" },
    { id: 2, section: "Flute" },
] as unknown as Marcher[];

/** Page 0 ends at 0 s, page 1 at 4 s, page 2 at 8 s, page 3 at 12 s */
const pages = [
    { id: 10, timestamp: 0, duration: 0 },
    { id: 11, timestamp: 0, duration: 4 },
    { id: 12, timestamp: 4, duration: 4 },
    { id: 13, timestamp: 8, duration: 4 },
];

const tagAppearance = (
    id: number,
    fill: typeof RED,
    priority = 1,
): TagAppearance =>
    ({
        id,
        tag_id: 100,
        start_page_id: 0,
        priority,
        fill_color: fill,
        outline_color: null,
        shape_type: null,
        visible: true,
        label_visible: true,
    }) as unknown as TagAppearance;

const section = {
    id: 1,
    section: "Flute",
    fill_color: BLUE,
    outline_color: null,
    shape_type: null,
    visible: true,
    label_visible: true,
} as unknown as SectionAppearance;

const build = () =>
    dbToMarcherAppearanceTimelines({
        pages,
        marchers,
        sectionAppearances: [section],
        // Marcher 1 has tag 100, red on pages 2 and 3 only
        marcherIdsByTagId: new Map([[100, [1]]]),
        tagAppearances: [tagAppearance(7, RED)],
        tagAppearanceIdsByPageId: new Map([
            [10, new Set<number>()],
            [11, new Set<number>()],
            [12, new Set([7])],
            [13, new Set([7])],
        ]),
        fieldProperties,
    });

const fillAt = (marcherId: number, timeMs: number) =>
    getAppearanceAtTime(build().get(marcherId)!, timeMs)!.find(
        (a) => a.fill_color != null,
    )!.fill_color;

describe("dbToMarcherAppearanceTimelines", () => {
    it("keys each page's appearance by its flag, and keeps only changes", () => {
        const timelines = build();
        expect(timelines.get(1)!.timestamps).toEqual([0, 8000]);
        // The section appearance never changes: one keyframe
        expect(timelines.get(2)!.timestamps).toEqual([0]);
    });

    it("leaves out per-marcher-page overrides (P7.14)", () => {
        for (const timeline of build().values())
            for (const stack of timeline.stacks)
                expect(stack.some((a) => "marcher_id" in a)).toBe(false);
    });
});

describe("getAppearanceAtTime", () => {
    it("changes at a flag and holds until the next change", () => {
        const theme = fieldProperties.theme.defaultMarcher.fill;
        expect(fillAt(1, 0)).toEqual(theme);
        expect(fillAt(1, 7999)).toEqual(theme);
        // On page 2's flag, and on through page 3
        expect(fillAt(1, 8000)).toEqual(RED);
        expect(fillAt(1, 11000)).toEqual(RED);
        expect(fillAt(1, 99999)).toEqual(RED);
        expect(fillAt(2, 5000)).toEqual(BLUE);
    });

    it("counts a time a float error short of a flag as on it", () => {
        expect(fillAt(1, 8000 - 1e-7)).toEqual(RED);
    });

    it("uses the first appearance before the first flag, and returns the same stack for one keyframe", () => {
        const timeline = build().get(1)!;
        expect(getAppearanceAtTime(timeline, -50)).toBe(timeline.stacks[0]);
        expect(getAppearanceAtTime(timeline, 9000)).toBe(
            getAppearanceAtTime(timeline, 10000),
        );
        expect(getAppearanceAtTime({ timestamps: [], stacks: [] }, 0)).toBe(
            null,
        );
    });
});

describe("applyAppearancesAt (the canvas side)", () => {
    const stubCanvas = () => {
        const canvasMarchers = marchers.map((marcherObj) => ({
            marcherObj,
            setAppearance: vi.fn(),
        }));
        return {
            canvasMarchers,
            canvas: {
                getCanvasMarchers: () =>
                    canvasMarchers as unknown as CanvasMarcher[],
                requestRenderAll: vi.fn(),
            },
        };
    };

    it("styles each marcher at the time, and again only when its appearance changes", () => {
        const { canvas, canvasMarchers } = stubCanvas();
        const timelines = build();
        const applied = new WeakMap<CanvasMarcher, unknown>();
        const at = (timeMs: number) =>
            applyAppearancesAt({ canvas, timelines, timeMs, applied });

        expect(at(4000)).toBe(2);
        expect(canvas.requestRenderAll).toHaveBeenCalledTimes(1);
        // Nothing changes before page 2's flag: no restyle, no render
        expect(at(6000)).toBe(0);
        expect(canvas.requestRenderAll).toHaveBeenCalledTimes(1);
        // Crossing the flag (as playback does) restyles only marcher 1
        expect(at(8000)).toBe(1);
        expect(canvasMarchers[0]!.setAppearance).toHaveBeenLastCalledWith(
            timelines.get(1)!.stacks[1],
            { requestRenderAll: false },
            undefined,
        );
        expect(canvasMarchers[1]!.setAppearance).toHaveBeenCalledTimes(1);
    });
});
