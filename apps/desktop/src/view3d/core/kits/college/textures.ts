import {
    CanvasTexture,
    RepeatWrapping,
    SRGBColorSpace,
    type Texture,
} from "three";
import { paintCanvasTexture, TEXTURE_FONT } from "../../environment";

/** "#rrggbb" to [r, g, b] in 0..255, falling back to gray. */
export function rgb(hex: string): [number, number, number] {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return [128, 128, 128];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(
    a: [number, number, number],
    b: [number, number, number],
    t: number,
): [number, number, number] {
    return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ];
}

export const css = (c: [number, number, number], a = 1) =>
    `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

/** Small deterministic generator, so textures are the same on every build. */
function lcg(seed: number) {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** Weathered poured concrete with a control joint at the tile edge. 6 x 6 m. */
export function concreteTexture(): CanvasTexture {
    return paintCanvasTexture(
        512,
        512,
        (g, W, H) => {
            g.fillStyle = "#b4b2ac";
            g.fillRect(0, 0, W, H);
            const rnd = lcg(11);
            // Broad mottling first, then fine speckle.
            for (let i = 0; i < 90; i++) {
                const x = rnd() * W;
                const y = rnd() * H;
                const r = 20 + rnd() * 60;
                const grad = g.createRadialGradient(x, y, 0, x, y, r);
                const dark = rnd() < 0.5;
                grad.addColorStop(
                    0,
                    dark ? "rgba(70,68,64,0.10)" : "rgba(255,252,244,0.10)",
                );
                grad.addColorStop(1, "rgba(0,0,0,0)");
                g.fillStyle = grad;
                g.fillRect(x - r, y - r, r * 2, r * 2);
            }
            for (let i = 0; i < 5000; i++) {
                g.fillStyle =
                    rnd() < 0.5
                        ? "rgba(40,38,34,0.12)"
                        : "rgba(255,255,255,0.14)";
                g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 1.5, 1);
            }
            g.fillStyle = "rgba(50,48,44,0.55)";
            g.fillRect(0, 0, 3, H);
            g.fillRect(0, 0, W, 3);
        },
        { repeat: true },
    );
}

export type SeatPattern = "solid" | "stripe" | "band";

/**
 * One tread's seats, 12 m long (24 seats) by one row deep. The seat back is at
 * the top of the canvas (the far side of the tread), the cushion below it.
 */
export function seatTexture(
    color: string,
    pattern: SeatPattern,
): CanvasTexture {
    const base = rgb(color);
    return paintCanvasTexture(
        512,
        128,
        (g, W, H) => {
            const cells = 24;
            const cw = W / cells;
            g.fillStyle = "#26272b";
            g.fillRect(0, 0, W, H);
            for (let i = 0; i < cells; i++) {
                let c = base;
                if (pattern === "stripe") {
                    c = Math.floor(i / 3) % 2 === 0 ? base : [236, 232, 220];
                } else if (pattern === "band") {
                    c = i % 6 === 2 ? mix(base, [255, 255, 255], 0.55) : base;
                }
                const x = i * cw;
                // back
                g.fillStyle = css(mix(c, [0, 0, 0], 0.18));
                g.fillRect(x + 1.5, 4, cw - 3, H * 0.46);
                g.fillStyle = css(mix(c, [255, 255, 255], 0.2));
                g.fillRect(x + 1.5, 4, cw - 3, 5);
                // cushion
                g.fillStyle = css(c);
                g.fillRect(x + 1.5, H * 0.56, cw - 3, H * 0.4);
            }
        },
        { repeat: true },
    );
}

/** A mowed-lawn tile: two bands, each 4.57 m (5 yd) wide when repeated. */
export function lawnTexture(): CanvasTexture {
    return paintCanvasTexture(
        128,
        64,
        (g, W, H) => {
            const rnd = lcg(5);
            g.fillStyle = "#3f7d34";
            g.fillRect(0, 0, W / 2, H);
            g.fillStyle = "#37702d";
            g.fillRect(W / 2, 0, W / 2, H);
            for (let i = 0; i < 700; i++) {
                g.fillStyle =
                    rnd() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";
                g.fillRect(rnd() * W, rnd() * H, 1, 2);
            }
        },
        { repeat: true },
    );
}

/** The padded wall around the field, 12 m by 1.4 m: team color and lettering. */
export function wallTexture(color: string, text: string): CanvasTexture {
    const c = rgb(color);
    return paintCanvasTexture(
        1024,
        120,
        (g, W, H) => {
            g.fillStyle = css(c);
            g.fillRect(0, 0, W, H);
            // padded panels
            g.fillStyle = css(mix(c, [0, 0, 0], 0.22), 0.55);
            for (let x = 0; x < W; x += W / 4) g.fillRect(x, 0, 3, H);
            g.fillStyle = css(mix(c, [255, 255, 255], 0.5));
            g.fillRect(0, 0, W, 9);
            g.fillStyle = "rgba(255,255,255,0.92)";
            g.font = `800 ${H * 0.52}px ${TEXTURE_FONT}`;
            g.textAlign = "center";
            g.textBaseline = "middle";
            g.fillText(text.toUpperCase(), W / 2, H * 0.58);
        },
        { repeat: true },
    );
}

/**
 * The stadium's outer wall: brick bays with limestone pilasters, a stone base
 * and tall arched openings. 14 m wide by 9 m tall when repeated. With
 * `windows` it paints only the openings (the warm glow at night).
 */
export function facadeTexture(tint: string, windows: boolean): CanvasTexture {
    const brick = mix([150, 108, 88], rgb(tint), 0.22);
    const stone: [number, number, number] = [206, 196, 176];
    return paintCanvasTexture(
        1024,
        658,
        (g, W, H) => {
            const px = W / 14; // px per meter, both axes (658 / 9 = 73)
            if (windows) {
                g.fillStyle = "#000";
                g.fillRect(0, 0, W, H);
            } else {
                const rnd = lcg(3);
                g.fillStyle = css(brick);
                g.fillRect(0, 0, W, H);
                // brick courses
                for (let y = 0; y < H; y += px * 0.14) {
                    g.fillStyle = "rgba(30,20,16,0.22)";
                    g.fillRect(0, y, W, 1);
                }
                for (let i = 0; i < 2600; i++) {
                    g.fillStyle =
                        rnd() < 0.5
                            ? "rgba(255,230,200,0.07)"
                            : "rgba(20,10,6,0.10)";
                    g.fillRect(rnd() * W, rnd() * H, px * 0.3, px * 0.12);
                }
            }
            // Canvas y = 0 is the top of the tile. The stone base is the
            // bottom 1.1 m; a cornice runs along the top.
            if (!windows) {
                g.fillStyle = css(stone);
                g.fillRect(0, H - px * 1.1, W, px * 1.1);
                g.fillStyle = css(mix(stone, [90, 80, 64], 0.4));
                g.fillRect(0, H - px * 1.1, W, 3);
                g.fillRect(0, 0, W, px * 0.35);
                g.fillStyle = css(mix(stone, [255, 255, 255], 0.25));
                g.fillRect(0, px * 0.35, W, 3);
            }
            // two bays per tile, 7 m each
            for (let bay = 0; bay < 2; bay++) {
                const x0 = bay * 7 * px;
                const openW = 3.4 * px;
                const ox = x0 + (7 * px - openW) / 2;
                const top = px * 1.4;
                const bottom = H - px * 1.1;
                const archR = openW / 2;
                const drawOpening = (inset: number) => {
                    g.beginPath();
                    g.moveTo(ox + inset, bottom);
                    g.lineTo(ox + inset, top + archR);
                    g.arc(
                        ox + openW / 2,
                        top + archR,
                        archR - inset,
                        Math.PI,
                        0,
                    );
                    g.lineTo(ox + openW - inset, bottom);
                    g.closePath();
                };
                if (!windows) {
                    g.fillStyle = css(stone);
                    drawOpening(-px * 0.28);
                    g.fill();
                    // pilaster between bays
                    g.fillRect(x0 - px * 0.3, px * 0.35, px * 0.6, H);
                    g.fillRect(x0 + 7 * px - px * 0.3, px * 0.35, px * 0.6, H);
                    g.fillStyle = "#1a1c22";
                } else {
                    g.fillStyle = "#ffc27a";
                }
                drawOpening(0);
                g.fill();
                if (!windows) {
                    // mullions, so the opening reads as a window
                    g.fillStyle = css(mix(stone, [60, 56, 48], 0.5));
                    g.fillRect(ox + openW / 2 - 2, top, 4, bottom - top);
                    g.fillRect(ox, top + archR + px * 1.2, openW, 4);
                    g.fillRect(ox, top + archR + px * 3.4, openW, 4);
                } else {
                    g.fillStyle = "#000";
                    g.fillRect(ox + openW / 2 - 3, top, 6, bottom - top);
                    g.fillRect(ox, top + archR + px * 1.2, openW, 6);
                    g.fillRect(ox, top + archR + px * 3.4, openW, 6);
                }
            }
        },
        { repeat: true },
    );
}

/**
 * Suite glass: 16 m wide by 8 m tall when repeated (four 4 m suites, two
 * floors). With `lit` it paints the warm interiors for the night emissive.
 */
export function glassTexture(lit: boolean): CanvasTexture {
    return paintCanvasTexture(
        1024,
        512,
        (g, W, H) => {
            const rnd = lcg(lit ? 21 : 9);
            if (lit) {
                g.fillStyle = "#000";
                g.fillRect(0, 0, W, H);
            } else {
                const grad = g.createLinearGradient(0, 0, 0, H);
                grad.addColorStop(0, "#3b5f86");
                grad.addColorStop(0.5, "#1c2f47");
                grad.addColorStop(1, "#14202f");
                g.fillStyle = grad;
                g.fillRect(0, 0, W, H);
            }
            const bays = 4;
            const floors = 2;
            const bw = W / bays;
            const fh = H / floors;
            for (let f = 0; f < floors; f++) {
                for (let b = 0; b < bays; b++) {
                    const x = b * bw;
                    const y = f * fh;
                    if (lit) {
                        if (rnd() < 0.8) {
                            g.fillStyle = rnd() < 0.5 ? "#ffd9a0" : "#ffe9c8";
                            g.fillRect(x + 8, y + 22, bw - 16, fh - 40);
                            // a few people as dark bars
                            g.fillStyle = "rgba(40,24,10,0.65)";
                            for (let k = 0; k < 3; k++) {
                                g.fillRect(
                                    x + 24 + rnd() * (bw - 70),
                                    y + fh * 0.45,
                                    9,
                                    fh * 0.4,
                                );
                            }
                        }
                    } else {
                        g.fillStyle = "rgba(255,255,255,0.07)";
                        g.beginPath();
                        g.moveTo(x, y + fh);
                        g.lineTo(x + bw * 0.5, y);
                        g.lineTo(x + bw * 0.75, y);
                        g.lineTo(x + bw * 0.25, y + fh);
                        g.fill();
                    }
                }
            }
            // mullions and floor slabs, in both maps
            g.fillStyle = lit ? "#000" : "#9aa3ad";
            for (let b = 0; b <= bays; b++) g.fillRect(b * bw - 4, 0, 8, H);
            g.fillStyle = lit ? "#000" : "#dcd8cf";
            g.fillRect(0, 0, W, 16);
            g.fillRect(0, fh - 9, W, 18);
            g.fillRect(0, H - 9, W, 9);
        },
        { repeat: true },
    );
}

/** LED ribbon board, 35 m by 2.2 m when repeated: team colors and lettering. */
export function ribbonBoardTexture(
    text: string,
    primary: string,
    secondary: string,
): CanvasTexture {
    const a = rgb(primary);
    const b = rgb(secondary);
    return paintCanvasTexture(
        2048,
        128,
        (g, W, H) => {
            g.fillStyle = "#0a0a12";
            g.fillRect(0, 0, W, H);
            const grad = g.createLinearGradient(0, 0, W, 0);
            grad.addColorStop(0, css(mix(a, [0, 0, 0], 0.55)));
            grad.addColorStop(0.5, css(mix(a, [0, 0, 0], 0.2)));
            grad.addColorStop(1, css(mix(a, [0, 0, 0], 0.55)));
            g.fillStyle = grad;
            g.fillRect(0, 10, W, H - 20);
            g.fillStyle = css(mix(b, [255, 255, 255], 0.4));
            g.fillRect(0, 0, W, 8);
            g.fillRect(0, H - 8, W, 8);
            g.fillStyle = "#fff";
            g.font = `800 ${H * 0.56}px ${TEXTURE_FONT}`;
            g.textBaseline = "middle";
            g.textAlign = "left";
            const label = `${text.toUpperCase()}   ★   `;
            const w = g.measureText(label).width || 400;
            const n = Math.max(1, Math.floor(W / w));
            const gap = (W - w * n) / n;
            for (let i = 0; i < n; i++) {
                g.fillText(label, i * (w + gap), H * 0.54);
            }
            // LED grid
            g.fillStyle = "rgba(0,0,0,0.28)";
            for (let x = 0; x < W; x += 4) g.fillRect(x, 0, 1, H);
            for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
        },
        { repeat: true },
    );
}

/** The lamp face of a light bank: a grid of hot dots on a dark frame. */
export function lampTexture(): CanvasTexture {
    return paintCanvasTexture(256, 128, (g, W, H) => {
        g.fillStyle = "#15161a";
        g.fillRect(0, 0, W, H);
        const cols = 12;
        const rows = 6;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = ((c + 0.5) * W) / cols;
                const y = ((r + 0.5) * H) / rows;
                const grad = g.createRadialGradient(x, y, 0, x, y, 9);
                grad.addColorStop(0, "#ffffff");
                grad.addColorStop(0.5, "#fff1cf");
                grad.addColorStop(1, "rgba(255,230,180,0)");
                g.fillStyle = grad;
                g.fillRect(x - 10, y - 10, 20, 20);
            }
        }
    });
}

/** Line score for the scoreboard above the video board. */
export function scoreboardTexture(home: string, away: string): CanvasTexture {
    const h = rgb(home);
    const a = rgb(away);
    return paintCanvasTexture(1024, 256, (g, W, H) => {
        g.fillStyle = "#08090c";
        g.fillRect(0, 0, W, H);
        const row = (
            y: number,
            c: [number, number, number],
            label: string,
            score: string,
        ) => {
            g.fillStyle = css(c);
            g.fillRect(36, y, 360, 90);
            g.fillStyle = "#fff";
            g.font = `800 58px ${TEXTURE_FONT}`;
            g.textAlign = "center";
            g.textBaseline = "middle";
            g.fillText(label, 216, y + 47);
            g.fillStyle = "#ffb52e";
            g.font = `800 110px ${TEXTURE_FONT}`;
            g.fillText(score, 500, y + 50);
        };
        row(26, h, "HOME", "21");
        row(140, a, "GUEST", "17");
        g.fillStyle = "#ffb52e";
        g.textAlign = "center";
        g.font = `700 40px ${TEXTURE_FONT}`;
        g.fillText("QTR", 700, 50);
        g.fillText("TIME", 880, 50);
        g.font = `800 110px ${TEXTURE_FONT}`;
        g.fillText("3", 700, 150);
        g.fillText("4:12", 880, 150);
        g.fillStyle = "rgba(0,0,0,0.3)";
        for (let x = 0; x < W; x += 5) g.fillRect(x, 0, 1, H);
        for (let y = 0; y < H; y += 5) g.fillRect(0, y, W, 1);
    });
}

/** A pennant banner for the stair towers: team color, border, stacked name. */
export function bannerTexture(color: string, text: string): CanvasTexture {
    const c = rgb(color);
    return paintCanvasTexture(128, 512, (g, W, H) => {
        g.fillStyle = css(c);
        g.fillRect(0, 0, W, H);
        g.fillStyle = css(mix(c, [255, 255, 255], 0.75));
        g.fillRect(6, 6, W - 12, 6);
        g.fillRect(6, H - 12, W - 12, 6);
        g.fillRect(6, 6, 6, H - 12);
        g.fillRect(W - 12, 6, 6, H - 12);
        g.fillStyle = "#fff";
        g.font = `800 56px ${TEXTURE_FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("\u2605", W / 2, 60);
        const letters = text.toUpperCase().replace(/\s+/g, "").slice(0, 7);
        g.font = `800 64px ${TEXTURE_FONT}`;
        [...letters].forEach((ch, i) =>
            g.fillText(ch, W / 2, 140 + i * forStep(letters.length)),
        );
    });
}

const forStep = (n: number) => Math.min(70, 340 / Math.max(1, n));

export function repeatTexture(t: Texture, x: number, y: number): void {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(x, y);
    t.colorSpace = SRGBColorSpace;
}
