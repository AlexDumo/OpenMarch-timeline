import {
    useEffect,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type PointerEvent as ReactPointerEvent,
} from "react";
import clsx from "clsx";
import { tolgeeTranslate as t } from "@/timeline/drillEditText";
import {
    beatToX,
    clamp,
    getPageRange,
    isPageSnapDisabled,
} from "./TimelineGeometry";
import { TIMELINE_RANGE_DRAG_PX } from "./TimelinePrimitives";
import type {
    TimelineMeasureMarker,
    TimelinePageMarker,
} from "./TimelineViewModel";

/**
 * Page flag handles (tempo experiment E10, Tempo lab `drillChoices`): a grip on each page's flag
 * in the ruler. Dragging it moves the flag to another count and carries the drill with it: moves
 * that land on the flag follow, so "page 23 two counts longer" takes them from page 24 and the
 * show keeps its counts. A plain drag on the ruler still scrubs (UI-10); only the grip moves a
 * flag, as only the start flag's pennant moves the start flag. While dragging, a readout says
 * what changes ("Pg 23: 16 → 18 counts · Pg 24: 16 → 14") and, once the pointer rests, what
 * happens to the drill. One drag is one edit. ←/→ on a focused grip move it a count.
 * Downbeats within 6px pull the flag to them; Alt turns that off.
 */

/** What dragging a flag to a beat does, in the commands' view beats */
export interface TimelinePageFlagMove {
    /** Moves `pageId`'s flag to view beat `toBeat` (one edit) */
    readonly onMove: (pageId: string | number, toBeat: number) => void;
    /** What it would do to the drill, for the readout; null when it can't tell */
    readonly preview?: (
        pageId: string | number,
        toBeat: number,
    ) => Promise<TimelinePageFlagPreview | null>;
}

export interface TimelinePageFlagPreview {
    /** False when the drill refuses the move */
    readonly ok: boolean;
    readonly text: string;
}

/** The page whose flag it is, the page after it, and the beats the flag may go to */
export function flagMoveBounds({
    pages,
    pageId,
    beatCount,
}: {
    pages: readonly TimelinePageMarker[];
    pageId: string | number;
    beatCount: number;
}) {
    const ordered = pages
        .filter((p) => !p.isInitial)
        .sort((a, b) => a.atBeat - b.atBeat);
    const index = ordered.findIndex((p) => p.id === pageId);
    const page = ordered[index];
    const range = getPageRange({ pages: ordered, pageId, beatCount });
    if (!page || !range) return null;
    const next = ordered[index + 1];
    const nextRange = next
        ? getPageRange({ pages: ordered, pageId: next.id, beatCount })
        : null;
    return {
        page,
        range,
        next: next && nextRange ? { page: next, range: nextRange } : null,
        min: range.startBeatIndex + 1,
        max: nextRange ? nextRange.endBeatIndex - 1 : beatCount,
    };
}

/** "Pg 23: 16 → 18 counts · Pg 24: 16 → 14", for the flag of `pageId` moved to `toBeat` */
export function flagMoveReadout({
    pages,
    pageId,
    toBeat,
    beatCount,
}: {
    pages: readonly TimelinePageMarker[];
    pageId: string | number;
    toBeat: number;
    beatCount: number;
}): string {
    const bounds = flagMoveBounds({ pages, pageId, beatCount });
    if (!bounds) return "";
    const { page, range, next } = bounds;
    const from = range.endBeatIndex - range.startBeatIndex;
    const to = toBeat - range.startBeatIndex;
    const own = t(
        "timeline.drillEdits.flag.readoutPage",
        "Pg {page}: {from} → {to} counts",
        { page: page.label, from, to },
    );
    if (!next) return own;
    return t(
        "timeline.drillEdits.flag.readoutBoth",
        "{own} · Pg {page}: {from} → {to}",
        {
            own,
            page: next.page.label,
            from: next.range.endBeatIndex - next.range.startBeatIndex,
            to: next.range.endBeatIndex - toBeat,
        },
    );
}

const SNAP_PX = 6;

export function TimelinePageFlagHandles({
    pages,
    measures,
    beatCount,
    pixelsPerBeat,
    move,
}: {
    pages: readonly TimelinePageMarker[];
    measures: readonly TimelineMeasureMarker[];
    beatCount: number;
    pixelsPerBeat: number;
    move: TimelinePageFlagMove;
}) {
    const [drag, setDrag] = useState<{
        pageId: string | number;
        toBeat: number;
    } | null>(null);
    const [preview, setPreview] = useState<TimelinePageFlagPreview | null>(
        null,
    );
    const dragRef = useRef<{
        pageId: string | number;
        pointerId: number;
        surface: HTMLElement;
        startClientX: number;
        moved: boolean;
        fromBeat: number;
        toBeat: number;
    } | null>(null);

    // Once the pointer rests, ask what the move would do to the drill
    useEffect(() => {
        setPreview(null);
        if (!drag || !move.preview) return;
        let stale = false;
        const timer = setTimeout(() => {
            void move.preview?.(drag.pageId, drag.toBeat).then((result) => {
                if (!stale) setPreview(result);
            });
        }, 180);
        return () => {
            stale = true;
            clearTimeout(timer);
        };
    }, [drag, move]);

    const ordered = pages
        .filter((p) => !p.isInitial)
        .sort((a, b) => a.atBeat - b.atBeat);
    const downbeats = measures.map((m) => m.atBeat);

    const beatAt = (
        clientX: number,
        surface: HTMLElement,
        bounds: { min: number; max: number },
        snap: boolean,
    ) => {
        const raw =
            (clientX - surface.getBoundingClientRect().left) / pixelsPerBeat;
        let beat = Math.round(raw);
        if (snap) {
            const near = downbeats
                .filter((d) => Math.abs(d - raw) * pixelsPerBeat <= SNAP_PX)
                .sort((a, b) => Math.abs(a - raw) - Math.abs(b - raw))[0];
            if (near !== undefined) beat = near;
        }
        return clamp(beat, bounds.min, bounds.max);
    };

    const end = (commit: boolean) => {
        const current = dragRef.current;
        dragRef.current = null;
        setDrag(null);
        if (
            commit &&
            current &&
            current.moved &&
            current.toBeat !== current.fromBeat
        )
            move.onMove(current.pageId, current.toBeat);
    };

    return (
        <>
            {ordered.map((page) => {
                const bounds = flagMoveBounds({
                    pages,
                    pageId: page.id,
                    beatCount,
                });
                if (!bounds) return null;
                const flag = bounds.range.endBeatIndex;
                const dragging = drag?.pageId === page.id;
                const shown = dragging ? drag.toBeat : flag;
                const label = t(
                    "timeline.drillEdits.flag.handle",
                    "Page {page} flag. Drag to move it: moves that land on it follow, and Page {page} takes counts from the next page or gives them to it.",
                    { page: page.label },
                );
                return (
                    <button
                        key={page.id}
                        type="button"
                        data-timeline-interactive="true"
                        data-testid="timeline-page-flag-handle"
                        data-page-id={String(page.id)}
                        aria-label={label}
                        title={label}
                        onPointerDown={(
                            event: ReactPointerEvent<HTMLButtonElement>,
                        ) => {
                            if (event.button !== 0) return;
                            event.stopPropagation();
                            event.preventDefault();
                            const surface = event.currentTarget.parentElement;
                            if (!surface) return;
                            dragRef.current = {
                                pageId: page.id,
                                pointerId: event.pointerId,
                                surface,
                                startClientX: event.clientX,
                                moved: false,
                                fromBeat: flag,
                                toBeat: flag,
                            };
                            event.currentTarget.setPointerCapture?.(
                                event.pointerId,
                            );
                        }}
                        onPointerMove={(event) => {
                            const current = dragRef.current;
                            if (
                                !current ||
                                current.pointerId !== event.pointerId ||
                                current.pageId !== page.id
                            )
                                return;
                            if (
                                !current.moved &&
                                Math.abs(event.clientX - current.startClientX) <
                                    TIMELINE_RANGE_DRAG_PX
                            )
                                return;
                            current.moved = true;
                            const toBeat = beatAt(
                                event.clientX,
                                current.surface,
                                bounds,
                                !isPageSnapDisabled(event),
                            );
                            if (toBeat === current.toBeat && drag) return;
                            current.toBeat = toBeat;
                            setDrag({ pageId: page.id, toBeat });
                        }}
                        onPointerUp={(event) => {
                            event.currentTarget.releasePointerCapture?.(
                                event.pointerId,
                            );
                            end(true);
                        }}
                        onPointerCancel={() => end(false)}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event: ReactKeyboardEvent) => {
                            if (event.key === "Escape" && dragRef.current) {
                                event.preventDefault();
                                end(false);
                                return;
                            }
                            const delta =
                                event.key === "ArrowLeft"
                                    ? -1
                                    : event.key === "ArrowRight"
                                      ? 1
                                      : 0;
                            if (delta === 0) return;
                            event.preventDefault();
                            event.stopPropagation();
                            const toBeat = clamp(
                                flag + delta,
                                bounds.min,
                                bounds.max,
                            );
                            if (toBeat !== flag) move.onMove(page.id, toBeat);
                        }}
                        className={clsx(
                            // The ruler's lower half: the start pennant (z-55) has the upper half, and the
                            // playhead (z-50) keeps the lanes below
                            "group focus-visible:ring-accent absolute top-[15px] z-[55] flex h-[13px] w-[11px] -translate-x-1/2 cursor-ew-resize items-end justify-center outline-hidden focus-visible:ring-2",
                        )}
                        style={{ left: beatToX(shown, pixelsPerBeat) }}
                    >
                        {/* The grip: a short tab on the flag line, standing on the ruler's bottom edge */}
                        <span
                            aria-hidden="true"
                            className={clsx(
                                "rounded-t-4 h-[10px] w-[5px] transition-colors",
                                dragging
                                    ? "bg-accent"
                                    : "bg-text/45 group-hover:bg-accent group-focus-visible:bg-accent",
                            )}
                        />
                    </button>
                );
            })}
            {drag && (
                <>
                    <span
                        aria-hidden="true"
                        data-testid="timeline-page-flag-ghost"
                        className="bg-accent pointer-events-none absolute top-0 z-[54] w-[2px]"
                        style={{
                            left: beatToX(drag.toBeat, pixelsPerBeat) - 1,
                            height: "100%",
                        }}
                    />
                    <div
                        role="status"
                        data-testid="timeline-page-flag-readout"
                        className="border-stroke bg-modal text-text rounded-6 shadow-modal pointer-events-none absolute top-32 z-[70] flex max-w-[360px] flex-col gap-2 border px-8 py-4 text-[11px] whitespace-nowrap"
                        style={{
                            left: beatToX(drag.toBeat, pixelsPerBeat) + 8,
                        }}
                    >
                        <span className="font-mono">
                            {flagMoveReadout({
                                pages,
                                pageId: drag.pageId,
                                toBeat: drag.toBeat,
                                beatCount,
                            })}
                        </span>
                        {preview && (
                            <span
                                className={clsx(
                                    "whitespace-normal",
                                    preview.ok
                                        ? "text-text-subtitle"
                                        : "text-red",
                                )}
                            >
                                {preview.text}
                            </span>
                        )}
                    </div>
                </>
            )}
        </>
    );
}
