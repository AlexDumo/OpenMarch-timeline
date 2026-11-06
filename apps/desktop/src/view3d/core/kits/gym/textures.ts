// cspell:ignore wordmark
import { Color, type CanvasTexture } from "three";
import { createRng, paintCanvasTexture, TEXTURE_FONT } from "../../environment";

/** Basketball court size in meters (28.65 x 15.24, the demo's 94 x 50 ft). */
export const COURT_LENGTH = 28.65;
export const COURT_WIDTH = 15.24;
/** The safety tape runs this far outside the performance area. */
export const TAPE_MARGIN = 1.5;
/** Width in meters one repeat of the block wall texture covers (12 blocks). */
export const BLOCK_TILE_WIDTH = 4.8;
/** Width in meters one repeat of the stage curtain texture covers. */
export const CURTAIN_TILE_WIDTH = 3.2;

/** The gym's painted palette, derived from the school (home) color. */
export interface GymPalette {
    /** Deep school color for the wainscot, pads, trusses and banners. */
    deep: string;
    /** Darker still, for the stage skirt and the curtain. */
    darker: string;
    /** A lighter tint of the school color, for stained floor paint. */
    tint: string;
    /** Gold accent stripe. */
    accent: string;
    /** Upper wall paint, warm off-white. */
    wall: string;
}

/** Hex string ("#rrggbb") for a CSS color with its HSL clamped. */
function shade(
    css: string,
    { l, sMax, sMin = 0 }: { l: number; sMax: number; sMin?: number },
): string {
    const c = new Color(0x6442ff);
    if (/^#[0-9a-f]{6}$/i.test(css.trim())) c.setStyle(css.trim());
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(hsl.h, Math.min(sMax, Math.max(sMin, hsl.s)), l);
    return `#${c.getHexString()}`;
}

export function gymPalette(homeColor: string): GymPalette {
    return {
        deep: shade(homeColor, { l: 0.27, sMax: 0.62, sMin: 0.2 }),
        darker: shade(homeColor, { l: 0.15, sMax: 0.55 }),
        tint: shade(homeColor, { l: 0.62, sMax: 0.5 }),
        accent: "#d8a72c",
        wall: "#e8e1d0",
    };
}

export interface FloorTextureOptions {
    /** Room floor extent in world meters. */
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    /** Performance area (the footprint) in world meters. */
    footprint: { minX: number; maxX: number; minZ: number; maxZ: number };
    /** Painted colors; default from the default school color. */
    palette?: GymPalette;
    /** Painted on the floor behind the performance area; empty for none. */
    wordmark?: string;
}

/**
 * The room floor: maple boards with staggered joints and a little grain, a
 * stained border in the school color with a gold pinstripe, a basketball
 * court centered under the performance area, a wordmark behind the
 * performance area and the yellow safety tape 1.5 m outside it. The canvas
 * top is the back wall (most negative z) and its left is minX.
 */
export function floorTexture(o: FloorTextureOptions): CanvasTexture {
    const roomW = o.maxX - o.minX;
    const roomD = o.maxZ - o.minZ;
    const s = Math.min(32, 4096 / Math.max(roomW, roomD));
    const X = (x: number) => (x - o.minX) * s;
    const Y = (z: number) => (z - o.minZ) * s;
    const pal = o.palette ?? gymPalette("#6442ff");
    return paintCanvasTexture(
        Math.ceil(roomW * s),
        Math.ceil(roomD * s),
        (g, W, H) => {
            const rnd = createRng(11);
            // Boards run along x; each row is cut into staggered lengths.
            const plank = Math.max(2, Math.round(0.075 * s));
            for (let y = 0; y < H; y += plank) {
                let x = -rnd() * 2.5 * s;
                while (x < W) {
                    const len = (1.2 + rnd() * 2.4) * s;
                    const l = 63 + rnd() * 9;
                    const sat = 42 + rnd() * 14;
                    const hue = 31 + rnd() * 6;
                    g.fillStyle = `hsl(${hue}, ${sat}%, ${l}%)`;
                    g.fillRect(x, y, len, plank);
                    g.fillStyle = "rgba(60, 35, 10, 0.35)";
                    g.fillRect(x, y, 1, plank);
                    x += len;
                }
                g.fillStyle = "rgba(70, 40, 15, 0.12)";
                g.fillRect(0, y, W, 1);
            }
            // Grain: faint streaks along the boards.
            const streaks = Math.round((W * H) / 900);
            for (let i = 0; i < streaks; i++) {
                const dark = rnd() < 0.6;
                g.fillStyle = dark
                    ? `rgba(110, 60, 20, ${0.05 + rnd() * 0.08})`
                    : `rgba(255, 235, 200, ${0.05 + rnd() * 0.06})`;
                g.fillRect(
                    rnd() * W,
                    rnd() * H,
                    (0.3 + rnd() * 1.4) * s,
                    Math.max(1, plank * 0.3),
                );
            }

            const fp = o.footprint;
            const cx = (fp.minX + fp.maxX) / 2;
            const cz = (fp.minZ + fp.maxZ) / 2;

            // Stained border in the school color, with a gold pinstripe.
            const band = 2.4 * s;
            g.save();
            g.globalCompositeOperation = "multiply";
            g.fillStyle = pal.tint;
            g.beginPath();
            g.rect(0, 0, W, H);
            g.rect(band, band, W - 2 * band, H - 2 * band);
            g.fill("evenodd");
            g.restore();
            g.strokeStyle = pal.accent;
            g.lineWidth = Math.max(1.5, 0.07 * s);
            g.strokeRect(band, band, W - 2 * band, H - 2 * band);

            // Basketball court: white lines, keys filled in the school color.
            const halfL = COURT_LENGTH / 2;
            const halfW = COURT_WIDTH / 2;
            if (halfL * 2 <= roomW - 1 && halfW * 2 <= roomD - 1) {
                g.save();
                g.globalAlpha = 0.88;
                g.fillStyle = pal.deep;
                for (const sg of [-1, 1]) {
                    const baseX = cx + sg * halfL;
                    g.fillRect(
                        X(sg > 0 ? baseX - 5.79 : baseX),
                        Y(cz - 2.44),
                        5.79 * s,
                        4.88 * s,
                    );
                }
                g.beginPath();
                g.arc(X(cx), Y(cz), 1.83 * s, 0, Math.PI * 2);
                g.fill();
                g.restore();
                g.strokeStyle = "rgba(255,255,255,0.92)";
                g.lineWidth = 0.06 * s;
                g.strokeRect(
                    X(cx - halfL),
                    Y(cz - halfW),
                    COURT_LENGTH * s,
                    COURT_WIDTH * s,
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
                    g.strokeRect(
                        X(sg > 0 ? baseX - 5.79 : baseX),
                        Y(cz - 2.44),
                        5.79 * s,
                        4.88 * s,
                    );
                    g.beginPath();
                    g.arc(
                        X(baseX - sg * 5.79),
                        Y(cz),
                        1.83 * s,
                        sg > 0 ? Math.PI * 0.5 : -Math.PI * 0.5,
                        sg > 0 ? Math.PI * 1.5 : Math.PI * 0.5,
                    );
                    g.stroke();
                    g.beginPath();
                    g.arc(
                        X(baseX - sg * 1.6),
                        Y(cz),
                        6.75 * s,
                        sg > 0 ? Math.PI * 0.6 : -Math.PI * 0.4,
                        sg > 0 ? Math.PI * 1.4 : Math.PI * 0.4,
                    );
                    g.stroke();
                }
            }

            // Wordmark between the performance area and the back wall.
            const text = (o.wordmark ?? "").trim().toUpperCase();
            const gapBack = fp.minZ - TAPE_MARGIN - (o.minZ + 1.5);
            if (text && gapBack > 2.5) {
                const capH = Math.min(2.6, gapBack * 0.55) * s;
                const midY = Y(fp.minZ - TAPE_MARGIN - gapBack / 2);
                g.save();
                g.font = `italic 800 ${capH}px ${TEXTURE_FONT}`;
                g.textAlign = "center";
                g.textBaseline = "middle";
                const maxW = Math.min(fp.maxX - fp.minX, 30) * s * 0.9;
                const wNat = g.measureText(text).width;
                const sx = wNat > maxW ? maxW / wNat : 1;
                g.translate(X(cx), midY);
                g.scale(sx, 1);
                g.lineJoin = "round";
                g.lineWidth = 0.22 * s;
                g.strokeStyle = pal.accent;
                g.strokeText(text, 0, 0);
                g.globalCompositeOperation = "multiply";
                g.fillStyle = pal.deep;
                g.fillText(text, 0, 0);
                g.restore();
            }

            // Ambient occlusion along the walls.
            const ao = 0.7 * s;
            const edge = (
                x0: number,
                y0: number,
                x1: number,
                y1: number,
            ): CanvasGradient => {
                const gr = g.createLinearGradient(x0, y0, x1, y1);
                gr.addColorStop(0, "rgba(30,20,10,0.35)");
                gr.addColorStop(1, "rgba(30,20,10,0)");
                return gr;
            };
            g.fillStyle = edge(0, 0, 0, ao);
            g.fillRect(0, 0, W, ao);
            g.fillStyle = edge(0, H, 0, H - ao);
            g.fillRect(0, H - ao, W, ao);
            g.fillStyle = edge(0, 0, ao, 0);
            g.fillRect(0, 0, ao, H);
            g.fillStyle = edge(W, 0, W - ao, 0);
            g.fillRect(W - ao, 0, ao, H);

            // Safety tape.
            g.strokeStyle = "#e5b800";
            g.lineWidth = 0.1 * s;
            g.setLineDash([0.6 * s, 0.36 * s]);
            g.strokeRect(
                X(fp.minX - TAPE_MARGIN),
                Y(fp.minZ - TAPE_MARGIN),
                (fp.maxX - fp.minX + 2 * TAPE_MARGIN) * s,
                (fp.maxZ - fp.minZ + 2 * TAPE_MARGIN) * s,
            );
            g.setLineDash([]);
        },
    );
}

/**
 * Painted concrete block, the full room height, one repeat 4.8 m wide: a
 * black rubber cove base, a wainscot in the school color with a gold stripe,
 * off-white block above, darkening toward the roof. The canvas covers wall
 * heights -0.1 m (bottom) to `roomHeight - 0.1` m (top), like the room shell.
 */
export function blockWallTexture(
    pal: GymPalette,
    roomHeight: number,
): CanvasTexture {
    const ppm = 100;
    const W = BLOCK_TILE_WIDTH * ppm;
    const H = Math.round(roomHeight * ppm);
    const top = roomHeight - 0.1;
    const yAt = (m: number) => (top - m) * ppm;
    return paintCanvasTexture(
        W,
        H,
        (g) => {
            const band = (from: number, to: number, color: string) => {
                g.fillStyle = color;
                g.fillRect(0, yAt(to), W, yAt(from) - yAt(to));
            };
            band(-0.1, top, pal.wall);
            band(-0.1, 1.55, pal.deep);
            band(1.55, 1.72, pal.accent);
            band(1.8, 1.86, pal.deep);
            // Darken toward the roof structure.
            const roof = g.createLinearGradient(0, yAt(top), 0, yAt(6));
            roof.addColorStop(0, "rgba(40,36,30,0.45)");
            roof.addColorStop(1, "rgba(40,36,30,0)");
            g.fillStyle = roof;
            g.fillRect(0, yAt(top), W, yAt(6) - yAt(top));

            // Blocks: 0.4 x 0.2 m in running bond, paint filling the joints.
            const rnd = createRng(5);
            const bw = 0.4 * ppm;
            const bh = 0.2 * ppm;
            for (let r = 0; r * 0.2 < top; r++) {
                const y = yAt((r + 1) * 0.2);
                const off = r % 2 ? bw / 2 : 0;
                for (let x = -off; x < W; x += bw) {
                    const v = rnd();
                    g.fillStyle =
                        v < 0.5
                            ? `rgba(0,0,0,${v * 0.06})`
                            : `rgba(255,255,255,${(v - 0.5) * 0.06})`;
                    g.fillRect(x, y, bw, bh);
                    g.fillStyle = "rgba(0,0,0,0.16)";
                    g.fillRect(x, y, 2, bh);
                }
                g.fillStyle = "rgba(0,0,0,0.18)";
                g.fillRect(0, y, W, 2);
                g.fillStyle = "rgba(255,255,255,0.08)";
                g.fillRect(0, y + 2, W, 1);
            }
            // Pores in the block face.
            for (let i = 0; i < (W * H) / 60; i++) {
                g.fillStyle = `rgba(0,0,0,${0.04 + rnd() * 0.08})`;
                g.fillRect(rnd() * W, rnd() * H, 1, 1);
            }
            band(-0.1, 0.12, "#1c1a19");
        },
        { repeat: true },
    );
}

/** Corrugated roof deck, seen from below: three ribs per repeat. */
export function deckTexture(): CanvasTexture {
    return paintCanvasTexture(
        16,
        96,
        (g) => {
            for (let i = 0; i < 3; i++) {
                const gr = g.createLinearGradient(0, i * 32, 0, i * 32 + 32);
                gr.addColorStop(0, "#9a9c9c");
                gr.addColorStop(0.35, "#d2d4d2");
                gr.addColorStop(0.65, "#bcbebc");
                gr.addColorStop(1, "#8a8c8c");
                g.fillStyle = gr;
                g.fillRect(0, i * 32, 16, 32);
            }
        },
        { repeat: true },
    );
}

/** One championship banner. */
export interface BannerSpec {
    /** Small line above the title. */
    top: string;
    /** One or two big title lines. */
    title: string[];
    year: string;
}

export const BANNER_CELL = { width: 256, height: 400 } as const;

/**
 * All banners in one atlas, `cols` across: felt in the school color, gold
 * border, white lettering and a swallowtail bottom cut out (use alphaTest).
 */
export function bannerAtlas(
    banners: BannerSpec[],
    pal: GymPalette,
    cols: number,
): CanvasTexture {
    const rows = Math.max(1, Math.ceil(banners.length / cols));
    const { width: cw, height: ch } = BANNER_CELL;
    return paintCanvasTexture(cw * cols, ch * rows, (g) => {
        banners.forEach((b, i) => {
            g.save();
            g.translate((i % cols) * cw, Math.floor(i / cols) * ch);
            const shape = (inset: number) => {
                g.beginPath();
                g.moveTo(8 + inset, 4 + inset);
                g.lineTo(cw - 8 - inset, 4 + inset);
                g.lineTo(cw - 8 - inset, ch - 6 - inset * 1.4);
                g.lineTo(cw / 2, ch - 62 - inset * 0.6);
                g.lineTo(8 + inset, ch - 6 - inset * 1.4);
                g.closePath();
            };
            shape(0);
            g.fillStyle = pal.deep;
            g.fill();
            shape(12);
            g.lineWidth = 5;
            g.strokeStyle = pal.accent;
            g.stroke();
            // Felt sheen: a soft vertical falloff.
            shape(0);
            const sheen = g.createLinearGradient(0, 0, 0, ch);
            sheen.addColorStop(0, "rgba(255,255,255,0.08)");
            sheen.addColorStop(1, "rgba(0,0,0,0.18)");
            g.fillStyle = sheen;
            g.fill();
            g.textAlign = "center";
            g.textBaseline = "alphabetic";
            g.fillStyle = pal.accent;
            g.font = `700 22px ${TEXTURE_FONT}`;
            g.fillText(b.top, cw / 2, 62, cw - 50);
            g.fillStyle = "#fff";
            g.fillRect(cw / 2 - 40, 78, 80, 3);
            g.font = `800 40px ${TEXTURE_FONT}`;
            b.title.forEach((l, j) =>
                g.fillText(l, cw / 2, 136 + j * 48, cw - 44),
            );
            g.fillStyle = pal.accent;
            g.font = `800 58px ${TEXTURE_FONT}`;
            g.fillText(b.year, cw / 2, 290);
            g.restore();
        });
    });
}

/** Scoreboard face: header in the school color, clock, home and guest. */
export function scoreboardTexture(
    title: string,
    pal: GymPalette,
): CanvasTexture {
    return paintCanvasTexture(640, 280, (g) => {
        g.fillStyle = "#0b0b0d";
        g.fillRect(0, 0, 640, 280);
        g.fillStyle = pal.deep;
        g.fillRect(0, 0, 640, 56);
        g.fillStyle = pal.accent;
        g.fillRect(0, 56, 640, 5);
        g.fillStyle = "#fff";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = `800 36px ${TEXTURE_FONT}`;
        g.fillText(title, 320, 30, 600);
        g.font = `700 26px ${TEXTURE_FONT}`;
        g.fillText("HOME", 105, 92);
        g.fillText("GUEST", 535, 92);
        g.fillText("PERIOD", 320, 205);
        const digits = (
            t: string,
            x: number,
            y: number,
            size: number,
            color: string,
        ) => {
            g.font = `700 ${size}px "DejaVu Sans Mono", monospace`;
            g.fillStyle = "rgba(255,60,30,0.14)";
            g.fillText(t.replace(/\d/g, "8"), x, y);
            g.shadowColor = color;
            g.shadowBlur = 12;
            g.fillStyle = color;
            g.fillText(t, x, y);
            g.shadowBlur = 0;
        };
        digits("00", 105, 160, 84, "#ff4a24");
        digits("00", 535, 160, 84, "#ff4a24");
        digits("12:00", 320, 135, 96, "#ffb21e");
        digits("1", 320, 248, 50, "#ff4a24");
    });
}

/** Exit sign face: red letters on a dark field. */
export function exitTexture(): CanvasTexture {
    return paintCanvasTexture(128, 56, (g) => {
        g.fillStyle = "#1a0606";
        g.fillRect(0, 0, 128, 56);
        g.fillStyle = "#ff2a1a";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = `800 38px ${TEXTURE_FONT}`;
        g.fillText("EXIT", 64, 30);
    });
}

/** Stage curtain: velvet folds in the school color. Repeats along U. */
export function curtainTexture(pal: GymPalette): CanvasTexture {
    return paintCanvasTexture(
        256,
        256,
        (g) => {
            g.fillStyle = pal.deep;
            g.fillRect(0, 0, 256, 256);
            const folds = 8;
            for (let x = 0; x < 256; x++) {
                const p = ((x / 256) * folds) % 1;
                const lit = Math.pow(
                    0.5 + 0.5 * Math.sin(p * Math.PI * 2),
                    1.6,
                );
                g.fillStyle = `rgba(255,255,255,${0.02 + lit * 0.22})`;
                g.fillRect(x, 0, 1, 256);
                g.fillStyle = `rgba(0,0,0,${(1 - lit) * 0.5})`;
                g.fillRect(x, 0, 1, 256);
            }
            const gr = g.createLinearGradient(0, 0, 0, 256);
            gr.addColorStop(0, "rgba(0,0,0,0.25)");
            gr.addColorStop(0.2, "rgba(0,0,0,0)");
            gr.addColorStop(1, "rgba(0,0,0,0.2)");
            g.fillStyle = gr;
            g.fillRect(0, 0, 256, 256);
        },
        { repeat: true },
    );
}

/**
 * Wall mural above the bleachers: speed stripes in the school color and a
 * slanted wordmark. Transparent around the paint.
 */
export function muralTexture(text: string, pal: GymPalette): CanvasTexture {
    return paintCanvasTexture(2048, 512, (g, W, H) => {
        g.save();
        g.translate(W / 2, H / 2 - 20);
        g.transform(1, 0, -0.18, 1, 0, 0);
        const stripe = (y: number, h: number, color: string) => {
            g.fillStyle = color;
            g.fillRect(-W * 0.47, y, W * 0.94, h);
        };
        stripe(-40, 80, pal.deep);
        stripe(-66, 14, pal.accent);
        stripe(52, 14, pal.accent);
        g.font = `italic 900 220px ${TEXTURE_FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        const t = text.trim().toUpperCase() || "HOME";
        const nat = g.measureText(t).width;
        const sx = Math.min(1, (W * 0.62) / nat);
        g.scale(sx, 1);
        // Knock the stripes out around the wordmark.
        g.globalCompositeOperation = "destination-out";
        g.fillRect(-(nat + 120) / 2, -120, nat + 120, 240);
        g.globalCompositeOperation = "source-over";
        g.lineJoin = "round";
        g.lineWidth = 24;
        g.strokeStyle = pal.accent;
        g.strokeText(t, 0, 10);
        g.fillStyle = pal.deep;
        g.fillText(t, 0, 10);
        g.restore();
        g.fillStyle = pal.deep;
        g.textAlign = "center";
        g.textBaseline = "alphabetic";
        g.font = `800 50px ${TEXTURE_FONT}`;
        g.fillText("H O M E   O F   C H A M P I O N S", W / 2, H - 22);
    });
}

/** Backboard face: smoky glass with a white edge and a shooter's square. */
export function backboardTexture(): CanvasTexture {
    return paintCanvasTexture(256, 150, (g) => {
        g.fillStyle = "#a9b4bd";
        g.fillRect(0, 0, 256, 150);
        g.strokeStyle = "#f4f4f2";
        g.lineWidth = 10;
        g.strokeRect(5, 5, 246, 140);
        g.strokeStyle = "#e0552a";
        g.lineWidth = 6;
        g.strokeRect(96, 66, 64, 50);
    });
}

/**
 * Light beam falloff for the show spots' faked cones: bright at the lamp
 * (canvas top, the cone tip) fading toward the floor.
 */
export function beamTexture(): CanvasTexture {
    return paintCanvasTexture(4, 256, (g) => {
        const gr = g.createLinearGradient(0, 0, 0, 256);
        gr.addColorStop(0, "#000");
        gr.addColorStop(0.04, "#fff");
        gr.addColorStop(0.5, "#777");
        gr.addColorStop(1, "#222");
        g.fillStyle = gr;
        g.fillRect(0, 0, 4, 256);
    });
}
