/**
 * Record path (prototype): the command handlers, the transport's record button and the count shown
 * over the field while a take counts in or records. The take itself is `recordPathStore.ts`.
 */
import { useEffect } from "react";
import { toast } from "sonner";
import { T, useTranslate } from "@tolgee/react";
import { Button } from "@openmarch/ui";
import Shortcut from "@/components/ui/Shortcut";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { db } from "@/global/database/db";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useTimingObjects } from "@/hooks";
import { useActionHandler } from "@/shortcuts/useActionHandler";
import { runAction } from "@/shortcuts/registry";
import { TransportButton } from "@/components/timeline/TransportButtons";
import { activeFieldEditor } from "@/field/editor/activeFieldEditor";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { evenExactPathSpeed } from "@/db-functions/timelineExactPaths";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import tolgee from "@/global/singletons/Tolgee";
import { groupMoveAt } from "./pathTarget";
import {
    discardRecordPath,
    leaveRecordMode,
    toggleRecordPath,
    useRecordPathStore,
} from "./recordPathStore";

/** Typing in a field keeps its keys */
const typing = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement &&
    (target.isContentEditable ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT");

const noPlayback = () => {};

/** Record path and Make speed even, for the editor's action handlers */
export function useRecordPathActions(): void {
    const { countGrid } = useTimingObjects()!;
    const setIsPlaying = useIsPlaying()?.setIsPlaying ?? noPlayback;
    const phase = useRecordPathStore((s) => s.phase);
    useActionHandler("recordPath", () => {
        void toggleRecordPath({ countGrid, setIsPlaying });
    });
    useActionHandler("evenPathSpeed", () => void evenSpeed());
    // Record mode's keys, before anything else hears them: Space records a take (or ends one and
    // keeps it); Escape throws a take away, or leaves Record mode between takes
    useEffect(() => {
        if (phase === "idle" || phase === "saving") return;
        const onKey = (event: KeyboardEvent) => {
            if (typing(event.target)) return;
            const plain =
                !event.altKey &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.shiftKey;
            if (event.key === " " && plain) {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (!event.repeat)
                    void toggleRecordPath({ countGrid, setIsPlaying });
                return;
            }
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (phase === "armed") leaveRecordMode();
            else discardRecordPath();
        };
        window.addEventListener("keydown", onKey, { capture: true });
        return () =>
            window.removeEventListener("keydown", onKey, { capture: true });
    }, [phase, countGrid, setIsPlaying]);
}

async function evenSpeed(): Promise<void> {
    const ids = [...(activeFieldEditor()?.selected() ?? [])];
    if (ids.length === 0) return;
    const beat = useTimelineSelectionStore.getState().playheadBeat;
    let move = await groupMoveAt(db, ids, beat);
    if (move.kind !== "move") move = await groupMoveAt(db, ids, beat + 1e-6);
    const notRecorded = () =>
        toast.info(
            tolgee.t(
                "pathways.record.notRecorded",
                "No recorded path to even out here: record one first",
            ),
        );
    if (move.kind !== "move") {
        notRecorded();
        return;
    }
    try {
        const count = await evenExactPathSpeed({
            db,
            timelineId: move.timelineId,
            marcherIds: ids,
        });
        if (count === 0) notRecorded();
        else
            toast.success(
                tolgee.t("pathways.record.evened", { count } as never),
            );
    } catch (error) {
        toastTimelineError(error);
    }
}

/** The round record button beside Play */
export function RecordPathButton() {
    const { t } = useTranslate();
    const phase = useRecordPathStore((s) => s.phase);
    const on = phase === "countIn" || phase === "recording";
    const armed = phase === "armed";
    return (
        <TransportButton
            label={t(
                on
                    ? "pathways.record.stop"
                    : armed
                      ? "pathways.record.take"
                      : "pathways.record.button",
            )}
            shortcut="Alt + Shift + R"
            pressed={on || armed}
            testId="timeline-record-path"
            onClick={() => runAction("recordPath")}
        >
            <span
                aria-hidden
                className={
                    on
                        ? "bg-red block size-10 animate-pulse rounded-full"
                        : "bg-red block size-10 rounded-full opacity-80"
                }
            />
        </TransportButton>
    );
}

/**
 * Record mode's bar over the field (as Edit move's): what's armed, Record take and Done. While a
 * take counts in or records, the big count instead.
 */
export function RecordPathCounter() {
    const phase = useRecordPathStore((s) => s.phase);
    if (phase === "armed") return <RecordModeBar />;
    return <TakeCounter />;
}

function RecordModeBar() {
    const { t } = useTranslate();
    const moveLabel = useRecordPathStore((s) => s.moveLabel);
    const counts = useRecordPathStore((s) => s.counts);
    const count = useSelectedMarchers()?.selectedMarchers.length ?? 0;
    return (
        <div
            data-testid="record-mode-bar"
            data-field-layer="task"
            role="status"
            className="border-red bg-bg-1 text-text rounded-6 text-sub pointer-events-auto absolute top-[calc(var(--field-top-inset,0px)+8px)] left-1/2 z-20 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-12 border px-12 py-6 whitespace-nowrap shadow-md"
        >
            <span className="text-red flex items-center gap-6 font-medium">
                <span
                    aria-hidden
                    className="bg-red block size-8 rounded-full"
                />
                {t("pathways.record.ready")}
            </span>
            <span>
                {t("pathways.record.readyLine", {
                    move: moveLabel,
                    counts,
                    count,
                })}
            </span>
            <span className="text-text-subtitle truncate">
                {t("pathways.record.readyHint")}
            </span>
            <Button
                size="compact"
                variant="primary"
                onClick={() => runAction("recordPath")}
                data-testid="record-mode-take"
            >
                <T
                    keyName="pathways.record.takeKeys"
                    params={{ keys: () => <Shortcut binding="Space" /> }}
                />
            </Button>
            <Button
                size="compact"
                variant="secondary"
                onClick={() => leaveRecordMode()}
                data-testid="record-mode-done"
            >
                <T
                    keyName="pathways.record.done"
                    params={{ keys: () => <Shortcut binding="Escape" /> }}
                />
            </Button>
        </div>
    );
}

/** The big count over the field: 4 3 2 1 while counting in, then the count playing */
function TakeCounter() {
    const { t } = useTranslate();
    const { phase, countIn, count, counts } = useRecordPathStore();
    if (phase !== "countIn" && phase !== "recording") return null;
    return (
        <div
            className="pointer-events-none absolute top-12 left-80 z-20 flex"
            data-testid="record-path-counter"
        >
            <div className="bg-bg-1/90 border-stroke rounded-6 flex flex-col items-center border px-16 py-8 shadow-md">
                <div className="text-text text-h1 leading-none font-bold tabular-nums">
                    {phase === "countIn" ? countIn : count}
                </div>
                <div className="text-sub mt-4">
                    {phase === "countIn" ? (
                        t("pathways.record.countIn")
                    ) : (
                        <>
                            <span className="text-red font-medium">
                                ● {t("pathways.record.recording")}
                            </span>{" "}
                            · {t("pathways.record.countOf", { count, counts })}
                        </>
                    )}
                </div>
                <div className="text-text-subtitle text-sub mt-4">
                    {t("pathways.record.hint")}
                </div>
            </div>
        </div>
    );
}
