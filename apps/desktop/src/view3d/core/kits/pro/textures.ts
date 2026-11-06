import type { CanvasTexture } from "three";
import { createRng, paintCanvasTexture, TEXTURE_FONT } from "../../environment";

/**
 * Canvas textures for the pro dome. All procedural (ADR 0010 D-1): nothing is
 * downloaded or bundled. Canvas y = 0 is the texture's top (v = 1).
 *
 * Bands built by `bandGeometry` run `v` from the lower ring (0) to the upper
 * one (1), so on a vertical wall the canvas top is the top of the wall.
 */

type Paint = (g: CanvasRenderingContext2D, w: number, h: number) => void;

/** A color and an emissive texture painted on the same layout. */
export interface TexturePair {
    map: CanvasTexture;
    emissive: CanvasTexture;
}

function pair(
    w: number,
    h: number,
    color: Paint,
    glow: Paint,
    repeat = true,
): TexturePair {
    return {
        map: paintCanvasTexture(w, h, color, { repeat }),
        emissive: paintCanvasTexture(
            w,
            h,
            (g, cw, ch) => {
                g.fillStyle = "#000";
                g.fillRect(0, 0, cw, ch);
                glow(g, cw, ch);
            },
            { repeat },
        ),
    };
}

/** Lightens (amount > 0) or darkens a "#rrggbb" color. */
export function shade(hex: string, amount: number): string {
    const n = parseInt(hex.replace("#", ""), 16);
    const ch = (s: number) => {
        const c = (n >> s) & 0xff;
        const t = amount > 0 ? 255 : 0;
        return Math.round(c + (t - c) * Math.abs(amount));
    };
    return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/**
 * One seating section, one row deep: a concrete walkway at the front of the
 * tread, a row of blue seats behind it and a half aisle with a stair nosing
 * at each side. `u` spans one section (`ringSections`), `v` one tread.
 */
export function seatTexture(): CanvasTexture {
    return paintCanvasTexture(
        512,
        64,
        (g, w, h) => {
            // Walkway, front of the tread (bottom of the canvas).
            g.fillStyle = "#5d6068";
            g.fillRect(0, 0, w, h);
            const seatTop = 4;
            const seatBottom = 40;
            g.fillStyle = "#123a8a";
            g.fillRect(0, seatTop, w, seatBottom - seatTop);
            const seatW = 11;
            for (let x = 0; x < w; x += seatW) {
                // Seat back (top), seat pan, and a shadow line between seats.
                g.fillStyle = "#0d2c6e";
                g.fillRect(x, seatTop, seatW - 2, 10);
                g.fillStyle = "#2457b8";
                g.fillRect(x + 1, seatTop + 12, seatW - 3, seatBottom - 18);
                g.fillStyle = "#081c48";
                g.fillRect(x + seatW - 2, seatTop, 2, seatBottom - seatTop);
            }
            g.fillStyle = "rgba(0,0,0,0.35)";
            g.fillRect(0, seatBottom, w, 5);
            // Aisle steps: plain concrete, light nosing at the front edge.
            const aisle = 22;
            for (const x of [0, w - aisle]) {
                g.fillStyle = "#7c7f87";
                g.fillRect(x, 0, aisle, h);
                g.fillStyle = "#d8d2b4";
                g.fillRect(x, h - 5, aisle, 5);
            }
        },
        { repeat: true },
    );
}

/**
 * An LED ribbon in the home color: the end-zone text, chevrons, a running
 * "score" readout and a small badge. Repeats along U; 8:1 so it isn't
 * stretched on a band whose tile is eight times its height.
 */
export function ledRibbonTexture(text: string, home: string): CanvasTexture {
    return paintCanvasTexture(
        1024,
        128,
        (g, w, h) => {
            g.fillStyle = "#05060c";
            g.fillRect(0, 0, w, h);
            const bg = g.createLinearGradient(0, 0, 0, h);
            bg.addColorStop(0, shade(home, -0.35));
            bg.addColorStop(1, shade(home, -0.7));
            g.fillStyle = bg;
            g.fillRect(0, 6, 440, h - 12);
            g.fillStyle = "#fff";
            g.font = `800 76px ${TEXTURE_FONT}`;
            g.textBaseline = "middle";
            g.textAlign = "center";
            g.fillText(text.toUpperCase(), 220, h / 2 + 4, 420);

            // Chevrons running toward the text.
            g.fillStyle = shade(home, 0.35);
            for (let i = 0; i < 6; i++) {
                const x = 460 + i * 28;
                g.beginPath();
                g.moveTo(x + 18, 24);
                g.lineTo(x, h / 2);
                g.lineTo(x + 18, h - 24);
                g.lineTo(x + 30, h - 24);
                g.lineTo(x + 12, h / 2);
                g.lineTo(x + 30, 24);
                g.fill();
            }

            g.fillStyle = "#101522";
            g.fillRect(650, 10, 360, h - 20);
            g.fillStyle = "#ffd34d";
            g.font = `700 38px ${TEXTURE_FONT}`;
            g.textAlign = "left";
            g.fillText("FINALS", 668, h / 2 + 2);
            g.fillStyle = "#e9edf7";
            g.font = `700 46px ${TEXTURE_FONT}`;
            g.textAlign = "right";
            g.fillText("8:45 PM", 992, h / 2 + 2);
            // LED pixel grid.
            g.fillStyle = "rgba(0,0,0,0.28)";
            for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
            for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h);
        },
        { repeat: true },
    );
}

/**
 * Suite windows: eight suites per tile, warm interiors of uneven brightness,
 * mullions and a few people at the glass. Use as both map and emissive map.
 */
export function suiteTexture(): CanvasTexture {
    const rnd = createRng(31);
    return paintCanvasTexture(
        1024,
        128,
        (g, w, h) => {
            const n = 8;
            const sw = w / n;
            for (let i = 0; i < n; i++) {
                const x = i * sw;
                const lit = 0.55 + rnd() * 0.45;
                const grad = g.createLinearGradient(0, 0, 0, h);
                grad.addColorStop(0, `rgba(255,226,170,${lit})`);
                grad.addColorStop(0.55, `rgba(176,128,82,${lit * 0.8})`);
                grad.addColorStop(1, `rgba(60,40,30,${lit * 0.9})`);
                g.fillStyle = "#14161c";
                g.fillRect(x, 0, sw, h);
                g.fillStyle = grad;
                g.fillRect(x, 0, sw, h);
                // Ceiling lights.
                g.fillStyle = "rgba(255,245,220,0.9)";
                for (let k = 0; k < 3; k++)
                    g.fillRect(x + 16 + k * 40, 8, 18, 4);
                // People standing at the glass.
                const people = Math.floor(rnd() * 4);
                for (let k = 0; k < people; k++) {
                    const px = x + 12 + rnd() * (sw - 30);
                    g.fillStyle = `rgba(20,16,14,${0.7 + rnd() * 0.3})`;
                    g.fillRect(px, h - 70, 12, 70);
                    g.beginPath();
                    g.arc(px + 6, h - 78, 7, 0, Math.PI * 2);
                    g.fill();
                }
                // Mullions and the counter rail.
                g.fillStyle = "#0b0c10";
                g.fillRect(x, 0, 6, h);
                g.fillRect(x + sw / 2 - 2, 0, 3, h);
                g.fillRect(x, h - 26, sw, 5);
            }
            g.fillStyle = "#0b0c10";
            g.fillRect(0, 0, w, 4);
            g.fillRect(0, h - 4, w, 4);
        },
        { repeat: true },
    );
}

/** Exterior heights in the facade texture, meters above the ground. */
export const FACADE_LAYOUT = {
    /** Wall height the texture's v spans. */
    height: 52,
    /** Limestone plinth with entrances. */
    base: 5,
    /** Top of the brick and its arched windows. */
    brick: 33,
    /** Top of the steel and glass band; above it is the cornice. */
    glass: 50.5,
} as const;

/**
 * The outside wall, one bay per tile (24 m): a limestone plinth with doors,
 * red-brown brick with two tall arched windows, a limestone string course,
 * then a steel-and-glass band up to a light cornice. The emissive texture
 * lights the windows and doors for night.
 */
export function facadeTextures(): TexturePair {
    const H = FACADE_LAYOUT.height;
    const W = 512;
    const CH = 1024;
    const y = (m: number) => CH * (1 - m / H);
    const L = FACADE_LAYOUT;
    const arch = (g: CanvasRenderingContext2D, x: number, ww: number) => {
        const top = y(L.brick - 3);
        const bottom = y(L.base + 3);
        g.beginPath();
        g.moveTo(x, bottom);
        g.lineTo(x, top + ww / 2);
        g.arc(x + ww / 2, top + ww / 2, ww / 2, Math.PI, 0);
        g.lineTo(x + ww, bottom);
        g.closePath();
    };
    const windows = [96, 320];
    const ww = 96;
    return pair(
        W,
        CH,
        (g) => {
            const rnd = createRng(11);
            // Brick body with course lines and tone noise.
            g.fillStyle = "#7e4434";
            g.fillRect(0, 0, W, CH);
            for (let row = y(L.brick); row < y(L.base); row += 6) {
                g.fillStyle = `rgba(${rnd() > 0.5 ? "40,18,12" : "150,90,70"},${0.08 + rnd() * 0.1})`;
                g.fillRect(0, row, W, 6);
                g.fillStyle = "rgba(30,14,10,0.25)";
                g.fillRect(0, row, W, 1);
            }
            // Pilasters at the bay edges.
            g.fillStyle = "#8d5040";
            g.fillRect(0, y(L.brick), 24, y(L.base) - y(L.brick));
            g.fillRect(W - 24, y(L.brick), 24, y(L.base) - y(L.brick));
            g.fillStyle = "#6a3529";
            g.fillRect(W / 2 - 10, y(L.brick), 20, y(L.base) - y(L.brick));
            // Arched windows: stone surround, dark glass, mullions.
            for (const x of windows) {
                g.fillStyle = "#cfc6b0";
                arch(g, x - 8, ww + 16);
                g.fill();
                g.fillStyle = "#1c2633";
                arch(g, x, ww);
                g.fill();
                g.fillStyle = "#2f3a48";
                for (let m = 1; m < 4; m++)
                    g.fillRect(x + (m * ww) / 4 - 2, y(L.brick - 3), 4, 760);
                for (let r = y(L.brick - 6); r < y(L.base + 3); r += 40)
                    g.fillRect(x, r, ww, 3);
            }
            // Limestone plinth, string course and cornice.
            g.fillStyle = "#c9c0aa";
            g.fillRect(0, y(L.base), W, CH - y(L.base));
            g.fillRect(0, y(L.brick + 1.4), W, y(L.brick) - y(L.brick + 1.4));
            g.fillStyle = "#b3aa94";
            g.fillRect(0, y(L.base) - 4, W, 8);
            g.fillStyle = "#20252c";
            for (const x of [56, 280])
                g.fillRect(x, y(3.6), 176, y(0) - y(3.6));
            // Steel and glass band.
            const gTop = y(L.glass);
            const gBot = y(L.brick + 1.4);
            const glass = g.createLinearGradient(0, gTop, 0, gBot);
            glass.addColorStop(0, "#5f7894");
            glass.addColorStop(1, "#2a3a4f");
            g.fillStyle = glass;
            g.fillRect(0, gTop, W, gBot - gTop);
            g.fillStyle = "#c4c8ce";
            for (let x = 0; x <= W; x += 32) g.fillRect(x - 2, gTop, 4, gBot - gTop);
            for (let r = gTop; r < gBot; r += 52) g.fillRect(0, r, W, 3);
            g.fillStyle = "#e3e1da";
            g.fillRect(0, 0, W, gTop);
            g.fillStyle = "rgba(0,0,0,0.2)";
            g.fillRect(0, gTop - 4, W, 4);
        },
        (g) => {
            for (const x of windows) {
                const grad = g.createLinearGradient(0, y(L.brick), 0, y(L.base));
                grad.addColorStop(0, "rgba(255,190,110,0.35)");
                grad.addColorStop(1, "rgba(255,214,150,0.9)");
                g.fillStyle = grad;
                arch(g, x, ww);
                g.fill();
            }
            g.fillStyle = "rgba(255,226,170,0.95)";
            for (const x of [56, 280]) g.fillRect(x, y(3.6), 176, y(0) - y(3.6));
            // The glass band glows faintly from the concourse inside.
            g.fillStyle = "rgba(170,200,255,0.28)";
            g.fillRect(0, y(L.glass), W, y(L.brick + 1.4) - y(L.glass));
        },
    );
}

/**
 * The inside of the outer wall, seen above the upper deck: dark panels, a
 * lit concourse strip and a band of clerestory glass under the roof.
 */
export function interiorWallTextures(rimTop: number): TexturePair {
    const H = FACADE_LAYOUT.height;
    const CH = 512;
    const W = 256;
    const y = (m: number) => CH * (1 - m / H);
    return pair(
        W,
        CH,
        (g) => {
            g.fillStyle = "#24272d";
            g.fillRect(0, 0, W, CH);
            g.fillStyle = "#1a1c21";
            for (let x = 0; x < W; x += 32) g.fillRect(x, 0, 2, CH);
            // Clerestory glass.
            const gTop = y(H - 4);
            const gBot = y(rimTop + 5);
            const glass = g.createLinearGradient(0, gTop, 0, gBot);
            glass.addColorStop(0, "#c5d3e2");
            glass.addColorStop(1, "#8a9cb2");
            g.fillStyle = glass;
            g.fillRect(0, gTop, W, gBot - gTop);
            g.fillStyle = "#2c3038";
            for (let x = 0; x < W; x += 21) g.fillRect(x, gTop, 3, gBot - gTop);
            g.fillRect(0, (gTop + gBot) / 2, W, 3);
            // Concourse light strip, just above the deck's back rim.
            g.fillStyle = "#e9dcc0";
            g.fillRect(0, y(rimTop + 2.2), W, y(rimTop + 1.2) - y(rimTop + 2.2));
        },
        (g) => {
            g.fillStyle = "rgba(255,226,180,1)";
            g.fillRect(0, y(rimTop + 2.2), W, y(rimTop + 1.2) - y(rimTop + 2.2));
        },
    );
}

/**
 * The end window wall: a glass curtain wall with heavy mullions every half
 * tile, lighter ones between and transoms. Transparent panes (alpha).
 */
export function windowWallTexture(): CanvasTexture {
    return paintCanvasTexture(
        256,
        512,
        (g, w, h) => {
            g.clearRect(0, 0, w, h);
            const pane = g.createLinearGradient(0, 0, 0, h);
            pane.addColorStop(0, "rgba(200,218,236,0.38)");
            pane.addColorStop(1, "rgba(150,176,204,0.26)");
            g.fillStyle = pane;
            g.fillRect(0, 0, w, h);
            g.fillStyle = "rgba(52,58,68,1)";
            for (let x = 0; x <= w; x += w / 8) g.fillRect(x - 3, 0, 6, h);
            for (let x = 0; x <= w; x += w / 2) g.fillRect(x - 8, 0, 16, h);
            for (let r = 0; r <= h; r += h / 16) g.fillRect(0, r - 3, w, 6);
            for (let r = 0; r <= h; r += h / 4) g.fillRect(0, r - 7, w, 14);
        },
        { repeat: true },
    );
}

/**
 * Roof tops: the fixed roof's big gray membrane panels with seams and a few
 * weathered ones (`panels` false), or the sliding panels' standing-seam
 * metal (`panels` true).
 */
export function roofTopTexture(panels: boolean): CanvasTexture {
    const rnd = createRng(panels ? 5 : 3);
    return paintCanvasTexture(
        256,
        256,
        (g, w, h) => {
            g.fillStyle = panels ? "#8e969f" : "#a9adb1";
            g.fillRect(0, 0, w, h);
            if (panels) {
                for (let x = 0; x < w; x += 8) {
                    g.fillStyle = "rgba(255,255,255,0.18)";
                    g.fillRect(x, 0, 2, h);
                    g.fillStyle = "rgba(20,24,30,0.35)";
                    g.fillRect(x + 2, 0, 1, h);
                }
                return;
            }
            for (let y = 0; y < h; y += 64)
                for (let x = 0; x < w; x += 64) {
                    const t = rnd();
                    g.fillStyle = `rgba(${t > 0.5 ? "255,255,255" : "40,44,50"},${0.04 + rnd() * 0.08})`;
                    g.fillRect(x, y, 64, 64);
                }
            g.fillStyle = "rgba(60,64,70,0.55)";
            for (let y = 0; y < h; y += 64) g.fillRect(0, y, w, 2);
            for (let x = 0; x < w; x += 64) g.fillRect(x, 0, 2, h);
            g.fillStyle = "rgba(60,64,70,0.2)";
            for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 1);
        },
        { repeat: true },
    );
}

/** The underside of the roof: dark steel deck with a purlin grid. */
export function roofUndersideTexture(): CanvasTexture {
    return paintCanvasTexture(
        256,
        256,
        (g, w, h) => {
            g.fillStyle = "#5a6068";
            g.fillRect(0, 0, w, h);
            g.fillStyle = "rgba(0,0,0,0.18)";
            for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 3, h);
            g.fillStyle = "#8d939b";
            for (let y = 0; y < h; y += 64) g.fillRect(0, y, w, 5);
            g.fillStyle = "#6f757d";
            for (let x = 0; x < w; x += 128) g.fillRect(x, 0, 4, h);
        },
        { repeat: true },
    );
}

/** The end-zone video board screen: a show graphic in the home color. */
export function boardScreenTexture(title: string, home: string): CanvasTexture {
    return paintCanvasTexture(1024, 544, (g, w, h) => {
        const bg = g.createLinearGradient(0, 0, w, h);
        bg.addColorStop(0, shade(home, -0.25));
        bg.addColorStop(1, shade(home, -0.8));
        g.fillStyle = bg;
        g.fillRect(0, 0, w, h);
        // Diagonal light streaks.
        g.fillStyle = "rgba(255,255,255,0.06)";
        for (let i = 0; i < 6; i++) {
            g.beginPath();
            const x = 120 + i * 170;
            g.moveTo(x, 0);
            g.lineTo(x + 70, 0);
            g.lineTo(x - 160, h);
            g.lineTo(x - 230, h);
            g.fill();
        }
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillStyle = "rgba(255,255,255,0.75)";
        g.font = `600 44px ${TEXTURE_FONT}`;
        g.fillText("NOW PERFORMING", w / 2, 120);
        g.fillStyle = "#fff";
        g.font = `800 132px ${TEXTURE_FONT}`;
        g.fillText(title.toUpperCase(), w / 2, 250, w - 80);
        // Lower third.
        g.fillStyle = "rgba(0,0,0,0.55)";
        g.fillRect(0, h - 132, w, 132);
        g.fillStyle = "#ffd34d";
        g.fillRect(0, h - 132, 16, 132);
        g.fillStyle = "#fff";
        g.textAlign = "left";
        g.font = `700 52px ${TEXTURE_FONT}`;
        g.fillText("3D VIEW", 48, h - 84);
        g.fillStyle = "rgba(255,255,255,0.7)";
        g.font = `500 36px ${TEXTURE_FONT}`;
        g.fillText("Live from the press box", 48, h - 36);
        g.textAlign = "right";
        g.fillStyle = "#fff";
        g.font = `700 64px ${TEXTURE_FONT}`;
        g.fillText("8:45", w - 48, h - 64);
    });
}

/** Office towers beyond the window wall: window grid, some lit at night. */
export function towerTextures(): TexturePair {
    const cols = 12;
    const rows = 36;
    return pair(
        128,
        512,
        (g, w, h) => {
            g.fillStyle = "#6c7684";
            g.fillRect(0, 0, w, h);
            g.fillStyle = "#3b4654";
            for (let r = 0; r < rows; r++)
                for (let c = 0; c < cols; c++)
                    g.fillRect(
                        (c * w) / cols + 2,
                        (r * h) / rows + 3,
                        w / cols - 4,
                        h / rows - 6,
                    );
        },
        (g, w, h) => {
            const rnd = createRng(17);
            for (let r = 0; r < rows; r++)
                for (let c = 0; c < cols; c++) {
                    if (rnd() > 0.45) continue;
                    g.fillStyle = `rgba(255,${200 + Math.floor(rnd() * 40)},140,${0.5 + rnd() * 0.5})`;
                    g.fillRect(
                        (c * w) / cols + 2,
                        (r * h) / rows + 3,
                        w / cols - 4,
                        h / rows - 6,
                    );
                }
        },
    );
}

/**
 * Surface parking around the plaza, one 30 m square per tile: asphalt with
 * striped stall rows on either side of drive aisles and a planted median.
 * `u` runs along the stalls' rows, `v` across them.
 */
export function parkingTexture(): CanvasTexture {
    const rnd = createRng(41);
    return paintCanvasTexture(
        256,
        256,
        (g, w, h) => {
            g.fillStyle = "#44464b";
            g.fillRect(0, 0, w, h);
            for (let i = 0; i < 260; i++) {
                g.fillStyle = `rgba(${rnd() > 0.5 ? "255,255,255" : "0,0,0"},0.05)`;
                g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 8, 2 + rnd() * 8);
            }
            const stalls = (y: number, depth: number) => {
                g.fillStyle = "rgba(225,225,215,0.45)";
                for (let x = 0; x < w; x += 23) g.fillRect(x, y, 1, depth);
                // A few parked cars.
                for (let x = 2; x < w - 20; x += 23) {
                    if (rnd() > 0.3) continue;
                    const shade = 30 + Math.floor(rnd() * 110);
                    g.fillStyle = `rgb(${shade},${shade},${shade + 10})`;
                    g.fillRect(x + 3, y + 6, 15, depth - 12);
                }
            };
            stalls(0, 47);
            stalls(107, 47);
            g.fillStyle = "#4d6b3a";
            g.fillRect(0, 158, w, 18);
            g.fillStyle = "#3f5a30";
            for (let x = 8; x < w; x += 32) {
                g.beginPath();
                g.arc(x, 167, 8, 0, Math.PI * 2);
                g.fill();
            }
            stalls(180, 47);
        },
        { repeat: true },
    );
}
