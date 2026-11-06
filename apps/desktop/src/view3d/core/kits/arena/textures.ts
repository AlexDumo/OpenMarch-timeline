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

/**
 * Signage palette. The arena's boards are quiet: a near-black band, soft
 * lavender-white marks and the brand purple only as hairlines, so nothing
 * competes with the performers on the floor.
 */
const SIGN = {
    /** Board background: LED black with a hint of violet. */
    ground: "#07060d",
    /** Brand purple, for hairlines and small accents only. */
    purple: "#6442ff",
    /** Logos on the boards: a soft white, never pure. */
    mark: "#cfcbe6",
    /** The On The Move logo's tint: muted brand lavender. */
    otm: "#a99cf2",
    /** Primary and secondary text on the screens. */
    text: "#ecebf3",
    muted: "rgba(236,235,243,0.56)",
    label: "rgba(185,168,255,0.62)",
};

/** Short copy under the On The Move logo. Awaiting owner approval. */
export const OTM_TAGLINE = "Your drill, on every phone.";

/** Sets canvas letter spacing where supported (Chromium; not every test DOM). */
function tracking(g: CanvasRenderingContext2D, px: number): void {
    const c = g as CanvasRenderingContext2D & { letterSpacing?: string };
    if ("letterSpacing" in c) c.letterSpacing = `${px}px`;
}

/**
 * The LED ribbon's layout. One texture tile spans `tileHeights` band heights
 * (the 2048 x 128 texture is squeezed along U, so marks are painted narrower
 * to read true on the band). Each tile carries two ads with long dark
 * stretches between: the OpenMarch logo at `firstAd` and the On The Move
 * logo half a tile on. `quiet` is a U with nothing on it but the hairlines,
 * for bands that should stay dark.
 */
export const ARENA_RIBBON = {
    tileHeights: 32,
    firstAd: 0.25,
    quiet: 0.5,
} as const;
const RIBBON_W = 2048;
const RIBBON_H = 128;

function paintRibbon(g: CanvasRenderingContext2D): void {
    const W = RIBBON_W;
    const H = RIBBON_H;
    g.fillStyle = SIGN.ground;
    g.fillRect(0, 0, W, H);
    // Hairlines along both edges, the one constant all the way round.
    g.fillStyle = "rgba(140,120,255,0.32)";
    g.fillRect(0, 0, W, 2);
    g.fillRect(0, H - 2, W, 2);
    // Each ad is drawn in square "band pixels" and squeezed onto the tile.
    const k = W / (ARENA_RIBBON.tileHeights * H);
    const slot = (u: number, draw: () => void) => {
        g.save();
        g.translate(u * W, 0);
        g.scale(k, 1);
        draw();
        g.restore();
    };
    const a = ARENA_RIBBON.firstAd;
    slot(a, () => drawOpenMarchLogo(g, 0, H / 2, 80, SIGN.mark));
    slot(a + 0.5, () =>
        drawOtmLogo(g, { x: -200, y: H / 2 - 38, w: 400, h: 76 }, SIGN.otm),
    );
}

/**
 * The LED ribbon boards (lower front wall; the upper fascia and scoreboard
 * rings sample its quiet stretch). See `ARENA_RIBBON` for the layout.
 */
export function arenaRibbonTexture(): CanvasTexture {
    const tex = paintCanvasTexture(RIBBON_W, RIBBON_H, paintRibbon, {
        repeat: true,
    });
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
 * The screens' width over height in the arena (`addScoreboard`: width 1,
 * depth 0.62 and height 0.42 of the board width). The atlas regions are
 * narrower than that, so faces are painted wide and squeezed to fit.
 */
const SCREEN_ASPECT = { side: 1 / 0.42, end: 0.62 / 0.42 };

/**
 * Runs `draw` in a face's own coordinates: `w` x 512 square pixels, where `w`
 * keeps the face's true aspect, squeezed into the atlas region.
 */
function inFace(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    regionW: number,
    aspect: number,
    draw: (w: number, h: number) => void,
): void {
    const h = 512;
    const w = h * aspect;
    g.save();
    g.beginPath();
    g.rect(x, y, regionW, h);
    g.clip();
    g.translate(x, y);
    g.scale(regionW / w, 1);
    draw(w, h);
    g.restore();
}

/** A screen's ground: flat near black with the faintest lift toward the top. */
function screenGround(g: CanvasRenderingContext2D, w: number, h: number) {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#0e0c19");
    bg.addColorStop(1, "#08070e");
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
}

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
    g.textAlign = "center";
    g.textBaseline = "middle";
    // Long face: the credits card, set like a title card.
    inFace(g, 0, 0, 1024, SCREEN_ASPECT.side, (w, h) => {
        screenGround(g, w, h);
        const cx = w / 2;
        const lines = [
            credits.designer && `Designed by ${credits.designer}`,
            credits.client && `For ${credits.client}`,
        ].filter((l): l is string => !!l);
        // Label, title, rule, then the lines; centered as a block.
        const block = 46 + 104 + 44 + lines.length * 52;
        let y = (h - 64 - block) / 2 + 12;
        g.fillStyle = SIGN.label;
        g.font = `600 24px ${TEXTURE_FONT}`;
        tracking(g, 6);
        g.fillText("NOW PERFORMING", cx, y);
        tracking(g, 0);
        y += 46 + 52;
        g.fillStyle = SIGN.text;
        const title = credits.title || "Untitled show";
        fitFont(g, title, 600, 92, 40, w - 160);
        g.fillText(title, cx, y);
        y += 52 + 34;
        g.fillStyle = SIGN.purple;
        g.fillRect(cx - 36, y - 1.5, 72, 3);
        y += 10 + 30;
        g.fillStyle = SIGN.muted;
        for (const l of lines) {
            fitFont(g, l, 400, 34, 20, w - 200);
            g.fillText(l, cx, y);
            y += 52;
        }
        // The OpenMarch logo, small, as the screen's signature.
        drawOpenMarchLogo(g, cx, h - 46, 34, "rgba(207,203,230,0.42)");
    });
    // End face: one ad, the On The Move logo and one line.
    inFace(g, 0, 512, 634, SCREEN_ASPECT.end, (w, h) => {
        screenGround(g, w, h);
        drawOtmLogo(g, { x: w * 0.14, y: 150, w: w * 0.72, h: 150 }, SIGN.otm);
        g.fillStyle = SIGN.muted;
        fitFont(g, OTM_TAGLINE, 500, 30, 18, w - 120);
        g.fillText(OTM_TAGLINE, w / 2, 372);
    });
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

/**
 * Rafter banner fabrics, one per banner. A matched set in deep ink, each with
 * the OpenMarch logo.
 */
export const ARENA_BANNERS: string[] = [
    "#1b1834",
    "#1b1834",
    "#1b1834",
    "#1b1834",
    "#1b1834",
    "#1b1834",
];

/** A banner's width over height in the arena (1.5 x 4.4 m in `addBanners`). */
const BANNER_ASPECT = 1.5 / 4.4;

/**
 * Every rafter banner side by side in one atlas, 128 x 512 each, so the
 * banners draw as one mesh. Banner `i` spans U from i / n to (i + 1) / n.
 * Each is painted at its true aspect and squeezed into its 128 px column.
 */
export function bannerAtlasTexture(): CanvasTexture {
    const n = ARENA_BANNERS.length;
    return paintCanvasTexture(128 * n, 512, (g) => {
        g.clearRect(0, 0, 128 * n, 512);
        const w = 512 * BANNER_ASPECT;
        ARENA_BANNERS.forEach((color, i) => {
            g.save();
            g.translate(i * 128, 0);
            g.scale(128 / w, 1);
            // Field with a pointed bottom.
            g.fillStyle = color;
            g.beginPath();
            g.moveTo(0, 0);
            g.lineTo(w, 0);
            g.lineTo(w, 462);
            g.lineTo(w / 2, 508);
            g.lineTo(0, 462);
            g.closePath();
            g.fill();
            // Logo upright near the top, a hairline under it, then fabric.
            drawOpenMarchLogo(g, w / 2, 112, 62, "#e6e3f2");
            g.fillStyle = "rgba(169,156,242,0.7)";
            g.fillRect(w / 2 - 22, 176, 44, 2);
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
