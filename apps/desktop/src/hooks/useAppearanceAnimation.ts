import { useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import type CanvasMarcher from "@/global/classes/canvasObjects/CanvasMarcher";
import type { RgbaColor } from "@openmarch/core";
import { fieldPropertiesQueryOptions } from "@/hooks/queries";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import { getLivePlaybackPosition } from "@/components/timeline/audio/AudioPlayer";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { timeAtBeat } from "@/timeline/timeMap";
import { useMarcherAppearanceTimelines } from "./useMarcherAppearanceTimelines";
import { getAppearanceAtTime } from "@/services/appearance/get-appearance-at-time";
import type { MarcherAppearanceTimeline } from "@/services/appearance/type";

/**
 * Styles each canvas marcher with its appearance at `timeMs`, skipping a marcher already styled
 * with that stack (`applied`, a reference check). Renders once if anything changed.
 *
 * @returns how many marchers were re-styled
 */
export function applyAppearancesAt({
    canvas,
    timelines,
    timeMs,
    applied,
    labelColor,
}: {
    canvas: Pick<OpenMarchCanvas, "getCanvasMarchers" | "requestRenderAll">;
    timelines: ReadonlyMap<number, MarcherAppearanceTimeline>;
    timeMs: number;
    applied: WeakMap<CanvasMarcher, unknown>;
    labelColor?: RgbaColor;
}): number {
    let changed = 0;
    for (const canvasMarcher of canvas.getCanvasMarchers()) {
        const timeline = timelines.get(canvasMarcher.marcherObj.id);
        if (!timeline) continue;
        const stack = getAppearanceAtTime(timeline, timeMs);
        if (!stack || applied.get(canvasMarcher) === stack) continue;
        applied.set(canvasMarcher, stack);
        canvasMarcher.setAppearance(
            stack,
            { requestRenderAll: false },
            labelColor,
        );
        changed++;
    }
    if (changed > 0) canvas.requestRenderAll();
    return changed;
}

/**
 * Keeps every marcher's appearance (fill, outline, shape, visibility, label) on the canvas in step
 * with time in timeline mode (ported from `coordinates-v2`; docs/timeline/ui.md UI-9 No selected
 * page, P8.12). Appearance is per page, keyed by each page's flag (`dbToMarcherAppearanceTimelines`)
 * and sampled at the paused playhead, or at the live playback time while playing, so it changes
 * as playback crosses a flag. Replaces `Canvas.tsx`'s selected-page appearance sync in timeline
 * mode; page mode keeps that.
 *
 * Each canvas marcher is re-styled only when its sampled stack changes (a reference check), so the
 * per-frame cost while playing is one binary search per marcher.
 *
 * @param redrawKey anything whose change means the canvas marchers were re-created, such as the
 * marcher visuals; every marcher is re-styled then
 */
export function useAppearanceAnimation({
    canvas,
    enabled,
    isPlaying,
    redrawKey,
}: {
    canvas: OpenMarchCanvas | null;
    enabled: boolean;
    isPlaying: boolean;
    redrawKey?: unknown;
}): void {
    const timelines = useMarcherAppearanceTimelines(enabled);
    const { beats } = useTimingObjects();
    const playheadBeat = useTimelineSelectionStore((s) => s.playheadBeat);
    const { data: fieldProperties } = useQuery({
        ...fieldPropertiesQueryOptions(),
        enabled,
    });
    const labelColor = fieldProperties?.theme.defaultMarcher.label;
    /** The stack each canvas marcher was last styled with */
    const applied = useRef(new WeakMap<CanvasMarcher, unknown>());

    // New marchers, new appearances or a new label color: style everyone again
    useEffect(() => {
        applied.current = new WeakMap();
    }, [canvas, timelines, labelColor, redrawKey]);

    const applyAt = useCallback(
        (timeMs: number) => {
            if (canvas && timelines)
                applyAppearancesAt({
                    canvas,
                    timelines,
                    timeMs,
                    applied: applied.current,
                    labelColor,
                });
        },
        [canvas, timelines, labelColor],
    );

    // Paused: the playhead
    useEffect(() => {
        if (!enabled || isPlaying) return;
        applyAt(timeAtBeat(beats, playheadBeat) * 1000);
    }, [enabled, isPlaying, applyAt, beats, playheadBeat, redrawKey]);

    // Playing: the live position, each frame
    useEffect(() => {
        if (!enabled || !isPlaying) return;
        let frame = 0;
        const step = () => {
            applyAt(getLivePlaybackPosition() * 1000);
            frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return () => cancelAnimationFrame(frame);
    }, [enabled, isPlaying, applyAt]);
}
