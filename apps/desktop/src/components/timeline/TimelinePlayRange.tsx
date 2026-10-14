import {
    memo,
    useRef,
    type KeyboardEvent as ReactKeyboardEvent,
    type PointerEvent as ReactPointerEvent,
} from "react";
import clsx from "clsx";
import { START_INK } from "./startFlagInk";
import { beatToX, TIMELINE_HEADROOM_HEIGHT } from "./TimelineGeometry";
import type {
    TimelinePlayRange as PlayRange,
    TimelineSeek,
} from "./TimelineViewModel";

/** Snaps a dragged end flag to the nearest snap beat within this many pixels */
const SNAP_PX = 8;
/** The end flag's pennant: a 12px triangle, its right side on the 2px stem */
const PENNANT = 12;

/**
 * What Play plays (UI-22): a bar along the ruler's top edge from the start flag to the **end
 * flag**, in the start flag's color, solid while looping and faint while not. The end flag is a
 * pennant pointing back at the start flag, with its own stem once the playhead isn't on it. Drag
 * it by the pennant or the stem (or focus the pennant and use the arrow keys), snapping to page
 * lines and downbeats (Alt turns snapping off); dragged past the start flag, the two swap
 * (`onLineDrag` with `line: "end"`, the store's flag drag). The start flag is dragged by its own
 * line (`TimelineSelectionRange`).
 */
export const TimelinePlayRange = memo(function TimelinePlayRange({
    range,
    beatCount,
    pixelsPerBeat,
    height,
    snapBeats = [],
    onLineDrag,
}: {
    /** In view beats */
    range: PlayRange;
    beatCount: number;
    pixelsPerBeat: number;
    /** The pinned overlay's height, which the end flag's stem spans */
    height: number;
    /** Page lines and downbeats the end flag snaps to */
    snapBeats?: readonly number[];
    /** The end flag's drag, as seeks with `line: "end"`; without it the flag is drawn only */
    onLineDrag?: TimelineSeek;
}) {
    const movable = !range.fixed && onLineDrag !== undefined;
    const drag = useRef<{
        pointerId: number;
        surface: Element;
        lastBeat: number | null;
    } | null>(null);
    const startX = Math.round(beatToX(range.startBeatIndex, pixelsPerBeat));
    const endX = Math.round(beatToX(range.endBeatIndex, pixelsPerBeat));
    const onPlayhead = range.endOnPlayhead;

    const bounded = (beat: number) => Math.min(beatCount, Math.max(beat, 0));
    const beatAt = (clientX: number, surface: Element, altKey: boolean) => {
        const raw =
            (clientX - surface.getBoundingClientRect().left) / pixelsPerBeat;
        if (!altKey) {
            let best: number | null = null;
            for (const beat of snapBeats)
                if (
                    Math.abs(beat - raw) * pixelsPerBeat <= SNAP_PX &&
                    (best === null ||
                        Math.abs(beat - raw) < Math.abs(best - raw))
                )
                    best = beat;
            if (best !== null) return bounded(best);
        }
        return bounded(Math.round(raw));
    };

    const handlers = movable
        ? {
              onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  const surface = event.currentTarget.closest(
                      "[data-testid=timeline-play-range]",
                  );
                  if (!surface) return;
                  drag.current = {
                      pointerId: event.pointerId,
                      surface,
                      lastBeat: null,
                  };
                  event.currentTarget.setPointerCapture?.(event.pointerId);
              },
              onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
                  const current = drag.current;
                  if (!current || current.pointerId !== event.pointerId) return;
                  const beat = beatAt(
                      event.clientX,
                      current.surface,
                      event.altKey,
                  );
                  if (beat === current.lastBeat) return;
                  // A press that hasn't left the flag's beat isn't a drag yet
                  if (current.lastBeat === null && beat === range.endBeatIndex)
                      return;
                  current.lastBeat = beat;
                  onLineDrag?.(beat, { gesture: "drag", line: "end" });
              },
              onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
                  const current = drag.current;
                  if (!current || current.pointerId !== event.pointerId) return;
                  drag.current = null;
                  event.currentTarget.releasePointerCapture?.(event.pointerId);
                  // A click leaves the end flag where it is
                  if (current.lastBeat === null) return;
                  onLineDrag?.(
                      beatAt(event.clientX, current.surface, event.altKey),
                      { gesture: "end", line: "end" },
                  );
              },
              onLostPointerCapture: () => {
                  const current = drag.current;
                  if (!current) return;
                  drag.current = null;
                  if (current.lastBeat !== null)
                      onLineDrag?.(range.endBeatIndex, {
                          gesture: "cancel",
                          line: "end",
                      });
              },
              onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
                  const delta =
                      event.key === "ArrowLeft"
                          ? -1
                          : event.key === "ArrowRight"
                            ? 1
                            : 0;
                  if (delta === 0) return;
                  event.preventDefault();
                  // The arrow moves the end flag, not the selected marchers
                  event.stopPropagation();
                  const target = bounded(range.endBeatIndex + delta);
                  if (target !== range.endBeatIndex)
                      onLineDrag?.(target, { gesture: "end", line: "end" });
              },
          }
        : {};
    const title = range.fixed
        ? "The isolated move's end"
        : "End flag: Play stops here, and Stop comes back here. Drag to move it";

    return (
        <div
            data-testid="timeline-play-range"
            className="pointer-events-none absolute inset-0"
        >
            {/* Square ends on the strip's top edge, as wide as the 2px lines at each end, so the
                bar, the flags' stems and the playhead's line meet flush (UI-20) */}
            <span
                data-testid="timeline-play-range-bar"
                data-looping={range.looping || undefined}
                aria-hidden="true"
                className={clsx(
                    "absolute top-0 z-40",
                    START_INK.bg,
                    range.looping ? "h-4" : "h-[2px] opacity-50",
                )}
                style={{
                    left: startX - 1,
                    width: Math.max(endX - startX, 2) + 2,
                }}
            />
            {/* Always mounted, so a drag that carries the flag onto or off the playhead keeps its
                pointer capture. Above the playhead (z-50): where the two meet, the end flag wins
                and the playhead is reached by clicking the timeline */}
            <span
                data-testid="timeline-end-stem"
                aria-hidden="true"
                {...handlers}
                onKeyDown={undefined}
                className={clsx(
                    "absolute top-0 z-[59] w-[16px] -translate-x-1/2 touch-none",
                    movable && "pointer-events-auto cursor-ew-resize",
                )}
                style={{ left: endX, height }}
            >
                {!onPlayhead && (
                    <span
                        className={clsx(
                            "pointer-events-none absolute top-0 left-1/2 w-[2px] -translate-x-1/2",
                            START_INK.bg,
                        )}
                        style={{ height }}
                    />
                )}
            </span>
            <svg
                width={PENNANT}
                height={PENNANT}
                viewBox="0 0 12 12"
                aria-hidden="true"
                className={clsx("absolute top-0 z-[59]", START_INK.text)}
                style={{ left: endX + 1 - PENNANT }}
            >
                {/* A filled right triangle on the strip's top edge, pointing back at the start
                    flag; its right side is the stem */}
                <path d="M12 0 L0 0 L12 12 Z" fill="currentColor" />
            </svg>
            <button
                type="button"
                data-testid="timeline-end-flag"
                data-timeline-interactive="true"
                aria-label={`End flag, beat ${range.endBeatIndex}`}
                title={title}
                disabled={!movable}
                {...handlers}
                className="focus-visible:ring-accent pointer-events-auto absolute top-0 z-[59] touch-none border-0 bg-transparent p-0 outline-hidden focus-visible:ring-2 enabled:cursor-ew-resize! disabled:pointer-events-none"
                style={{
                    left: endX + 1 - PENNANT,
                    width: PENNANT + 1,
                    height: TIMELINE_HEADROOM_HEIGHT,
                }}
            />
        </div>
    );
});
