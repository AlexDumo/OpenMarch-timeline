import { RepeatWrapping, type CanvasTexture } from "three";
import { createRng, paintCanvasTexture, TEXTURE_FONT } from "../../environment";

/**
 * Procedural textures for the high school stadium kits. Everything is painted
 * on small canvases (<= 2048 px) so the kits stay offline and cheap. Tiling
 * textures cover a known size in meters; callers set `repeat` from it.
 */

const css = (hex: number) => `#${hex.toString(16).padStart(6, "0")}`;

/** Scales a "#rrggbb" color by `k` (clamped), for shading team colors. */
export function shade(hex: number, k: number): number {
    const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
    return (
        (c((hex >> 16) & 255) << 16) | (c((hex >> 8) & 255) << 8) | c(hex & 255)
    );
}

/** Perceived brightness 0..1, to pick white or dark lettering. */
export function luma(hex: number): number {
    return (
        (0.299 * ((hex >> 16) & 255) +
            0.587 * ((hex >> 8) & 255) +
            0.114 * (hex & 255)) /
        255
    );
}

export function parseColor(text: string, fallback: number): number {
    const m = /^#([0-9a-f]{6})$/i.exec(text.trim());
    return m ? parseInt(m[1], 16) : fallback;
}

function tiled(tex: CanvasTexture): CanvasTexture {
    tex.wrapS = tex.wrapT = RepeatWrapping;
    return tex;
}

/** Mown grass: soft patches plus fine blades. Covers `GRASS_TILE` meters. */
export const GRASS_TILE = 12;
export function grassTexture(base: number, seed = 11): CanvasTexture {
    return tiled(
        paintCanvasTexture(
            512,
            512,
            (g, W, H) => {
                const rnd = createRng(seed);
                g.fillStyle = css(base);
                g.fillRect(0, 0, W, H);
                for (let i = 0; i < 90; i++) {
                    const x = rnd() * W;
                    const y = rnd() * H;
                    const r = 30 + rnd() * 70;
                    const k = 0.9 + rnd() * 0.22;
                    for (const dx of [-W, 0, W]) {
                        for (const dy of [-H, 0, H]) {
                            const grad = g.createRadialGradient(
                                x + dx,
                                y + dy,
                                0,
                                x + dx,
                                y + dy,
                                r,
                            );
                            grad.addColorStop(0, css(shade(base, k)) + "55");
                            grad.addColorStop(1, css(shade(base, k)) + "00");
                            g.fillStyle = grad;
                            g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
                        }
                    }
                }
                for (let i = 0; i < 7000; i++) {
                    const k = 0.72 + rnd() * 0.5;
                    g.fillStyle = css(shade(base, k)) + "aa";
                    g.fillRect(rnd() * W, rnd() * H, 1.5, 2 + rnd() * 4);
                }
            },
            { repeat: true, anisotropy: 8 },
        ),
    );
}

/** Asphalt with speckle and a few cracks. Covers `ASPHALT_TILE` meters. */
export const ASPHALT_TILE = 8;
export function asphaltTexture(base = 0x4b4d52, seed = 5): CanvasTexture {
    return tiled(
        paintCanvasTexture(
            512,
            512,
            (g, W, H) => {
                const rnd = createRng(seed);
                g.fillStyle = css(base);
                g.fillRect(0, 0, W, H);
                for (let i = 0; i < 9000; i++) {
                    const k = 0.7 + rnd() * 0.6;
                    g.fillStyle = css(shade(base, k)) + "bb";
                    g.fillRect(rnd() * W, rnd() * H, 1.5, 1.5);
                }
                g.strokeStyle = css(shade(base, 0.6));
                g.lineWidth = 1;
                for (let i = 0; i < 4; i++) {
                    g.beginPath();
                    let x = rnd() * W;
                    let y = rnd() * H;
                    g.moveTo(x, y);
                    for (let s = 0; s < 8; s++) {
                        x += (rnd() - 0.5) * 50;
                        y += (rnd() - 0.2) * 40;
                        g.lineTo(x, y);
                    }
                    g.stroke();
                }
            },
            { repeat: true, anisotropy: 8 },
        ),
    );
}

/** Rubberized running track. Covers `TRACK_TILE` meters. */
export const TRACK_TILE = 4;
export function trackTexture(base = 0xa24a36): CanvasTexture {
    return tiled(
        paintCanvasTexture(
            256,
            256,
            (g, W, H) => {
                const rnd = createRng(21);
                g.fillStyle = css(base);
                g.fillRect(0, 0, W, H);
                for (let i = 0; i < 5000; i++) {
                    const k = 0.78 + rnd() * 0.45;
                    g.fillStyle = css(shade(base, k)) + "99";
                    g.fillRect(rnd() * W, rnd() * H, 1.5, 1.5);
                }
            },
            { repeat: true, anisotropy: 8 },
        ),
    );
}

export type PlankKind = "aluminum" | "concrete";

/**
 * A stand-long strip (u runs along the stand): aluminum plank with ribs, a
 * seam and bolts every bay, or poured concrete with joints and stains.
 */
export function plankTexture(lengthM: number, kind: PlankKind): CanvasTexture {
    const W = Math.min(2048, Math.max(256, Math.ceil(lengthM * 22)));
    const H = 64;
    return paintCanvasTexture(W, H, (g) => {
        const rnd = createRng(kind === "aluminum" ? 3 : 4);
        const pxPerM = W / lengthM;
        if (kind === "aluminum") {
            g.fillStyle = "#cdd2d8";
            g.fillRect(0, 0, W, H);
            for (let y = 4; y < H; y += 8) {
                g.fillStyle = "#aeb4bc";
                g.fillRect(0, y, W, 1.5);
                g.fillStyle = "#e6eaee";
                g.fillRect(0, y + 1.5, W, 1);
            }
            for (let i = 0; i < 2600; i++) {
                g.fillStyle = `rgba(${rnd() < 0.5 ? "255,255,255" : "70,76,86"},${0.05 + rnd() * 0.1})`;
                g.fillRect(rnd() * W, rnd() * H, 4 + rnd() * 24, 1);
            }
            for (let m = 3.05; m < lengthM; m += 3.05) {
                const x = m * pxPerM;
                g.fillStyle = "#6f757e";
                g.fillRect(x - 1, 0, 2, H);
                g.fillStyle = "#8c929b";
                for (const y of [12, 32, 52]) {
                    g.beginPath();
                    g.arc(x - 6, y, 2, 0, Math.PI * 2);
                    g.arc(x + 6, y, 2, 0, Math.PI * 2);
                    g.fill();
                }
            }
        } else {
            g.fillStyle = "#a3a5aa";
            g.fillRect(0, 0, W, H);
            for (let i = 0; i < 3500; i++) {
                const k = 0.82 + rnd() * 0.3;
                g.fillStyle = `rgba(${Math.round(163 * k)},${Math.round(165 * k)},${Math.round(170 * k)},0.6)`;
                g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 3, 2);
            }
            for (let i = 0; i < 12; i++) {
                g.fillStyle = "rgba(60,60,64,0.07)";
                g.fillRect(rnd() * W, 0, 6 + rnd() * 30, H);
            }
            for (let m = 4; m < lengthM; m += 4) {
                g.fillStyle = "#6c6e73";
                g.fillRect(m * pxPerM - 1, 0, 2, H);
            }
        }
    });
}

/**
 * The padded wall along the front of a stand: team-colored panels with seams,
 * a pale coping strip on top and the team word centered, repeated on long
 * stands. u runs along the stand.
 */
export function fasciaTexture(
    lengthM: number,
    color: number,
    text: string,
): CanvasTexture {
    const W = Math.min(2048, Math.max(256, Math.ceil(lengthM * 22)));
    const H = 128;
    return paintCanvasTexture(W, H, (g) => {
        const pxPerM = W / lengthM;
        g.fillStyle = css(color);
        g.fillRect(0, 0, W, H);
        g.fillStyle = css(shade(color, 0.82));
        g.fillRect(0, H - 14, W, 14);
        g.fillStyle = css(shade(color, 1.18));
        g.fillRect(0, 0, W, 10);
        g.fillStyle = css(shade(color, 0.72));
        for (let m = 1.2; m < lengthM; m += 1.2) {
            g.fillRect(m * pxPerM - 1, 10, 2, H - 24);
        }
        if (text) {
            const pale = luma(color) > 0.62;
            g.fillStyle = pale ? "#14161c" : "#ffffff";
            g.font = `800 ${Math.round(H * 0.55)}px ${TEXTURE_FONT}`;
            g.textAlign = "center";
            g.textBaseline = "middle";
            const every = Math.max(lengthM / 3, 14);
            const n = Math.max(1, Math.round(lengthM / every));
            for (let k = 0; k < n; k++) {
                g.fillText(text, ((k + 0.5) / n) * W, H * 0.5 + 3);
            }
        }
    });
}

/**
 * A press box front: `stories` bands of ribbon windows with mullions.
 * `emissive` paints the lit rooms instead (warm glass with people shapes) and
 * is used as the emissive map, so it must stay in step with the day version.
 */
export function pressWindowTexture(
    widthM: number,
    stories: number,
    emissive: boolean,
): CanvasTexture {
    const W = Math.min(2048, Math.ceil(widthM * 40));
    const H = 128 * stories;
    return paintCanvasTexture(W, H, (g) => {
        const rnd = createRng(77);
        const pxPerM = W / widthM;
        g.fillStyle = emissive ? "#000000" : "#dcdad4";
        g.fillRect(0, 0, W, H);
        const bay = Math.max(1.5, widthM / Math.round(widthM / 2.1));
        for (let s = 0; s < stories; s++) {
            const top = s * 128 + 22;
            const bottom = s * 128 + 112;
            const panes = Math.round(widthM / bay);
            for (let p = 0; p < panes; p++) {
                const x0 = p * bay * pxPerM + 4;
                const w = bay * pxPerM - 8;
                if (emissive) {
                    const lit = rnd() < 0.82;
                    g.fillStyle = lit ? "#ffd89a" : "#3a2c18";
                    g.fillRect(x0, top, w, bottom - top);
                    if (lit) {
                        const heads = 1 + Math.floor(rnd() * 2.4);
                        for (let h = 0; h < heads; h++) {
                            const hx = x0 + w * (0.2 + rnd() * 0.6);
                            const hy = bottom - 32 - rnd() * 8;
                            g.fillStyle = "#2a1c0e";
                            g.beginPath();
                            g.arc(hx, hy, 9, 0, Math.PI * 2);
                            g.fill();
                            g.fillRect(hx - 15, hy + 11, 30, bottom - hy - 11);
                        }
                    }
                } else {
                    const grad = g.createLinearGradient(
                        x0,
                        top,
                        x0 + w,
                        bottom,
                    );
                    grad.addColorStop(0, "#35506e");
                    grad.addColorStop(0.45, "#1c2b40");
                    grad.addColorStop(1, "#111a28");
                    g.fillStyle = grad;
                    g.fillRect(x0, top, w, bottom - top);
                    g.fillStyle = "rgba(255,255,255,0.12)";
                    g.beginPath();
                    g.moveTo(x0, bottom);
                    g.lineTo(x0 + w * 0.5, top);
                    g.lineTo(x0 + w * 0.7, top);
                    g.lineTo(x0 + w * 0.2, bottom);
                    g.fill();
                }
            }
            if (!emissive) {
                g.fillStyle = "#9c9a94";
                g.fillRect(0, s * 128 + 112, W, 6);
            }
        }
    });
}

/** A lettered sign: a team-colored board with a white keyline and the text. */
export function signTexture(
    color: number,
    text: string,
    w = 1024,
    h = 160,
): CanvasTexture {
    return paintCanvasTexture(w, h, (g) => {
        g.fillStyle = css(shade(color, 0.7));
        g.fillRect(0, 0, w, h);
        g.fillStyle = css(color);
        g.fillRect(8, 8, w - 16, h - 16);
        g.strokeStyle = luma(color) > 0.62 ? "#14161c" : "#ffffff";
        g.lineWidth = 5;
        g.strokeRect(18, 18, w - 36, h - 36);
        g.fillStyle = luma(color) > 0.62 ? "#14161c" : "#ffffff";
        g.font = `800 ${Math.round(h * 0.56)}px ${TEXTURE_FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(text, w / 2, h / 2 + 4, w - 80);
    });
}

/** A brick wall with a window per bay. One tile is `tileW` x `tileH` meters. */
export function facadeTexture(
    brick: number,
    windows: boolean,
    seed = 9,
): CanvasTexture {
    return tiled(
        paintCanvasTexture(
            512,
            512,
            (g, W, H) => {
                const rnd = createRng(seed);
                g.fillStyle = css(shade(brick, 0.7));
                g.fillRect(0, 0, W, H);
                const bh = 10;
                const bw = 32;
                for (let y = 0, r = 0; y < H; y += bh, r++) {
                    for (let x = -(r % 2) * (bw / 2); x < W; x += bw) {
                        g.fillStyle = css(shade(brick, 0.82 + rnd() * 0.32));
                        g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
                    }
                }
                if (windows) {
                    g.fillStyle = "#cfcac0";
                    g.fillRect(
                        W * 0.2 - 8,
                        H * 0.2 - 8,
                        W * 0.6 + 16,
                        H * 0.5 + 20,
                    );
                    const grad = g.createLinearGradient(0, H * 0.2, W, H * 0.7);
                    grad.addColorStop(0, "#41607f");
                    grad.addColorStop(1, "#16202e");
                    g.fillStyle = grad;
                    g.fillRect(W * 0.2, H * 0.2, W * 0.6, H * 0.5);
                    g.fillStyle = "#cfcac0";
                    g.fillRect(W * 0.5 - 3, H * 0.2, 6, H * 0.5);
                    g.fillRect(W * 0.2, H * 0.45 - 3, W * 0.6, 6);
                    g.fillRect(W * 0.2 - 12, H * 0.7 + 8, W * 0.6 + 24, 8);
                }
            },
            { repeat: true, anisotropy: 8 },
        ),
    );
}

/** Chain link: diamond mesh on a transparent ground. One tile is 0.6 m. */
export function chainLinkTexture(): CanvasTexture {
    return tiled(
        paintCanvasTexture(
            64,
            64,
            (g, W, H) => {
                g.clearRect(0, 0, W, H);
                g.strokeStyle = "rgba(190,196,204,0.95)";
                g.lineWidth = 3;
                g.beginPath();
                g.moveTo(0, 0);
                g.lineTo(W, H);
                g.moveTo(0, H);
                g.lineTo(W, 0);
                g.moveTo(-W / 2, H / 2);
                g.lineTo(W / 2, H * 1.5);
                g.moveTo(W / 2, -H / 2);
                g.lineTo(W * 1.5, H / 2);
                g.stroke();
            },
            { repeat: true, anisotropy: 8 },
        ),
    );
}

/** Wrought-iron bars with spear tips. One tile is 1.2 m wide. */
export function ironFenceTexture(): CanvasTexture {
    return tiled(
        paintCanvasTexture(
            128,
            128,
            (g, W, H) => {
                g.clearRect(0, 0, W, H);
                g.fillStyle = "#1d1f24";
                for (let x = 8; x < W; x += 16) {
                    g.fillRect(x - 2, 14, 4, H - 14);
                    g.beginPath();
                    g.moveTo(x - 4, 14);
                    g.lineTo(x, 0);
                    g.lineTo(x + 4, 14);
                    g.fill();
                }
                g.fillRect(0, 26, W, 5);
                g.fillRect(0, H - 22, W, 5);
            },
            { repeat: true, anisotropy: 8 },
        ),
    );
}

/** Parking stalls: two stalls wide, 5.4 m deep per tile (5.2 x 5.4 m). */
export function parkingTexture(): CanvasTexture {
    return tiled(
        paintCanvasTexture(
            256,
            256,
            (g, W, H) => {
                const rnd = createRng(8);
                g.fillStyle = "#4a4c51";
                g.fillRect(0, 0, W, H);
                for (let i = 0; i < 3000; i++) {
                    const k = 0.75 + rnd() * 0.5;
                    g.fillStyle = `rgba(${Math.round(74 * k)},${Math.round(76 * k)},${Math.round(81 * k)},0.7)`;
                    g.fillRect(rnd() * W, rnd() * H, 1.5, 1.5);
                }
                g.fillStyle = "#dedbd0";
                for (const x of [0, W / 2]) g.fillRect(x - 2, 0, 4, H * 0.82);
            },
            { repeat: true, anisotropy: 8 },
        ),
    );
}

export interface ScoreboardTextureOptions {
    teamColor: number;
    name: string;
}

/** An LED scoreboard face: header, HOME and GUEST scores, clock and quarter. */
export function scoreboardTexture(o: ScoreboardTextureOptions): CanvasTexture {
    const W = 1024;
    const H = 460;
    return paintCanvasTexture(W, H, (g) => {
        g.fillStyle = "#07080a";
        g.fillRect(0, 0, W, H);
        g.fillStyle = css(o.teamColor);
        g.fillRect(0, 0, W, 108);
        g.fillStyle = luma(o.teamColor) > 0.62 ? "#14161c" : "#ffffff";
        g.font = `800 78px ${TEXTURE_FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(o.name, W / 2, 58, W - 60);
        g.font = `700 40px ${TEXTURE_FONT}`;
        g.fillStyle = "#e8e8ea";
        g.fillText("HOME", 190, 156);
        g.fillText("GUEST", W - 190, 156);
        g.fillText("QTR", W / 2 - 150, 360);
        g.fillText("TO", W / 2 + 150, 360);
        g.font = `800 150px ${TEXTURE_FONT}`;
        g.fillStyle = "#ff3b1f";
        g.fillText("21", 190, 255);
        g.fillText("14", W - 190, 255);
        g.fillStyle = "#ffb400";
        g.font = `800 130px ${TEXTURE_FONT}`;
        g.fillText("4:32", W / 2, 240);
        g.font = `800 90px ${TEXTURE_FONT}`;
        g.fillText("3", W / 2 - 150, 420);
        g.fillText("2", W / 2 + 150, 420);
        g.strokeStyle = "#1c1e22";
        g.lineWidth = 4;
        g.strokeRect(2, 2, W - 4, H - 4);
    });
}
