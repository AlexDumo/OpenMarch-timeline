import { ClampToEdgeWrapping, type CanvasTexture } from "three";
import { paintCanvasTexture, TEXTURE_FONT } from "../../environment";

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

/** One stretch of the LED ribbon. */
interface RibbonPanel {
    bg: [string, string];
    text: string;
    color: string;
    accent: string;
}

/**
 * The LED ribbon boards (front wall, upper fascia and the scoreboard rings):
 * four panels that repeat along U. 2048 x 128; one tile spans 16 band meters
 * at 1 m tall.
 */
export function arenaRibbonTexture(text: string): CanvasTexture {
    const panels: RibbonPanel[] = [
        {
            bg: ["#1a0f4d", "#0a0620"],
            text,
            color: "#ffffff",
            accent: "#8f78ff",
        },
        {
            bg: ["#f08a1c", "#b8420c"],
            text: "INDOOR CHAMPIONSHIPS",
            color: "#fff6e8",
            accent: "#ffd27a",
        },
        {
            bg: ["#05070c", "#101622"],
            text: "PERCUSSION · GUARD · WINDS",
            color: "#7fe3ff",
            accent: "#2bb3e0",
        },
        {
            bg: ["#9a1428", "#4c0812"],
            text: "WORLD FINALS",
            color: "#ffffff",
            accent: "#ff6b7d",
        },
    ];
    return paintCanvasTexture(
        2048,
        128,
        (g) => {
            const pw = 2048 / panels.length;
            panels.forEach((p, i) => {
                const x = i * pw;
                const bg = g.createLinearGradient(x, 0, x + pw, 128);
                bg.addColorStop(0, p.bg[0]);
                bg.addColorStop(1, p.bg[1]);
                g.fillStyle = bg;
                g.fillRect(x, 0, pw, 128);
                g.fillStyle = p.accent;
                g.fillRect(x, 0, pw, 10);
                g.fillRect(x, 118, pw, 10);
                g.fillStyle = p.color;
                g.textAlign = "center";
                g.textBaseline = "middle";
                let size = 64;
                g.font = `800 ${size}px ${TEXTURE_FONT}`;
                while (size > 24 && g.measureText(p.text).width > pw - 48) {
                    size -= 4;
                    g.font = `800 ${size}px ${TEXTURE_FONT}`;
                }
                g.fillText(p.text, x + pw / 2, 68);
            });
            // LED pixel grid: dark lines every 4 px.
            g.fillStyle = "rgba(0,0,0,0.28)";
            for (let x = 0; x < 2048; x += 4) g.fillRect(x, 0, 1, 128);
            for (let y = 0; y < 128; y += 4) g.fillRect(0, y, 2048, 1);
        },
        { repeat: true },
    );
}

/** Where each scoreboard face sits in the 1024 x 1024 atlas, in UV units. */
export const SCOREBOARD_ATLAS = {
    /** The two long faces (toward the front and back sides). */
    side: { u0: 0, v0: 0.5, u1: 1, v1: 1 },
    /** The two end faces (toward side 1 and side 2). */
    end: { u0: 0, v0: 0, u1: 0.62, v1: 0.5 },
};

/**
 * The center-hung scoreboard's screens: a "now performing" card on the long
 * faces and a score-style panel on the ends. V runs up (three.js convention),
 * so the canvas's top half is the long-face image.
 */
export function scoreboardTexture(text: string): CanvasTexture {
    return paintCanvasTexture(1024, 1024, (g) => {
        // Long face: 1024 x 512, top half of the canvas.
        const bg = g.createLinearGradient(0, 0, 1024, 512);
        bg.addColorStop(0, "#1d1060");
        bg.addColorStop(0.55, "#0b0a24");
        bg.addColorStop(1, "#24071a");
        g.fillStyle = bg;
        g.fillRect(0, 0, 1024, 512);
        // A soft spotlight bloom behind the title.
        const glow = g.createRadialGradient(512, 230, 20, 512, 230, 420);
        glow.addColorStop(0, "rgba(160,130,255,0.55)");
        glow.addColorStop(1, "rgba(160,130,255,0)");
        g.fillStyle = glow;
        g.fillRect(0, 0, 1024, 512);
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillStyle = "rgba(255,255,255,0.7)";
        g.font = `600 42px ${TEXTURE_FONT}`;
        g.fillText("NOW PERFORMING", 512, 110);
        g.fillStyle = "#ffffff";
        let size = 140;
        g.font = `800 ${size}px ${TEXTURE_FONT}`;
        while (size > 48 && g.measureText(text).width > 920) {
            size -= 6;
            g.font = `800 ${size}px ${TEXTURE_FONT}`;
        }
        g.fillText(text, 512, 245);
        g.fillStyle = "#f08a1c";
        g.fillRect(212, 340, 600, 6);
        g.fillStyle = "rgba(255,255,255,0.8)";
        g.font = `500 40px ${TEXTURE_FONT}`;
        g.fillText("WORLD CLASS FINALS", 512, 400);
        // End face: 634 x 512, bottom-left of the canvas.
        g.fillStyle = "#07080d";
        g.fillRect(0, 512, 634, 512);
        g.fillStyle = "#9a1428";
        g.fillRect(0, 512, 634, 96);
        g.fillStyle = "#ffffff";
        g.font = `800 52px ${TEXTURE_FONT}`;
        g.fillText("FINALS", 317, 562);
        const rows: [string, string][] = [
            ["GE", "19.40"],
            ["MUSIC", "38.65"],
            ["VISUAL", "29.10"],
        ];
        rows.forEach(([label, score], i) => {
            const y = 670 + i * 92;
            g.textAlign = "left";
            g.fillStyle = "rgba(255,255,255,0.75)";
            g.font = `600 44px ${TEXTURE_FONT}`;
            g.fillText(label, 48, y);
            g.textAlign = "right";
            g.fillStyle = "#ffcf5a";
            g.font = `800 56px ${TEXTURE_FONT}`;
            g.fillText(score, 586, y);
        });
        g.fillStyle = "rgba(0,0,0,0.25)";
        for (let x = 0; x < 1024; x += 4) g.fillRect(x, 0, 1, 1024);
    });
}

/** Rafter banners: text lines and a field color. */
export const ARENA_BANNERS: [string[], string][] = [
    [["WORLD", "CHAMPIONS", "2019"], "#9a1428"],
    [["INDOOR", "PERCUSSION", "2021"], "#1d2c5e"],
    [["WINTER", "GUARD", "2022"], "#ececec"],
    [["SCHOLASTIC", "WORLD", "2023"], "#9a1428"],
    [["INDEPENDENT", "OPEN", "2024"], "#1d2c5e"],
    [["WORLD", "FINALS", "2025"], "#ececec"],
];

/**
 * Every rafter banner side by side in one atlas, 128 x 512 each, so the
 * banners draw as one mesh. Banner `i` spans U from i / n to (i + 1) / n.
 */
export function bannerAtlasTexture(): CanvasTexture {
    const n = ARENA_BANNERS.length;
    return paintCanvasTexture(128 * n, 512, (g) => {
        ARENA_BANNERS.forEach(([lines, color], i) => {
            const x = i * 128;
            const light = color === "#ececec";
            g.fillStyle = color;
            g.fillRect(x, 0, 128, 512);
            g.fillStyle = light ? "#9a1428" : "#d8b45a";
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
            g.fillStyle = light ? "#1d2c5e" : "#ffffff";
            g.textAlign = "center";
            g.textBaseline = "middle";
            lines.forEach((l, k) => {
                let size = 26;
                g.font = `800 ${size}px ${TEXTURE_FONT}`;
                while (size > 12 && g.measureText(l).width > 112) {
                    size -= 2;
                    g.font = `800 ${size}px ${TEXTURE_FONT}`;
                }
                g.fillText(l, x + 64, 130 + k * 70);
            });
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
