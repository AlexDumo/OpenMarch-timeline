import { ClampToEdgeWrapping, type CanvasTexture } from "three";
import {
    drawOpenMarchLogo,
    drawOtmLogo,
    fitFont,
    paintCanvasTexture,
    paintWithOtmLogo,
    repaintCanvasTexture,
    TEXTURE_FONT,
} from "../../environment";
import type { ShowCredits } from "../../types";

/**
 * Canvas textures for the arena kit. Everything is painted here at build time;
 * nothing is downloaded. Sizes stay at or under 2048 px.
 */

export interface ArenaFloorOptions {
    /** Floor extent in world meters (the bowl's inner rectangle). */
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    /** Performance area (the footprint) in world meters. */
    footprint: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/** Basketball court under the tarp, as in the gym (28.65 x 15.24 m). */
const COURT = { length: 28.65, width: 15.24, apron: 1.8 };
/** The floor tape runs this far outside the performance area. */
export const ARENA_TAPE_MARGIN = 1.5;

/**
 * The arena floor: black event flooring with faint panel seams, the maple
 * court under the middle (mostly hidden by the tarp), and a white boundary
 * tape 1.5 m outside the performance area. The canvas top is the most
 * negative z and its left is minX.
 */
export function arenaFloorTexture(o: ArenaFloorOptions): CanvasTexture {
    const w = o.maxX - o.minX;
    const d = o.maxZ - o.minZ;
    const s = Math.min(24, 2048 / Math.max(w, d));
    const X = (x: number) => (x - o.minX) * s;
    const Y = (z: number) => (z - o.minZ) * s;
    const fp = o.footprint;
    const cx = (fp.minX + fp.maxX) / 2;
    const cz = (fp.minZ + fp.maxZ) / 2;
    return paintCanvasTexture(Math.ceil(w * s), Math.ceil(d * s), (g, W, H) => {
        g.fillStyle = "#1b1c21";
        g.fillRect(0, 0, W, H);
        // Event floor panels, 1.2 m, with a slight tone change per panel.
        const panel = 1.2 * s;
        for (let y = 0, j = 0; y < H; y += panel, j++) {
            for (let x = 0, i = 0; x < W; x += panel, i++) {
                const k = (i * 7 + j * 13) % 5;
                g.fillStyle = `rgba(255,255,255,${0.006 * k})`;
                g.fillRect(x + 1, y + 1, panel - 2, panel - 2);
            }
        }
        // Maple court and apron.
        const cw = COURT.length + 2 * COURT.apron;
        const ch = COURT.width + 2 * COURT.apron;
        if (cw < w && ch < d) {
            const plank = Math.max(2, Math.round(0.1 * s));
            const x0 = X(cx - cw / 2);
            const y0 = Y(cz - ch / 2);
            for (let y = 0, k = 0; y < ch * s; y += plank, k++) {
                g.fillStyle = `hsl(32, ${42 + ((k * 7) % 9)}%, ${54 + ((k * 13) % 7)}%)`;
                g.fillRect(x0, y0 + y, cw * s, Math.min(plank, ch * s - y));
            }
            g.strokeStyle = "#f4f1ea";
            g.lineWidth = 0.06 * s;
            g.strokeRect(
                X(cx - COURT.length / 2),
                Y(cz - COURT.width / 2),
                COURT.length * s,
                COURT.width * s,
            );
        }
        // Boundary tape around the performance area.
        g.strokeStyle = "rgba(240,240,240,0.85)";
        g.lineWidth = 0.08 * s;
        g.strokeRect(
            X(fp.minX - ARENA_TAPE_MARGIN),
            Y(fp.minZ - ARENA_TAPE_MARGIN),
            (fp.maxX - fp.minX + 2 * ARENA_TAPE_MARGIN) * s,
            (fp.maxZ - fp.minZ + 2 * ARENA_TAPE_MARGIN) * s,
        );
    });
}

/**
 * One seat back per tile, white on transparent, for a band tinted by vertex
 * colors and drawn with `alphaTest`. U runs along the row, V up.
 */
export function seatBackTexture(): CanvasTexture {
    const tex = paintCanvasTexture(
        64,
        64,
        (g) => {
            g.clearRect(0, 0, 64, 64);
            const grad = g.createLinearGradient(0, 0, 0, 64);
            grad.addColorStop(0, "#ffffff");
            grad.addColorStop(0.25, "#d9d9d9");
            grad.addColorStop(1, "#8c8c8c");
            g.fillStyle = grad;
            g.beginPath();
            g.roundRect(7, 4, 50, 60, [14, 14, 3, 3]);
            g.fill();
        },
        { repeat: true },
    );
    tex.wrapT = ClampToEdgeWrapping;
    return tex;
}

/** OpenMarch purple and its family, for signage. */
const PURPLE = "#6442ff";
const PURPLE_DEEP = "#1a0f4d";
const PURPLE_INK = "#0a0620";
const PURPLE_SOFT = "#b9a8ff";

/** Darkens every 4th pixel row and column, like an LED panel. */
function ledGrid(g: CanvasRenderingContext2D, w: number, h: number): void {
    g.fillStyle = "rgba(0,0,0,0.28)";
    for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h);
    for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
}

/** Fills a panel with a left-to-right two-stop gradient and top/bottom bars. */
function panelBack(
    g: CanvasRenderingContext2D,
    x: number,
    w: number,
    h: number,
    from: string,
    to: string,
    accent: string,
): void {
    const bg = g.createLinearGradient(x, 0, x + w, h);
    bg.addColorStop(0, from);
    bg.addColorStop(1, to);
    g.fillStyle = bg;
    g.fillRect(x, 0, w, h);
    g.fillStyle = accent;
    g.fillRect(x, 0, w, 8);
    g.fillRect(x, h - 8, w, 8);
}

function paintRibbon(g: CanvasRenderingContext2D): void {
    const H = 128;
    const pw = 512;
    // 1. OpenMarch logo and the web address.
    panelBack(g, 0, pw, H, PURPLE_DEEP, PURPLE_INK, PURPLE);
    drawOpenMarchLogo(g, 120, H / 2, 92, "#ffffff");
    g.fillStyle = PURPLE_SOFT;
    g.textAlign = "left";
    g.textBaseline = "middle";
    fitFont(g, "openmarch.com", 700, 44, 24, 270);
    g.fillText("openmarch.com", 228, H / 2 + 2);
    // 2. On The Move ad: logo and a line of copy.
    panelBack(g, pw, pw, H, "#7b5cff", "#3d1fd1", "#ffffff");
    drawOtmLogo(g, { x: pw + 18, y: 14, w: 250, h: 100 });
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    fitFont(g, "YOUR DRILL,", 800, 34, 18, 200);
    g.fillText("YOUR DRILL,", pw + 390, 46);
    fitFont(g, "IN EVERY POCKET", 800, 34, 18, 210);
    g.fillText("IN EVERY POCKET", pw + 390, 86);
    // 3. OpenMarch logo alone on black.
    panelBack(g, 2 * pw, pw, H, "#05070c", "#101622", PURPLE);
    drawOpenMarchLogo(g, 2 * pw + pw / 2, H / 2, 96, PURPLE_SOFT);
    // 4. On The Move logo alone, purple on white.
    panelBack(g, 3 * pw, pw, H, "#f4f1ff", "#ddd5ff", PURPLE);
    drawOtmLogo(g, { x: 3 * pw + 40, y: 12, w: pw - 80, h: 104 }, PURPLE);
    ledGrid(g, 2048, H);
}

/**
 * The LED ribbon boards (front wall, upper fascia and the scoreboard rings):
 * four panels that repeat along U, alternating the OpenMarch logo and On The
 * Move ads. 2048 x 128; one tile spans 16 band meters at 1 m tall.
 */
export function arenaRibbonTexture(): CanvasTexture {
    const tex = paintCanvasTexture(2048, 128, paintRibbon, { repeat: true });
    paintWithOtmLogo(tex, paintRibbon);
    return tex;
}

/** Where each scoreboard face sits in the 1024 x 1024 atlas, in UV units. */
export const SCOREBOARD_ATLAS = {
    /** The two long faces (toward the front and back sides). */
    side: { u0: 0, v0: 0.5, u1: 1, v1: 1 },
    /** The two end faces (toward side 1 and side 2). */
    end: { u0: 0, v0: 0, u1: 0.62, v1: 0.5 },
};

/**
 * Paints the center-hung scoreboard's screens: the show's credits on the long
 * faces and an On The Move ad on the ends. V runs up (three.js convention),
 * so the canvas's top half is the long-face image.
 */
function paintScoreboard(
    g: CanvasRenderingContext2D,
    credits: ShowCredits,
): void {
    g.clearRect(0, 0, 1024, 1024);
    // Long face: 1024 x 512, top half of the canvas.
    const bg = g.createLinearGradient(0, 0, 1024, 512);
    bg.addColorStop(0, "#1d1060");
    bg.addColorStop(0.55, "#0b0a24");
    bg.addColorStop(1, "#24071a");
    g.fillStyle = bg;
    g.fillRect(0, 0, 1024, 512);
    const glow = g.createRadialGradient(512, 200, 20, 512, 200, 420);
    glow.addColorStop(0, "rgba(160,130,255,0.5)");
    glow.addColorStop(1, "rgba(160,130,255,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, 1024, 512);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "rgba(255,255,255,0.7)";
    g.font = `600 38px ${TEXTURE_FONT}`;
    g.fillText("NOW PERFORMING", 512, 70);
    g.fillStyle = "#ffffff";
    const title = credits.title || "Untitled show";
    fitFont(g, title, 800, 120, 44, 920);
    g.fillText(title, 512, 175);
    g.fillStyle = PURPLE;
    g.fillRect(312, 252, 400, 6);
    const lines = [
        credits.designer && `Designed by ${credits.designer}`,
        credits.client && `For ${credits.client}`,
    ].filter((l): l is string => !!l);
    g.fillStyle = "rgba(255,255,255,0.85)";
    lines.forEach((l, i) => {
        fitFont(g, l, 500, 46, 24, 900);
        g.fillText(l, 512, 312 + i * 62);
    });
    // Footer strip with the OpenMarch logo.
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(0, 440, 1024, 72);
    drawOpenMarchLogo(g, 512, 476, 56, "rgba(255,255,255,0.85)");

    // End face: 634 x 512, bottom-left of the canvas. On The Move ad.
    const end = g.createLinearGradient(0, 512, 634, 1024);
    end.addColorStop(0, "#7b5cff");
    end.addColorStop(1, "#2a1290");
    g.fillStyle = end;
    g.fillRect(0, 512, 634, 512);
    drawOtmLogo(g, { x: 40, y: 560, w: 554, h: 240 });
    g.fillStyle = "#ffffff";
    g.font = `800 44px ${TEXTURE_FONT}`;
    g.fillText("YOUR DRILL, IN EVERY POCKET", 317, 860);
    g.fillStyle = "rgba(255,255,255,0.75)";
    g.font = `600 32px ${TEXTURE_FONT}`;
    g.fillText("openmarch.com", 317, 930);
    ledGrid(g, 1024, 1024);
}

/**
 * The scoreboard's screen atlas (see `paintScoreboard`), blank credits until
 * `setCredits` is called. Every repaint, the logo's included, uses the latest.
 */
export function scoreboardTexture(): {
    texture: CanvasTexture;
    setCredits(credits: ShowCredits): void;
} {
    let credits: ShowCredits = { title: "" };
    const paint = (g: CanvasRenderingContext2D) => paintScoreboard(g, credits);
    const texture = paintCanvasTexture(1024, 1024, paint);
    paintWithOtmLogo(texture, paint);
    let last = JSON.stringify(credits);
    return {
        texture,
        setCredits(next) {
            const key = JSON.stringify(next);
            if (key === last) return;
            last = key;
            credits = next;
            repaintCanvasTexture(texture, paint);
        },
    };
}

/** Rafter banner field colors; each carries the OpenMarch logo. */
export const ARENA_BANNERS: string[] = [
    PURPLE,
    "#1d2c5e",
    "#ececec",
    PURPLE_DEEP,
    "#1d2c5e",
    "#ececec",
];

/**
 * Every rafter banner side by side in one atlas, 128 x 512 each, so the
 * banners draw as one mesh. Banner `i` spans U from i / n to (i + 1) / n.
 */
export function bannerAtlasTexture(): CanvasTexture {
    const n = ARENA_BANNERS.length;
    return paintCanvasTexture(128 * n, 512, (g) => {
        ARENA_BANNERS.forEach((color, i) => {
            const x = i * 128;
            const light = color === "#ececec";
            g.fillStyle = color;
            g.fillRect(x, 0, 128, 512);
            g.fillStyle = light ? PURPLE : "#d8b45a";
            g.fillRect(x + 10, 26, 108, 6);
            g.fillRect(x + 10, 430, 108, 6);
            // Pointed bottom.
            g.clearRect(x, 470, 128, 42);
            g.fillStyle = color;
            g.beginPath();
            g.moveTo(x, 470);
            g.lineTo(x + 128, 470);
            g.lineTo(x + 64, 508);
            g.closePath();
            g.fill();
            // The logo turned to run up the banner, as large as fits.
            g.save();
            g.translate(x + 64, 230);
            g.rotate(-Math.PI / 2);
            drawOpenMarchLogo(g, 0, 0, 104, light ? PURPLE : "#ffffff");
            g.restore();
        });
    });
}

/**
 * The performers' tunnel mouth: near black, with warm light spilling across
 * the tunnel floor from inside and a faint blue edge.
 */
export function tunnelMouthTexture(): CanvasTexture {
    return paintCanvasTexture(256, 256, (g) => {
        g.fillStyle = "#020203";
        g.fillRect(0, 0, 256, 256);
        const spill = g.createRadialGradient(128, 300, 10, 128, 300, 220);
        spill.addColorStop(0, "rgba(255,190,120,0.75)");
        spill.addColorStop(0.5, "rgba(255,150,80,0.18)");
        spill.addColorStop(1, "rgba(255,150,80,0)");
        g.fillStyle = spill;
        g.fillRect(0, 0, 256, 256);
        g.fillStyle = "rgba(90,120,255,0.35)";
        g.fillRect(0, 0, 256, 5);
    });
}

/**
 * Vertical fade for the haze beams: opaque white at the lamp (V = 1) fading
 * to nothing at the floor (V = 0).
 */
export function beamFadeTexture(): CanvasTexture {
    const tex = paintCanvasTexture(4, 128, (g) => {
        const grad = g.createLinearGradient(0, 0, 0, 128);
        grad.addColorStop(0, "rgba(255,255,255,1)");
        grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grad;
        g.fillRect(0, 0, 4, 128);
    });
    tex.anisotropy = 1;
    return tex;
}
