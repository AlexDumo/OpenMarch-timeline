import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { TrashIcon, UsersThreeIcon } from "@phosphor-icons/react";
import clsx from "clsx";
import { Button, Input } from "@openmarch/ui";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { db } from "@/global/database/db";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import { MOVE_NAME_MAX_LENGTH, moveLabel } from "@/timeline/timelineViewModel";
import { isolatedTimelineName } from "@/components/timeline/TimelineIsolationBar";
import { useMoveCommands } from "@/components/timeline/useTimelineCommands";
import { useMoveCardRevealStore } from "@/stores/MoveCardRevealStore";
import type {
    PageBox,
    StoredTimelineMembership,
} from "@/stores/TimelineSelectionStore";
import type { InspectorTranslate } from "./TimelineInspectorSection";
import { Field, Help } from "./TimelineTransitionEditor";

/**
 * The stored timeline the inspector's Move card is about (ui.md UI-14): the one the edit window
 * resolves to, when it has a clip, that is when no page box has its range (UI-10). A page
 * timeline gets no card: pages are moved with their flags.
 */
export function moveCardTimeline(
    selected: StoredTimelineMembership | null,
    pageBoxes: readonly PageBox[],
): StoredTimelineMembership | null {
    if (!selected) return null;
    const onPageBox = pageBoxes.some(
        (box) => box.start === selected.start && box.end === selected.end,
    );
    return onPageBox ? null : selected;
}

/** How long **Edit move**'s highlight stays on the card */
const REVEAL_FLASH_MS = 1200;

/** How long the card waits for the inspector to lay out before scrolling to it */
const REVEAL_SCROLL_DELAY_MS = 120;

/**
 * The Move card (UI-14), first in the timeline section while the window is a move with a clip: its
 * name (Enter or leaving the field saves, Esc goes back; empty clears it), when it happens in
 * pages and counts, who is in it with **Select them**, and **Delete move**. **Edit move** brings
 * it into view with a brief highlight (`useMoveCardRevealStore`), once the section has opened.
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
    const commit = () => {
        if (name.trim() === stored.trim()) {
            setName(stored);
            return;
        }
        moves.renameMove(timeline.id, name);
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
                    placeholder={moveLabel({ id: timeline.id })}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        else if (e.key === "Escape") {
                            // Back to the stored name, then leave without saving
                            e.stopPropagation();
                            setName(stored);
                            const input = e.currentTarget;
                            requestAnimationFrame(() => input.blur());
                        }
                    }}
                />
            </Field>
            <Field label={t("inspector.timeline.move.counts")}>
                <p className="text-sub" data-testid="timeline-move-card-range">
                    {isolatedTimelineName(timeline, pages)}
                </p>
            </Field>
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
                    onClick={() => moves.deleteMove(timeline.id)}
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
