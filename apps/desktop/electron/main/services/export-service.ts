/* eslint-disable max-lines-per-function */
import { dialog, BrowserWindow, app, shell } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import sanitize from "sanitize-filename";
import type Page from "../../../src/global/classes/Page";
import {
    drillChartPdfFileName,
    fieldImageDataUri,
    renderDrillChartPdf,
} from "../../../src/components/exporting/utils/drillChartPdf";

import Store from "electron-store";
import { getOrmConnection } from "../../database/database.services";
import logoSvgRaw from "@/assets/open-march-logo.svg?raw";

const store = new Store();

// Logo for HTML header/footer templates (data URI required by printToPDF)
const logoDataUri = `data:image/svg+xml;base64,${Buffer.from(
    logoSvgRaw.replace(/currentColor/g, "black"),
).toString("base64")}`;

const headerHtml = ({ showName }: { showName: string }) => `
<div style="
    padding: 4px 16px;
    font-family: Arial, sans-serif;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 9px;
    color: #999;
    width: 100%;
    box-sizing: border-box;
    height: 20px;
">
    <div style="flex: 1; text-align: left;">
        ${logoDataUri ? `<img src="${logoDataUri}" style="height: 16px; width: auto;" />` : "Logo not found"}
    </div>
    <div style="flex: 1; text-align: center; font-weight: bold; font-size: 8px;">
        ${showName}
    </div>
    <div style="flex: 1;"></div>
</div>
`;

// Function (not a const) so the export date is not frozen at app launch
const footerHtml = () => `
<div style="
    padding: 4px 16px;
    font-family: Arial, sans-serif;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 8px;
    color: #999;
    width: 100%;
    box-sizing: border-box;
    height: 16px;
">
    <div style="flex: 1; text-align: left;">Exported ${new Date().toLocaleDateString()}</div>
    <div style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px;">
        <img src="${logoDataUri}" style="height: 10px; width: auto; opacity: 0.55;" />
        <span>Made with OpenMarch</span>
    </div>
    <div style="flex: 1; text-align: right;">
        Page <span class="pageNumber"></span> of <span class="totalPages"></span>
    </div>
</div>
`;

function chunkArray<T>(array: T[], size: number): T[][] {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }
    return result;
}

const printStyles = (quarterPages: boolean) => `
  @media print {
    .marcher-sheet {
      page-break-before: auto;
      min-height: 10in;
      width: 100%;
      box-sizing: border-box;
    }
    .marcher-sheet:not(:last-child) {
      page-break-after: always;
    }
    ${
        quarterPages
            ? `
      .grid-container {
        display: grid;
        grid-template-columns: 50% 50%;
        grid-template-rows: 50% 50%;
        height: 10in;
        width: 7.5in;
      }
      .grid-container:not(:last-child) {
        page-break-after: always;
      }
      .grid-item {
        box-sizing: border-box;
        padding: 0.1in;
        border: 1px solid #333;
      }
      .marcher-sheet {
        page-break-before: auto;
        page-break-after: auto;
        min-height: auto;
        padding: 0.5rem;
      }
    `
            : ""
    }

    /* Allow tables to break across pages but keep headers */
    table {
      page-break-inside: auto;
    }

    /* Ensure table headers repeat on each page */
    thead {
      display: table-header-group;
    }

    /* Ensure performer header repeats on each page */
    .sheetHeader {
      display: table-header-group;
      page-break-inside: avoid;
      page-break-after: avoid;
    }

    /* Keep coordinate rows whole across page breaks */
    tbody tr {
      page-break-inside: avoid;
    }
  }

  @page {
    margin: 0.5in;
  }

  body {
    margin: 0;
    padding: 0;
    font-family: Arial, sans-serif;
  }
`;

/**
 * Wrap rendered coordinate sheets in a printable HTML document. In quarter
 * page mode, sheets are arranged into 2x2 grids; otherwise each sheet starts
 * on its own page and may flow onto more (the print styles keep the table
 * headers repeating and rows unbroken).
 */
function buildSheetDocumentHtml(
    sheets: string[],
    quarterPages: boolean,
): string {
    const combinedHtml = quarterPages
        ? chunkArray(sheets, 4)
              .map(
                  (chunk) => `<div class="grid-container">
                      ${chunk.map((sheet) => `<div class="grid-item">${sheet}</div>`).join("")}
                  </div>`,
              )
              .join("")
        : sheets
              .map((sheet) => `<div class="marcher-sheet">${sheet}</div>`)
              .join("");

    return `<html>
      <head>
        <meta charset="UTF-8" />
        <title>PDF Export</title>
        <style>${printStyles(quarterPages)}</style>
      </head>
      <body>${combinedHtml}</body>
    </html>`;
}

/**
 * Render an HTML document to a PDF buffer in a hidden window with the
 * OpenMarch header/footer. Handles temp file plumbing, timeout, and cleanup.
 */
async function printHtmlToPdf(
    htmlContent: string,
    margins: Electron.PrintToPDFOptions["margins"],
    timeoutMs = 30000,
): Promise<Buffer> {
    const tempDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "openmarch-export-"),
    );
    const tempFile = path.join(tempDir, "export.html");
    await fs.promises.writeFile(tempFile, htmlContent, { mode: 0o600 });

    const win = new BrowserWindow({ width: 1200, height: 800, show: false });
    let timeout: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            new Promise<never>((_, reject) => {
                timeout = setTimeout(
                    () =>
                        reject(
                            new Error(
                                `PDF generation timed out after ${timeoutMs / 1000} seconds`,
                            ),
                        ),
                    timeoutMs,
                );
            }),
            (async () => {
                await win.loadFile(tempFile);
                return await win.webContents.printToPDF({
                    margins,
                    pageSize: "Letter",
                    printBackground: true,
                    headerTemplate: headerHtml({
                        showName: PDFExportService.getCurrentFilename(),
                    }),
                    footerTemplate: footerHtml(),
                    displayHeaderFooter: true,
                });
            })(),
        ]);
    } finally {
        clearTimeout(timeout);
        win.destroy();
        await fs.promises
            .rm(tempDir, { recursive: true, force: true })
            .catch(() => {});
    }
}

interface ExportSheet {
    name: string;
    drillNumber: string;
    section: string;
    renderedPage: string;
}

export class PDFExportService {
    // Cache for the field image to avoid repeated DB queries during bulk exports
    private static fieldImageCache: string | null | undefined = undefined;

    /**
     * Clear the field image cache. Call this when starting a new export session
     * or when the field image might have changed.
     */
    public static clearFieldImageCache() {
        this.fieldImageCache = undefined;
    }

    private static generateSinglePDF(sheets: string[], quarterPages: boolean) {
        return printHtmlToPdf(
            buildSheetDocumentHtml(sheets, quarterPages),
            quarterPages
                ? { top: 0.75, bottom: 0.5, left: 0, right: 0 }
                : { top: 0.75, bottom: 0.5, left: 0.25, right: 0.25 },
        );
    }

    private static async generateSeparatePDFs(
        sheets: ExportSheet[],
        outputPath: string,
        quarterPages: boolean,
    ) {
        // Group sheets by section
        const sectionMap = new Map<string, ExportSheet[]>();
        sheets.forEach((sheet) => {
            const section = sheet.section || "Other";
            if (!sectionMap.has(section)) sectionMap.set(section, []);
            sectionMap.get(section)!.push(sheet);
        });

        const currentFileName = PDFExportService.getCurrentFilename();
        const date = new Date().toISOString().split("T")[0];

        if (quarterPages) {
            // One PDF per section, each page a 2x2 grid of quarter sheets
            await fs.promises.mkdir(outputPath, { recursive: true });

            for (const [section, sectionSheets] of sectionMap) {
                const pdfBuffer = await printHtmlToPdf(
                    buildSheetDocumentHtml(
                        sectionSheets.map((s) => s.renderedPage),
                        true,
                    ),
                    { top: 0.75, bottom: 0.5, left: 0, right: 0 },
                );
                const fileName = `${currentFileName}-${date}-${section}.pdf`;
                await fs.promises.writeFile(
                    path.join(outputPath, sanitize(fileName)),
                    new Uint8Array(pdfBuffer),
                );
            }
        } else {
            // One PDF per marcher, organized into section folders
            for (const [section, sectionSheets] of sectionMap) {
                const sectionDir = path.join(outputPath, sanitize(section));
                await fs.promises.mkdir(sectionDir, { recursive: true });

                for (const sheet of sectionSheets) {
                    const pdfBuffer = await printHtmlToPdf(
                        buildSheetDocumentHtml([sheet.renderedPage], false),
                        { top: 0.75, bottom: 0.5, left: 0.25, right: 0.25 },
                        15000,
                    );
                    const fileName = `${currentFileName}-${date}-${sheet.drillNumber}${sheet.name ? " - " + sheet.name : ""}`;
                    await fs.promises.writeFile(
                        path.join(sectionDir, `${sanitize(fileName)}.pdf`),
                        new Uint8Array(pdfBuffer),
                    );
                }
            }
        }
    }

    public static async export(
        sheets: ExportSheet[],
        organizeBySection: boolean,
        quarterPages: boolean,
    ) {
        // Clear the field image cache at the start of a new export session
        this.clearFieldImageCache();

        try {
            let result: Electron.SaveDialogReturnValue;
            if (organizeBySection) {
                result = await dialog.showSaveDialog({
                    title: "Select Export Location",
                    defaultPath: PDFExportService.getDefaultPath(),
                    properties: [
                        "createDirectory",
                        "showOverwriteConfirmation",
                    ],
                    buttonLabel: "Export Here",
                });

                if (result.canceled || !result.filePath) {
                    return { success: false, path: "", cancelled: true };
                }
                await PDFExportService.generateSeparatePDFs(
                    sheets,
                    result.filePath,
                    quarterPages,
                );
            } else {
                result = await dialog.showSaveDialog({
                    title: "Save PDF",
                    defaultPath: `${PDFExportService.getDefaultPath()}.pdf`,
                    filters: [{ name: "PDF", extensions: ["pdf"] }],
                    properties: ["showOverwriteConfirmation"],
                });

                if (result.canceled || !result.filePath) {
                    return { success: false, path: "", cancelled: true };
                }

                const pdfBuffer = await PDFExportService.generateSinglePDF(
                    sheets.map((s) => s.renderedPage),
                    quarterPages,
                );

                await fs.promises.writeFile(
                    result.filePath,
                    new Uint8Array(pdfBuffer),
                );
            }
            return { success: true, path: result.filePath };
        } catch (error) {
            return {
                success: false,
                path: "",
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    private static getDefaultPath(): string {
        const date = new Date().toISOString().split("T")[0];
        const win = BrowserWindow.getFocusedWindow();
        const currentFileName = win
            ? win.getTitle().replace(/\.[^/.]+$/, "")
            : "untitled";

        // Get the directory where the current .dots file is saved
        const currentFilePath = store.get("databasePath") as string;
        const baseDir = currentFilePath
            ? path.dirname(currentFilePath)
            : app.getPath("documents");

        return path.join(
            baseDir,
            `${currentFileName}-${date}-coordinate-sheets`,
        );
    }

    /**
     * Open the export directory in the file explorer
     * @param exportDir - The directory to open
     */
    public static async openExportDirectory(
        exportDir: string,
    ): Promise<string> {
        return await shell.openPath(exportDir);
    }

    /**
     * Create a directory for exporting files
     * @param defaultName - Default name for the export directory
     * @returns An object containing the export name and directory path
     */
    public static async createExportDirectory(
        defaultName: string,
    ): Promise<{ exportName: string; exportDir: string }> {
        // Clear the field image cache at the start of a new export session
        this.clearFieldImageCache();

        // Generate default path similar to coordinate sheets but with "charts"
        const date = new Date().toISOString().split("T")[0];
        const currentFileName = defaultName || "untitled";

        // Get the directory where the current .dots file is saved
        const currentFilePath = store.get("databasePath") as string;
        const baseDir = currentFilePath
            ? path.dirname(currentFilePath)
            : app.getPath("documents");

        const defaultPath = path.join(
            baseDir,
            `${currentFileName}-${date}-charts`,
        );

        // Prompt user for export location
        const result = await dialog.showSaveDialog({
            title: "Select Export Location",
            defaultPath: defaultPath,
            properties: ["createDirectory", "showOverwriteConfirmation"],
            buttonLabel: "Export Here",
        });

        // Error handling
        if (result.canceled) {
            throw new Error("Export cancelled");
        }
        if (!result.filePath) {
            throw new Error("No file path selected for export");
        }

        // Create export directory
        const exportDir = result.filePath;
        await fs.promises.mkdir(exportDir, { recursive: true });

        // Generate base file name
        const exportName = path.basename(
            path.basename(defaultName) === path.basename(result.filePath)
                ? defaultName
                : result.filePath,
        );

        return { exportName, exportDir };
    }

    /**
     * Helper function to get field image as base64 data URI from the database.
     * This is cached to avoid repeated DB queries during bulk exports.
     * The cache is cleared automatically when starting a new export session.
     */
    private static async getFieldImageDataUri(): Promise<string | null> {
        // Return cached value if available (undefined means not yet fetched, null means no image)
        if (this.fieldImageCache !== undefined) {
            return this.fieldImageCache;
        }

        try {
            // Access the database in the main process
            const db = getOrmConnection();
            const result = await db.query.field_properties.findFirst({
                columns: { image: true },
            });

            if (!result?.image) {
                this.fieldImageCache = null;
                return null;
            }

            const dataUri = fieldImageDataUri(result.image);

            // Cache the result
            this.fieldImageCache = dataUri;
            return dataUri;
        } catch (error) {
            console.error("Error fetching field image:", error);
            this.fieldImageCache = null;
            return null;
        }
    }

    /**
     * Generate a PDF for each marcher based on their SVG pages and coordinates
     * This will create a single PDF for each marcher with their respective pages.
     * @param svgPages
     * @param drillNumber
     * @param marcherCoordinates
     * @param pages
     * @param showName
     * @param exportDir
     * @param individualCharts
     */
    public static async generateDocForMarcher(args: {
        svgPages: string[];
        drillNumber: string;
        marcherCoordinates: string[];
        pages: Page[];
        showName: string;
        exportDir: string;
        individualCharts: boolean;
        notesAppendixPages?: { pageName: string; notes: string }[];
    }) {
        const {
            svgPages,
            drillNumber,
            marcherCoordinates,
            pages,
            showName,
            exportDir,
            individualCharts,
            notesAppendixPages = [],
        } = args;
        // Debug: Confirm this is drill chart export
        console.debug(
            `🎺 DRILL CHART EXPORT - generateDocForMarcher called - ${drillNumber}`,
        );

        // Fetch the field image once from the database in the main process
        const fieldImage = await this.getFieldImageDataUri();

        const pdf = await renderDrillChartPdf({
            svgPages,
            drillNumber,
            marcherCoordinates,
            pages,
            showName,
            individualCharts,
            notesAppendixPages,
            fieldImageDataUri: fieldImage,
        });
        await fs.promises.writeFile(
            path.join(exportDir, drillChartPdfFileName(showName, drillNumber)),
            pdf,
        );

        return { success: true };
    }

    /**
     * Get the current filename from the focused window
     */
    public static getCurrentFilename(): string {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) return "untitled";
        return win
            .getTitle()
            .replace(/^OpenMarch - /, "")
            .replace(/\.[^/.]+$/, "");
    }
}
