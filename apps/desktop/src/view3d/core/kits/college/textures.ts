import type { CanvasTexture } from "three";
import {
    createRng,
    paintCanvasTexture,
    TEXTURE_FONT,
} from "../../environment";

/**
 * Procedural textures for the college kit, painted on 2D canvases (no image
 * files). Every texture here is small and repeats; the kit owns and disposes
 * them.
 */

/** Parses "#rrggbb" into [r, g, b], or the fallback. */
export function rgbOf(css: string, fallback: string): [number, number, number] {
    const m = /^#([0-9a-f]{6})$/i.exec(css.trim()) ?? /^#([0-9a-f]{6})$/i.exec(fallback);
    const n = parseInt(m![1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const rgb = ([r, g, b]: [number, number, number], k = 1) =>
    `rgb(${Math.round(Math.min(255, r * k))},${Math.round(Math.min(255, g * k))},${Math.round(Math.min(255, b * k))})`;

/**
 * Cast concrete for risers, treads and aisles (4 m tile): speckle, faint
 * form-board joints and a few weather streaks. Mostly light, so vertex
 * colors set the overall tone.
 */
export function concreteTexture(): CanvasTexture {
    return paintCanvasTexture(
        256,
        256,
        (g, w, h) => {
            const rnd = createRng(11);
            g.fillStyle = "#d8d6d0";
            g.fillRect(0, 0, w, h);
            for (let i = 0; i < 2600; i++) {
                const l = 150 + Math.floor(rnd() * 90);
                g.fillStyle = `rgba(${l},${l - 2},${l - 6},0.35)`;
                g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
            }
            g.fillStyle = "rgba(90,88,82,0.18)";
            for (let x = 0; x < w; x += 64) g.fillRect(x, 0, 1, h);
            for (let i = 0; i < 6; i++) {
                const x = rnd() * w;
                const grad = g.createLinearGradient(0, 0, 0, h);
                grad.addColorStop(0, "rgba(70,68,64,0.14)");
                grad.addColorStop(1, "rgba(70,68,64,0)");
                g.fillStyle = grad;
                g.fillRect(x, 0, 3 + rnd() * 8, h * (0.4 + rnd() * 0.6));
            }
        },
        { repeat: true },
    );
}

/**
 * Exterior precast panels (12 m tile): 3 x 3 panels with dark reveals, a
 * little tone variation per panel and a band of dark vents.
 */
export function facadeTexture(): CanvasTexture {
    return paintCanvasTexture(
        256,
        256,
        (g, w, h) => {
            const rnd = createRng(5);
            const n = 3;
            const pw = w / n;
            const ph = h / n;
            for (let i = 0; i < n; i++)
                for (let j = 0; j < n; j++) {
                    const l = 196 + Math.floor(rnd() * 18);
                    g.fillStyle = `rgb(${l},${l - 4},${l - 12})`;
                    g.fillRect(i * pw, j * ph, pw, ph);
                }
            for (let i = 0; i < 1800; i++) {
                const l = 150 + Math.floor(rnd() * 70);
                g.fillStyle = `rgba(${l},${l},${l - 8},0.25)`;
                g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5);
            }
            g.fillStyle = "#6d6a64";
            for (let i = 0; i <= n; i++) {
                g.fillRect(i * pw - 1.5, 0, 3, h);
                g.fillRect(0, i * ph - 1.5, w, 3);
            }
            // Louvered vents in the middle band of each panel.
            g.fillStyle = "#3b3a38";
            for (let i = 0; i < n; i++) {
                const y = ph * 1 + ph * 0.32;
                g.fillRect(i * pw + pw * 0.18, y, pw * 0.64, ph * 0.3);
            }
            g.fillStyle = "rgba(255,255,255,0.12)";
            for (let i = 0; i < n; i++)
                for (let k = 0; k < 6; k++)
                    g.fillRect(
                        i * pw + pw * 0.18,
                        ph * 1.32 + k * ph * 0.05,
                        pw * 0.64,
                        1,
                    );
        },
        { repeat: true },
    );
}

/**
 * One seat back per repeat (`SEAT_PITCH` along the row): a light rounded
 * shell with a dark gap and a shadowed foot. Vertex colors tint it.
 */
export function seatTexture(): CanvasTexture {
    return paintCanvasTexture(
        32,
        32,
        (g, w, h) => {
            g.fillStyle = "#2a2a2c";
            g.fillRect(0, 0, w, h);
            const grad = g.createLinearGradient(0, h, 0, 0);
            grad.addColorStop(0, "#9a9a9a");
            grad.addColorStop(0.35, "#ffffff");
            grad.addColorStop(1, "#e6e6e6");
            g.fillStyle = grad;
            g.beginPath();
            g.moveTo(3, h);
            g.lineTo(3, 9);
            g.quadraticCurveTo(3, 2, 10, 2);
            g.lineTo(22, 2);
            g.quadraticCurveTo(29, 2, 29, 9);
            g.lineTo(29, h);
            g.closePath();
            g.fill();
        },
        { repeat: true, anisotropy: 4 },
    );
}

/**
 * The padded field wall (`WALL_TILE` meters per repeat, the wall's height
 * top to bottom): team color with a white cap and kick stripe and the
 * venue's text, like a college wall wrap.
 */
export function wallTexture(text: string, home: string): CanvasTexture {
    const c = rgbOf(home, "#6442ff");
    return paintCanvasTexture(
        1024,
        128,
        (g, w, h) => {
            // v = 0 is the foot of the wall; canvas y = 0 is its top.
            g.fillStyle = rgb(c, 0.82);
            g.fillRect(0, 0, w, h);
            g.fillStyle = "#f4f4f2";
            g.fillRect(0, 0, w, 10);
            g.fillStyle = rgb(c, 0.45);
            g.fillRect(0, h - 16, w, 16);
            g.fillStyle = "rgba(255,255,255,0.9)";
            g.fillRect(0, h - 22, w, 4);
            g.fillStyle = "#ffffff";
            g.textAlign = "center";
            g.textBaseline = "middle";
            g.font = `800 64px ${TEXTURE_FONT}`;
            const label = (text || "OPENMARCH").toUpperCase();
            g.fillText(label, w * 0.25, h * 0.5);
            g.fillText(label, w * 0.75, h * 0.5);
            g.fillStyle = "rgba(255,255,255,0.5)";
            for (const x of [0, 0.5]) {
                g.beginPath();
                g.arc(w * x, h * 0.5, 9, 0, Math.PI * 2);
                g.fill();
            }
        },
        { repeat: true },
    );
}

/**
 * LED ribbon board on the upper-deck fascias (`RIBBON_TILE` meters per
 * repeat): alternating team-color and dark panels with the venue text, under
 * a fine LED dot grid.
 */
export function collegeRibbonTexture(text: string, home: string): CanvasTexture {
    const c = rgbOf(home, "#6442ff");
    return paintCanvasTexture(
        2048,
        96,
        (g, w, h) => {
            const label = (text || "OPENMARCH").toUpperCase();
            const panels = 4;
            const pw = w / panels;
            g.textBaseline = "middle";
            g.textAlign = "center";
            for (let i = 0; i < panels; i++) {
                const x = i * pw;
                const lit = i % 2 === 0;
                if (lit) {
                    const grad = g.createLinearGradient(x, 0, x + pw, 0);
                    grad.addColorStop(0, rgb(c, 0.7));
                    grad.addColorStop(0.5, rgb(c, 1.05));
                    grad.addColorStop(1, rgb(c, 0.7));
                    g.fillStyle = grad;
                } else g.fillStyle = "#07080c";
                g.fillRect(x, 0, pw, h);
                g.font = `800 62px ${TEXTURE_FONT}`;
                g.fillStyle = lit ? "#ffffff" : rgb(c, 1.25);
                g.fillText(
                    i % 4 === 1 ? "GO BAND" : label,
                    x + pw / 2,
                    h * 0.53,
                );
            }
            g.fillStyle = "rgba(0,0,0,0.35)";
            for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h);
            for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
        },
        { repeat: true },
    );
}

/**
 * Suite and press box glass (24 m wide, two stories per repeat): mullions
 * every 1.5 m, a slab line, and rooms whose lights vary. Used as the color
 * and the emissive map, so the glass glows warm at night.
 */
export function suiteGlassTexture(): CanvasTexture {
    return paintCanvasTexture(
        512,
        128,
        (g, w, h) => {
            const rnd = createRng(23);
            const bays = 16;
            const bw = w / bays;
            for (let story = 0; story < 2; story++) {
                const y0 = story * (h / 2);
                for (let i = 0; i < bays; i++) {
                    const lit = rnd();
                    const l = lit < 0.2 ? 0.25 : 0.65 + rnd() * 0.35;
                    const grad = g.createLinearGradient(0, y0, 0, y0 + h / 2);
                    grad.addColorStop(0, `rgba(${255 * l},${214 * l},${160 * l},1)`);
                    grad.addColorStop(1, `rgba(${200 * l},${150 * l},${100 * l},1)`);
                    g.fillStyle = grad;
                    g.fillRect(i * bw, y0, bw, h / 2);
                    // A few silhouettes in some rooms.
                    if (lit > 0.5) {
                        g.fillStyle = "rgba(20,16,12,0.6)";
                        for (let k = 0; k < 3; k++) {
                            const px = i * bw + 4 + rnd() * (bw - 10);
                            g.fillRect(px, y0 + h * 0.3, 4, h * 0.2);
                        }
                    }
                }
                g.fillStyle = "#1a1c22";
                g.fillRect(0, y0, w, 6);
                g.fillRect(0, y0 + h / 2 - 10, w, 10);
            }
            g.fillStyle = "#23262d";
            for (let i = 0; i <= bays; i++) g.fillRect(i * bw - 1.5, 0, 3, h);
        },
        { repeat: true },
    );
}

/** A bank of stadium lamps: 8 x 3 round heads on a dark frame (emissive). */
export function lampBankTexture(): CanvasTexture {
    return paintCanvasTexture(
        256,
        96,
        (g, w, h) => {
            g.fillStyle = "#202226";
            g.fillRect(0, 0, w, h);
            const cols = 8;
            const rows = 3;
            for (let i = 0; i < cols; i++)
                for (let j = 0; j < rows; j++) {
                    const x = (i + 0.5) * (w / cols);
                    const y = (j + 0.5) * (h / rows);
                    const grad = g.createRadialGradient(x, y, 1, x, y, 13);
                    grad.addColorStop(0, "#ffffff");
                    grad.addColorStop(0.6, "#fff4dc");
                    grad.addColorStop(1, "#3a3a3a");
                    g.fillStyle = grad;
                    g.beginPath();
                    g.arc(x, y, 12, 0, Math.PI * 2);
                    g.fill();
                }
        },
        { anisotropy: 4 },
    );
}

/**
 * The scoreboard under the video board: home and visitor scores in team
 * colors, the quarter and a clock, as a lit LED panel.
 */
export function scoreboardTexture(home: string, away: string): CanvasTexture {
    const hc = rgbOf(home, "#6442ff");
    const ac = rgbOf(away, "#c23b3b");
    return paintCanvasTexture(1024, 160, (g, w, h) => {
        g.fillStyle = "#050608";
        g.fillRect(0, 0, w, h);
        const block = (x: number, c: [number, number, number], name: string, score: string) => {
            g.fillStyle = rgb(c, 0.95);
            g.fillRect(x, 14, 300, 46);
            g.fillStyle = "#ffffff";
            g.font = `800 38px ${TEXTURE_FONT}`;
            g.textAlign = "center";
            g.textBaseline = "middle";
            g.fillText(name, x + 150, 38);
            g.fillStyle = "#ffcf4a";
            g.font = `700 80px ${TEXTURE_FONT}`;
            g.fillText(score, x + 150, 108);
        };
        block(24, hc, "HOME", "21");
        block(w - 324, ac, "GUEST", "17");
        g.textAlign = "center";
        g.fillStyle = "#ffffff";
        g.font = `800 40px ${TEXTURE_FONT}`;
        g.fillText("HALFTIME", w / 2, 44);
        g.fillStyle = "#ff5a3a";
        g.font = `700 64px ${TEXTURE_FONT}`;
        g.fillText("00:00", w / 2, 110);
        g.fillStyle = "rgba(0,0,0,0.4)";
        for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h);
        for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
    });
}

/** The crown sign above the video board: the venue text on team color. */
export function crownTexture(text: string, home: string): CanvasTexture {
    const c = rgbOf(home, "#6442ff");
    return paintCanvasTexture(1024, 128, (g, w, h) => {
        g.fillStyle = rgb(c, 0.85);
        g.fillRect(0, 0, w, h);
        g.fillStyle = "#ffffff";
        g.fillRect(0, 0, w, 6);
        g.fillRect(0, h - 6, w, 6);
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = `800 84px ${TEXTURE_FONT}`;
        g.fillText((text || "OPENMARCH").toUpperCase(), w / 2, h * 0.55);
    });
}

/**
 * The exterior: red brick with three tall arched openings per `FACADE_TILE`
 * (12 m), limestone trim at the springing line and a dark recess inside each
 * arch, like an old collegiate horseshoe.
 */
export function brickTexture(): CanvasTexture {
    return paintCanvasTexture(
        512,
        512,
        (g, w, h) => {
            const rnd = createRng(31);
            g.fillStyle = "#b9b2a6";
            g.fillRect(0, 0, w, h);
            const bh = 8;
            const bw = 22;
            for (let y = 0, k = 0; y < h; y += bh, k++) {
                for (let x = -(k % 2) * (bw / 2); x < w; x += bw) {
                    const r = 128 + rnd() * 34;
                    g.fillStyle = `rgb(${r},${r * 0.42 + rnd() * 8},${r * 0.32})`;
                    g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
                }
            }
            const bays = 3;
            const bayW = w / bays;
            const open = bayW * 0.5;
            const spring = h * 0.42;
            const sill = h * 0.92;
            for (let i = 0; i < bays; i++) {
                const cx = (i + 0.5) * bayW;
                // Limestone surround, then the dark opening.
                for (const [pad, color] of [
                    [10, "#d9d2c2"],
                    [0, "#1c1a1a"],
                ] as const) {
                    g.fillStyle = color;
                    g.beginPath();
                    g.moveTo(cx - open / 2 - pad, sill);
                    g.lineTo(cx - open / 2 - pad, spring);
                    g.arc(cx, spring, open / 2 + pad, Math.PI, 0);
                    g.lineTo(cx + open / 2 + pad, sill);
                    g.closePath();
                    g.fill();
                }
                // Mullion and transom in the opening.
                g.fillStyle = "#3a3633";
                g.fillRect(cx - 2, spring - open / 2, 4, sill - spring + open / 2);
                g.fillRect(cx - open / 2, spring, open, 4);
            }
            g.fillStyle = "#d9d2c2";
            g.fillRect(0, sill, w, h - sill);
            g.fillRect(0, 0, w, 10);
        },
        { repeat: true },
    );
}
