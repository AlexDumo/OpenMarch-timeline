// cspell:ignore keyline keylined superframe superframes wordmark
import type { CanvasTexture } from "three";
import {
    brandArtReady,
    drawOtmLogo,
    fitText,
    paintCanvasTexture,
    repaintCanvasTexture,
    TEXTURE_FONT,
} from "../../environment";
import type { FieldCenterArt } from "../../field";
import { MARCHER_MARK, OPENMARCH_LOGO } from "../../field/brandMark";
import type { ShowCredits, VenueParams } from "../../types";

/**
 * The venue's identity: everything in the hall that carries a name or a
 * logo is painted here, on canvas, and says OpenMarch. No other brand, real
 * or made up. The marks are OpenMarch's own, never redrawn:
 *
 * - the logo, "OPEN" over "MARCH" with the marcher standing in for the O
 *   and the M (`OPENMARCH_LOGO`, from `apps/website/public/openmarch.svg`);
 * - the app icon: the marcher (`MARCHER_MARK`) in white on a violet rounded
 *   square, cut off at the bottom, as in `apps/desktop/build/icon.png`;
 * - the wordmark: the marcher beside OPENMARCH in DM Sans bold, as the field
 *   paints it in the end zones (`field/paint.ts`);
 * - the On The Move logo (`drawOtmLogo`) on one sideline board.
 *
 * The colors are the app's: brand violet, its dark-theme lavender, and the
 * near-black of the app's dark theme (`packages/ui/src/tailwind.css`); the
 * type is DM Sans, the app's face.
 *
 * Faces built from them: the drape's logo panel and championship banner,
 * the LED ribbons, the video boards' header and card, the field wall's pads,
 * the sideline boards, the rafter banners, the ring of legends, the flag,
 * the plaza's monument signs and the midfield paint. The event is GRAND NATIONAL CHAMPIONSHIPS; the boards
 * and ribbons show the show's own title when it has one.
 *
 * Painters take a 2D context and the face's size in pixels and nothing else,
 * so tests can run them against a recording context. The `diesel*Texture`
 * functions (named for the kit) wrap them in textures that repaint once the
 * app's font and the On The Move logo have loaded.
 */
export const OM = {
    /** LED black: the app's signage ground. */
    ink: "#07060d",
    /** The app's dark-theme background. */
    night: "#0f0e13",
    /** OpenMarch violet: the app icon, the accent, the end zones. */
    violet: "#6442ff",
    /** The accent in the app's dark theme. */
    lavender: "#967eff",
    /** Violet in shadow, for the ends of gradients and the vinyl's folds. */
    deep: "#3b23b8",
    /** The soft white the app's signage paints its logos in. */
    mist: "#cfcbe6",
    paper: "#f4f3f9",
    white: "#ffffff",
} as const;

/** The name as signage sets it in capitals. */
export const OPENMARCH_SIGN = "OPENMARCH";
export const OPENMARCH_URL = "openmarch.com";
/** The website's own line (`apps/website`, home page). */
export const OPENMARCH_TAGLINE = "FREE & OPEN-SOURCE DRILL WRITING";
export const OPENMARCH_3D = "DESIGN YOUR SHOW IN 3D";
export const DIESEL_EVENT = "GRAND NATIONAL CHAMPIONSHIPS";
/** The round of the event the hall is dressed for. */
export const DIESEL_ROUND = "PRELIMS";

/**
 * The venue's colors and end-zone lettering for a show that has not chosen
 * its own (`defaultVenueForKit`): OpenMarch's, the same as every kit's.
 */
export const DIESEL_VENUE_PARAMS: Readonly<VenueParams> = Object.freeze({
    homeColor: OM.violet,
    awayColor: "#c23b3b",
    endZoneText: OPENMARCH_SIGN,
    endZoneColor: OM.violet,
});

/** Cap height over font size for DM Sans and its fallbacks. */
const CAP = 0.7;

type G = CanvasRenderingContext2D;

/** Sets canvas letter spacing where supported (Chromium; not every test DOM). */
function tracking(g: G, px: number): void {
    const c = g as G & { letterSpacing?: string };
    if ("letterSpacing" in c) c.letterSpacing = `${px}px`;
}

export interface SignTextOptions {
    color: string;
    align?: "left" | "center" | "right";
    /** Letter spacing in ems. */
    spacing?: number;
    /** Extra weight, as a stroke in ems, over DM Sans bold. */
    weight?: number;
    /** Shrinks the text to fit this width. */
    maxWidth?: number;
}

const signFont = (cap: number) => `700 ${cap / CAP}px ${TEXTURE_FONT}`;

/** Width of `text` as `signText` sets it at this cap height. */
function signWidth(g: G, text: string, cap: number, spacing = 0.04): number {
    g.font = signFont(cap);
    tracking(g, (spacing * cap) / CAP);
    const width = g.measureText(text).width;
    tracking(g, 0);
    return width;
}

/**
 * DM Sans bold, `cap` pixels tall, vertically centered on `cy`. Signage
 * across a hall wants a little more than bold, so the letters are also
 * stroked in their own color. Returns the width drawn.
 */
export function signText(
    g: G,
    text: string,
    x: number,
    cy: number,
    cap: number,
    options: SignTextOptions,
): number {
    const { color, align = "left", spacing = 0.04 } = options;
    let width = signWidth(g, text, cap, spacing);
    if (options.maxWidth && width > options.maxWidth) {
        cap *= options.maxWidth / width;
        width = options.maxWidth;
    }
    const left =
        align === "center" ? x - width / 2 : align === "right" ? x - width : x;
    g.save();
    g.font = signFont(cap);
    tracking(g, (spacing * cap) / CAP);
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.fillStyle = color;
    g.strokeStyle = color;
    g.lineJoin = "round";
    g.lineWidth = ((options.weight ?? 0.025) * cap) / CAP;
    g.fillText(text, left, cy + cap / 2);
    if (g.lineWidth > 0) g.strokeText(text, left, cy + cap / 2);
    tracking(g, 0);
    g.restore();
    return width;
}

type Mark = {
    readonly width: number;
    readonly height: number;
    readonly paths: readonly string[];
};

/** Each mark's paths, parsed once. */
const parsed = new Map<Mark, Path2D[]>();
function markPaths(mark: Mark): Path2D[] | null {
    // Test DOMs may lack Path2D; the marks are then left out.
    if (typeof Path2D === "undefined") return null;
    let paths = parsed.get(mark);
    if (!paths) {
        paths = mark.paths.map((d) => new Path2D(d));
        parsed.set(mark, paths);
    }
    return paths;
}

/**
 * Fills a mark `height` pixels tall from its top-left corner (x, y). With
 * `keyline`, first strokes it that wide (in pixels) in another color, so it
 * stands out from a busy ground.
 */
function fillMark(
    g: G,
    mark: Mark,
    x: number,
    y: number,
    height: number,
    color: string,
    keyline?: { color: string; width: number },
): void {
    const paths = markPaths(mark);
    if (!paths) return;
    const k = height / mark.height;
    g.save();
    g.translate(x, y);
    g.scale(k, k);
    if (keyline) {
        g.strokeStyle = keyline.color;
        g.lineJoin = "round";
        g.lineWidth = (2 * keyline.width) / k;
        for (const p of paths) g.stroke(p);
    }
    g.fillStyle = color;
    for (const p of paths) g.fill(p);
    g.restore();
}

/** Logo width over height. */
export const LOGO_ASPECT = OPENMARCH_LOGO.width / OPENMARCH_LOGO.height;

/**
 * The OpenMarch logo, `height` pixels tall, centered on (cx, cy), in one
 * color. Returns its width.
 */
export function paintLogo(
    g: G,
    cx: number,
    cy: number,
    height: number,
    color: string,
    keyline?: { color: string; width: number },
): number {
    const width = height * LOGO_ASPECT;
    fillMark(
        g,
        OPENMARCH_LOGO,
        cx - width / 2,
        cy - height / 2,
        height,
        color,
        keyline,
    );
    return width;
}

/** The marcher on its own, `height` tall, from its top-left corner. */
export function paintMarcher(
    g: G,
    x: number,
    y: number,
    height: number,
    color: string,
): number {
    fillMark(g, MARCHER_MARK, x, y, height, color);
    return (height * MARCHER_MARK.width) / MARCHER_MARK.height;
}

/**
 * The app icon, `size` pixels square, centered on (cx, cy): a violet rounded
 * square with the white marcher filling its height and running off the
 * bottom edge. `edge` rings it in a color, for a violet ground.
 */
export function paintAppIcon(
    g: G,
    cx: number,
    cy: number,
    size: number,
    edge?: string,
): void {
    const x = cx - size / 2;
    const y = cy - size / 2;
    const radius = size * 0.12;
    if (edge) {
        const e = size * 0.05;
        g.beginPath();
        g.roundRect(x - e, y - e, size + 2 * e, size + 2 * e, radius + e);
        g.fillStyle = edge;
        g.fill();
    }
    g.save();
    g.beginPath();
    g.roundRect(x, y, size, size, radius);
    g.fillStyle = OM.violet;
    g.fill();
    g.clip();
    // As the icon has it: the marcher is 0.37 of the tile wide, its plume
    // just under the top edge.
    const markWidth = size * 0.37;
    const markHeight = (markWidth * MARCHER_MARK.height) / MARCHER_MARK.width;
    paintMarcher(g, cx - markWidth / 2, y + size * 0.045, markHeight, OM.white);
    g.restore();
}

export interface WordmarkOptions {
    color: string;
    /** The marcher's color; the text's by default. */
    markColor?: string;
    align?: "left" | "center" | "right";
    maxWidth?: number;
}

/** The marcher's height and the gap after it, in cap heights (`field/paint.ts`). */
const WORDMARK_MARK = 1.3;
const WORDMARK_GAP = 0.3;

/**
 * The wordmark: the marcher, then OPENMARCH in DM Sans bold `cap` pixels
 * tall, as the end zones paint it. Returns the width drawn.
 */
export function paintWordmark(
    g: G,
    x: number,
    cy: number,
    cap: number,
    options: WordmarkOptions,
): number {
    const { color, align = "left" } = options;
    const markWidth = (c: number) =>
        (c * WORDMARK_MARK * MARCHER_MARK.width) / MARCHER_MARK.height;
    const measure = (c: number) =>
        markWidth(c) + c * WORDMARK_GAP + signWidth(g, OPENMARCH_SIGN, c);
    let total = measure(cap);
    if (options.maxWidth && total > options.maxWidth) {
        cap *= options.maxWidth / total;
        total = measure(cap);
    }
    const left =
        align === "center" ? x - total / 2 : align === "right" ? x - total : x;
    const markHeight = cap * WORDMARK_MARK;
    paintMarcher(
        g,
        left,
        cy - markHeight / 2,
        markHeight,
        options.markColor ?? color,
    );
    signText(
        g,
        OPENMARCH_SIGN,
        left + markWidth(cap) + cap * WORDMARK_GAP,
        cy,
        cap,
        { color },
    );
    return total;
}

/** The drape's logo panel: the app icon on a black square with a fine edge. */
export function paintLogoPanel(g: G, w: number, h: number): void {
    g.fillStyle = OM.ink;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(207,203,230,0.16)";
    g.lineWidth = Math.max(2, h * 0.006);
    g.strokeRect(h * 0.02, h * 0.02, w - h * 0.04, h - h * 0.04);
    paintAppIcon(g, w / 2, h / 2, Math.min(w, h) * 0.78);
}

/** Width over height of the drape's championship banner. */
export const DIESEL_BANNER_ASPECT = 10;

/**
 * The drape's banner: the logo, a lavender rule, and GRAND NATIONAL
 * CHAMPIONSHIPS, white on black.
 */
export function paintChampionshipBanner(g: G, w: number, h: number): void {
    g.fillStyle = OM.ink;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(207,203,230,0.18)";
    g.lineWidth = Math.max(2, h * 0.012);
    g.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1);
    const logoH = h * 0.66;
    const logoW = logoH * LOGO_ASPECT;
    const gap = h * 0.55;
    const cap = h * 0.34;
    const textW = Math.min(
        signWidth(g, DIESEL_EVENT, cap, 0.06),
        w - h * 1.2 - logoW - 2 * gap,
    );
    let at = (w - (logoW + 2 * gap + textW)) / 2;
    paintLogo(g, at + logoW / 2, h / 2, logoH, OM.white);
    at += logoW + gap;
    g.fillStyle = OM.lavender;
    g.fillRect(at - h * 0.015, h * 0.22, h * 0.03, h * 0.56);
    signText(g, DIESEL_EVENT, at + gap, h / 2, cap, {
        color: OM.white,
        spacing: 0.06,
        maxWidth: textW,
    });
}

/**
 * One tile of the padded field wall (16 wall heights long): violet vinyl
 * pads with their seams, the wordmark and the address.
 */
export function paintWallPad(g: G, w: number, h: number): void {
    const sheen = g.createLinearGradient(0, 0, 0, h);
    sheen.addColorStop(0, "#7a5dff");
    sheen.addColorStop(0.16, OM.violet);
    sheen.addColorStop(0.8, "#5233e6");
    sheen.addColorStop(1, OM.deep);
    g.fillStyle = sheen;
    g.fillRect(0, 0, w, h);
    // Eight pads a tile, each with a seam.
    for (let i = 0; i < 8; i++) {
        const x = (i * w) / 8;
        g.fillStyle = "rgba(20,8,70,0.5)";
        g.fillRect(x - 2, 0, 4, h);
        g.fillStyle = "rgba(255,255,255,0.1)";
        g.fillRect(x + 2, 0, 2, h);
    }
    // The rolled top edge.
    g.fillStyle = "rgba(255,255,255,0.16)";
    g.fillRect(0, 0, w, h * 0.05);
    paintWordmark(g, w * 0.3, h * 0.53, h * 0.42, {
        color: OM.white,
        align: "center",
        maxWidth: w * 0.4,
    });
    signText(g, OPENMARCH_URL, w * 0.76, h * 0.53, h * 0.36, {
        color: OM.white,
        align: "center",
        spacing: 0.02,
        maxWidth: w * 0.36,
    });
}

/** What the ring of legends says, between app icons. */
const RING_LEGENDS = [
    OPENMARCH_SIGN,
    DIESEL_EVENT,
    OPENMARCH_3D,
    OPENMARCH_URL.toUpperCase(),
    OPENMARCH_TAGLINE,
    "RING OF CHAMPIONS",
];

/**
 * One tile of the upper deck's fascia: small white legends on black, the app
 * icon between each. The name itself is the wordmark.
 */
export function paintNameRing(g: G, w: number, h: number): void {
    g.fillStyle = OM.ink;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,0.1)";
    g.fillRect(0, 0, w, 2);
    g.fillRect(0, h - 2, w, 2);
    const slot = w / RING_LEGENDS.length;
    RING_LEGENDS.forEach((legend, i) => {
        const x = i * slot;
        paintAppIcon(g, x + h * 0.5, h / 2, h * 0.58);
        const options = {
            color: "#eceaf4",
            align: "center" as const,
            maxWidth: slot - h * 1.6,
        };
        const cx = x + slot / 2 + h * 0.3;
        if (legend === OPENMARCH_SIGN)
            paintWordmark(g, cx, h / 2, h * 0.3, options);
        else
            signText(g, legend, cx, h / 2, h * 0.24, {
                ...options,
                spacing: 0.12,
                weight: 0,
            });
    });
}

/** What the LED ribbons show besides the event's name. */
export interface DieselRibbonState {
    /** The show's title; blank shows the wordmark instead. */
    title: string;
    /** The time of day, as `dieselClock` formats it. */
    time: string;
    year: number;
}

/** The ribbons' clock and year for a date: "8:43 PM". */
export function dieselClock(date: Date): { time: string; year: number } {
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const time = `${hours % 12 || 12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
    return { time, year: date.getFullYear() };
}

/** The ribbons' state with a blank title, for the first paint. */
export function dieselRibbonState(date: Date): DieselRibbonState {
    return { title: "", ...dieselClock(date) };
}

/** A hairline along both edges, the one constant all the way round. */
function ledEdges(g: G, w: number, h: number, color: string): void {
    g.fillStyle = color;
    g.fillRect(0, 0, w, Math.max(2, h * 0.03));
    g.fillRect(0, h - Math.max(2, h * 0.03), w, Math.max(2, h * 0.03));
}

/**
 * One tile of the lower LED ribbon (32 ribbon heights long), left to right:
 * a violet block with the logo and the address, the year and the event with
 * the round in a lavender pill, the clock, and the show now performing (or
 * the wordmark).
 */
export function paintRibbonLower(
    g: G,
    w: number,
    h: number,
    state: DieselRibbonState,
): void {
    const u = w / 32;
    g.fillStyle = OM.ink;
    g.fillRect(0, 0, w, h);

    // The violet block.
    const block = g.createLinearGradient(0, 0, 4.6 * u, 0);
    block.addColorStop(0, OM.violet);
    block.addColorStop(1, OM.deep);
    g.fillStyle = block;
    g.fillRect(0, 0, 4.6 * u, h);
    const logoH = h * 0.78;
    paintLogo(g, 0.25 * u + (logoH * LOGO_ASPECT) / 2, h / 2, logoH, OM.white);
    signText(g, OPENMARCH_URL, 0.5 * u + logoH * LOGO_ASPECT, h / 2, h * 0.3, {
        color: OM.white,
        spacing: 0.02,
        maxWidth: 4.3 * u - logoH * LOGO_ASPECT - 0.4 * u,
    });

    // The event, then the round in a pill.
    const event = `${state.year} ${DIESEL_EVENT}`;
    const eventWidth = signText(g, event, 5.1 * u, h / 2, h * 0.4, {
        color: OM.white,
        maxWidth: 13.4 * u,
    });
    const pillX = 5.1 * u + eventWidth + 0.45 * u;
    const pillW = 2.5 * u;
    const pillH = h * 0.56;
    g.fillStyle = OM.lavender;
    g.beginPath();
    g.roundRect(pillX, (h - pillH) / 2, pillW, pillH, pillH / 2);
    g.fill();
    signText(g, DIESEL_ROUND, pillX + pillW / 2, h / 2, h * 0.26, {
        color: OM.ink,
        align: "center",
        spacing: 0.08,
        maxWidth: pillW - 0.5 * u,
    });

    // The clock, on a night block between two violet rules.
    g.fillStyle = OM.night;
    g.fillRect(22 * u, 0, 3.8 * u, h);
    g.fillStyle = OM.violet;
    g.fillRect(22 * u, 0, 0.08 * u, h);
    g.fillRect(25.72 * u, 0, 0.08 * u, h);
    signText(g, state.time, 23.9 * u, h / 2, h * 0.42, {
        color: OM.white,
        align: "center",
        spacing: 0.04,
        maxWidth: 3.3 * u,
    });

    // Now performing, or the wordmark.
    const title = state.title.trim();
    if (title) {
        signText(g, "NOW PERFORMING", 26.2 * u, h * 0.27, h * 0.16, {
            color: OM.lavender,
            spacing: 0.16,
            weight: 0,
        });
        g.fillStyle = OM.white;
        g.textAlign = "left";
        g.textBaseline = "middle";
        g.fillText(
            fitText(g, title, 700, h * 0.42, h * 0.24, 5.4 * u),
            26.2 * u,
            h * 0.64,
        );
    } else
        paintWordmark(g, 26.2 * u, h / 2, h * 0.36, {
            color: OM.white,
            maxWidth: 5.4 * u,
        });
    ledEdges(g, w, h, "rgba(100,66,255,0.6)");
}

/**
 * One tile of the upper LED ribbon: the event's name and the round in white
 * on black, the app icon at each end of a violet-to-lavender glow.
 */
export function paintRibbonUpper(g: G, w: number, h: number): void {
    g.fillStyle = OM.ink;
    g.fillRect(0, 0, w, h);
    const glow = g.createLinearGradient(0, 0, w, 0);
    glow.addColorStop(0, OM.lavender);
    glow.addColorStop(0.08, OM.violet);
    glow.addColorStop(0.2, "rgba(100,66,255,0)");
    glow.addColorStop(0.8, "rgba(100,66,255,0)");
    glow.addColorStop(0.92, OM.violet);
    glow.addColorStop(1, OM.lavender);
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
    for (const at of [0.155, 0.845]) {
        paintAppIcon(g, w * at, h / 2, h * 0.72, OM.white);
    }
    signText(g, `${DIESEL_EVENT} – ${DIESEL_ROUND}`, w / 2, h / 2, h * 0.42, {
        color: OM.white,
        align: "center",
        spacing: 0.06,
        maxWidth: w * 0.6,
    });
    ledEdges(g, w, h, "rgba(255,255,255,0.22)");
}

/**
 * The sign over each video board: the logo in lit white, between two
 * lavender rules, with the app icon at each end.
 */
export function paintBoardHeader(g: G, w: number, h: number): void {
    g.fillStyle = "#0b0a10";
    g.fillRect(0, 0, w, h);
    const logoH = h * 0.8;
    const logoW = paintLogo(g, w / 2, h / 2, logoH, OM.white);
    g.fillStyle = OM.lavender;
    for (const side of [-1, 1]) {
        const x0 = w / 2 + side * (logoW / 2 + h * 0.5);
        const x1 = w / 2 + side * (w / 2 - h * 1.4);
        g.fillRect(Math.min(x0, x1), h * 0.48, Math.abs(x1 - x0), h * 0.04);
        paintAppIcon(g, w / 2 + side * (w / 2 - h * 0.7), h / 2, h * 0.78);
    }
}

/**
 * The card a video board shows when it has no live picture: the app icon,
 * the logo, the event, and the show now performing, bright on violet.
 */
export function paintBoardCard(
    g: G,
    w: number,
    h: number,
    credits: ShowCredits,
): void {
    const ground = g.createLinearGradient(0, 0, w, h);
    ground.addColorStop(0, OM.violet);
    ground.addColorStop(0.55, OM.deep);
    ground.addColorStop(1, OM.night);
    g.fillStyle = ground;
    g.fillRect(0, 0, w, h);
    // The marcher, huge and faint, across the right of the card.
    g.save();
    g.globalAlpha = 0.1;
    paintMarcher(g, w * 0.7, -h * 0.1, h * 1.5, OM.white);
    g.restore();

    const icon = h * 0.5;
    paintAppIcon(g, w * 0.2, h * 0.42, icon, OM.white);
    const left = w * 0.2 + icon / 2 + h * 0.1;
    const room = w - left - h * 0.1;
    const logoH = h * 0.16;
    paintLogo(g, left + (logoH * LOGO_ASPECT) / 2, h * 0.26, logoH, OM.white);
    signText(g, "GRAND NATIONAL", left, h * 0.46, h * 0.1, {
        color: OM.white,
        maxWidth: room,
    });
    signText(g, "CHAMPIONSHIPS", left, h * 0.6, h * 0.1, {
        color: OM.white,
        maxWidth: room,
    });

    // The lower third: the show now performing.
    g.fillStyle = "rgba(7,6,13,0.84)";
    g.fillRect(0, h * 0.78, w, h * 0.22);
    g.fillStyle = OM.lavender;
    g.fillRect(0, h * 0.78, w, h * 0.012);
    const heading = credits.text?.heading ?? "Now performing";
    const title = credits.title || credits.text?.untitled || "OpenMarch";
    signText(g, heading.toLocaleUpperCase(), h * 0.1, h * 0.84, h * 0.036, {
        color: OM.lavender,
        spacing: 0.16,
        weight: 0,
        maxWidth: w - h * 0.2,
    });
    g.fillStyle = OM.white;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(
        fitText(g, title, 700, h * 0.085, h * 0.05, w - h * 0.2),
        h * 0.1,
        h * 0.925,
    );
}

/** What one sideline board shows. */
export type SponsorFace =
    /** The marcher and OPENMARCH. */
    | "wordmark"
    /** The stacked logo. */
    | "logo"
    /** The app icon and a line of text. */
    | "icon"
    /** A line of text. */
    | "text"
    /** The On The Move app's logo. */
    | "otm"
    /** The logo and the event's name, on the long middle boards. */
    | "event";

/** One board on the back sideline: OpenMarch's, every one. */
export interface SponsorPanel {
    /** Meters wide; every board is `SPONSOR_HEIGHT` tall. */
    width: number;
    face: SponsorFace;
    /** The line on a "text" or "icon" board. */
    text?: string;
    ground: string;
    color: string;
}

/** Height of the sponsor boards, meters. */
export const SPONSOR_HEIGHT = 1;

const board = (
    face: SponsorFace,
    ground: string,
    color: string,
    text?: string,
): SponsorPanel => ({ width: 7, face, ground, color, text });
const EVENT_BOARD: SponsorPanel = {
    width: 13,
    face: "event",
    ground: OM.ink,
    color: OM.white,
};

/** The boards along the back sideline, from the audience's left to right. */
export const SPONSOR_PANELS: SponsorPanel[] = [
    board("text", OM.paper, OM.violet, OPENMARCH_URL),
    board("logo", OM.violet, OM.white),
    board("text", OM.night, OM.lavender, OPENMARCH_3D),
    board("otm", OM.ink, OM.white),
    EVENT_BOARD,
    EVENT_BOARD,
    board("wordmark", OM.violet, OM.white),
    board("icon", OM.paper, OM.ink, "DRILL WRITING"),
    board("text", OM.night, OM.white, "FREE & OPEN-SOURCE"),
    board("logo", OM.paper, OM.violet),
];

/** One sponsor board, `w` x `h` pixels. */
export function paintSponsorPanel(
    g: G,
    panel: SponsorPanel,
    w: number,
    h: number,
): void {
    g.fillStyle = panel.ground;
    g.fillRect(0, 0, w, h);
    // The frame of the board.
    g.strokeStyle = "rgba(0,0,0,0.5)";
    g.lineWidth = Math.max(2, h * 0.04);
    g.strokeRect(0, 0, w, h);
    const { color } = panel;
    const room = w - h * 0.7;
    switch (panel.face) {
        case "event": {
            paintAppIcon(g, h * 0.62, h / 2, h * 0.76);
            const logoH = h * 0.74;
            const logoW = paintLogo(
                g,
                h * 1.3 + (logoH * LOGO_ASPECT) / 2,
                h / 2,
                logoH,
                color,
            );
            const left = h * 1.3 + logoW + h * 0.45;
            signText(g, DIESEL_EVENT, left, h / 2, h * 0.3, {
                color,
                spacing: 0.06,
                maxWidth: w - left - h * 0.4,
            });
            return;
        }
        case "logo":
            paintLogo(g, w / 2, h / 2, h * 0.78, color);
            return;
        case "wordmark":
            paintWordmark(g, w / 2, h / 2, h * 0.4, {
                color,
                align: "center",
                maxWidth: room,
            });
            return;
        case "otm":
            drawOtmLogo(
                g,
                { x: h * 0.3, y: h * 0.06, w: w - h * 0.6, h: h * 0.88 },
                color,
            );
            return;
        case "icon": {
            paintAppIcon(g, h * 0.62, h / 2, h * 0.76);
            const left = h * 1.2;
            signText(
                g,
                panel.text ?? "",
                left + (w - left - h * 0.3) / 2,
                h / 2,
                h * 0.34,
                {
                    color,
                    align: "center",
                    spacing: 0.06,
                    maxWidth: w - left - h * 0.4,
                },
            );
            return;
        }
        case "text": {
            // The marcher leads the line, as it leads the wordmark.
            const text = panel.text ?? "";
            let cap = h * 0.36;
            const markW = (c: number) =>
                (c * WORDMARK_MARK * MARCHER_MARK.width) / MARCHER_MARK.height;
            const run = (c: number) =>
                markW(c) + c * WORDMARK_GAP + signWidth(g, text, c);
            if (run(cap) > room) cap *= room / run(cap);
            const left = (w - run(cap)) / 2;
            const markH = cap * WORDMARK_MARK;
            paintMarcher(g, left, h / 2 - markH / 2, markH, color);
            signText(
                g,
                text,
                left + markW(cap) + cap * WORDMARK_GAP,
                h / 2,
                cap,
                {
                    color,
                },
            );
        }
    }
}

/** One rafter banner: what it celebrates, and whether it is the white one. */
export interface RafterBanner {
    lines: string[];
    year: string;
    white?: boolean;
}

/** The banners on the trusses; they repeat in this order. */
export const RAFTER_BANNERS: RafterBanner[] = [
    { lines: ["GRAND", "NATIONAL", "CHAMPIONS"], year: "2009" },
    { lines: ["GRAND", "NATIONAL", "CHAMPIONS"], year: "2013" },
    { lines: ["DIVISION", "CHAMPIONS"], year: "2014" },
    { lines: [OPENMARCH_SIGN], year: "", white: true },
    { lines: ["GRAND", "NATIONAL", "CHAMPIONS"], year: "2016" },
    { lines: ["DIVISION", "CHAMPIONS"], year: "2019" },
    { lines: ["GRAND", "NATIONAL", "FINALISTS"], year: "2022" },
    { lines: ["GRAND", "NATIONAL", "CHAMPIONS"], year: "2024" },
];

/** Width over height of a rafter banner. */
export const RAFTER_BANNER_ASPECT = 0.4;

/**
 * One rafter banner, `w` x `h` pixels: the app icon, then what it celebrates
 * and the year; the white one carries the logo instead.
 */
export function paintRafterBanner(
    g: G,
    banner: RafterBanner,
    w: number,
    h: number,
): void {
    const ground = banner.white ? OM.paper : "#22176a";
    const ink = banner.white ? OM.violet : OM.white;
    g.fillStyle = ground;
    g.fillRect(0, 0, w, h);
    // A stitched border and the pole sleeve along the top.
    g.strokeStyle = banner.white
        ? "rgba(100,66,255,0.5)"
        : "rgba(255,255,255,0.5)";
    g.lineWidth = Math.max(2, w * 0.016);
    g.strokeRect(w * 0.06, w * 0.06, w * 0.88, h - w * 0.12);
    g.fillStyle = "rgba(0,0,0,0.3)";
    g.fillRect(0, 0, w, w * 0.035);

    paintAppIcon(g, w / 2, w * 0.5, w * 0.58);
    if (banner.lines.length === 1 && banner.lines[0] === OPENMARCH_SIGN) {
        // The logo, upright and as wide as the banner allows, then the
        // address at the foot.
        const logoW = w * 0.74;
        const logoH = logoW / LOGO_ASPECT;
        paintLogo(g, w / 2, w * 1.25 + logoH / 2, logoH, ink);
        signText(g, OPENMARCH_URL, w / 2, h - w * 0.36, w * 0.075, {
            color: ink,
            align: "center",
            spacing: 0.02,
            maxWidth: w * 0.74,
        });
        return;
    }
    let y = w * 1.08;
    for (const line of banner.lines) {
        signText(g, line, w / 2, y, w * 0.115, {
            color: ink,
            align: "center",
            spacing: 0.08,
            maxWidth: w * 0.74,
        });
        y += w * 0.2;
    }
    signText(g, banner.year, w / 2, h - w * 0.36, w * 0.25, {
        color: OM.lavender,
        align: "center",
        maxWidth: w * 0.74,
    });
}

/** Width over height of the flag on each superframe. */
export const DIESEL_FLAG_ASPECT = 2 / 3;

/**
 * The hall's flag, hung tall: the app icon's violet field and white marcher,
 * cut off at the bottom as on the icon, inside a white edge.
 */
export function paintDieselFlag(g: G, w: number, h: number): void {
    g.fillStyle = OM.violet;
    g.fillRect(0, 0, w, h);
    g.save();
    g.beginPath();
    g.rect(0, 0, w, h);
    g.clip();
    const markWidth = w * 0.56;
    const markHeight = (markWidth * MARCHER_MARK.height) / MARCHER_MARK.width;
    paintMarcher(g, (w - markWidth) / 2, h * 0.07, markHeight, OM.white);
    g.restore();
    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.lineWidth = Math.max(2, w * 0.012);
    g.strokeRect(w * 0.04, w * 0.04, w * 0.92, h - w * 0.08);
}

/** Width over height of the face of a plaza monument sign. */
export const MONUMENT_ASPECT = 2.6;

/**
 * The face of a monument sign on the plaza: the app icon and the logo in
 * white on the app's night, over a violet foot with the address.
 */
export function paintMonument(g: G, w: number, h: number): void {
    g.fillStyle = OM.night;
    g.fillRect(0, 0, w, h);
    const foot = h * 0.2;
    g.fillStyle = OM.violet;
    g.fillRect(0, h - foot, w, foot);
    g.fillStyle = OM.lavender;
    g.fillRect(0, h - foot, w, Math.max(2, h * 0.012));
    const body = h - foot;
    const icon = body * 0.62;
    const logoH = body * 0.5;
    const logoW = logoH * LOGO_ASPECT;
    const gap = body * 0.16;
    const left = (w - (icon + gap + logoW)) / 2;
    paintAppIcon(g, left + icon / 2, body / 2, icon);
    paintLogo(g, left + icon + gap + logoW / 2, body / 2, logoH, OM.white);
    signText(g, OPENMARCH_URL, w / 2, h - foot / 2, foot * 0.42, {
        color: OM.white,
        align: "center",
        spacing: 0.04,
        maxWidth: w * 0.8,
    });
}

/** Width over height of the midfield helmet. */
const HELMET_ASPECT = 1.1;

/**
 * The paint at midfield: a football helmet seen from the side, facing the
 * left end zone, with the OpenMarch marcher on its shell, in the box the
 * turf drawings give the midfield logo (27 ft across, 13 ft 6 in each side
 * of the 50; `FieldSurfaceInput.centerArt`). A plain white shell with a
 * violet edge, stripe and mark, and a gray face mask.
 */
export const dieselFieldArt: FieldCenterArt = {
    aspect: HELMET_ASPECT,
    maxWidth: 27 * 0.3048,
    paint(g, w, h) {
        paintHelmet(g, w, h);
    },
};

/** Paints the midfield helmet into a `w` x `h` box (`dieselFieldArt`). */
export function paintHelmet(g: G, w: number, h: number): void {
    // Drawn in units of the box's height, from the top-left corner.
    const u = Math.min(h, w / HELMET_ASPECT);
    g.save();
    g.translate((w - u * HELMET_ASPECT) / 2, (h - u) / 2);
    g.scale(u, u);
    g.lineJoin = "round";
    g.lineCap = "round";
    const cx = 0.62;
    const cy = 0.5;
    const r = 0.44;
    const deg = Math.PI / 180;
    const shell = () => {
        g.beginPath();
        // Over the crown from the back of the neck to the brow.
        g.arc(cx, cy, r, 25 * deg, 170 * deg, true);
        g.lineTo(0.3, 0.62);
        g.lineTo(0.36, 0.86);
        g.lineTo(0.7, 0.9);
        g.quadraticCurveTo(
            0.98,
            0.86,
            cx + r * Math.cos(25 * deg),
            cy + r * Math.sin(25 * deg),
        );
        g.closePath();
    };
    const mask = () => {
        g.beginPath();
        // Two bars from the brow and the jaw, joined by a curved front.
        g.moveTo(0.31, 0.6);
        g.lineTo(0.1, 0.6);
        g.quadraticCurveTo(0.02, 0.6, 0.03, 0.7);
        g.lineTo(0.06, 0.84);
        g.quadraticCurveTo(0.09, 0.9, 0.18, 0.9);
        g.lineTo(0.37, 0.86);
        g.moveTo(0.04, 0.75);
        g.lineTo(0.34, 0.74);
        g.moveTo(0.18, 0.6);
        g.lineTo(0.18, 0.9);
    };
    // The face mask: gray bars edged in violet.
    mask();
    g.strokeStyle = OM.violet;
    g.lineWidth = 0.06;
    g.stroke();
    g.strokeStyle = "#b8bcc8";
    g.lineWidth = 0.032;
    g.stroke();
    // The shell, edged in violet.
    shell();
    g.fillStyle = OM.white;
    g.fill();
    g.strokeStyle = OM.violet;
    g.lineWidth = 0.04;
    g.stroke();
    // A stripe along the crown, clipped to the shell.
    g.save();
    shell();
    g.clip();
    g.beginPath();
    g.arc(cx, cy, r - 0.06, 200 * deg, 345 * deg);
    g.lineWidth = 0.05;
    g.lineCap = "butt";
    g.stroke();
    g.restore();
    // The ear hole.
    g.beginPath();
    g.arc(0.72, 0.68, 0.032, 0, Math.PI * 2);
    g.fillStyle = OM.violet;
    g.fill();
    // The OpenMarch marcher on the shell.
    const markHeight = 0.4;
    const markWidth = (markHeight * MARCHER_MARK.width) / MARCHER_MARK.height;
    paintMarcher(g, 0.64 - markWidth / 2, 0.2, markHeight, OM.violet);
    g.restore();
}

type Paint = (g: G, width: number, height: number) => void;

let artReady: Promise<void> | null = null;
/**
 * Resolves once the app's face and the On The Move logo have loaded (at once
 * where they already have, or can't).
 */
function dieselArtReady(): Promise<void> {
    if (artReady) return artReady;
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    const face = '700 64px "DM Sans"';
    const font =
        !fonts || typeof fonts.load !== "function"
            ? Promise.resolve()
            : fonts.load(face).then(
                  () => undefined,
                  () => undefined,
              );
    artReady = Promise.all([font, brandArtReady()]).then(() => undefined);
    return artReady;
}

/**
 * A texture for signage: painted now, and again once the app's face and the
 * On The Move logo have loaded (a canvas waits for neither), with mipmaps
 * and the sharpest filtering the GPU has, so lettering holds up across the
 * hall. `paint` may read state that changes; `repaintCanvasTexture` shows
 * the change.
 */
export function dieselTexture(
    width: number,
    height: number,
    paint: Paint,
    options: { repeat?: boolean } = {},
): CanvasTexture {
    const texture = paintCanvasTexture(width, height, paint, {
        repeat: options.repeat,
        anisotropy: 16,
    });
    let live = true;
    texture.addEventListener("dispose", () => (live = false));
    void dieselArtReady().then(() => {
        if (live) repaintCanvasTexture(texture, paint);
    });
    return texture;
}

/** The drape's logo panel (square). */
export function dieselLogoPanelTexture(): CanvasTexture {
    return dieselTexture(1024, 1024, paintLogoPanel);
}

/** The drape's championship banner (`DIESEL_BANNER_ASPECT`). */
export function dieselChampionshipBannerTexture(): CanvasTexture {
    return dieselTexture(2560, 256, paintChampionshipBanner);
}

/** The flag on each superframe (`DIESEL_FLAG_ASPECT`). */
export function dieselFlagTexture(): CanvasTexture {
    return dieselTexture(512, 768, paintDieselFlag);
}

/** The ring of legends' tile (64 m of a 2 m fascia); repeats along U. */
export function dieselNameRingTexture(): CanvasTexture {
    return dieselTexture(4096, 128, paintNameRing, { repeat: true });
}

/** The plaza's monument signs (`MONUMENT_ASPECT`). */
export function dieselMonumentTexture(): CanvasTexture {
    return dieselTexture(1040, 400, paintMonument);
}

/** The field wall's tile (16 wall heights); repeats along U. */
export function dieselWallPadTexture(): CanvasTexture {
    return dieselTexture(2048, 128, paintWallPad, { repeat: true });
}
