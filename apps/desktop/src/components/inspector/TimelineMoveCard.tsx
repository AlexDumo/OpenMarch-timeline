import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
    ArrowLineRightIcon,
    TrashIcon,
    UsersThreeIcon,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { Button, Input, ToggleGroup, ToggleGroupItem } from "@openmarch/ui";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { db } from "@/global/database/db";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import { MOVE_NAME_MAX_LENGTH, moveLabels } from "@/timeline/timelineViewModel";
import { useTimelineViewVersions } from "@/timeline/useTimelineViewVersions";
import { DEFAULT_BULGE, clampBulge } from "@/timeline/timelineTransitionEditor";
import {
    readMovePath,
    setMovePath,
    type MovePath,
    type MovePathStyle,
} from "@/db-functions/timelineCommands";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import { isolatedTimelineName } from "@/components/timeline/TimelineIsolationBar";
import { useMoveCommands } from "@/components/timeline/useTimelineCommands";
import { useMoveCardRevealStore } from "@/stores/MoveCardRevealStore";
import {
    useTimelineSelectionStore,
    type PageBox,
    type StoredTimelineMembership,
} from "@/stores/TimelineSelectionStore";
import type { InspectorTranslate } from "./TimelineInspectorSection";
import { BulgeEditor, Field, Help } from "./TimelineTransitionEditor";

/**
 * The stored timeline the inspector's Move card is about (ui.md UI-14): the one the edit window
 * resolves to, when it has a clip, that is when no page box has its range (UI-10). A page
 * timeline gets no card: pages are moved with their flags.
 */
export function moveCardTimeline(
    selected: StoredTimelineMembership | null,
    pageBoxes: readonly PageBox[],
): StoredTimelineMembership | null {
    // Isolated (Edit move, a double-click), the window is the start to P, wherever P is inside
    // it; the caller passes the isolated timeline then
    if (!selected) return null;
    const onPageBox = pageBoxes.some(
        (box) => box.start === selected.start && box.end === selected.end,
    );
    return onPageBox ? null : selected;
}

const MOVE_PATH_STYLES: readonly MovePathStyle[] = ["direct", "arc"];

/**
 * A move's path, read again after every timeline edit, undo and redo; `null` until first read.
 */
function useMovePath(timelineId: number): MovePath | null {
    const { version, displayVersion } = useTimelineViewVersions();
    const [path, setPath] = useState<MovePath | null>(null);
    useEffect(() => {
        let current = true;
        readMovePath(db, timelineId).then(
            (read) => {
                if (current) setPath(read);
            },
            (error: unknown) =>
                console.error("Couldn't read the move's path", error),
        );
        return () => {
            current = false;
        };
    }, [timelineId, version, displayVersion]);
    return path;
}

/** How long **Edit move**'s highlight stays on the card */
const REVEAL_FLASH_MS = 1200;

/** How long the card waits for the inspector to lay out before scrolling to it */
const REVEAL_SCROLL_DELAY_MS = 120;

/**
 * The Move card (UI-14), first in the timeline section while the window is a move with a clip: its
 * name (Enter or leaving the field saves, Esc goes back; empty clears it), when it happens in
 * pages and counts, its **Path** for every marcher in it at once (Direct, or Arc with one bend;
 * "Mixed" when they differ), how to change where they end up, who is in it with **Select them**,
 * and **Delete move**. **Edit move** brings it into view with a brief highlight
 * (`useMoveCardRevealStore`), once the section has opened.
 */
export function TimelineMoveCard({
    timeline,
    t,
}: {
    timeline: StoredTimelineMembership;
    t: InspectorTranslate;
}) {
    const moves = useMoveCommands(db);
    const pages = useTimingObjects()?.pages ?? [];
    const isPlaying = useIsPlaying()?.isPlaying ?? false;
    const stored = timeline.name ?? "";
    const [name, setName] = useState(stored);
    // The stored name changed (a rename here or on the clip, an undo): show it
    useEffect(() => setName(stored), [stored, timeline.id]);
    // "Move 2": the label it has while unnamed
    const defaultLabel = useTimelineSelectionStore(
        (s) =>
            moveLabels(
                (s.storedTimelines ?? []).map((t) => ({ ...t, name: null })),
                s.pageBoxes,
            ).get(timeline.id) ?? "Move",
    );
    const playheadBeat = useTimelineSelectionStore((s) => s.playheadBeat);
    const path = useMovePath(timeline.id);
    const [pathPending, setPathPending] = useState(false);
    const editPath = (style: MovePathStyle, bulge?: number) => {
        setPathPending(true);
        setMovePath({ db, timelineId: timeline.id, style, bulge })
            .catch((error: unknown) => toastTimelineError(error))
            .finally(() => setPathPending(false));
    };
    const commit = () => {
        if (name.trim() === stored.trim()) {
            setName(stored);
            return;
        }
        void moves.renameMove(timeline.id, name);
    };

    const ref = useRef<HTMLElement>(null);
    const [flash, setFlash] = useState(false);
    // Each **Edit move** request for this card, taken once
    const [reveals, setReveals] = useState(0);
    const pending = useMoveCardRevealStore((s) => s.pending);
    useEffect(() => {
        if (pending !== timeline.id) return;
        useMoveCardRevealStore.getState().clear();
        setReveals((n) => n + 1);
    }, [pending, timeline.id]);
    useEffect(() => {
        if (reveals === 0) return;
        setFlash(true);
        // Once the section has opened and the selection's editors have laid out above it
        const scroll = setTimeout(
            () =>
                ref.current?.scrollIntoView?.({
                    block: "start",
                    behavior: "smooth",
                }),
            REVEAL_SCROLL_DELAY_MS,
        );
        const timeout = setTimeout(() => setFlash(false), REVEAL_FLASH_MS);
        return () => {
            clearTimeout(scroll);
            clearTimeout(timeout);
        };
    }, [reveals]);

    const count = timeline.marcherIds.size;
    return (
        <section
            ref={ref}
            data-testid="timeline-move-card"
            data-flash={flash || undefined}
            aria-label={t("inspector.timeline.move.title")}
            className={clsx(
                "rounded-6 border-stroke flex flex-col gap-12 border p-12 transition-shadow duration-300",
                flash && "ring-accent ring-2",
            )}
        >
            <h5 className="text-body font-medium">
                {t("inspector.timeline.move.title")}
            </h5>
            <Field label={t("inspector.timeline.move.name")}>
                <Input
                    compact
                    data-testid="timeline-move-card-name"
                    aria-label={t("inspector.timeline.move.name")}
                    maxLength={MOVE_NAME_MAX_LENGTH}
                    placeholder={defaultLabel}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                        // Its keys are its own: blurring first would hand Enter to the app's
                        // Enter shortcut (create a shape)
                        if (e.key === "Enter") {
                            e.preventDefault();
                            e.stopPropagation();
                            e.currentTarget.blur();
                        } else if (e.key === "Escape") {
                            // Back to the stored name, then leave without saving
                            e.stopPropagation();
                            setName(stored);
                            const input = e.currentTarget;
                            requestAnimationFrame(() => input.blur());
                        }
                    }}
                />
                {name.length >= MOVE_NAME_MAX_LENGTH && (
                    <Help testId="timeline-move-card-name-limit">
                        {t("inspector.timeline.move.nameLimit", {
                            max: MOVE_NAME_MAX_LENGTH,
                        })}
                    </Help>
                )}
            </Field>
            <Field label={t("inspector.timeline.move.counts")}>
                <p className="text-sub" data-testid="timeline-move-card-range">
                    {isolatedTimelineName(timeline, pages)}
                </p>
            </Field>
            <Field label={t("inspector.timeline.move.path")}>
                <div className="flex items-center gap-8">
                    <ToggleGroup
                        type="single"
                        data-testid="timeline-move-card-path"
                        aria-label={t("inspector.timeline.move.path")}
                        value={
                            path?.style === "direct" || path?.style === "arc"
                                ? path.style
                                : ""
                        }
                        disabled={pathPending || !path?.transitions}
                        onValueChange={(value: string) => {
                            if (value) editPath(value as MovePathStyle);
                        }}
                    >
                        {MOVE_PATH_STYLES.map((style) => (
                            <ToggleGroupItem
                                key={style}
                                value={style}
                                className="text-sub px-8"
                            >
                                {t(`inspector.timeline.pathStyle.${style}`)}
                            </ToggleGroupItem>
                        ))}
                    </ToggleGroup>
                    {path !== null &&
                        path.style !== "direct" &&
                        path.style !== "arc" &&
                        path.transitions > 0 && (
                            <span
                                className="text-sub text-text/60"
                                data-testid="timeline-move-card-path-mixed"
                            >
                                {t("inspector.timeline.move.pathMixed")}
                            </span>
                        )}
                </div>
            </Field>
            {path?.style === "arc" && (
                <BulgeEditor
                    bulge={path.bulge ?? DEFAULT_BULGE}
                    disabled={pathPending}
                    t={t}
                    onCommit={(value) => {
                        const bulge = clampBulge(value);
                        if (bulge !== null) editPath("arc", bulge);
                    }}
                />
            )}
            <div className="flex flex-col gap-6">
                <Help testId="timeline-move-card-end-help">
                    {t("inspector.timeline.move.endHelp")}
                </Help>
                {playheadBeat !== timeline.end && (
                    <Button
                        size="compact"
                        variant="secondary"
                        className="w-fit"
                        data-testid="timeline-move-card-go-to-end"
                        disabled={isPlaying}
                        onClick={() =>
                            useTimelineSelectionStore
                                .getState()
                                .seek(timeline.end)
                        }
                    >
                        <ArrowLineRightIcon size={16} />
                        {t("inspector.timeline.move.goToEnd")}
                    </Button>
                )}
            </div>
            <div className="flex items-center justify-between gap-8">
                <p className="text-sub" data-testid="timeline-move-card-count">
                    {t("inspector.timeline.move.marchers", { count })}
                </p>
                <Button
                    size="compact"
                    variant="secondary"
                    disabled={count === 0}
                    onClick={() => void moves.selectMarchers(timeline.id)}
                >
                    <UsersThreeIcon size={16} />
                    {t("inspector.timeline.move.selectMarchers")}
                </Button>
            </div>
            <div className="flex flex-col gap-6">
                <Button
                    size="compact"
                    variant="secondary"
                    className="text-red w-fit"
                    data-testid="timeline-move-card-delete"
                    disabled={isPlaying}
                    onClick={() => void moves.deleteMove(timeline.id)}
                >
                    <TrashIcon size={16} />
                    {t("inspector.timeline.move.delete")}
                </Button>
                {isPlaying && (
                    <Help>{t("inspector.timeline.move.paused")}</Help>
                )}
            </div>
        </section>
    );
}
