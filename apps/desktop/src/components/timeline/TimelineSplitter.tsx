import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import {
    MIN_TIMELINE_HEIGHT,
    TIMELINE_SPLIT_KEY_STEP,
    clampTimelineHeight,
    maxTimelineHeight,
} from "./timelineSplit";

/**
 * The timeline pane with a draggable divider on top. With no saved height the pane is as small as
 * it can be and still show every track. Once the divider moves, the pane keeps that height,
 * clamped to the workspace it sits in (its parent): taller than the tracks, the grid fills the
 * extra room; shorter, the tracks scroll. Drag, arrow keys, or double-click (back to fitted).
 */
export function TimelineSplitter({ children }: { children: ReactNode }) {
    const saved = useUiSettingsStore((s) => s.uiSettings.timelineHeight);
    const setTimelineHeight = useUiSettingsStore((s) => s.setTimelineHeight);
    const paneRef = useRef<HTMLDivElement>(null);
    const [available, setAvailable] = useState(Infinity);
    const [measured, setMeasured] = useState(MIN_TIMELINE_HEIGHT);
    const [dragHeight, setDragHeight] = useState<number | null>(null);

    useEffect(() => {
        const pane = paneRef.current;
        const parent = pane?.parentElement;
        if (!pane || !parent) return;
        const measure = () => {
            setAvailable(parent.clientHeight);
            setMeasured(pane.offsetHeight);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(parent);
        observer.observe(pane);
        return () => observer.disconnect();
    }, []);

    const chosen = dragHeight ?? saved;
    const height =
        chosen === null ? null : clampTimelineHeight(chosen, available);
    const shown = height ?? measured;

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragHeight(shown);
    };
    const onPointerMove = useCallback(
        (event: PointerEvent<HTMLDivElement>) => {
            if (dragHeight === null || !paneRef.current) return;
            // The pane's bottom edge stays put, so the divider follows the pointer
            const bottom = paneRef.current.getBoundingClientRect().bottom;
            setDragHeight(
                clampTimelineHeight(bottom - event.clientY, available),
            );
        },
        [available, dragHeight],
    );
    const onPointerUp = () => {
        if (dragHeight !== null) setTimelineHeight(dragHeight);
        setDragHeight(null);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey
            ? TIMELINE_SPLIT_KEY_STEP * 4
            : TIMELINE_SPLIT_KEY_STEP;
        if (event.key === "Home") {
            event.preventDefault();
            setTimelineHeight(null);
            return;
        }
        const next =
            event.key === "ArrowUp"
                ? shown + step
                : event.key === "ArrowDown"
                  ? shown - step
                  : null;
        if (next === null) return;
        event.preventDefault();
        setTimelineHeight(clampTimelineHeight(next, available));
    };

    return (
        <div
            ref={paneRef}
            className="flex min-h-0 shrink-0 flex-col"
            style={
                height === null
                    ? { maxHeight: maxTimelineHeight(available) }
                    : { height }
            }
            data-testid="timeline-pane"
        >
            <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize timeline"
                aria-valuemin={MIN_TIMELINE_HEIGHT}
                aria-valuenow={shown}
                tabIndex={0}
                data-testid="timeline-splitter"
                className="group -mt-6 flex h-8 shrink-0 cursor-row-resize touch-none items-center justify-center outline-none"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onDoubleClick={() => setTimelineHeight(null)}
                onKeyDown={onKeyDown}
            >
                <div className="bg-stroke group-hover:bg-accent group-focus-visible:bg-accent h-2 w-48 rounded-full transition-colors" />
            </div>
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </div>
    );
}
