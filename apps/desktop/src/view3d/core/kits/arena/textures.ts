import { ClampToEdgeWrapping, type CanvasTexture, type Texture } from "three";
import { paintCanvasTexture, TEXTURE_FONT } from "../../environment";

/** Basketball court size in meters (94 x 50 ft). */
export const ARENA_COURT_LENGTH = 28.65;
export const ARENA_COURT_WIDTH = 15.24;

export interface ArenaFloorOptions {
    /** Floor extent in world meters. */
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    /** Performance area in world meters; the court is centered under it. */
    footprint: { minX: number; maxX: number; minZ: number; maxZ: number };
    /** "#rrggbb" apron and lettering color. */
    accent: string;
}

/**
 * The arena floor: a sealed hardwood court with a deep apron around it and
 * the court's lines, the way UD Arena is laid before the tarp goes down. The
 * canvas top is the back (most negative z) and its left is minX.
 */
export function arenaFloorTexture(o: ArenaFloorOptions): CanvasTexture {
    const W = o.maxX - o.minX;
    const D = o.maxZ - o.minZ;
    const s = Math.min(32, 2048 / Math.max(W, D));
    const X = (x: number) => (x - o.minX) * s;
    const Y = (z: number) => (z - o.minZ) * s;
    return paintCanvasTexture(Math.ceil(W * s), Math.ceil(D * s), (g, w, h) => {
        // Apron: dark stained boards.
        g.fillStyle = "#14192e";
        g.fillRect(0, 0, w, h);
        const plank = Math.max(2, Math.round(0.09 * s));
        const fp = o.footprint;
        const cx = (fp.minX + fp.maxX) / 2;
        const cz = (fp.minZ + fp.maxZ) / 2;
        const halfL = ARENA_COURT_LENGTH / 2;
        const halfW = ARENA_COURT_WIDTH / 2;
        // Maple boards across the whole court plus the run-off.
        const x0 = X(Math.min(cx - halfL - 3.2, fp.minX - 1));
        const x1 = X(Math.max(cx + halfL + 3.2, fp.maxX + 1));
        const y0 = Y(Math.min(cz - halfW - 3.2, fp.minZ - 1));
        const y1 = Y(Math.max(cz + halfW + 3.2, fp.maxZ + 1));
        for (let y = y0, k = 0; y < y1; y += plank, k++) {
            g.fillStyle = `hsl(35, ${50 + ((k * 7) % 8)}%, ${58 + ((k * 13) % 8)}%)`;
            g.fillRect(x0, y, x1 - x0, plank);
            // Board ends, staggered.
            g.fillStyle = "rgba(90,50,20,0.28)";
            for (let x = x0 + ((k * 97) % 120); x < x1; x += 120) {
                g.fillRect(x, y, 1, plank);
            }
        }
        // Accent paint under the baskets and a wide border strip.
        g.fillStyle = o.accent;
        g.globalAlpha = 0.85;
        for (const sg of [-1, 1]) {
            const baseX = cx + sg * halfL;
            g.fillRect(
                X(sg > 0 ? baseX - 5.79 : baseX),
                Y(cz - 1.83),
                5.79 * s,
                3.66 * s,
            );
        }
        g.globalAlpha = 1;
        g.strokeStyle = "#f4f1ea";
        g.lineWidth = 0.09 * s;
        g.strokeRect(
            X(cx - halfL),
            Y(cz - halfW),
            ARENA_COURT_LENGTH * s,
            ARENA_COURT_WIDTH * s,
        );
        g.beginPath();
        g.moveTo(X(cx), Y(cz - halfW));
        g.lineTo(X(cx), Y(cz + halfW));
        g.stroke();
        g.beginPath();
        g.arc(X(cx), Y(cz), 1.83 * s, 0, Math.PI * 2);
        g.stroke();
        for (const sg of [-1, 1]) {
            const baseX = cx + sg * halfL;
            g.beginPath();
            g.arc(
                X(baseX - sg * 1.6),
                Y(cz),
                6.7 * s,
                sg > 0 ? Math.PI * 0.6 : -Math.PI * 0.4,
                sg > 0 ? Math.PI * 1.4 : Math.PI * 0.4,
            );
            g.stroke();
        }
        // Soft traffic wear and a gloss gradient so the floor reads as sealed.
        const gloss = g.createRadialGradient(
            X(cx),
            Y(cz),
            s,
            X(cx),
            Y(cz),
            Math.max(w, h) * 0.6,
        );
        gloss.addColorStop(0, "rgba(255,240,210,0.16)");
        gloss.addColorStop(1, "rgba(0,0,0,0.28)");
        g.fillStyle = gloss;
        g.fillRect(0, 0, w, h);
    });
}

/**
 * One seat seen from above, grayscale so the vertex color tints it. U is
 * one seat wide; V runs from the front of the tread (0) to the back (1).
 * Repeats along U.
 */
export function seatTexture(): CanvasTexture {
    return paintCanvasTexture(
        128,
        128,
        (g, w, h) => {
            g.fillStyle = "#5c5c5c"; // leg room
            g.fillRect(0, 0, w, h);
            const row = (
                y0: number,
                y1: number,
                light: number,
                dark: number,
            ) => {
                const grad = g.createLinearGradient(0, h - y1, 0, h - y0);
                grad.addColorStop(0, `rgb(${dark},${dark},${dark})`);
                grad.addColorStop(1, `rgb(${light},${light},${light})`);
                g.fillStyle = grad;
                g.beginPath();
                g.roundRect(8, h - y1, w - 16, y1 - y0, 14);
                g.fill();
            };
            // Seat back (toward the back of the tread, top of canvas).
            row(64, 118, 236, 170);
            // Cushion.
            row(10, 58, 255, 200);
            // Highlight on the seat-back crown.
            g.fillStyle = "rgba(255,255,255,0.35)";
            g.fillRect(16, 12, w - 32, 6);
            g.fillStyle = "rgba(0,0,0,0.45)";
            g.fillRect(0, 0, 3, h);
            g.fillRect(w - 3, 0, 3, h);
        },
        { repeat: true },
    );
}

/**
 * A long LED ribbon: a dark base, saturated color blocks and short text.
 * Repeats along U; `aspect` is width over height of the painted strip.
 */
export function arenaRibbonTexture(
    text: string,
    accents: [string, string],
    big: boolean,
): CanvasTexture {
    const H = big ? 160 : 64;
    return paintCanvasTexture(
        2048,
        H,
        (g, w, h) => {
            g.fillStyle = "#0b0d1c";
            g.fillRect(0, 0, w, h);
            const cell = w / 4;
            for (let i = 0; i < 4; i++) {
                const x = i * cell;
                const grad = g.createLinearGradient(x, 0, x + cell, 0);
                grad.addColorStop(0, i % 2 ? accents[1] : accents[0]);
                grad.addColorStop(1, "#0b0d1c");
                g.fillStyle = grad;
                g.fillRect(x, h * 0.12, cell * 0.58, h * 0.76);
                g.fillStyle = "#fff";
                g.textBaseline = "middle";
                g.font = `800 ${Math.round(h * 0.34)}px ${TEXTURE_FONT}`;
                g.fillText(
                    i % 2 ? "WORLD FINALS" : text,
                    x + cell * 0.05,
                    h * 0.54,
                    cell * 0.5,
                );
                g.fillStyle = "rgba(255,255,255,0.6)";
                for (let k = 0; k < 6; k++) {
                    g.fillRect(
                        x + cell * (0.7 + k * 0.045),
                        h * 0.3,
                        4,
                        h * 0.4,
                    );
                }
            }
            // LED dot grid.
            g.fillStyle = "rgba(0,0,0,0.35)";
            for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
        },
        { repeat: true },
    );
}

/** A video wall face: a gradient, the show's name and a score strip. */
export function scoreboardTexture(
    title: string,
    sub: string,
    color: string,
): CanvasTexture {
    return paintCanvasTexture(1024, 448, (g, w, h) => {
        const bg = g.createLinearGradient(0, 0, w, h);
        bg.addColorStop(0, color);
        bg.addColorStop(1, "#070718");
        g.fillStyle = bg;
        g.fillRect(0, 0, w, h);
        g.fillStyle = "rgba(255,255,255,0.08)";
        for (let i = 0; i < 9; i++) g.fillRect(i * 140 - 60, 0, 40, h);
        g.fillStyle = "#fff";
        g.textAlign = "center";
        g.font = `800 112px ${TEXTURE_FONT}`;
        g.fillText(title, w / 2, 190);
        g.font = `600 44px ${TEXTURE_FONT}`;
        g.fillStyle = "rgba(255,255,255,0.82)";
        g.fillText(sub, w / 2, 262);
        const labels = ["MUSIC", "VISUAL", "GE 1", "GE 2"];
        labels.forEach((l, i) => {
            const x = 70 + i * 220;
            g.fillStyle = "rgba(0,0,0,0.55)";
            g.fillRect(x, 320, 200, 90);
            g.fillStyle = "#ffd36b";
            g.font = `700 30px ${TEXTURE_FONT}`;
            g.fillText(l, x + 100, 352);
            g.fillStyle = "#fff";
            g.font = `800 40px ${TEXTURE_FONT}`;
            g.fillText((89.4 - i * 1.7).toFixed(1), x + 100, 394);
        });
    });
}

/** The scoreboard's LED underside: a violet glow with a panel grid. */
export function underboardTexture(): CanvasTexture {
    return paintCanvasTexture(256, 192, (g, w, h) => {
        const grad = g.createRadialGradient(
            w / 2,
            h / 2,
            6,
            w / 2,
            h / 2,
            w * 0.62,
        );
        grad.addColorStop(0, "#8a7bff");
        grad.addColorStop(0.6, "#3a3aa8");
        grad.addColorStop(1, "#10103a");
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
        g.strokeStyle = "rgba(0,0,10,0.55)";
        g.lineWidth = 2;
        for (let x = 0; x <= w; x += 32) {
            g.beginPath();
            g.moveTo(x, 0);
            g.lineTo(x, h);
            g.stroke();
        }
        for (let y = 0; y <= h; y += 32) {
            g.beginPath();
            g.moveTo(0, y);
            g.lineTo(w, y);
            g.stroke();
        }
    });
}

/** Six championship banners in one atlas: cells of 256 x 400, left to right. */
export const BANNER_CELLS = 6;
export function bannerAtlasTexture(
    labels: [string, string, string][],
): CanvasTexture {
    const colors = [
        "#1f3f8f",
        "#a8222c",
        "#e8e2d0",
        "#1f3f8f",
        "#a8222c",
        "#e8e2d0",
    ];
    return paintCanvasTexture(256 * BANNER_CELLS, 400, (g, w, h) => {
        void w;
        labels.slice(0, BANNER_CELLS).forEach((lines, i) => {
            const x = i * 256;
            const light = colors[i] === "#e8e2d0";
            g.fillStyle = colors[i];
            g.fillRect(x, 0, 256, h);
            g.fillStyle = light ? "#1f3f8f" : "#fff";
            g.fillRect(x, 340, 256, 14);
            // Pennant tail.
            g.fillStyle = "rgba(0,0,0,0.25)";
            g.beginPath();
            g.moveTo(x, h);
            g.lineTo(x + 128, 372);
            g.lineTo(x + 256, h);
            g.fill();
            g.fillStyle = light ? "#14192e" : "#fff";
            g.textAlign = "center";
            lines.forEach((l, j) => {
                g.font = `${j === 1 ? 800 : 700} ${j === 1 ? 40 : 30}px ${TEXTURE_FONT}`;
                g.fillText(l, x + 128, 90 + j * 62);
            });
        });
    });
}

/** Light spilling out of the performer tunnel: warm in the middle. */
export function tunnelGlowTexture(): CanvasTexture {
    return paintCanvasTexture(128, 128, (g, w, h) => {
        const grad = g.createRadialGradient(
            w / 2,
            h * 0.7,
            4,
            w / 2,
            h * 0.7,
            w * 0.7,
        );
        grad.addColorStop(0, "#fff2d0");
        grad.addColorStop(0.35, "#c58a50");
        grad.addColorStop(1, "#0a0806");
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
    });
}

/** A vertical fade for light beams: bright at the fixture (top), gone at the floor. */
export function beamTexture(): CanvasTexture {
    const tex = paintCanvasTexture(8, 128, (g, w, h) => {
        const grad = g.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, "#ffffff");
        grad.addColorStop(0.5, "#6a6a6a");
        grad.addColorStop(1, "#000000");
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
    });
    tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
    return tex;
}

export type { Texture };
