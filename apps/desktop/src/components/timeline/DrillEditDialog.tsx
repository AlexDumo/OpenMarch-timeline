import { useEffect, useMemo, useState } from "react";
import {
    useQuery,
    useQueryClient,
    type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import clsx from "clsx";
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
    Input,
    RadioGroup,
    RadioGroupItem,
} from "@openmarch/ui";
import type Page from "@/global/classes/Page";
import { eq } from "drizzle-orm";
import { db, schema } from "@/global/database/db";
import {
    commitDrillEdit,
    pageForAddedCounts,
    previewDrillEdit,
    type DrillEdit,
    type DrillEditPreview,
    type DrillImpact,
} from "@/db-functions/drillEdits";
import { countSpanOf, type NamedGridPage } from "@/db-functions/drillNames";
import { TimelineWriteError } from "@/db-functions/timelineErrors";
import { pageEndBeat } from "@/timeline/pageEndBeat";
import {
    clipText,
    impactLines,
    measureRangeText,
    impactSummary,
    spanText,
    tolgeeTranslate as t,
    type DrillImpactLine,
} from "@/timeline/drillEditText";
import {
    timelineErrorMessage,
    toastTimelineError,
} from "@/timeline/timelineErrorMessages";
import { invalidatePageQueries } from "@/hooks/queries/usePages";
import { measureKeys } from "@/hooks/queries/useMeasures";
import { getUtilityQueryOptions } from "@/hooks/queries/useUtility";
import { historyKeys } from "@/hooks/queries/useHistory";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { useAudioEnvelopeStore } from "@/timeline/timelineWaveform";

/**
 * The **Remove counts…** and **Add counts…** dialogs (tempo experiment E10, Tempo lab
 * `drillChoices`). Each says what the edit will do to the drill before it happens: the choice is
 * run as a preview that is rolled back (`previewDrillEdit`) whenever it changes, and the report
 * lists the clips that shift, squeeze, stretch, stop early, hold or go, in pages and counts. A
 * refusal is shown in drill words with the nearest edit that works. Committing is one undo.
 *
 * - Remove: moves that run into the cut are squeezed (same set, fewer counts) or skip (stop
 *   where marchers are when the cut starts). Clips that are only in the cut go with it; the
 *   commit button says so.
 * - Add: "Does the recording have these counts?" (yes: keep the tempo, later music moves later;
 *   no: squeeze them into the page's time), and at a page flag, hold or stretch.
 */

/** What the dialog is for. Beats are spec beats (ordinals) */
export type DrillEditRequest =
    | {
          readonly kind: "remove";
          readonly start: number;
          readonly end: number;
          /** When it came from a measure ("m41") */
          readonly measure?: string;
      }
    | {
          readonly kind: "add";
          /** The new counts go before beat `at` */
          readonly at: number;
          readonly place: "flag" | "playhead";
      };

/** Pages as `drillNames` needs them, with the app's own page names */
/**
 * Pages as `drillNames` needs them, with the app's own page names. The last page runs to its flag
 * (`start + last_page_counts`) even past the show's last count, as the count edits see it
 * (`withLastFlag`), so Hold is offered on the same flags the edit accepts.
 */
export const namedPages = (pages: readonly Page[], lastPageCounts?: number) => {
    const grid: NamedGridPage[] = [];
    const names = new Map<number, string>();
    for (const page of pages) {
        const first = page.beats[0];
        if (!first) continue;
        grid.push({ id: page.id, start: first.index, end: pageEndBeat(page) });
        names.set(page.id, page.name);
    }
    grid.sort((a, b) => a.start - b.start);
    const last = grid[grid.length - 1];
    if (last && last.id !== 0 && lastPageCounts !== undefined)
        grid[grid.length - 1] = {
            ...last,
            end: Math.max(last.end, last.start + lastPageCounts),
        };
    return { grid, names };
};

/**
 * After a count edit: beats, pages, measures and the utility row changed, and Undo has a new
 * entry (the app also refreshes Undo after every history write, `refreshHistoryOnWrites`)
 */
export const invalidateAfterDrillEdit = async (qc: QueryClient) => {
    await invalidatePageQueries(qc);
    await qc.invalidateQueries({ queryKey: measureKeys.all() });
    await qc.invalidateQueries({ queryKey: historyKeys.all() });
};

const PREVIEW_DELAY_MS = 200;

const TONE: Record<DrillImpactLine["tone"], string> = {
    plain: "text-text",
    notice: "text-text",
    warning: "text-red font-medium",
    loss: "text-red",
};

/**
 * The report: the summary (marks, renumbering, show length) first and always in view, then the
 * clip and page lines, in a box that grows with the dialog before it scrolls
 */
function ImpactList({ impact }: { impact: DrillImpact }) {
    const lines = impactLines(impact, t);
    const summary = lines.filter((line) => line.summary);
    const details = lines.filter((line) => !line.summary);
    return (
        <div className="flex flex-col gap-6">
            {summary.length > 0 && (
                <Lines testId="drill-edit-summary" lines={summary} />
            )}
            {details.length > 0 && (
                <Lines
                    testId="drill-edit-impact"
                    lines={details}
                    className="max-h-[38vh] overflow-y-auto"
                />
            )}
        </div>
    );
}

function Lines({
    lines,
    testId,
    className,
}: {
    lines: readonly DrillImpactLine[];
    testId: string;
    className?: string;
}) {
    return (
        <ul
            data-testid={testId}
            className={clsx(
                "border-stroke bg-fg-1 rounded-6 flex flex-col gap-4 border px-10 py-8 text-[12px]",
                className,
            )}
        >
            {lines.map((line, i) => (
                <li
                    key={i}
                    className={clsx("flex gap-6 leading-snug", TONE[line.tone])}
                >
                    <span aria-hidden="true">
                        {line.tone === "loss"
                            ? "✕"
                            : line.tone === "warning"
                              ? "!"
                              : line.tone === "notice"
                                ? "•"
                                : "·"}
                    </span>
                    <span>{line.text}</span>
                </li>
            ))}
        </ul>
    );
}

function Choice<V extends string>({
    legend,
    value,
    onChange,
    options,
}: {
    legend: string;
    value: V;
    onChange: (value: V) => void;
    options: readonly {
        value: V;
        label: string;
        hint?: string;
        disabledReason?: string | null;
    }[];
}) {
    return (
        <fieldset className="flex flex-col gap-6">
            <legend className="text-sub text-text mb-6 text-[12px] font-medium">
                {legend}
            </legend>
            <RadioGroup
                aria-label={legend}
                value={value}
                onValueChange={(next) => onChange(next as V)}
            >
                {options.map((option) => (
                    <div key={option.value} className="flex flex-col gap-2">
                        <RadioGroupItem
                            value={option.value}
                            disabled={!!option.disabledReason}
                        >
                            <span className="text-[12px]">{option.label}</span>
                        </RadioGroupItem>
                        {(option.disabledReason ?? option.hint) && (
                            <span className="text-text-subtitle pl-36 text-[11px]">
                                {option.disabledReason ?? option.hint}
                            </span>
                        )}
                    </div>
                ))}
            </RadioGroup>
        </fieldset>
    );
}

/** Previews `edit` after a short pause, and again whenever it changes */
const usePreview = (edit: DrillEdit | null, channel: string) => {
    const [state, setState] = useState<{
        key: string;
        preview: DrillEditPreview;
    } | null>(null);
    const key = edit ? JSON.stringify(edit) : "";
    useEffect(() => {
        if (!edit) return;
        let stale = false;
        const timer = setTimeout(() => {
            void previewDrillEdit({ db, edit, channel }).then((preview) => {
                // Null: a newer preview on this channel replaced it
                if (!stale && preview) setState({ key, preview });
            });
        }, PREVIEW_DELAY_MS);
        return () => {
            stale = true;
            clearTimeout(timer);
        };
        // `key` stands for `edit`
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    return state?.key === key ? state.preview : null;
};

// eslint-disable-next-line max-lines-per-function
export default function DrillEditDialog({
    request,
    pages,
    beatCount,
    onClose,
    onShowRange,
    onReopen,
}: {
    request: DrillEditRequest;
    pages: readonly Page[];
    beatCount: number;
    onClose: () => void;
    /** Selects a range on the timeline (to show the clip a refusal names) */
    onShowRange?: (start: number, end: number) => void;
    /** Opens the dialog again for another request (a refusal's alternative) */
    onReopen?: (request: DrillEditRequest) => void;
}) {
    const queryClient = useQueryClient();
    const lastPageCounts = useQuery(getUtilityQueryOptions()).data
        ?.last_page_counts;
    const { grid, names } = useMemo(
        () => namedPages(pages, lastPageCounts),
        [pages, lastPageCounts],
    );
    const [count, setCount] = useState(4);
    const [recording, setRecording] = useState<"has" | "sameTime">("has");
    // As the edit decides it: the page that gets the counts ends at them
    const onFlag =
        request.kind === "add" &&
        pageForAddedCounts(grid, request.at)?.end === request.at;
    const [hold, setHold] = useState<"hold" | "stretch">(
        onFlag ? "hold" : "stretch",
    );
    const [crossing, setCrossing] = useState<"squeeze" | "skip">("squeeze");
    // Remove: did the recording lose these counts too? Yes unless said otherwise; asked only
    // when there is a recording
    const hasAudio = useAudioEnvelopeStore((s) => s.envelope !== null);
    const [cutRecording, setCutRecording] = useState<"lost" | "kept">("lost");
    const [marks, setMarks] = useState<"move" | "drop">("move");
    const [committing, setCommitting] = useState(false);

    const edit: DrillEdit | null =
        request.kind === "remove"
            ? {
                  kind: "removeCounts",
                  start: request.start,
                  end: request.end,
                  crossing,
                  inside: "delete",
                  recording: hasAudio ? cutRecording : "lost",
                  marks,
              }
            : Number.isInteger(count) && count >= 1 && count <= 512
              ? {
                    kind: "addCounts",
                    at: request.at,
                    count,
                    recording,
                    crossing: hold,
                }
              : null;
    // The other choice too, to know whether it is worth offering
    const other: DrillEdit | null =
        edit?.kind === "removeCounts"
            ? { ...edit, crossing: crossing === "skip" ? "squeeze" : "skip" }
            : edit?.kind === "addCounts" && onFlag
              ? { ...edit, crossing: hold === "hold" ? "stretch" : "hold" }
              : null;
    const preview = usePreview(edit, "drill-edit");
    const otherPreview = usePreview(other, "drill-edit-other");

    const owner = useMemo(
        () =>
            request.kind === "add"
                ? pageForAddedCounts(grid, request.at)
                : null,
        [grid, request],
    );
    const ownerName = owner ? (names.get(owner.id) ?? "?") : null;

    const impact = preview?.ok ? preview.impact : null;
    const otherImpact = otherPreview?.ok ? otherPreview.impact : null;
    // The measures the cut takes, once the preview knows them ("m41–56")
    const cutMeasures =
        request.kind === "remove" && impact?.measures?.removed
            ? measureRangeText(impact.measures.removed)
            : null;
    // Rehearsal marks the cut takes: offer to keep the first on the measure after the cut
    const cutMarks = (impact?.marks ?? []).filter(
        (m) => m.change === "moved" || m.change === "removed",
    );
    const movableMark =
        marks === "move"
            ? cutMarks.find((m) => m.change === "moved")
            : cutMarks[0];
    // The cut's length in seconds, for the recording question
    const cutSeconds = useMemo(() => {
        if (request.kind !== "remove") return "0";
        let seconds = 0;
        for (const page of pages)
            for (const beat of page.beats)
                if (beat.index >= request.start && beat.index < request.end)
                    seconds += beat.duration;
        return seconds.toFixed(1);
    }, [pages, request]);

    // Title and where
    const title =
        request.kind === "remove"
            ? request.measure
                ? t(
                      "timeline.drillEdits.remove.titleMeasure",
                      "Remove {measure}’s counts",
                      { measure: request.measure },
                  )
                : t("timeline.drillEdits.remove.title", "Remove counts")
            : request.place === "flag" && ownerName
              ? t(
                    "timeline.drillEdits.add.titleFlag",
                    "Add counts at the end of Pg {page}",
                    { page: ownerName },
                )
              : t(
                    "timeline.drillEdits.add.titlePlayhead",
                    "Add counts at the playhead",
                );
    const span =
        request.kind === "remove"
            ? spanText(countSpanOf(grid, names, request.start, request.end), t)
            : "";
    const where =
        request.kind === "remove"
            ? cutMeasures
                ? t(
                      "timeline.drillEdits.remove.whereMeasures",
                      "{measures} ({span}): {n, plural, one {# count} other {# counts}}",
                      {
                          measures: cutMeasures,
                          span,
                          n: request.end - request.start,
                      },
                  )
                : t(
                      "timeline.drillEdits.remove.where",
                      "{span}: {n, plural, one {# count} other {# counts}}",
                      { span, n: request.end - request.start },
                  )
            : request.at > 1
              ? t("timeline.drillEdits.add.where", "After {span}", {
                    span: spanText(
                        countSpanOf(grid, names, request.at - 1, request.at),
                        t,
                    ),
                })
              : t(
                    "timeline.drillEdits.add.whereStart",
                    "At the start of the show",
                );

    // Moves that cross the cut, or land at or run through the new counts: only then is there a
    // drill choice to make
    const moves = (i: DrillImpact | null) =>
        i?.moves.filter((m) =>
            request.kind === "remove"
                ? m.change === "squeezed" || m.change === "stopsEarly"
                : m.change === "stretched" || m.change === "holds",
        ) ?? [];
    const crossingMoves = moves(impact).length + moves(otherImpact).length > 0;
    const skipImpact = crossing === "skip" ? impact : otherImpact;
    const canSkip = skipImpact?.moves.some((m) => m.change === "stopsEarly");
    const skipReason =
        skipImpact && !canSkip
            ? t(
                  "timeline.drillEdits.remove.cantSkip",
                  "Not here: every move that crosses the cut runs on past it, and marchers can’t jump to where they’d be after it.",
              )
            : null;
    const holdReason = !onFlag
        ? t(
              "timeline.drillEdits.add.cantHoldHere",
              "Only at a page flag: here marchers are partway through a move. Add the counts at the end of the page to hold.",
          )
        : null;
    const deleted =
        impact?.moves.filter((m) => m.note === "onlyInCut").length ?? 0;

    // A refusal, in drill words, and the nearest edit that works
    const error = preview && !preview.ok ? preview.error : null;
    const subject =
        error instanceof TimelineWriteError ? error.subject : undefined;
    const clipRange = useClipRange(error ? subject?.timelineId : undefined);
    const cuts = useAlternativeCuts({
        request,
        clipRange,
        crossing,
        beatCount,
    });
    const alternatives = [
        ...cuts.map((cut) => ({
            label: t(
                "timeline.drillEdits.remove.instead",
                "Remove {span} instead",
                {
                    span: spanText(
                        countSpanOf(grid, names, cut.start, cut.end),
                        t,
                    ),
                },
            ),
            apply: () => onReopen?.({ kind: "remove", ...cut }),
        })),
        ...(subject?.clip && clipRange && onShowRange
            ? [
                  {
                      label: t("timeline.drillEdits.showClip", "Show {clip}", {
                          clip: clipText(subject.clip, t),
                      }),
                      apply: () => {
                          onClose();
                          onShowRange(clipRange[0], clipRange[1]);
                      },
                  },
              ]
            : []),
    ];

    const commit = async () => {
        if (!edit || committing) return;
        setCommitting(true);
        try {
            const done = await commitDrillEdit({ db, edit });
            await invalidateAfterDrillEdit(queryClient);
            // The range held counts that are now other music: let it go
            if (
                useTimelineSelectionStore.getState().selection?.kind === "range"
            )
                useTimelineSelectionStore.getState().selectNothing();
            toast.success(impactSummary(done, t));
            onClose();
        } catch (e) {
            toastTimelineError(e);
        } finally {
            setCommitting(false);
        }
    };

    const commitLabel =
        request.kind === "remove"
            ? deleted > 0
                ? t(
                      "timeline.drillEdits.remove.commitDeleting",
                      "Remove {n, plural, one {# count} other {# counts}} and delete {m, plural, one {# move} other {# moves}}",
                      { n: request.end - request.start, m: deleted },
                  )
                : t(
                      "timeline.drillEdits.remove.commit",
                      "Remove {n, plural, one {# count} other {# counts}}",
                      { n: request.end - request.start },
                  )
            : t(
                  "timeline.drillEdits.add.commit",
                  "Add {n, plural, one {# count} other {# counts}}",
                  { n: Number.isInteger(count) ? count : 0 },
              );

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent
                data-testid="drill-edit-dialog"
                className="w-[460px] max-w-[95vw]"
                aria-describedby={undefined}
            >
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>
                    <span className="text-text-subtitle text-[12px]">
                        {where}
                    </span>
                </DialogDescription>
                <div className="flex flex-col gap-14 overflow-y-auto">
                    {request.kind === "add" && (
                        <>
                            <label className="flex items-center gap-8 text-[12px]">
                                {t("timeline.drillEdits.add.count", "Counts")}
                                <Input
                                    type="number"
                                    min={1}
                                    max={512}
                                    step={1}
                                    value={Number.isFinite(count) ? count : ""}
                                    onChange={(event) =>
                                        setCount(
                                            Math.floor(
                                                Number(event.target.value),
                                            ),
                                        )
                                    }
                                    className="w-80"
                                    data-testid="drill-edit-count"
                                    autoFocus
                                />
                            </label>
                            <Choice
                                legend={t(
                                    "timeline.drillEdits.add.recording",
                                    "Does the recording have these counts?",
                                )}
                                value={recording}
                                onChange={setRecording}
                                options={[
                                    {
                                        value: "has",
                                        label: t(
                                            "timeline.drillEdits.add.recordingHas",
                                            "Yes: the music got longer",
                                        ),
                                        hint: t(
                                            "timeline.drillEdits.add.recordingHasHint",
                                            "Same tempo; everything after them plays later.",
                                        ),
                                    },
                                    {
                                        value: "sameTime",
                                        label: t(
                                            "timeline.drillEdits.add.recordingNot",
                                            "No: fit them into the same time",
                                        ),
                                        hint: ownerName
                                            ? t(
                                                  "timeline.drillEdits.add.recordingNotHint",
                                                  "Pg {page} keeps its length in seconds, so its counts get faster.",
                                                  { page: ownerName },
                                              )
                                            : undefined,
                                        disabledReason: ownerName
                                            ? null
                                            : t(
                                                  "timeline.drillEdits.add.recordingNotNoPage",
                                                  "Past the last flag there is no page to fit them into.",
                                              ),
                                    },
                                ]}
                            />
                            {crossingMoves && (
                                <Choice
                                    legend={t(
                                        "timeline.drillEdits.add.marchers",
                                        "Moves that end here",
                                    )}
                                    value={hold}
                                    onChange={setHold}
                                    options={[
                                        {
                                            value: "hold",
                                            label: t(
                                                "timeline.drillEdits.add.hold",
                                                "Hold marchers for these counts",
                                            ),
                                            hint: t(
                                                "timeline.drillEdits.add.holdHint",
                                                "Moves arrive on their count as now, then hold.",
                                            ),
                                            disabledReason: holdReason,
                                        },
                                        {
                                            value: "stretch",
                                            label: t(
                                                "timeline.drillEdits.add.stretch",
                                                "Stretch the move over them",
                                            ),
                                            hint: t(
                                                "timeline.drillEdits.add.stretchHint",
                                                "Same set, more counts: smaller steps.",
                                            ),
                                        },
                                    ]}
                                />
                            )}
                        </>
                    )}
                    {request.kind === "remove" && crossingMoves && (
                        <Choice
                            legend={t(
                                "timeline.drillEdits.remove.crossing",
                                "Moves that cross the cut",
                            )}
                            value={crossing}
                            onChange={setCrossing}
                            options={[
                                {
                                    value: "squeeze",
                                    label: t(
                                        "timeline.drillEdits.remove.squeeze",
                                        "Squeeze the move into fewer counts",
                                    ),
                                    hint: t(
                                        "timeline.drillEdits.remove.squeezeHint",
                                        "Marchers still reach their set, with bigger steps.",
                                    ),
                                },
                                {
                                    value: "skip",
                                    label: t(
                                        "timeline.drillEdits.remove.skip",
                                        "Skip that part of the move",
                                    ),
                                    hint: t(
                                        "timeline.drillEdits.remove.skipHint",
                                        "Marchers stop where they are when the cut starts; that set is skipped.",
                                    ),
                                    disabledReason: skipReason,
                                },
                            ]}
                        />
                    )}
                    {request.kind === "remove" && hasAudio && (
                        <Choice
                            legend={t(
                                "timeline.drillEdits.remove.recording",
                                "Did the recording lose these counts too?",
                            )}
                            value={cutRecording}
                            onChange={setCutRecording}
                            options={[
                                {
                                    value: "lost",
                                    label: t(
                                        "timeline.drillEdits.remove.recordingLost",
                                        "Yes: the music was cut too",
                                    ),
                                    hint: t(
                                        "timeline.drillEdits.remove.recordingLostHint",
                                        "Their {seconds} s go with them: the music after the cut plays that much earlier, with its counts.",
                                        { seconds: cutSeconds },
                                    ),
                                },
                                {
                                    value: "kept",
                                    label: t(
                                        "timeline.drillEdits.remove.recordingKept",
                                        "No: the recording still has them",
                                    ),
                                    hint: t(
                                        "timeline.drillEdits.remove.recordingKeptHint",
                                        "The music stays where it is. The counts after the cut, to the end of their page, slow down to fill its {seconds} s, so later pages stay with the music.",
                                        { seconds: cutSeconds },
                                    ),
                                },
                            ]}
                        />
                    )}
                    {request.kind === "remove" && cutMarks.length > 0 && (
                        <Choice
                            legend={t(
                                "timeline.drillEdits.remove.marks",
                                "Rehearsal marks in the cut",
                            )}
                            value={marks}
                            onChange={setMarks}
                            options={[
                                {
                                    value: "move",
                                    label: t(
                                        "timeline.drillEdits.remove.marksMove",
                                        "Keep {mark} on the first measure after the cut",
                                        { mark: cutMarks[0]!.mark },
                                    ),
                                    disabledReason:
                                        marks === "move" && !movableMark
                                            ? t(
                                                  "timeline.drillEdits.remove.marksMoveTaken",
                                                  "The measure after the cut has a mark of its own.",
                                              )
                                            : null,
                                },
                                {
                                    value: "drop",
                                    label: t(
                                        "timeline.drillEdits.remove.marksDrop",
                                        "Remove {marks}",
                                        {
                                            marks: cutMarks
                                                .map((m) => m.mark)
                                                .join(", "),
                                        },
                                    ),
                                },
                            ]}
                        />
                    )}
                    <div className="flex flex-col gap-6">
                        <span className="text-[12px] font-medium">
                            {t(
                                "timeline.drillEdits.whatHappens",
                                "What happens to the drill",
                            )}
                        </span>
                        {impact ? (
                            <ImpactList impact={impact} />
                        ) : error ? (
                            <div
                                role="alert"
                                data-testid="drill-edit-refusal"
                                className="border-red/40 bg-red/10 text-text rounded-6 flex flex-col gap-8 border px-10 py-8 text-[12px]"
                            >
                                <span>{timelineErrorMessage(error)}</span>
                                {alternatives.length > 0 && (
                                    <div className="flex flex-wrap gap-6">
                                        {alternatives.map((alt) => (
                                            <Button
                                                key={alt.label}
                                                size="compact"
                                                variant="secondary"
                                                onClick={alt.apply}
                                            >
                                                {alt.label}
                                            </Button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : !edit ? (
                            <span
                                role="alert"
                                data-testid="drill-edit-invalid"
                                className="text-red text-[12px]"
                            >
                                {t(
                                    "timeline.drillEdits.add.countInvalid",
                                    "Enter a whole number of counts from 1 to 512.",
                                )}
                            </span>
                        ) : (
                            <span className="text-text-subtitle text-[12px]">
                                {t("timeline.drillEdits.checking", "Checking…")}
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex justify-end gap-8">
                    <Button
                        variant="secondary"
                        size="compact"
                        onClick={onClose}
                    >
                        {t("timeline.drillEdits.cancel", "Cancel")}
                    </Button>
                    <Button
                        size="compact"
                        data-testid="drill-edit-commit"
                        disabled={!impact || committing}
                        onClick={() => void commit()}
                        variant={deleted > 0 ? "red" : "primary"}
                    >
                        {commitLabel}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

/**
 * The nearest cuts that work, for a refusal: the same number of counts just after or just
 * before the clip in the way, each kept only if its preview passes. Spec beats.
 */
function useAlternativeCuts({
    request,
    clipRange,
    crossing,
    beatCount,
}: {
    request: DrillEditRequest;
    clipRange: readonly [number, number] | null;
    crossing: "squeeze" | "skip";
    beatCount: number;
}): { start: number; end: number }[] {
    const [found, setFound] = useState<{ start: number; end: number }[]>([]);
    const length = request.kind === "remove" ? request.end - request.start : 0;
    useEffect(() => {
        setFound([]);
        if (length === 0 || !clipRange) return;
        const candidates = [
            { start: clipRange[1], end: clipRange[1] + length },
            { start: clipRange[0] - length, end: clipRange[0] },
        ].filter((c) => c.start >= 1 && c.end <= beatCount);
        let stale = false;
        void (async () => {
            const ok: { start: number; end: number }[] = [];
            for (const c of candidates) {
                const result = await previewDrillEdit({
                    db,
                    channel: `drill-edit-alternative-${c.start}`,
                    edit: {
                        kind: "removeCounts",
                        ...c,
                        crossing,
                        inside: "delete",
                    },
                });
                if (result?.ok) ok.push(c);
            }
            if (!stale) setFound(ok);
        })();
        return () => {
            stale = true;
        };
    }, [beatCount, clipRange, crossing, length]);
    return found;
}

/** A stored timeline's range by id, read once */
function useClipRange(timelineId: number | undefined) {
    const [range, setRange] = useState<readonly [number, number] | null>(null);
    useEffect(() => {
        setRange(null);
        if (timelineId === undefined) return;
        let stale = false;
        void db
            .select({
                start: schema.timelines.start_beat,
                end: schema.timelines.end_beat,
            })
            .from(schema.timelines)
            .where(eq(schema.timelines.id, timelineId))
            .get()
            .then((row) => {
                if (!stale && row) setRange([row.start, row.end]);
            });
        return () => {
            stale = true;
        };
    }, [timelineId]);
    return range;
}
