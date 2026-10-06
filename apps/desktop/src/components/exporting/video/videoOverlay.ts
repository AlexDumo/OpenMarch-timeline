import Measure from "@/global/classes/Measure";
import type Beat from "@/global/classes/Beat";
import Page from "@/global/classes/Page";
import { recolorMarcherIconSvg } from "@/assets/open-march-marcher";
import { getVideoThemeColors, type VideoTheme } from "./videoTheme";

/**
 * Optional info overlay drawn on each exported video frame so viewers can
 * tell where they are in the show (set, counts, measure, rehearsal mark,
 * tempo, clock).
 */
export interface OverlayOptions {
    /** Show the current set transition, e.g. "Set 4 → 5" */
    showSet: boolean;
    /** Show the count within the current transition, e.g. "Count 7 / 16" */
    showCounts: boolean;
    /** Show the measure number and active rehearsal mark, e.g. "m. 23" + "A" */
    showMeasures: boolean;
    /** Show the current tempo, e.g. "144 bpm" */
    showTempo: boolean;
    /** Show elapsed / total time, e.g. "1:23 / 6:45" */
    showClock: boolean;
    /** Translated label for "Set" */
    setLabel: string;
    /** Translated label for "Count" */
    countLabel: string;
}

/**
 * Where and how large the overlay is drawn, normalized to the frame size so
 * the same placement works for any export resolution.
 */
export interface OverlayPlacement {
    /** Left edge of the box as a fraction of the frame width (0-1) */
    x: number;
    /** Top edge of the box as a fraction of the frame height (0-1) */
    y: number;
    /** Multiplier on the base font size */
    scale: number;
    /**
     * Maximum box width as a fraction of the frame width. Controls how
     * items wrap: wide enough fits everything on one row, narrower stacks
     * items onto multiple rows.
     */
    widthFraction: number;
}

export const DEFAULT_OVERLAY_PLACEMENT: OverlayPlacement = {
    x: 0.02,
    y: 0.93,
    scale: 1,
    widthFraction: 0.75,
};

/** Pixel rectangle of the drawn overlay box, for preview hit-testing */
export interface OverlayRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Show-wide digit widths so numeric overlay fields keep a stable layout. */
export interface OverlayFormatBounds {
    countDigits: number;
    measureDigits: number;
    clockMinuteDigits: number;
    /** Characters of the widest tempo, such as 5 for "152.5" */
    tempoDigits: number;
    /** Max digit length of page number portions (e.g. "12" in "12A") */
    setNumberDigits: number;
    /** Max letter suffix length on page names (0–2; subsets use one letter almost always) */
    setSuffixChars: number;
}

/** A time this close after a beat line is on it (sums of beat lengths drift in the last bits) */
const SAME_TIME_SECONDS = 1e-6;

export interface OverlayState {
    /** Name of the set the marchers are leaving (null at the opening set) */
    previousSetName: string | null;
    /** Name of the set the marchers are moving toward, or the opening set before count 1 */
    setName: string;
    /**
     * The count within the current transition: the last count line at or before now, so the
     * transition's last count is on its set. 0 at the opening set, before the first count.
     */
    count: number;
    /** Total counts of the current transition; 0 at the opening set */
    totalCounts: number;
    measureNumber: number | null;
    /** Most recent rehearsal mark at or before the current measure */
    rehearsalMark: string | null;
    /** The tempo the current beat is counted at (`countTempoBpm`) */
    tempoBpm: number | null;
    timeSeconds: number;
    totalSeconds: number;
    formatBounds: OverlayFormatBounds;
}

/**
 * Precomputed, monotonically-advancing lookup over the show's timing
 * objects. The export loop queries strictly increasing timestamps, so each
 * cursor only ever moves forward, making per-frame lookups O(1).
 */
export class OverlayTimeline {
    private readonly pages: Page[];
    private readonly measures: Measure[];
    private readonly totalSeconds: number;
    private readonly formatBounds: OverlayFormatBounds;
    /**
     * Every page's counts in show order, each at the time of its beat line: count k of a page is
     * the k-th beat line after the page's start, so its last count is on its flag, where the
     * marchers reach its set (docs/tempo/count-convention.md, as the timeline's readout counts).
     */
    private readonly countLines: {
        readonly pageIndex: number;
        readonly count: number;
        readonly time: number;
    }[] = [];
    private pageCursor = 0;
    private countCursor = -1;
    private measureCursor = 0;

    constructor(sortedPages: Page[], measures: Measure[]) {
        this.pages = sortedPages;
        this.measures = measures;
        const lastPage = sortedPages[sortedPages.length - 1];
        this.totalSeconds = lastPage
            ? lastPage.timestamp + lastPage.duration
            : 0;
        sortedPages.forEach((page, pageIndex) => {
            // The first page is the opening set, with no counts of its own
            if (pageIndex === 0 && (page.counts === 0 || page.duration === 0))
                return;
            const { beats } = page;
            const last = beats[beats.length - 1];
            const flag =
                sortedPages[pageIndex + 1]?.beats[0]?.timestamp ??
                (last ? last.timestamp + last.duration : page.timestamp);
            for (let count = 1; count <= beats.length; count++)
                this.countLines.push({
                    pageIndex,
                    count,
                    time: count < beats.length ? beats[count].timestamp : flag,
                });
        });
        this.formatBounds = computeFormatBounds(
            sortedPages,
            measures,
            this.totalSeconds,
        );
    }

    /**
     * @param timeSeconds - Show time; must not decrease between calls
     */
    getState(timeSeconds: number): OverlayState {
        // The page and count: the last count line at or before this time, so a page's last
        // count holds from its flag until the next page's count 1. Before the first page's
        // count 1 the marchers are at the opening set, count 0.
        while (
            this.countCursor < this.countLines.length - 1 &&
            timeSeconds + SAME_TIME_SECONDS >=
                this.countLines[this.countCursor + 1].time
        ) {
            this.countCursor++;
        }
        const line = this.countLines[this.countCursor];

        // The beat sounding now, for the tempo: the page whose beats cover this time. The
        // first page has duration 0, so it is skipped immediately.
        while (
            this.pageCursor < this.pages.length - 1 &&
            timeSeconds >=
                this.pages[this.pageCursor].timestamp +
                    this.pages[this.pageCursor].duration
        ) {
            this.pageCursor++;
        }
        const soundingPage = this.pages[this.pageCursor];
        let currentBeat: Beat | undefined;
        for (let i = soundingPage.beats.length - 1; i >= 0; i--) {
            if (soundingPage.beats[i].timestamp <= timeSeconds) {
                currentBeat = soundingPage.beats[i];
                break;
            }
        }

        while (
            this.measureCursor < this.measures.length - 1 &&
            timeSeconds + SAME_TIME_SECONDS >=
                this.measures[this.measureCursor + 1].timestamp
        ) {
            this.measureCursor++;
        }
        const measure = this.measures[this.measureCursor] as
            | Measure
            | undefined;
        // The active rehearsal mark is the most recent one at or before the
        // current measure (marks denote the start of a section)
        let rehearsalMark: string | null = null;
        const inMeasure =
            measure != null &&
            measure.timestamp <= timeSeconds + SAME_TIME_SECONDS;
        if (inMeasure) {
            for (let i = this.measureCursor; i >= 0; i--) {
                if (this.measures[i].rehearsalMark) {
                    rehearsalMark = this.measures[i].rehearsalMark;
                    break;
                }
            }
        }

        // Tempo from the beat currently sounding, at its measure's count tempo
        const tempoBpm = currentBeat
            ? countTempoBpm(currentBeat, inMeasure ? measure : undefined)
            : null;

        const page = this.pages[line?.pageIndex ?? 0];
        return {
            previousSetName: line
                ? (this.pages[line.pageIndex - 1]?.name ?? null)
                : null,
            setName: page.name,
            count: line?.count ?? 0,
            // The count lines stop at the page's beats, so the total does too
            totalCounts: line ? page.beats.length : 0,
            measureNumber: inMeasure && measure ? measure.number : null,
            rehearsalMark,
            tempoBpm,
            timeSeconds,
            totalSeconds: this.totalSeconds,
            formatBounds: this.formatBounds,
        };
    }
}

/** Two beat durations closer than this are the same length */
const SAME_DURATION_SECONDS = 1e-6;

/**
 * The short beat's length when a measure is mixed meter, such as 7/8 as 2+2+3: exactly two beat
 * lengths, the long one 1.5 times the short one (as `measureIsMixedMeter` in TempoGroup.ts decides
 * it). Null otherwise.
 */
function mixedMeterShortBeat(beats: readonly Beat[]): number | null {
    const lengths: number[] = [];
    for (const beat of beats)
        if (
            !lengths.some(
                (length) =>
                    Math.abs(length - beat.duration) < SAME_DURATION_SECONDS,
            )
        )
            lengths.push(beat.duration);
    if (lengths.length !== 2) return null;
    const short = Math.min(...lengths);
    const long = Math.max(...lengths);
    return short > 0 && Math.abs(long / short - 1.5) < 1e-3 ? short : null;
}

/**
 * The tempo a beat is counted at, in beats per minute, to two decimals so an exact tempo such as
 * 152.5 shows as itself. In a mixed-meter measure every beat reads the short beat's tempo, as the
 * tempo is written (♩=176 for 7/8 as 2+2+3), so the long beat doesn't make it jump. Null for a
 * beat with no length.
 */
export function countTempoBpm(
    beat: Beat,
    measure: Measure | undefined,
): number | null {
    if (!(beat.duration > 0)) return null;
    const inMeasure = measure?.beats?.some(
        (other) => other === beat || other.id === beat.id,
    );
    const short = inMeasure ? mixedMeterShortBeat(measure!.beats) : null;
    return Math.round((60 / (short ?? beat.duration)) * 100) / 100;
}

/** A tempo as the overlay writes it: "152.5", "176", "117.33" */
export function formatTempo(bpm: number): string {
    return String(Math.round(bpm * 100) / 100);
}

/** The widest tempo the show's overlay can write, in characters (at least 3, as "120") */
function maxTempoChars(pages: Page[], measures: Measure[]): number {
    const sorted = [...measures].sort((a, b) => a.timestamp - b.timestamp);
    let widest = 3;
    let cursor = -1;
    const beats = pages
        .flatMap((page) => page.beats)
        .sort((a, b) => a.timestamp - b.timestamp);
    for (const beat of beats) {
        while (
            cursor < sorted.length - 1 &&
            sorted[cursor + 1].timestamp <= beat.timestamp
        )
            cursor++;
        const bpm = countTempoBpm(beat, sorted[cursor]);
        if (bpm != null) widest = Math.max(widest, formatTempo(bpm).length);
    }
    return widest;
}

export function computeFormatBounds(
    pages: Page[],
    measures: Measure[],
    totalSeconds: number,
): OverlayFormatBounds {
    const countDigits = Math.max(
        1,
        ...pages.map((page) => String(page.beats.length).length),
    );
    const measureDigits =
        measures.length > 0
            ? Math.max(
                  1,
                  ...measures.map((measure) => String(measure.number).length),
              )
            : 1;
    const clockMinuteDigits = Math.max(
        1,
        String(Math.floor(totalSeconds / 60)).length,
    );
    let setNumberDigits = 1;
    let setSuffixChars = 0;
    for (const page of pages) {
        const parsed = parsePageName(page.name);
        setNumberDigits = Math.max(setNumberDigits, parsed.numberDigits);
        setSuffixChars = Math.max(setSuffixChars, parsed.suffixChars);
    }
    return {
        countDigits,
        measureDigits,
        clockMinuteDigits,
        tempoDigits: maxTempoChars(pages, measures),
        setNumberDigits,
        setSuffixChars: Math.min(setSuffixChars, 2),
    };
}

const PAGE_NAME_PATTERN = /^(\d+)([A-Za-z]*)$/;

function parsePageName(name: string): {
    numberDigits: number;
    suffixChars: number;
} {
    const match = name.match(PAGE_NAME_PATTERN);
    if (!match) {
        return { numberDigits: name.length, suffixChars: 0 };
    }
    return {
        numberDigits: match[1].length,
        suffixChars: match[2].length,
    };
}

function setNameLayoutTemplate(
    setNumberDigits: number,
    setSuffixChars: number,
): string {
    return digitTemplate(setNumberDigits) + "M".repeat(setSuffixChars);
}

export function padInteger(value: number, width: number): string {
    return String(value).padStart(width, "0");
}

export function padIntegerSpaced(value: number, width: number): string {
    return String(value).padStart(width, " ");
}

export function digitTemplate(width: number): string {
    return "8".repeat(width);
}

export function formatClock(seconds: number, minuteWidth?: number): string {
    const total = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(total / 60);
    const mins =
        minuteWidth !== undefined
            ? padIntegerSpaced(minutes, minuteWidth)
            : String(minutes);
    return `${mins}:${(total % 60).toString().padStart(2, "0")}`;
}

function formatClockLayout(minuteWidth: number): string {
    const mins = padIntegerSpaced(
        Number(digitTemplate(minuteWidth)),
        minuteWidth,
    );
    return `${mins}:88`;
}

/** Fixed-width elapsed/total pair with the slash anchored between both fields. */
export function formatClockRange(
    timeSeconds: number,
    totalSeconds: number,
    minuteWidth: number,
): { text: string; layoutText: string } {
    const fieldWidth = formatClockLayout(minuteWidth).length;
    const elapsed = formatClock(timeSeconds, minuteWidth).padStart(
        fieldWidth,
        " ",
    );
    const total = formatClock(totalSeconds, minuteWidth);
    const layoutElapsed = formatClockLayout(minuteWidth).padStart(
        fieldWidth,
        " ",
    );
    const layoutTotal = formatClockLayout(minuteWidth);
    return {
        text: `${elapsed} / ${total}`,
        layoutText: `${layoutElapsed} / ${layoutTotal}`,
    };
}

const FONT_FAMILY =
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const SEPARATOR = "  ·  ";

export interface OverlaySegment {
    text: string;
    bold: boolean;
    /** When set, used only for layout width in drawOverlay */
    layoutText?: string;
}

/**
 * Build the list of overlay items to display. Each segment flows like an
 * inline element: segments share a row when they fit within the placement
 * width and wrap onto new rows when they don't.
 */
export function buildOverlaySegments(
    state: OverlayState,
    options: OverlayOptions,
): OverlaySegment[] {
    const {
        countDigits,
        measureDigits,
        clockMinuteDigits,
        tempoDigits,
        setNumberDigits,
        setSuffixChars,
    } = state.formatBounds;
    const countTemplate = digitTemplate(countDigits);
    const setTemplate = setNameLayoutTemplate(setNumberDigits, setSuffixChars);
    const setTransitionLayout = `${options.setLabel} ${setTemplate} → ${setTemplate}`;
    const segments: OverlaySegment[] = [];
    if (options.showSet) {
        segments.push({
            text: state.previousSetName
                ? `${options.setLabel} ${state.previousSetName} → ${state.setName}`
                : `${options.setLabel} ${state.setName}`,
            layoutText: setTransitionLayout,
            bold: true,
        });
    }
    // The opening set has no counts to show
    if (options.showCounts && state.totalCounts > 0) {
        segments.push({
            text: `${options.countLabel} ${padInteger(state.count, countDigits)} / ${padInteger(state.totalCounts, countDigits)}`,
            layoutText: `${options.countLabel} ${countTemplate} / ${countTemplate}`,
            bold: true,
        });
    }
    if (options.showMeasures && state.measureNumber !== null) {
        const measureNumber = padInteger(state.measureNumber, measureDigits);
        const measureTemplate = digitTemplate(measureDigits);
        segments.push({
            text: state.rehearsalMark
                ? `[${state.rehearsalMark}]  m. ${measureNumber}`
                : `m. ${measureNumber}`,
            layoutText: state.rehearsalMark
                ? `[${state.rehearsalMark}]  m. ${measureTemplate}`
                : `m. ${measureTemplate}`,
            bold: false,
        });
    }
    if (options.showTempo && state.tempoBpm !== null) {
        segments.push({
            text: `${formatTempo(state.tempoBpm).padStart(tempoDigits, " ")} bpm`,
            layoutText: `${digitTemplate(tempoDigits)} bpm`,
            bold: false,
        });
    }
    if (options.showClock) {
        const clock = formatClockRange(
            state.timeSeconds,
            state.totalSeconds,
            clockMinuteDigits,
        );
        segments.push({
            text: clock.text,
            layoutText: clock.layoutText,
            bold: false,
        });
    }
    return segments;
}

const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max);

/**
 * Draw the overlay HUD on a video frame. Position, size, and width all come
 * from the normalized placement, so 720p and 4K renders look identical and
 * the in-modal preview matches the final video.
 *
 * @returns The pixel rect of the drawn box (used by the preview for
 * drag/resize hit-testing), or null if nothing was drawn.
 */
// eslint-disable-next-line max-lines-per-function
export function drawOverlay(
    ctx: CanvasRenderingContext2D,
    state: OverlayState,
    options: OverlayOptions,
    placement: OverlayPlacement,
    frameWidth: number,
    frameHeight: number,
    theme: VideoTheme,
): OverlayRect | null {
    const segments = buildOverlaySegments(state, options);
    if (segments.length === 0) return null;
    const colors = getVideoThemeColors(theme);

    const fontSize = Math.max(
        9,
        Math.round(frameHeight * 0.028 * placement.scale),
    );
    const padding = Math.round(fontSize * 0.6);
    const lineHeight = Math.round(fontSize * 1.35);
    const font = (bold: boolean) =>
        `${bold ? 600 : 400} ${fontSize}px ${FONT_FAMILY}`;

    ctx.save();
    const widths = segments.map((segment) => {
        ctx.font = font(segment.bold);
        return ctx.measureText(segment.layoutText ?? segment.text).width;
    });
    ctx.font = font(false);
    const separatorWidth = ctx.measureText(SEPARATOR).width;

    // Greedy row wrapping; a single segment is never broken, so the box can
    // always fit the widest item even below the requested width
    const maxContentWidth = Math.max(
        frameWidth * placement.widthFraction - padding * 2,
        ...widths,
    );
    const rows: number[][] = [[]];
    let rowWidth = 0;
    segments.forEach((_, i) => {
        const row = rows[rows.length - 1];
        const addedWidth =
            row.length > 0 ? separatorWidth + widths[i] : widths[i];
        if (row.length > 0 && rowWidth + addedWidth > maxContentWidth) {
            rows.push([i]);
            rowWidth = widths[i];
        } else {
            row.push(i);
            rowWidth += addedWidth;
        }
    });

    const rowWidths = rows.map((row) =>
        row.reduce(
            (total, i, j) => total + widths[i] + (j > 0 ? separatorWidth : 0),
            0,
        ),
    );
    const boxWidth = Math.max(...rowWidths) + padding * 2;
    const boxHeight = rows.length * lineHeight + padding * 2;
    const boxX = clamp(
        placement.x * frameWidth,
        0,
        Math.max(0, frameWidth - boxWidth),
    );
    const boxY = clamp(
        placement.y * frameHeight,
        0,
        Math.max(0, frameHeight - boxHeight),
    );

    ctx.fillStyle = colors.overlayBg;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxWidth, boxHeight, Math.round(padding * 0.66));
    ctx.fill();

    ctx.textBaseline = "middle";
    rows.forEach((row, rowIndex) => {
        let textX = boxX + padding;
        const textY = boxY + padding + rowIndex * lineHeight + lineHeight / 2;
        row.forEach((i, j) => {
            if (j > 0) {
                ctx.font = font(false);
                ctx.fillStyle = colors.overlayTextMuted;
                ctx.fillText(SEPARATOR, textX, textY);
                textX += separatorWidth;
            }
            ctx.font = font(segments[i].bold);
            ctx.fillStyle = colors.overlayText;
            ctx.fillText(segments[i].text, textX, textY);
            textX += widths[i];
        });
    });

    ctx.restore();
    return { x: boxX, y: boxY, width: boxWidth, height: boxHeight };
}

/* ------------------------------ Branding ------------------------------ */

export const BRANDING_TEXT = "Made with OpenMarch";

const logoPromises = new Map<VideoTheme, Promise<HTMLImageElement | null>>();

/** Load the OpenMarch marcher icon for canvas drawing. Cached per theme. */
export function loadBrandingLogo(
    theme: VideoTheme,
): Promise<HTMLImageElement | null> {
    const cached = logoPromises.get(theme);
    if (cached) return cached;

    const promise = new Promise<HTMLImageElement | null>((resolve) => {
        const svg = recolorMarcherIconSvg(
            getVideoThemeColors(theme).brandingLogoHex,
        );
        const url = URL.createObjectURL(
            new Blob([svg], { type: "image/svg+xml" }),
        );
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = url;
    });
    logoPromises.set(theme, promise);
    return promise;
}

/**
 * Draw the "Made with OpenMarch" watermark in the bottom-right corner of a
 * video frame.
 */
export function drawBranding(
    ctx: CanvasRenderingContext2D,
    logo: HTMLImageElement | null,
    frameWidth: number,
    frameHeight: number,
    theme: VideoTheme,
): void {
    const colors = getVideoThemeColors(theme);
    const fontSize = Math.max(8, Math.round(frameHeight * 0.019));
    const margin = Math.round(frameHeight * 0.02);
    const padding = Math.round(fontSize * 1);
    const verticalPadding = Math.round(padding / 2);

    ctx.save();
    ctx.font = `500 ${fontSize}px ${FONT_FAMILY}`;
    ctx.textBaseline = "middle";
    const textWidth = ctx.measureText(BRANDING_TEXT).width;
    const logoHeight = Math.round(fontSize * 1.4);
    const logoWidth = logo
        ? Math.round(logoHeight * (logo.width / logo.height))
        : 0;
    const gap = logo ? Math.round(fontSize * 0.5) : 0;

    const boxWidth = padding * 2 + logoWidth + gap + textWidth;
    const boxHeight = Math.max(logoHeight, fontSize) + verticalPadding * 2;
    const boxX = frameWidth - margin - boxWidth;
    const boxY = frameHeight - margin - boxHeight;

    ctx.fillStyle = colors.brandingBg;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxWidth, boxHeight, Math.round(boxHeight / 2));
    ctx.fill();

    const centerY = boxY + boxHeight / 2;
    if (logo) {
        ctx.globalAlpha = 0.92;
        ctx.drawImage(
            logo,
            boxX + padding,
            centerY - logoHeight / 2,
            logoWidth,
            logoHeight,
        );
        ctx.globalAlpha = 1;
    }
    ctx.fillStyle = colors.brandingText;
    ctx.fillText(BRANDING_TEXT, boxX + padding + logoWidth + gap, centerY);
    ctx.restore();
}
