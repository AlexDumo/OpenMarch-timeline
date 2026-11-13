/* eslint-disable max-lines-per-function */
/**
 * Draws drill chart PDFs with PDFKit and svg-to-pdfkit, and returns the
 * bytes. Shared by the Electron main process (which writes the file, see
 * `electron/main/services/export-service.ts`) and the web build (which
 * hands the file to the person, see `web/renderer/drillChartExport.ts`).
 *
 * Under Node `pdfkit` is the package's Node build; the web build aliases it
 * to the self-contained browser build (`pdfkit/js/pdfkit.standalone.js`),
 * which bundles the standard fonts. Nothing here touches the file system.
 */
import PDFDocument from "pdfkit";
// @ts-ignore - svg-to-pdfkit doesn't have types
import SVGtoPDF from "svg-to-pdfkit";
import sanitizeHtml from "sanitize-html";
import sanitize from "sanitize-filename";
import { measureRangeString as _measureRangeString } from "../../../global/classes/Page.utils";
import logoSvgRaw from "../../../assets/open-march-logo.svg?raw";

/** The parts of a page a drill chart shows (a `Page`, or a copy of one sent over IPC). */
export interface DrillChartPage {
    name: string;
    counts?: number | null;
    notes?: string | null;
    measures: { number: number; counts: number }[] | null;
    measureBeatToStartOn: number | null;
    measureBeatToEndOn: number | null;
}

export interface DrillChartPdfArgs {
    /** One SVG per page, from `generateDrillChartExportSVGs`. */
    svgPages: string[];
    /** The marcher's drill number, or "MAIN" for the overview chart. */
    drillNumber: string;
    /** Readable coordinates per page (individual charts only). */
    marcherCoordinates: string[];
    pages: DrillChartPage[];
    showName: string;
    individualCharts: boolean;
    notesAppendixPages?: { pageName: string; notes: string }[];
    /** Replaces the field image placeholder in the SVGs (see `fieldImageDataUri`). */
    fieldImageDataUri?: string | null;
    /** The date in the footer. Defaults to now. */
    exportedOn?: Date;
}

/** The field image as the data URI the SVGs' placeholder is replaced with. */
export function fieldImageDataUri(
    image: Uint8Array | null | undefined,
): string | null {
    if (!image || image.length === 0) return null;
    let binary = "";
    for (let i = 0; i < image.length; i += 0x8000)
        binary += String.fromCharCode(...image.subarray(i, i + 0x8000));
    // Adjust the MIME type if the actual format is ever detected
    return `data:image/png;base64,${btoa(binary)}`;
}

/** "Show-T1.pdf", without characters file systems reject. */
export function drillChartPdfFileName(
    showName: string,
    drillNumber: string,
): string {
    return sanitize(`${showName}-${drillNumber}.pdf`);
}

// Modified from Page.ts for export purposes
const measureRangeString = (page: DrillChartPage): string => {
    try {
        if (!page.measures || page.measures.length === 0) return "START";
        else return _measureRangeString(page);
    } catch (err) {
        return "N/A";
    }
};

const FOOTER_BRANDING = "Made with OpenMarch";

// svg-to-pdfkit prefers the root width/height attributes over the options,
// so strip them to make the logo scale to the footer size (viewBox remains)
const footerLogoSvg = (() => {
    const rootTagEnd = logoSvgRaw.indexOf(">");
    const rootTag = logoSvgRaw
        .slice(0, rootTagEnd)
        .replace(/\s(width|height)="[^"]*"/g, "");
    return (rootTag + logoSvgRaw.slice(rootTagEnd)).replace(
        /currentColor/g,
        "#666666",
    );
})();

/**
 * Draw the OpenMarch branding footer (export date, logo + "Made with
 * OpenMarch", page numbers) at the bottom of the current PDFKit page.
 */
function drawPdfFooter(
    doc: InstanceType<typeof PDFDocument>,
    pageNumber: number,
    totalPages: number,
    exportedOn: Date,
): void {
    const pageWidth = doc.page.width;
    const footerY = doc.page.height - 19;
    // Clear the bottom margin so drawing near the page edge doesn't trigger
    // an automatic page break
    const oldMargins = doc.page.margins;
    doc.page.margins = { ...oldMargins, bottom: 0 };

    doc.fillColor("#666666").fontSize(8).font("Helvetica");
    doc.text(`Exported ${exportedOn.toLocaleDateString()}`, 30, footerY, {
        lineBreak: false,
    });

    const logoHeight = 9;
    const logoWidth = logoHeight * (54 / 32);
    const gap = 4;
    const brandingX =
        (pageWidth - (logoWidth + gap + doc.widthOfString(FOOTER_BRANDING))) /
        2;
    try {
        SVGtoPDF(doc, footerLogoSvg, brandingX, footerY - 1, {
            width: logoWidth,
            height: logoHeight,
        });
    } catch {
        // Branding text alone if the logo fails to render
    }
    doc.text(FOOTER_BRANDING, brandingX + logoWidth + gap, footerY, {
        lineBreak: false,
    });

    const pageLabel = `Page ${pageNumber} of ${totalPages}`;
    doc.text(
        pageLabel,
        pageWidth - 30 - doc.widthOfString(pageLabel),
        footerY,
        {
            lineBreak: false,
        },
    );

    doc.page.margins = oldMargins;
}

/**
 * Draws one drill chart PDF: a landscape Letter page per SVG page with the
 * title bar, the field and the set/counts/measures, coordinates (individual
 * charts) and notes, then the notes appendix, then the footer on every page.
 */
export async function renderDrillChartPdf(
    args: DrillChartPdfArgs,
): Promise<Uint8Array> {
    const {
        svgPages,
        drillNumber,
        marcherCoordinates,
        pages,
        showName,
        individualCharts,
        notesAppendixPages = [],
        fieldImageDataUri = null,
        exportedOn = new Date(),
    } = args;

    // Replace the placeholder in all SVG pages with the actual image data
    const PLACEHOLDER = "OPENMARCH_FIELD_IMAGE_PLACEHOLDER";
    // The placeholder might be resolved to an absolute URL by the browser (e.g., http://localhost:5173/PLACEHOLDER)
    // so we need to match any URL that contains the placeholder
    const processedSvgPages = svgPages.map((svg) => {
        if (fieldImageDataUri && svg.includes(PLACEHOLDER)) {
            return svg.replace(PLACEHOLDER, fieldImageDataUri);
        }
        return svg;
    });
    const doc = new PDFDocument({
        size: "LETTER",
        layout: "landscape",
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        bufferPages: true,
    });
    const chunks: Uint8Array[] = [];
    doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    const finished = new Promise<void>((resolve, reject) => {
        doc.on("end", () => resolve());
        doc.on("error", reject);
    });

    // Helper to draw bold header and value with proper wrapping and y advancement
    function drawLabelValue(
        doc: InstanceType<typeof PDFDocument>,
        label: string,
        value: string,
        x: number,
        y: number,
        width: number,
        fontSize: number = 11,
    ): number {
        doc.fontSize(fontSize).font("Helvetica-Bold");
        doc.text(label, x, y, {
            width: width,
            continued: true,
        });

        doc.font("Helvetica");
        doc.text(` ${value}`, {
            width: width,
            continued: false,
        });

        const afterY = doc.y;
        return afterY + 2;
    }

    const renderHtmlText = (
        doc: InstanceType<typeof PDFDocument>,
        html: string,
        x: number,
        y: number,
        width: number,
        baseFontSize: number = 10,
    ): number => {
        if (!html) return y;

        // Sanitize HTML using sanitize-html library to prevent XSS and CodeQL warnings
        // Allow only tags we explicitly handle for formatting
        let text = "";
        try {
            text = sanitizeHtml(html, {
                allowedTags: [
                    "h1",
                    "h2",
                    "h3",
                    "h4",
                    "h5",
                    "h6",
                    "p",
                    "div",
                    "br",
                    "strong",
                    "b",
                    "em",
                    "i",
                    "ul",
                    "ol",
                    "li",
                ],
                allowedAttributes: {}, // No attributes allowed
            });
        } catch (error) {
            console.error("Error sanitizing HTML:", error);
        }

        // Decode HTML entities
        const entityMap: Record<string, string> = {
            "&amp;": "&",
            "&lt;": "<",
            "&gt;": ">",
            "&quot;": '"',
            "&#39;": "'",
            "&apos;": "'",
        };
        text = text.replace(
            /&(?:amp|lt|gt|quot|#39|apos);/g,
            (match) => entityMap[match] || match,
        );
        text = text.replace(/&#(\d{1,6});/g, (match, num) => {
            const code = parseInt(num, 10);
            if (code >= 0 && code <= 0x10ffff) {
                try {
                    return String.fromCodePoint(code);
                } catch {
                    return match;
                }
            }
            return match;
        });
        text = text.replace(/&#x([0-9a-fA-F]{1,6});/g, (match, hex) => {
            const code = parseInt(hex, 16);
            if (code >= 0 && code <= 0x10ffff) {
                try {
                    return String.fromCodePoint(code);
                } catch {
                    return match;
                }
            }
            return match;
        });

        text = text.replace(/<li[^>]*>/gi, "• ");
        text = text.replace(/<\/li>/gi, "\n");
        text = text.replace(/<\/?(ul|ol)[^>]*>/gi, "\n");
        text = text.replace(/<(p|div)[^>]*>/gi, "\n");

        let currentY = y;

        // Extract and replace headings with placeholders to preserve them during splitting
        const headingPlaceholders: Array<{
            placeholder: string;
            type: "h1" | "h2" | "h3";
            content: string;
        }> = [];
        let placeholderCounter = 0;

        text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (match, content) => {
            const placeholder = `__HEADING_H1_${placeholderCounter++}__`;
            headingPlaceholders.push({
                placeholder,
                type: "h1",
                content: sanitizeHtml(content, {
                    allowedTags: [],
                    allowedAttributes: {},
                }).trim(),
            });
            return placeholder;
        });

        text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (match, content) => {
            const placeholder = `__HEADING_H2_${placeholderCounter++}__`;
            headingPlaceholders.push({
                placeholder,
                type: "h2",
                content: sanitizeHtml(content, {
                    allowedTags: [],
                    allowedAttributes: {},
                }).trim(),
            });
            return placeholder;
        });

        text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (match, content) => {
            const placeholder = `__HEADING_H3_${placeholderCounter++}__`;
            headingPlaceholders.push({
                placeholder,
                type: "h3",
                content: sanitizeHtml(content, {
                    allowedTags: [],
                    allowedAttributes: {},
                }).trim(),
            });
            return placeholder;
        });

        const blockSplitRegex = /(?:<br\s*\/?>|<\/(?:p|div)\s*>)/gi;
        const blocks = text.split(blockSplitRegex);

        if (blocks.length === 0 || (blocks.length === 1 && !blocks[0].trim())) {
            blocks.length = 0;
            blocks.push(text);
        }

        for (const block of blocks) {
            const trimmedBlock = block.trim();
            if (!trimmedBlock) {
                currentY += baseFontSize * 0.5;
                continue;
            }

            // Check for heading placeholders
            const h1Placeholder = trimmedBlock.match(/__HEADING_H1_\d+__/);
            const h2Placeholder = trimmedBlock.match(/__HEADING_H2_\d+__/);
            const h3Placeholder = trimmedBlock.match(/__HEADING_H3_\d+__/);

            if (h1Placeholder) {
                const placeholder = h1Placeholder[0];
                const heading = headingPlaceholders.find(
                    (h) => h.placeholder === placeholder,
                );
                if (heading && heading.content) {
                    doc.fontSize(baseFontSize * 1.5).font("Helvetica-Bold");
                    doc.text(heading.content, x, currentY, { width });
                    currentY = doc.y + baseFontSize * 0.3;
                }
                continue;
            } else if (h2Placeholder) {
                const placeholder = h2Placeholder[0];
                const heading = headingPlaceholders.find(
                    (h) => h.placeholder === placeholder,
                );
                if (heading && heading.content) {
                    doc.fontSize(baseFontSize * 1.3).font("Helvetica-Bold");
                    doc.text(heading.content, x, currentY, { width });
                    currentY = doc.y + baseFontSize * 0.3;
                }
                continue;
            } else if (h3Placeholder) {
                const placeholder = h3Placeholder[0];
                const heading = headingPlaceholders.find(
                    (h) => h.placeholder === placeholder,
                );
                if (heading && heading.content) {
                    doc.fontSize(baseFontSize * 1.1).font("Helvetica-Bold");
                    doc.text(heading.content, x, currentY, { width });
                    currentY = doc.y + baseFontSize * 0.3;
                }
                continue;
            }

            // Remove heading placeholders from block before processing
            const blockWithoutPlaceholders = trimmedBlock
                .replace(/__HEADING_H[1-3]_\d+__/g, "")
                .trim();
            if (!blockWithoutPlaceholders) {
                currentY += baseFontSize * 0.5;
                continue;
            }

            const formatTagsRegex =
                /<(strong|b|em|i)(?:\s[^>]*)?>|<\/(strong|b|em|i)>/gi;
            const parts: Array<{
                text: string;
                bold: boolean;
                italic: boolean;
            }> = [];
            let inBold = false;
            let inItalic = false;
            let lastIndex = 0;
            let match;

            formatTagsRegex.lastIndex = 0;

            while (
                (match = formatTagsRegex.exec(blockWithoutPlaceholders)) !==
                null
            ) {
                if (match.index > lastIndex) {
                    const textBefore = blockWithoutPlaceholders.substring(
                        lastIndex,
                        match.index,
                    );
                    const cleanText = sanitizeHtml(textBefore, {
                        allowedTags: [],
                        allowedAttributes: {},
                    }).trim();
                    if (cleanText) {
                        parts.push({
                            text: cleanText,
                            bold: inBold,
                            italic: inItalic,
                        });
                    }
                }

                const tag = match[1] || match[2];
                if (tag === "strong" || tag === "b") {
                    inBold = !inBold;
                } else if (tag === "em" || tag === "i") {
                    inItalic = !inItalic;
                }

                lastIndex = match.index + match[0].length;
            }

            if (lastIndex < blockWithoutPlaceholders.length) {
                const textAfter = blockWithoutPlaceholders.substring(lastIndex);
                // Strip all HTML tags completely to prevent injection vulnerabilities
                // We handle formatting separately via the regex parsing above
                const cleanText = sanitizeHtml(textAfter, {
                    allowedTags: [],
                    allowedAttributes: {},
                }).trim();
                if (cleanText) {
                    parts.push({
                        text: cleanText,
                        bold: inBold,
                        italic: inItalic,
                    });
                }
            }

            if (parts.length === 0) {
                // Use sanitizeHtml to strip tags instead of regex
                const plainText = sanitizeHtml(blockWithoutPlaceholders, {
                    allowedTags: [],
                    allowedAttributes: {},
                }).trim();

                if (plainText) {
                    doc.fontSize(baseFontSize).font("Helvetica");
                    doc.text(plainText, x, currentY, { width });
                    currentY = doc.y + baseFontSize * 0.2;
                }
            } else {
                doc.fontSize(baseFontSize);
                let isFirst = true;
                let startX = x;

                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i];
                    if (!part.text) continue;

                    let font = "Helvetica";
                    if (part.bold && part.italic) {
                        font = "Helvetica-BoldOblique";
                    } else if (part.bold) {
                        font = "Helvetica-Bold";
                    } else if (part.italic) {
                        font = "Helvetica-Oblique";
                    }

                    doc.font(font);
                    doc.text(
                        part.text,
                        isFirst ? x : startX,
                        isFirst ? currentY : doc.y,
                        {
                            width,
                            continued: i < parts.length - 1,
                        },
                    );

                    if (isFirst) {
                        isFirst = false;
                        startX = doc.x;
                    }
                }

                currentY = doc.y + baseFontSize * 0.2;
            }
        }

        return currentY;
    };

    // Set up margins and top bar height
    const margin = 20;
    const topBarHeight = 34;

    // Loop through each SVG page and create a PDF page for it
    for (let i = 0; i < processedSvgPages.length; i++) {
        if (i > 0) doc.addPage();

        // Data for each page
        const page = pages?.[i];
        const setNumber = page?.name ?? "END";
        const counts = page?.counts != null ? String(page.counts) : "END";
        const measureNumbers = measureRangeString(page);
        const prevCoord = marcherCoordinates[i - 1] ?? "N/A";
        const currCoord = marcherCoordinates[i] ?? "N/A";
        const nextCoord = marcherCoordinates[i + 1] ?? "N/A";
        const notesHtml = page?.notes ?? "";
        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;

        // Top bar with drill number, show name, and set number
        doc.rect(margin, margin, pageWidth - 2 * margin, topBarHeight).fill(
            "#ddd",
        );
        const titleBarY = margin + topBarHeight / 2 - 6;

        doc.fillColor("black").fontSize(16).font("Helvetica-Bold");
        doc.fillColor("black").text(`${drillNumber}`, margin + 10, titleBarY, {
            width: pageWidth * 0.15,
            align: "left",
        });
        doc.text(showName, pageWidth * 0.15, titleBarY, {
            width: pageWidth * 0.65,
            align: "center",
        });
        doc.text(`Set: ${setNumber}`, pageWidth * 0.8, titleBarY, {
            width: pageWidth * 0.2,
            align: "center",
        });

        // Field SVG
        const maxSVGHeight = 425;
        const maxSVGWidth = pageWidth - 2 * margin;
        try {
            SVGtoPDF(doc, processedSvgPages[i], margin, 65, {
                height: maxSVGHeight,
                width: maxSVGWidth,
                preserveAspectRatio: "xMidYMid meet",
            });
        } catch (svgError) {
            doc.fillColor("red")
                .fontSize(20)
                .text(
                    `Error rendering SVG: ${svgError instanceof Error ? svgError.message : svgError}`,
                    margin * 2,
                    pageHeight / 2,
                    {
                        height: maxSVGHeight,
                        width: maxSVGWidth,
                        continued: true,
                    },
                );
            doc.fillColor("black");
        }

        // Set, Counts, Measures, Coordinates, and Notes setup
        const bottomY = doc.page.height - 110;
        const columnPadding = 12;
        const marginSize = margin * 1.5;
        const contentWidth = pageWidth - marginSize * 2 - columnPadding * 2;

        // Variable column widths (18%, 56%, 26%)
        // If main sheet, no middle coordinates column
        const leftColWidth = contentWidth * 0.18;
        const midColWidth = individualCharts ? contentWidth * 0.56 : 0;
        const rightColWidth = individualCharts
            ? contentWidth * 0.26
            : contentWidth * 0.82;
        const leftX = marginSize;
        const midX = leftX + leftColWidth + columnPadding;
        const rightX = individualCharts
            ? midX + midColWidth + columnPadding
            : leftX + leftColWidth + columnPadding;

        // Initialize Y positions for each column
        let yLeft = bottomY;
        let yMid = bottomY;
        let yRight = bottomY;

        // Left column (Set, Counts, Measures)
        yLeft = drawLabelValue(
            doc,
            "Set:",
            setNumber,
            leftX,
            yLeft,
            leftColWidth,
        );
        yLeft = drawLabelValue(
            doc,
            "Counts:",
            counts,
            leftX,
            yLeft,
            leftColWidth,
        );
        yLeft = drawLabelValue(
            doc,
            "Measures:",
            measureNumbers,
            leftX,
            yLeft,
            leftColWidth,
        );

        // Middle column (Coordinates)
        if (individualCharts) {
            yMid = drawLabelValue(
                doc,
                "Previous Coordinate:",
                prevCoord,
                midX,
                yMid,
                midColWidth,
            );
            yMid = drawLabelValue(
                doc,
                "Current Coordinate:",
                currCoord,
                midX,
                yMid,
                midColWidth,
            );
            yMid = drawLabelValue(
                doc,
                "Next Coordinate:",
                nextCoord,
                midX,
                yMid,
                midColWidth,
            );
        }

        // Right column (Notes)
        doc.fontSize(11).font("Helvetica-Bold");
        doc.text("Notes:", rightX, yRight, {
            width: rightColWidth,
        });
        const notesStartY = doc.y + 2;
        if (notesHtml) {
            yRight = renderHtmlText(
                doc,
                notesHtml,
                rightX,
                notesStartY,
                rightColWidth,
                10,
            );
        } else {
            yRight = notesStartY;
        }

        // Footers are drawn in a single pass over all buffered pages
        // after the content (charts + notes appendix) is complete
    }

    // Notes appendix pages
    const appendixEntries = (notesAppendixPages ?? [])
        .map((entry) => ({
            pageName: entry.pageName,
            notesHtml: entry.notes ?? "",
        }))
        .filter((entry) => entry.notesHtml.trim().length > 0);

    if (appendixEntries.length > 0) {
        const drawAppendixHeaderOnCurrentPage = () => {
            const pageWidth = doc.page.width;
            const pageHeight = doc.page.height;

            doc.rect(margin, margin, pageWidth - 2 * margin, topBarHeight).fill(
                "#ddd",
            );
            const titleBarY = margin + topBarHeight / 2 - 6;

            doc.fillColor("black").fontSize(16).font("Helvetica-Bold");
            doc.text(`${drillNumber}`, margin + 10, titleBarY, {
                width: pageWidth * 0.2,
                align: "left",
            });
            doc.text(showName, pageWidth * 0.2, titleBarY, {
                width: pageWidth * 0.6,
                align: "center",
            });
            doc.text("Notes", pageWidth * 0.8, titleBarY, {
                width: pageWidth * 0.2,
                align: "center",
            });

            return {
                pageWidth,
                pageHeight,
                startY: margin + topBarHeight + 20,
            };
        };

        const renderAppendixHeader = () => {
            doc.addPage({
                size: "LETTER",
                layout: "portrait",
                margins: {
                    top: margin + topBarHeight + 20,
                    bottom: 60,
                    left: 0,
                    right: 0,
                },
            });
            return drawAppendixHeaderOnCurrentPage();
        };

        const writeNotesEntry = (entry: {
            pageName: string;
            notesHtml: string;
        }) => {
            if (!entry.notesHtml) return;

            const { pageWidth, startY } = renderAppendixHeader();
            const contentWidth = pageWidth - 2 * margin;

            // Capture the start page index (the page we just added)
            const rangeStart = doc.bufferedPageRange();
            const startPageIndex = rangeStart.start + rangeStart.count - 1;

            const title = `Set ${entry.pageName}`;
            doc.fillColor("black").fontSize(12).font("Helvetica-Bold");
            doc.text(title, margin, startY, {
                width: contentWidth,
            });
            const notesStartY = doc.y + 4;

            renderHtmlText(
                doc,
                entry.notesHtml,
                margin,
                notesStartY,
                contentWidth,
                10,
            );

            const rangeEnd = doc.bufferedPageRange();
            const endPageIndex = rangeEnd.start + rangeEnd.count - 1;

            // Entries that flow onto extra pages need the header repeated
            for (
                let pageIdx = startPageIndex + 1;
                pageIdx <= endPageIndex;
                pageIdx++
            ) {
                doc.switchToPage(pageIdx);
                drawAppendixHeaderOnCurrentPage();
            }
        };

        for (const entry of appendixEntries) {
            writeNotesEntry(entry);
        }
    }

    // Branding footer with page numbers on every page
    const pageRange = doc.bufferedPageRange();
    for (let i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
        doc.switchToPage(i);
        drawPdfFooter(
            doc,
            i - pageRange.start + 1,
            pageRange.count,
            exportedOn,
        );
    }

    doc.end();
    await finished;

    const bytes = new Uint8Array(
        chunks.reduce((total, chunk) => total + chunk.length, 0),
    );
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }
    return bytes;
}
