import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import {
    DEFAULT_TIMELINE_HEIGHT,
    MIN_TIMELINE_HEIGHT,
    TIMELINE_SPLIT_KEY_STEP,
    clampTimelineHeight,
} from "./timelineSplit";

/**
 * The timeline pane with a draggable divider on top. It takes its height from the saved
 * setting, clamped against the workspace it sits in (its parent), and the canvas above takes
 * the rest. Drag, arrow keys, or double-click (reset) change it.
 */
export function TimelineSplitter({ children }: { children: ReactNode }) {
    const saved = useUiSettingsStore((s) => s.uiSettings.timelineHeight);
    const setTimelineHeight = useUiSettingsStore((s) => s.setTimelineHeight);
    const paneRef = useRef<HTMLDivElement>(null);
    const [available, setAvailable] = useState(Infinity);
    const [dragHeight, setDragHeight] = useState<number | null>(null);

    useEffect(() => {
        const parent = paneRef.current?.parentElement;
        if (!parent) return;
        const measure = () => setAvailable(parent.clientHeight);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(parent);
        return () => observer.disconnect();
    }, []);

    const height = clampTimelineHeight(dragHeight ?? saved, available);

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragHeight(height);
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
        const next =
            event.key === "ArrowUp"
                ? height + step
                : event.key === "ArrowDown"
                  ? height - step
                  : event.key === "Home"
                    ? DEFAULT_TIMELINE_HEIGHT
                    : null;
        if (next === null) return;
        event.preventDefault();
        setTimelineHeight(clampTimelineHeight(next, available));
    };

    return (
        <div
            ref={paneRef}
            className="flex min-h-0 shrink-0 flex-col"
            style={{ height }}
            data-testid="timeline-pane"
        >
            <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize timeline"
                aria-valuemin={MIN_TIMELINE_HEIGHT}
                aria-valuenow={height}
                tabIndex={0}
                data-testid="timeline-splitter"
                className="group -mt-6 flex h-8 shrink-0 cursor-row-resize touch-none items-center justify-center outline-none"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onDoubleClick={() => setTimelineHeight(DEFAULT_TIMELINE_HEIGHT)}
                onKeyDown={onKeyDown}
            >
                <div className="bg-stroke group-hover:bg-accent group-focus-visible:bg-accent h-2 w-48 rounded-full transition-colors" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
    );
}
