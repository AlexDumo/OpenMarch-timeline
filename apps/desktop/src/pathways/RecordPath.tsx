/**
 * Record path (prototype): the command handlers, the transport's record button and the count shown
 * over the field while a take counts in or records. The take itself is `recordPathStore.ts`.
 */
import { useEffect } from "react";
import { toast } from "sonner";
import { useTranslate } from "@tolgee/react";
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
    toggleRecordPath,
    useRecordPathStore,
} from "./recordPathStore";

/** Record path and Make speed even, for the editor's action handlers */
export function useRecordPathActions(): void {
    const { countGrid } = useTimingObjects()!;
    const setIsPlaying = useIsPlaying()?.setIsPlaying ?? (() => {});
    const phase = useRecordPathStore((s) => s.phase);
    useActionHandler("recordPath", () => {
        void toggleRecordPath({ countGrid, setIsPlaying });
    });
    useActionHandler("evenPathSpeed", () => void evenSpeed());
    // Escape throws the take away, before anything else hears it
    useEffect(() => {
        if (phase !== "countIn" && phase !== "recording") return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopImmediatePropagation();
            discardRecordPath();
        };
        window.addEventListener("keydown", onKey, { capture: true });
        return () =>
            window.removeEventListener("keydown", onKey, { capture: true });
    }, [phase]);
}

async function evenSpeed(): Promise<void> {
    const ids = [...(activeFieldEditor()?.selected() ?? [])];
    if (ids.length === 0) return;
    const beat = useTimelineSelectionStore.getState().playheadBeat;
    let move = await groupMoveAt(db, ids, beat + 1e-6);
    if (move.kind !== "move") move = await groupMoveAt(db, ids, beat);
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
    return (
        <TransportButton
            label={t(on ? "pathways.record.stop" : "pathways.record.button")}
            shortcut="Alt + Shift + R"
            pressed={on}
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

/** The big count over the field: 4 3 2 1 while counting in, then the count playing */
export function RecordPathCounter() {
    const { t } = useTranslate();
    const { phase, countIn, count, counts } = useRecordPathStore();
    if (phase !== "countIn" && phase !== "recording") return null;
    return (
        <div
            className="pointer-events-none absolute inset-x-0 top-12 z-20 flex justify-center"
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
