import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@openmarch/ui";
import { T, useTolgee } from "@tolgee/react";
import type { MusicXmlParseResult } from "@openmarch/musicxml-parser";
import { useTimingObjects } from "@/hooks";
import { conToastError } from "@/utilities/utils";
import { db } from "@/global/database/db";
import { useTempoLabFlag } from "@/stores/UiSettingsStore";
import { planMusicXmlReimport } from "@/db-functions/musicXmlReimport";
import {
    defaultReimportTiming,
    reimportChangesAnything,
    scoreMeasuresOf,
    type ReimportPlan,
    type ReimportScoreMeasure,
    type ReimportShow,
    type ReimportTiming,
} from "@/timeline/tempo/reimport";
import {
    _dryRunMusicXmlImport,
    readMusicXmlFile,
    useImportMusicXml,
    useReimportMusicXml,
    type MusicXmlImportData,
} from "./MusicXmlImport";
import MusicXmlImportPreview, {
    type MusicXmlDryRunState,
} from "./MusicXmlImportPreview";
import { reimportLines } from "./musicXmlReimportPreview";

/** An in-place re-import on offer (Tempo lab `reimportInPlace`). */
interface PendingReimport {
    show: ReimportShow;
    score: ReimportScoreMeasure[];
    plan: ReimportPlan;
}

/**
 * Picks a MusicXML file, shows what it read in a preview (with a dry run of the import against
 * the show's drill), and imports it only when the user presses Import.
 *
 * With Tempo lab `reimportInPlace`, a file whose bars line up with the show's is offered as an
 * update in place first (E12); replacing everything is one step further away.
 */
// eslint-disable-next-line max-lines-per-function
export default function MusicXmlSelector() {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { t } = useTolgee();
    const { measures, pages: allPages, beats: allBeats } = useTimingObjects();
    const queryClient = useQueryClient();
    const reimportInPlace = useTempoLabFlag("reimportInPlace");
    const [pending, setPending] = useState<{
        fileName: string;
        report: MusicXmlParseResult;
    } | null>(null);
    const [dryRun, setDryRun] = useState<MusicXmlDryRunState>({
        status: "checking",
    });
    const [reimport, setReimport] = useState<PendingReimport | null>(null);
    const [mode, setMode] = useState<"reimport" | "replace">("replace");
    const [timing, setTiming] = useState<ReimportTiming>("score");
    const [noMatch, setNoMatch] = useState(false);
    // Ignores a dry run that finishes after its preview was closed or replaced
    const previewId = useRef(0);

    const importMusicXmlMutation = useImportMusicXml();
    const reimportMutation = useReimportMusicXml();

    const importData = (
        fileName: string,
        report: MusicXmlParseResult,
    ): MusicXmlImportData => ({
        fileName,
        report,
        allPages,
        measures,
        allBeats,
    });

    const clearInput = () => {
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    /** Runs the full import's dry run for the preview that is open now. */
    const startDryRun = async (
        fileName: string,
        report: MusicXmlParseResult,
    ) => {
        const id = previewId.current;
        setDryRun({ status: "checking" });
        const result = await _dryRunMusicXmlImport({
            data: importData(fileName, report),
        });
        // Reads that ran while the trial was open may have cached its rolled-back rows
        await queryClient.invalidateQueries();
        if (previewId.current !== id) return;
        setDryRun(
            result.ok
                ? { status: "ok" }
                : { status: "refused", message: result.message },
        );
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        clearInput();
        if (!file) return;

        if (!allPages || !allBeats) {
            toast.error("Failed to fetch required data");
            return;
        }

        let report: MusicXmlParseResult;
        try {
            report = await readMusicXmlFile(file);
        } catch (error) {
            conToastError(t("music.importError"), error);
            return;
        }
        if (report.measures.length === 0) {
            toast.error(t("music.xmlPreview.noMeasures"));
            return;
        }

        previewId.current++;
        let offer: PendingReimport | null = null;
        let none = false;
        if (reimportInPlace) {
            const score = scoreMeasuresOf(report.measures);
            const { show, plan } = await planMusicXmlReimport({ db, score });
            if (plan.pairs.length > 0) offer = { show, score, plan };
            else none = show.measures.length > 0;
        }
        setReimport(offer);
        setNoMatch(none);
        setMode(offer ? "reimport" : "replace");
        if (offer) setTiming(defaultReimportTiming(offer.plan));
        setPending({ fileName: file.name, report });
        // The full import's dry run takes the timeline's write lock: run it only when it's needed
        if (!offer) await startDryRun(file.name, report);
    };

    const close = () => {
        previewId.current++;
        setPending(null);
        setReimport(null);
    };

    const handleImport = async () => {
        if (!pending) return;
        try {
            const result = await importMusicXmlMutation.mutateAsync(
                importData(pending.fileName, pending.report),
            );
            if (result.success) toast.success(result.message);
            close();
        } catch {
            // The mutation's onError has shown the toast; the preview stays open
        }
    };

    const handleUpdate = async () => {
        if (!pending || !reimport) return;
        try {
            const result = await reimportMutation.mutateAsync({
                fileName: pending.fileName,
                score: reimport.score,
                timing,
            });
            if (result.success) toast.success(result.message);
            close();
        } catch {
            // The mutation's onError has shown the toast; the preview stays open
        }
    };

    const lines = useMemo(
        () =>
            reimport
                ? reimportLines(
                      reimport.show,
                      reimport.score,
                      reimport.plan,
                      timing,
                  )
                : [],
        [reimport, timing],
    );
    const busy = importMusicXmlMutation.isPending || reimportMutation.isPending;

    return (
        <div className="mt-8 flex items-center gap-8 px-12">
            <label className="text-body text-text/80 w-full">
                <T keyName="music.importLabel" />
            </label>
            <input
                ref={fileInputRef}
                type="file"
                accept=".xml,.musicxml,.mxl"
                className="hidden"
                data-testid="musicxml-file-input"
                onChange={handleFileChange}
            />
            <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className="whitespace-nowrap"
            >
                {busy ? t("music.importing") : t("music.importButton")}
            </Button>
            {pending && (
                <MusicXmlImportPreview
                    open
                    fileName={pending.fileName}
                    report={pending.report}
                    dryRun={dryRun}
                    pageCount={allPages.length}
                    importing={importMusicXmlMutation.isPending}
                    onImport={handleImport}
                    onCancel={close}
                    noMatch={noMatch}
                    reimport={
                        reimport
                            ? {
                                  mode,
                                  lines,
                                  changes: reimportChangesAnything(
                                      reimport.plan,
                                      timing,
                                  ),
                                  synced: {
                                      total: reimport.plan.synced.total,
                                      moved: reimport.plan.synced.moved.length,
                                  },
                                  timing,
                                  onTimingChange: setTiming,
                                  updating: reimportMutation.isPending,
                                  onUpdate: handleUpdate,
                                  onReplaceEverything: () => {
                                      setMode("replace");
                                      void startDryRun(
                                          pending.fileName,
                                          pending.report,
                                      );
                                  },
                                  onBack: () => {
                                      previewId.current++;
                                      setMode("reimport");
                                  },
                              }
                            : undefined
                    }
                />
            )}
        </div>
    );
}
