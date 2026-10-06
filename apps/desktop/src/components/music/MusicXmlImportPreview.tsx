import { useMemo, useState } from "react";
import {
    Button,
    Checkbox,
    DangerNote,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
    InfoNote,
    WarningNote,
} from "@openmarch/ui";
import { T, useTolgee } from "@tolgee/react";
import { clsx } from "clsx";
import type { MusicXmlParseResult } from "@openmarch/musicxml-parser";
import {
    previewRows,
    summaryParts,
    warningText,
    type PreviewTranslate,
} from "./musicXmlPreview";
import MusicXmlReimportSection, {
    type MusicXmlReimportState,
} from "./MusicXmlReimportSection";

/** Whether the import would go through, from a rolled-back trial run. */
export type MusicXmlDryRunState =
    | { status: "checking" }
    | { status: "ok" }
    | { status: "refused"; message: string };

interface MusicXmlImportPreviewProps {
    open: boolean;
    fileName: string;
    report: MusicXmlParseResult;
    dryRun: MusicXmlDryRunState;
    /** Pages in the show now; page N moves to measure N on import */
    pageCount: number;
    importing: boolean;
    onImport: () => void;
    onCancel: () => void;
    /** With Tempo lab `reimportInPlace` and bars that line up: update the show in place */
    reimport?: MusicXmlReimportState;
    /** With Tempo lab `reimportInPlace`: the show has measures, but none line up with the file */
    noMatch?: boolean;
}

/**
 * What a MusicXML file will bring in, before anything is written: a summary line, a table of the
 * measures where something happens (marks, meters, tempos, warnings), and whether the show's
 * drill would refuse the import.
 */
// eslint-disable-next-line max-lines-per-function
export default function MusicXmlImportPreview({
    open,
    fileName,
    report,
    dryRun,
    pageCount,
    importing,
    onImport,
    onCancel,
    reimport,
    noMatch = false,
}: MusicXmlImportPreviewProps) {
    const { t: tolgeeT } = useTolgee();
    const t: PreviewTranslate = (key, params) => tolgeeT(key, params ?? {});
    const [showAll, setShowAll] = useState(false);
    const rows = useMemo(
        () => previewRows(report, { all: showAll }),
        [report, showAll],
    );
    const refused = dryRun.status === "refused";
    const inPlace = reimport?.mode === "reimport";

    return (
        <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
            <DialogContent
                className="w-[48rem] max-w-[90vw]"
                aria-describedby={undefined}
                onEscapeKeyDown={onCancel}
            >
                <DialogTitle>
                    <T keyName="music.xmlPreview.title" params={{ fileName }} />
                </DialogTitle>
                <DialogDescription>
                    <span
                        className="text-text/80"
                        data-testid="musicxml-preview-summary"
                    >
                        {summaryParts(report, t).join(" · ")}
                    </span>
                </DialogDescription>

                <div
                    className={clsx(
                        "rounded-6 border-stroke max-h-[18rem] overflow-y-auto border",
                        // Keep a few of the file's rows visible above the re-import summary
                        inPlace && "max-h-[8rem] min-h-[6rem] shrink-0",
                    )}
                >
                    <table
                        className="text-sub w-full border-collapse"
                        data-testid="musicxml-preview-table"
                    >
                        <thead className="bg-fg-2 text-text/70 sticky top-0 text-left">
                            <tr>
                                <th className="px-8 py-4 font-medium">
                                    <T keyName="music.xmlPreview.columns.measure" />
                                </th>
                                <th className="px-8 py-4 font-medium">
                                    <T keyName="music.xmlPreview.columns.mark" />
                                </th>
                                <th className="px-8 py-4 font-medium">
                                    <T keyName="music.xmlPreview.columns.meter" />
                                </th>
                                <th className="px-8 py-4 font-medium">
                                    <T keyName="music.xmlPreview.columns.tempo" />
                                </th>
                                <th className="px-8 py-4 font-medium">
                                    <T keyName="music.xmlPreview.columns.notes" />
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr
                                    key={row.measureIndex}
                                    data-warning={
                                        row.warnings.length > 0 || undefined
                                    }
                                    className={clsx(
                                        "border-stroke border-t align-top",
                                        row.warnings.length > 0 &&
                                            "bg-yellow/12",
                                    )}
                                >
                                    <td className="px-8 py-4 font-mono whitespace-nowrap">
                                        m{row.measure}
                                    </td>
                                    <td className="px-8 py-4 font-medium">
                                        {row.rehearsalMark}
                                    </td>
                                    <td className="px-8 py-4 whitespace-nowrap">
                                        {row.meter}
                                    </td>
                                    <td className="px-8 py-4 whitespace-nowrap">
                                        {row.tempo}
                                    </td>
                                    <td className="px-8 py-4">
                                        {row.warnings.map((w, i) => (
                                            <div
                                                key={`w${i}`}
                                                className="text-text"
                                            >
                                                {warningText(w, t)}
                                            </div>
                                        ))}
                                        {row.notes.map((w, i) => (
                                            <div
                                                key={`n${i}`}
                                                className="text-text/60"
                                            >
                                                {warningText(w, t)}
                                            </div>
                                        ))}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <label className="text-sub text-text/80 flex items-center gap-8">
                    <Checkbox
                        checked={showAll}
                        onCheckedChange={(checked) =>
                            setShowAll(checked === true)
                        }
                    />
                    <T keyName="music.xmlPreview.showAll" />
                </label>

                {inPlace && reimport && (
                    <MusicXmlReimportSection reimport={reimport} />
                )}
                {!inPlace && reimport && (
                    <WarningNote>
                        <T keyName="music.xmlPreview.reimport.replaceWarning" />
                    </WarningNote>
                )}
                {!inPlace && noMatch && (
                    <InfoNote>
                        <T keyName="music.xmlPreview.reimport.noMatch" />
                    </InfoNote>
                )}
                {!inPlace && pageCount > 1 && !refused && (
                    <InfoNote>
                        <T
                            keyName="music.xmlPreview.pagesMove"
                            params={{ count: pageCount }}
                        />
                    </InfoNote>
                )}
                {!inPlace && dryRun.status === "checking" && (
                    <InfoNote>
                        <T keyName="music.xmlPreview.checking" />
                    </InfoNote>
                )}
                {!inPlace && refused && (
                    <DangerNote>
                        <span data-testid="musicxml-preview-refused">
                            <T
                                keyName="music.xmlPreview.refused"
                                params={{ reason: dryRun.message }}
                            />
                        </span>
                    </DangerNote>
                )}
                {report.summary.warnings > 0 && (inPlace || !refused) && (
                    <WarningNote>
                        <T keyName="music.xmlPreview.warningsHint" />
                    </WarningNote>
                )}

                <div className="flex justify-end gap-8">
                    {inPlace && reimport && (
                        <Button
                            variant="ghost"
                            className="mr-auto"
                            onClick={reimport.onReplaceEverything}
                            data-testid="musicxml-reimport-replace"
                        >
                            <T keyName="music.xmlPreview.reimport.replaceEverything" />
                        </Button>
                    )}
                    {!inPlace && reimport && (
                        <Button
                            variant="ghost"
                            className="mr-auto"
                            onClick={reimport.onBack}
                        >
                            <T keyName="music.xmlPreview.reimport.back" />
                        </Button>
                    )}
                    <Button variant="secondary" onClick={onCancel}>
                        <T keyName="music.xmlPreview.cancel" />
                    </Button>
                    {inPlace && reimport ? (
                        <Button
                            onClick={reimport.onUpdate}
                            disabled={reimport.updating || !reimport.changes}
                            data-testid="musicxml-reimport-update"
                        >
                            {reimport.updating ? (
                                <T keyName="music.xmlPreview.reimport.updating" />
                            ) : (
                                <T keyName="music.xmlPreview.reimport.update" />
                            )}
                        </Button>
                    ) : (
                        <Button
                            onClick={onImport}
                            disabled={importing || dryRun.status !== "ok"}
                            data-testid="musicxml-preview-import"
                        >
                            {importing ? (
                                <T keyName="music.importing" />
                            ) : (
                                <T keyName="music.xmlPreview.import" />
                            )}
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
