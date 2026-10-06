import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@openmarch/ui";
import { T, useTolgee } from "@tolgee/react";
import type { MusicXmlParseResult } from "@openmarch/musicxml-parser";
import { useTimingObjects } from "@/hooks";
import { conToastError } from "@/utilities/utils";
import {
    _dryRunMusicXmlImport,
    readMusicXmlFile,
    useImportMusicXml,
    type MusicXmlImportData,
} from "./MusicXmlImport";
import MusicXmlImportPreview, {
    type MusicXmlDryRunState,
} from "./MusicXmlImportPreview";

/**
 * Picks a MusicXML file, shows what it read in a preview (with a dry run of the import against
 * the show's drill), and imports it only when the user presses Import.
 */
export default function MusicXmlSelector() {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { t } = useTolgee();
    const { measures, pages: allPages, beats: allBeats } = useTimingObjects();
    const queryClient = useQueryClient();
    const [pending, setPending] = useState<{
        fileName: string;
        report: MusicXmlParseResult;
    } | null>(null);
    const [dryRun, setDryRun] = useState<MusicXmlDryRunState>({
        status: "checking",
    });
    // Ignores a dry run that finishes after its preview was closed or replaced
    const previewId = useRef(0);

    const importMusicXmlMutation = useImportMusicXml();

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

        const id = ++previewId.current;
        setPending({ fileName: file.name, report });
        setDryRun({ status: "checking" });
        const result = await _dryRunMusicXmlImport({
            data: importData(file.name, report),
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

    const close = () => {
        previewId.current++;
        setPending(null);
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
                disabled={importMusicXmlMutation.isPending}
                className="whitespace-nowrap"
            >
                {importMusicXmlMutation.isPending
                    ? t("music.importing")
                    : t("music.importButton")}
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
                />
            )}
        </div>
    );
}
