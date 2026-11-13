/**
 * The web build's end of drill chart export: the channels Electron's
 * `PDFExportService` answers (`export:createExportDirectory`,
 * `export:generateDocForMarcher`), answered in the page.
 *
 * The renderer makes the SVGs as in Electron and asks for one PDF at a time
 * (one for the whole show, or one per marcher). Each is drawn here by the
 * same code Electron uses (src/components/exporting/utils/drillChartPdf.ts),
 * loaded on the first export, and kept in memory: about 10 KB per page, so a
 * 150-marcher show is a few tens of MB.
 *
 * As with video (./videoExport.ts), saving needs a fresh tap, so the dialog
 * shows "Save drill charts" when they're done, which calls
 * `open-export-directory` with the export's id: the share sheet on iPads
 * (Save to Files, AirDrop, Mail), a download elsewhere. One PDF is saved as
 * it is; several go in one zip.
 */
import type { DrillChartPdfArgs } from "../../src/components/exporting/utils/drillChartPdf";

type DrillChartRender = typeof import("./drillChartRender");

export interface DrillChartExportDeps {
    /** Loads the PDF code (a separate chunk). */
    load: () => Promise<
        Pick<
            DrillChartRender,
            | "renderDrillChartPdf"
            | "drillChartPdfFileName"
            | "loadFieldImageDataUri"
            | "zipFiles"
        >
    >;
    /** Offers the share sheet (see ./filePicking.ts `shareFile`). */
    share: (
        file: File,
    ) => Promise<"shared" | "cancelled" | "expired" | "unavailable">;
    download: (file: File) => void;
    /** iPad/iPhone: share first. */
    appleTouch: boolean;
    newId: () => string;
}

interface Session {
    exportName: string;
    files: File[];
    fieldImage: Promise<string | null> | null;
    /** The file to save, made once on the first Save. */
    ready: Promise<File> | null;
}

const ID_PREFIX = "drill-charts:";

/** The show's name, or a stand-in, without characters file systems reject. */
function exportNameFor(defaultName: string | null | undefined): string {
    const cleaned = (defaultName ?? "")
        // eslint-disable-next-line no-control-regex
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
        .trim();
    return cleaned || "OpenMarch show";
}

// eslint-disable-next-line max-lines-per-function
export function createDrillChartExportHandlers(deps: DrillChartExportDeps) {
    const sessions = new Map<string, Session>();

    async function fileToSave(session: Session): Promise<File> {
        if (session.files.length === 1) return session.files[0];
        const lib = await deps.load();
        return lib.zipFiles(
            session.files,
            `${session.exportName}-drill-charts.zip`,
        );
    }

    return {
        /** Starts an export (Electron asks for a folder here). */
        createExportDirectory(defaultName: string | null | undefined) {
            // One export at a time, as with video: drop earlier ones
            sessions.clear();
            const exportDir = `${ID_PREFIX}${deps.newId()}`;
            const exportName = exportNameFor(defaultName);
            sessions.set(exportDir, {
                exportName,
                files: [],
                fieldImage: null,
                ready: null,
            });
            return { exportName, exportDir };
        },

        /** Draws one PDF and keeps it for saving. */
        async generateDocForMarcher(
            args: Omit<DrillChartPdfArgs, "fieldImageDataUri"> & {
                exportDir: string;
            },
        ): Promise<{ success: boolean; error?: string }> {
            const session = sessions.get(args.exportDir);
            if (!session)
                return { success: false, error: "This export has ended" };
            try {
                const lib = await deps.load();
                // Read once per export, as Electron caches it
                session.fieldImage ??= lib.loadFieldImageDataUri();
                const { exportDir: _exportDir, ...drawArgs } = args;
                const pdf = await lib.renderDrillChartPdf({
                    ...drawArgs,
                    fieldImageDataUri: await session.fieldImage,
                });
                session.files.push(
                    new File(
                        [pdf as Uint8Array<ArrayBuffer>],
                        lib.drillChartPdfFileName(
                            args.showName,
                            args.drillNumber,
                        ),
                        { type: "application/pdf" },
                    ),
                );
                session.ready = null;
                return { success: true };
            } catch (error) {
                console.error("Drawing a drill chart failed:", error);
                return {
                    success: false,
                    error: error instanceof Error ? error.message : "",
                };
            }
        },

        /** Whether `exportDir` is a drill chart export (not a video). */
        owns: (exportDir: string) => exportDir.startsWith(ID_PREFIX),

        /**
         * Saves a finished export, from a tap. Returns "saved", "cancelled"
         * (the share sheet was closed; it can be tried again) or "missing".
         */
        async deliver(
            exportDir: string,
        ): Promise<"saved" | "cancelled" | "missing"> {
            const session = sessions.get(exportDir);
            if (!session || session.files.length === 0) return "missing";
            session.ready ??= fileToSave(session);
            const file = await session.ready;
            if (deps.appleTouch) {
                const shared = await deps.share(file);
                // Too long after the tap (e.g. a big zip): tapping Save
                // again works, and the file is ready by then
                if (shared === "cancelled" || shared === "expired")
                    return "cancelled";
                if (shared === "shared") return "saved";
            }
            deps.download(file);
            return "saved";
        },
    };
}

export function download(file: File) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
}

export function browserDrillChartExportDeps(
    overrides: Pick<DrillChartExportDeps, "share" | "appleTouch">,
): DrillChartExportDeps {
    return {
        load: () => import("./drillChartRender"),
        download,
        newId: () => crypto.randomUUID(),
        ...overrides,
    };
}
