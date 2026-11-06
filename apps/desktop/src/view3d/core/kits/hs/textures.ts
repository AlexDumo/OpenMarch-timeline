import { ClampToEdgeWrapping, RepeatWrapping, type CanvasTexture } from "three";
import { createRng, paintCanvasTexture, TEXTURE_FONT } from "../../environment";

/**
 * Canvas textures for the high school kits (stands, track, fence, scoreboard,
 * press box, buildings and the painted site around the stadium). Everything
 * is procedural: no image files, no network.
 */

type G = CanvasRenderingContext2D;

/** "#rrggbb" to [r, g, b] (0..255); falls back to `fallback`. */
export function rgbOf(css: string, fallback = "#6442ff"): [number, number, number] {
    const m = /^#([0-9a-f]{6})$/i.exec(css.trim()) ?? /^#([0-9a-f]{6})$/i.exec(fallback);
    const n = parseInt(m ? m[1] : "6442ff", 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mixes a css color toward black (k < 0) or white (k > 0). */
export function shade(css: string, k: number): string {
    const [r, g, b] = rgbOf(css);
    const t = k < 0 ? 0 : 255;
    const a = Math.abs(k);
    const f = (c: number) => Math.round(c + (t - c) * a);
    return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
}

/** Relative luminance 0..1 of a css color, for picking legible text. */
export function luminance(css: string): number {
    const [r, g, b] = rgbOf(css);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Sprinkles `n` tiny rectangles of random gray over the canvas (grain). */
function grain(
    g: G,
    w: number,
    h: number,
    n: number,
    alpha: number,
    seed: number,
    size = 1,
): void {
    const rnd = createRng(seed);
    for (let i = 0; i < n; i++) {
        const v = rnd() < 0.5 ? 0 : 255;
        g.fillStyle = `rgba(${v},${v},${v},${alpha * rnd()})`;
        g.fillRect(rnd() * w, rnd() * h, size, size);
    }
}

// ---------------------------------------------------------------------------
// Stands

/** Meters of stand length one texture repeat covers (24 ft plank lengths). */
export const STAND_TILE = 7.315;
/** V bands of the stand atlas: tread, riser and side walls. */
export const STAND_BANDS = {
    tread: [0.02, 0.48] as [number, number],
    riser: [0.52, 0.73] as [number, number],
    side: [0.77, 0.98] as [number, number],
};

/**
 * Stand surface atlas. `aluminum`: brushed planks with seams and splice
 * joints, darker riser plates. `concrete`: warm precast treads with a worn
 * nosing, board-formed risers and walls.
 */
export function standTexture(style: "aluminum" | "concrete"): CanvasTexture {
    const tex = paintCanvasTexture(512, 512, (g, w, h) => {
        // canvas y 0 is v = 1: side band on top, riser, then tread at the bottom
        const band = (v0: number, v1: number) => [h * (1 - v1), h * (1 - v0)];
        const [sideTop, sideBot] = band(0.75, 1);
        const [riserTop, riserBot] = band(0.5, 0.75);
        const [treadTop, treadBot] = band(0, 0.5);
        const rnd = createRng(style === "aluminum" ? 11 : 23);
        if (style === "aluminum") {
            // tread: three planks of brushed aluminum, nosing toward the front
            const th = treadBot - treadTop;
            const grad = g.createLinearGradient(0, treadTop, 0, treadBot);
            grad.addColorStop(0, "#c9ccd1");
            grad.addColorStop(1, "#b7bbc2");
            g.fillStyle = grad;
            g.fillRect(0, treadTop, w, th);
            for (let i = 0; i < 260; i++) {
                const y = treadTop + rnd() * th;
                g.fillStyle = `rgba(${rnd() < 0.5 ? 255 : 60},${rnd() < 0.5 ? 255 : 60},${rnd() < 0.5 ? 255 : 70},0.07)`;
                g.fillRect(0, y, w, 1);
            }
            g.fillStyle = "rgba(30,34,40,0.55)";
            for (const f of [0.34, 0.67]) g.fillRect(0, treadTop + th * f, w, 3);
            // rear edge of the tread meets the next riser: soft shadow
            const sh = g.createLinearGradient(0, treadTop, 0, treadTop + th * 0.12);
            sh.addColorStop(0, "rgba(20,22,28,0.45)");
            sh.addColorStop(1, "rgba(20,22,28,0)");
            g.fillStyle = sh;
            g.fillRect(0, treadTop, w, th * 0.12);
            // nosing: a bright front edge
            g.fillStyle = "#e3e6ea";
            g.fillRect(0, treadBot - 6, w, 6);
            // riser plate: darker mill finish with one rib
            const rh = riserBot - riserTop;
            g.fillStyle = "#8d929b";
            g.fillRect(0, riserTop, w, rh);
            g.fillStyle = "rgba(255,255,255,0.18)";
            g.fillRect(0, riserTop + rh * 0.45, w, 3);
            g.fillStyle = "rgba(0,0,0,0.25)";
            g.fillRect(0, riserTop + rh * 0.45 + 3, w, 2);
            // side: galvanized steel
            g.fillStyle = "#7c8189";
            g.fillRect(0, sideTop, w, sideBot - sideTop);
            // splice joint every plank length (u = 0)
            g.fillStyle = "rgba(25,28,34,0.6)";
            g.fillRect(0, treadTop, 3, th);
            g.fillRect(0, riserTop, 2, rh);
            // a few bolts along the riser
            g.fillStyle = "rgba(40,44,50,0.6)";
            for (let x = 16; x < w; x += 64) {
                g.fillRect(x, riserTop + rh * 0.2, 3, 3);
            }
            grain(g, w, h, 4000, 0.18, 5);
        } else {
            const th = treadBot - treadTop;
            g.fillStyle = "#b9b3a8";
            g.fillRect(0, treadTop, w, th);
            // stains and wear where people walk (the front half)
            for (let i = 0; i < 90; i++) {
                g.fillStyle = `rgba(${rnd() < 0.6 ? "70,66,60" : "235,230,220"},${0.04 + rnd() * 0.06})`;
                const r = 6 + rnd() * 30;
                g.beginPath();
                g.ellipse(rnd() * w, treadTop + th * (0.3 + rnd() * 0.7), r * 2, r, 0, 0, Math.PI * 2);
                g.fill();
            }
            const sh = g.createLinearGradient(0, treadTop, 0, treadTop + th * 0.18);
            sh.addColorStop(0, "rgba(40,36,32,0.5)");
            sh.addColorStop(1, "rgba(40,36,32,0)");
            g.fillStyle = sh;
            g.fillRect(0, treadTop, w, th * 0.18);
            // nosing edge
            g.fillStyle = "#d4cfc4";
            g.fillRect(0, treadBot - 8, w, 8);
            // control joint
            g.fillStyle = "rgba(50,46,40,0.55)";
            g.fillRect(0, treadTop, 2, th);
            g.fillRect(w / 2, treadTop, 2, th);
            // riser: darker, board-formed
            const rh = riserBot - riserTop;
            g.fillStyle = "#8f8a82";
            g.fillRect(0, riserTop, w, rh);
            g.fillStyle = "rgba(0,0,0,0.12)";
            for (let y = riserTop + 10; y < riserBot; y += 18) g.fillRect(0, y, w, 2);
            g.fillRect(0, riserTop, 2, rh);
            g.fillRect(w / 2, riserTop, 2, rh);
            // side walls: concrete with form-tie dots and panel joints
            g.fillStyle = "#a39d93";
            g.fillRect(0, sideTop, w, sideBot - sideTop);
            g.fillStyle = "rgba(60,56,50,0.35)";
            for (let x = 20; x < w; x += 42) {
                for (let y = sideTop + 14; y < sideBot; y += 30) g.fillRect(x, y, 3, 3);
            }
            g.fillRect(0, sideTop, 3, sideBot - sideTop);
            grain(g, w, h, 9000, 0.22, 9);
        }
    });
    tex.wrapS = RepeatWrapping;
    tex.wrapT = ClampToEdgeWrapping;
    return tex;
}

/**
 * The padded wall along a stand's front: team-colored pads with seams, a
 * white cap and `text` painted at even spacing. One texture spans the wall.
 */
export function wallTexture(
    color: string,
    text: string,
    length: number,
    repeats: number,
): CanvasTexture {
    const W = 2048;
    const H = 64;
    return paintCanvasTexture(W, H, (g) => {
        g.fillStyle = shade(color, -0.1);
        g.fillRect(0, 0, W, H);
        const pad = Math.max(4, Math.round((W / length) * 1.83));
        for (let x = 0; x < W; x += pad) {
            const grad = g.createLinearGradient(x, 0, x + pad, 0);
            grad.addColorStop(0, "rgba(0,0,0,0.22)");
            grad.addColorStop(0.08, "rgba(255,255,255,0.06)");
            grad.addColorStop(0.92, "rgba(255,255,255,0)");
            grad.addColorStop(1, "rgba(0,0,0,0.18)");
            g.fillStyle = grad;
            g.fillRect(x, 0, pad, H);
        }
        g.fillStyle = "#eef0f2";
        g.fillRect(0, 0, W, 6);
        g.fillStyle = "rgba(0,0,0,0.35)";
        g.fillRect(0, H - 5, W, 5);
        if (!text) return;
        g.fillStyle = luminance(color) > 0.6 ? "#1b1d22" : "#ffffff";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = `800 40px ${TEXTURE_FONT}`;
        // letters are painted squeezed: the wall's texel is 2.5x wider than tall
        const sx = (H / 1.2 / (W / length)) * 0.95;
        for (let k = 0; k < repeats; k++) {
            const cx = (W * (k + 0.5)) / repeats;
            g.save();
            g.translate(cx, H / 2 + 3);
            g.scale(sx, 1);
            g.fillText(text, 0, 0);
            g.restore();
        }
    });
}

// ---------------------------------------------------------------------------
// Fence and track

/** Meters one chain-link texture repeat covers along the fence. */
export const FENCE_TILE = 3.05;

/** Chain-link fence: thin diamond wires, a top rail and a post at u = 0. */
export function chainLinkTexture(): CanvasTexture {
    const tex = paintCanvasTexture(
        256,
        128,
        (g, w, h) => {
            g.clearRect(0, 0, w, h);
            g.strokeStyle = "rgba(170,176,184,0.8)";
            g.lineWidth = 1;
            const step = 8;
            for (let x = -h; x < w + h; x += step) {
                g.beginPath();
                g.moveTo(x, 0);
                g.lineTo(x + h, h);
                g.moveTo(x + h, 0);
                g.lineTo(x, h);
                g.stroke();
            }
            g.fillStyle = "rgba(150,156,164,1)";
            g.fillRect(0, 0, w, 6);
            g.fillRect(0, h - 3, w, 3);
            g.fillStyle = "rgba(120,126,134,1)";
            g.fillRect(0, 0, 6, h);
        },
        { repeat: true },
    );
    tex.wrapT = ClampToEdgeWrapping;
    return tex;
}

/** Meters of track one texture repeat covers along the lanes. */
export const TRACK_TILE = 9.144;

/**
 * Track surface across the six lanes (v = 0 is the inside curb): speckled
 * polyurethane, 5 cm lane lines, a white curb line. Repeats along u.
 */
export function trackTexture(lanes: number): CanvasTexture {
    const tex = paintCanvasTexture(
        512,
        512,
        (g, w, h) => {
            g.fillStyle = "#a6462f";
            g.fillRect(0, 0, w, h);
            const rnd = createRng(31);
            // worn inside lanes are lighter, as on a real track
            const wear = g.createLinearGradient(0, h, 0, 0);
            wear.addColorStop(0, "rgba(230,170,140,0.16)");
            wear.addColorStop(0.35, "rgba(230,170,140,0.05)");
            wear.addColorStop(1, "rgba(60,20,10,0.06)");
            g.fillStyle = wear;
            g.fillRect(0, 0, w, h);
            for (let i = 0; i < 16000; i++) {
                const k = rnd();
                g.fillStyle =
                    k < 0.4
                        ? "rgba(70,24,14,0.5)"
                        : k < 0.75
                          ? "rgba(214,120,90,0.45)"
                          : "rgba(40,30,28,0.35)";
                g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5);
            }
            g.fillStyle = "#f4f2ee";
            const px = h / TRACK_TILE;
            const line = Math.max(2, 0.05 * px);
            for (let k = 0; k <= lanes; k++) {
                const v = k / lanes;
                const y = h - v * h;
                const t = k === 0 ? line * 2.2 : line;
                g.fillRect(0, Math.min(h - t, Math.max(0, y - t / 2)), w, t);
            }
        },
        { repeat: true },
    );
    tex.wrapT = ClampToEdgeWrapping;
    return tex;
}

/** Finish line decal: lane numbers 1..lanes and a white line, transparent. */
export function finishTexture(lanes: number): CanvasTexture {
    return paintCanvasTexture(256, 512, (g, w, h) => {
        g.clearRect(0, 0, w, h);
        g.fillStyle = "#f4f2ee";
        g.fillRect(w - 14, 0, 10, h);
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = `700 70px ${TEXTURE_FONT}`;
        for (let k = 0; k < lanes; k++) {
            const y = h - ((k + 0.5) / lanes) * h;
            g.save();
            g.translate(w * 0.55, y);
            g.rotate(Math.PI / 2);
            g.fillText(String(k + 1), 0, 0);
            g.restore();
        }
    });
}

// ---------------------------------------------------------------------------
// Scoreboard

/** Classic high school scoreboard face (map and emissive in one). */
export function scoreboardTexture(
    homeColor: string,
    title: string,
): CanvasTexture {
    return paintCanvasTexture(1024, 512, (g, w, h) => {
        g.fillStyle = "#16171b";
        g.fillRect(0, 0, w, h);
        // header in the home color
        const hh = 110;
        g.fillStyle = homeColor;
        g.fillRect(0, 0, w, hh);
        g.fillStyle = "rgba(255,255,255,0.12)";
        g.fillRect(0, 0, w, 8);
        g.fillStyle = luminance(homeColor) > 0.6 ? "#16171b" : "#ffffff";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = `800 76px ${TEXTURE_FONT}`;
        g.fillText(title.toUpperCase(), w / 2, hh / 2 + 4, w - 60);
        // labels
        g.fillStyle = "#f2f2f2";
        g.font = `700 44px ${TEXTURE_FONT}`;
        g.fillText("HOME", 170, 160);
        g.fillText("GUEST", w - 170, 160);
        g.font = `700 30px ${TEXTURE_FONT}`;
        g.fillText("QTR", w / 2, 280);
        for (const [label, x] of [
            ["BALL ON", 200],
            ["DOWN", w / 2],
            ["TO GO", w - 200],
        ] as const) {
            g.fillText(label, x, 352);
        }
        // LED digits: unlit segments faintly visible behind lit ones
        const digits = (text: string, x: number, y: number, size: number, color: string) => {
            g.font = `700 ${size}px "DejaVu Sans Mono", monospace`;
            g.fillStyle = "rgba(255,255,255,0.06)";
            g.fillText("8".repeat(text.length), x, y);
            g.fillStyle = color;
            g.shadowColor = color;
            g.shadowBlur = 14;
            g.fillText(text, x, y);
            g.shadowBlur = 0;
        };
        digits("00", 170, 230, 96, "#ff3b2f");
        digits("00", w - 170, 230, 96, "#ff3b2f");
        digits("12:00", w / 2, 196, 104, "#ffb21e");
        digits("1", w / 2, 322, 56, "#ffb21e");
        digits("--", 200, 400, 56, "#ff3b2f");
        digits("1", w / 2, 400, 56, "#ff3b2f");
        digits("10", w - 200, 400, 56, "#ff3b2f");
        // sponsor panel, of course
        g.fillStyle = "#f4f1ea";
        g.fillRect(0, h - 64, w, 64);
        g.fillStyle = shade(homeColor, -0.2);
        g.font = `800 40px ${TEXTURE_FONT}`;
        g.fillText("GO BAND! · BAND BOOSTERS", w / 2, h - 30);
    });
}

// ---------------------------------------------------------------------------
// Press box

export interface FacadeTextures {
    map: CanvasTexture;
    emissive: CanvasTexture;
}

/**
 * Press box front: siding, a home-colored fascia carrying `text` on the top
 * story, and a band of glass per story with mullions and people inside. The
 * emissive twin lights the windows warm for dusk and night.
 */
export function pressBoxFacade(
    width: number,
    height: number,
    stories: number,
    homeColor: string,
    text: string,
): FacadeTextures {
    const W = 2048;
    const H = Math.max(128, Math.min(1024, Math.round((W * height) / width)));
    const pxm = W / width;
    const storyH = H / stories;
    const rows = (k: number) => {
        const top = k * storyH;
        return {
            top,
            fascia: [top, top + storyH * 0.2],
            glass: [top + storyH * 0.26, top + storyH * 0.78],
        };
    };
    const mullion = Math.max(8, pxm * 1.5);
    const people = (g: G, k: number, lit: boolean) => {
        const { glass } = rows(k);
        const rnd = createRng(77 + k);
        const gh = glass[1] - glass[0];
        for (let x = mullion * 0.5; x < W; x += mullion * (0.6 + rnd() * 1.4)) {
            if (rnd() < 0.35) continue;
            const s = gh * (0.42 + rnd() * 0.12);
            g.fillStyle = lit ? "rgba(40,28,18,0.85)" : "rgba(8,10,14,0.55)";
            // shoulders and a head, seen through the glass from the field
            g.fillRect(x - s * 0.32, glass[1] - s * 0.62, s * 0.64, s * 0.62);
            g.beginPath();
            g.arc(x, glass[1] - s * 0.8, s * 0.18, 0, Math.PI * 2);
            g.fill();
        }
    };
    const paint = (lit: boolean) =>
        paintCanvasTexture(W, H, (g) => {
            g.fillStyle = lit ? "#000" : "#e4dfd4";
            g.fillRect(0, 0, W, H);
            if (!lit) {
                // vertical metal panel seams
                g.fillStyle = "rgba(0,0,0,0.07)";
                for (let x = 0; x < W; x += Math.max(4, pxm * 0.6)) g.fillRect(x, 0, 2, H);
            }
            for (let k = 0; k < stories; k++) {
                const r = rows(k);
                if (!lit) {
                    g.fillStyle = homeColor;
                    g.fillRect(0, r.fascia[0], W, r.fascia[1] - r.fascia[0]);
                    g.fillStyle = "rgba(255,255,255,0.85)";
                    g.fillRect(0, r.fascia[1] - 4, W, 4);
                    if (k === 0 && text) {
                        g.fillStyle = luminance(homeColor) > 0.6 ? "#16171b" : "#ffffff";
                        g.textAlign = "center";
                        g.textBaseline = "middle";
                        const fh = r.fascia[1] - r.fascia[0];
                        g.font = `800 ${Math.round(fh * 0.72)}px ${TEXTURE_FONT}`;
                        g.fillText(text.toUpperCase(), W / 2, r.fascia[0] + fh * 0.52, W * 0.6);
                    }
                }
                const [g0, g1] = r.glass;
                if (lit) {
                    const warm = g.createLinearGradient(0, g0, 0, g1);
                    warm.addColorStop(0, "#ffe2b0");
                    warm.addColorStop(1, "#d9a060");
                    g.fillStyle = warm;
                } else {
                    // sky reflected in tinted glass: lighter at the top
                    const sky = g.createLinearGradient(0, g0, 0, g1);
                    sky.addColorStop(0, "#6f8297");
                    sky.addColorStop(0.5, "#2c3a4c");
                    sky.addColorStop(1, "#1b2533");
                    g.fillStyle = sky;
                }
                g.fillRect(0, g0, W, g1 - g0);
                people(g, k, lit);
                g.fillStyle = lit ? "#000" : "#3c3f45";
                for (let x = 0; x <= W; x += mullion) g.fillRect(x - 3, g0, 6, g1 - g0);
                g.fillRect(0, g0, W, 5);
                g.fillRect(0, g1 - 6, W, 6);
                if (!lit) {
                    // a sill under each band
                    g.fillStyle = "rgba(0,0,0,0.25)";
                    g.fillRect(0, g1, W, 6);
                }
            }
        });
    return { map: paint(false), emissive: paint(true) };
}

// ---------------------------------------------------------------------------
// Buildings

/** Meters one building texture repeat covers horizontally. */
export const BUILDING_TILE = 12;
/** Height in meters the facade band of the atlas represents (two stories). */
export const BUILDING_BAND_HEIGHT = 8;
/** The facade band and the roof's UV in the building atlas. */
export const BUILDING_FACADE_BAND: [number, number] = [0.25, 1];
export const BUILDING_ROOF_UV: [number, number] = [0.5, 0.12];

/**
 * School brick: two stories of window bands over red-brown brick, a cast
 * stone band, and a gravel roof patch at the bottom of the atlas. The
 * emissive twin lights about half the windows.
 */
export function buildingTextures(): FacadeTextures {
    const W = 512;
    const H = 512;
    const facadeH = H * 0.75;
    const storyH = facadeH / 2;
    const win = (k: number) => ({ y0: k * storyH + storyH * 0.3, y1: k * storyH + storyH * 0.72 });
    const paint = (lit: boolean) =>
        paintCanvasTexture(
            W,
            H,
            (g) => {
                g.fillStyle = lit ? "#000" : "#8a4a37";
                g.fillRect(0, 0, W, facadeH);
                const rnd = createRng(lit ? 3 : 5);
                if (!lit) {
                    // brick courses and color variation
                    for (let y = 0; y < facadeH; y += 4) {
                        for (let x = (y / 4) % 2 ? 0 : -5; x < W; x += 10) {
                            const v = rnd();
                            g.fillStyle = `rgba(${v < 0.5 ? "60,25,18" : "180,110,90"},${0.08 + rnd() * 0.12})`;
                            g.fillRect(x, y, 9, 3);
                        }
                    }
                    g.fillStyle = "#c9c0ad";
                    g.fillRect(0, 0, W, 10);
                    g.fillRect(0, storyH - 4, W, 6);
                }
                for (let k = 0; k < 2; k++) {
                    const { y0, y1 } = win(k);
                    for (let i = 0; i < 6; i++) {
                        const x0 = (W / 6) * i + 10;
                        const x1 = (W / 6) * (i + 1) - 10;
                        if (lit) {
                            if (rnd() < 0.45) continue;
                            g.fillStyle = rnd() < 0.7 ? "#ffe6b8" : "#cfe2ff";
                        } else {
                            const sky = g.createLinearGradient(0, y0, 0, y1);
                            sky.addColorStop(0, "#7a8da3");
                            sky.addColorStop(1, "#27313e");
                            g.fillStyle = sky;
                        }
                        g.fillRect(x0, y0, x1 - x0, y1 - y0);
                        g.fillStyle = lit ? "#000" : "#d8d4cc";
                        g.fillRect((x0 + x1) / 2 - 2, y0, 4, y1 - y0);
                        g.fillRect(x0, y0 + (y1 - y0) * 0.35, x1 - x0, 3);
                        if (!lit) {
                            g.fillStyle = "#c9c0ad";
                            g.fillRect(x0 - 3, y1, x1 - x0 + 6, 5);
                        }
                    }
                }
                // roof: gravel
                g.fillStyle = lit ? "#000" : "#6d6c69";
                g.fillRect(0, facadeH, W, H - facadeH);
                if (!lit) grain(g, W, H - facadeH, 3000, 0.4, 7);
            },
            { repeat: true },
        );
    const map = paint(false);
    const emissive = paint(true);
    for (const t of [map, emissive]) t.wrapT = ClampToEdgeWrapping;
    return { map, emissive };
}

// ---------------------------------------------------------------------------
// Site

export interface SiteRect {
    /** Center, in world meters. */
    x: number;
    z: number;
    /** Size along x and z. */
    w: number;
    d: number;
}

export interface SitePaint {
    /** Painted square: center and side in meters. */
    cx: number;
    cz: number;
    size: number;
    px: number;
    /** Base grass, css. */
    grass: string;
    /** Parking lots, with stalls in rows along x. */
    lots: SiteRect[];
    /** Concrete pads and plazas. */
    pads: SiteRect[];
    /** Concrete walks as polylines of [x, z] points. */
    walks: { points: [number, number][]; width: number }[];
    /** Practice fields: lighter grass with faded lines. */
    fields: SiteRect[];
    /** A band practice lot: asphalt with painted yard lines. */
    bandLots: SiteRect[];
    /** Baseball diamonds: home plate position and the direction to second base (radians about +y from +x). */
    diamonds: { x: number; z: number; angle: number }[];
    /** Darker worn grass under the trees, kept clear elsewhere. */
    treeShade: { x: number; z: number; r: number }[];
    seed: number;
}

/** The ground around the stadium: grass with mowing, lots, walks and fields. */
export function siteTexture(s: SitePaint): CanvasTexture {
    const S = s.px;
    const k = S / s.size;
    const X = (x: number) => (x - (s.cx - s.size / 2)) * k;
    const Y = (z: number) => (z - (s.cz - s.size / 2)) * k;
    const rect = (r: SiteRect, inset = 0) =>
        [X(r.x - r.w / 2) + inset, Y(r.z - r.d / 2) + inset, r.w * k - 2 * inset, r.d * k - 2 * inset] as const;
    return paintCanvasTexture(
        S,
        S,
        (g) => {
            const rnd = createRng(s.seed);
            g.fillStyle = s.grass;
            g.fillRect(0, 0, S, S);
            // broad color drift: dry patches, lush patches
            for (let i = 0; i < 260; i++) {
                const r = (8 + rnd() * 50) * k;
                const x = rnd() * S;
                const y = rnd() * S;
                const tone = rnd();
                const col =
                    tone < 0.4 ? "120,130,60" : tone < 0.75 ? "40,80,30" : "90,110,50";
                const grad = g.createRadialGradient(x, y, 0, x, y, r);
                grad.addColorStop(0, `rgba(${col},0.16)`);
                grad.addColorStop(1, `rgba(${col},0)`);
                g.fillStyle = grad;
                g.fillRect(x - r, y - r, 2 * r, 2 * r);
            }
            for (const t of s.treeShade) {
                const r = t.r * k;
                const grad = g.createRadialGradient(X(t.x), Y(t.z), 0, X(t.x), Y(t.z), r);
                grad.addColorStop(0, "rgba(40,50,25,0.45)");
                grad.addColorStop(1, "rgba(40,50,25,0)");
                g.fillStyle = grad;
                g.fillRect(X(t.x) - r, Y(t.z) - r, 2 * r, 2 * r);
            }
            // mowing stripes, 6 m wide
            const stripe = 6 * k;
            g.fillStyle = "rgba(255,255,230,0.035)";
            for (let x = 0; x < S; x += stripe * 2) g.fillRect(x, 0, stripe, S);
            for (let i = 0; i < 9000; i++) {
                g.fillStyle = `rgba(${rnd() < 0.5 ? "20,40,10" : "170,180,110"},0.12)`;
                g.fillRect(rnd() * S, rnd() * S, 1, 1);
            }

            for (const f of s.fields) {
                g.fillStyle = "rgba(110,150,70,0.35)";
                g.fillRect(...rect(f));
                g.strokeStyle = "rgba(240,240,230,0.45)";
                g.lineWidth = Math.max(1, 0.12 * k);
                g.strokeRect(...rect(f, 2 * k));
                const [x0, y0, w, h] = rect(f, 2 * k);
                const along = f.w >= f.d;
                const n = 10;
                for (let i = 1; i < n; i++) {
                    g.beginPath();
                    if (along) {
                        g.moveTo(x0 + (w * i) / n, y0);
                        g.lineTo(x0 + (w * i) / n, y0 + h);
                    } else {
                        g.moveTo(x0, y0 + (h * i) / n);
                        g.lineTo(x0 + w, y0 + (h * i) / n);
                    }
                    g.stroke();
                }
            }

            for (const d of s.diamonds) {
                g.save();
                g.translate(X(d.x), Y(d.z));
                g.rotate(d.angle);
                // outfield arc of infield dirt, a grass infield, base paths
                g.fillStyle = "#b08a5e";
                g.beginPath();
                g.moveTo(0, 0);
                g.arc(0, 0, 29 * k, -Math.PI / 4, Math.PI / 4);
                g.closePath();
                g.fill();
                g.fillStyle = s.grass;
                g.save();
                g.rotate(Math.PI / 4);
                g.fillRect(2 * k, 2 * k, 23.5 * k, 23.5 * k);
                g.restore();
                g.fillStyle = "#b08a5e";
                g.beginPath();
                g.arc(18.4 * k, 0, 3 * k, 0, Math.PI * 2);
                g.arc(0, 0, 4 * k, 0, Math.PI * 2);
                g.fill();
                g.strokeStyle = "rgba(245,245,240,0.8)";
                g.lineWidth = Math.max(1, 0.1 * k);
                g.beginPath();
                g.moveTo(0, 0);
                g.lineTo(Math.cos(-Math.PI / 4) * 95 * k, Math.sin(-Math.PI / 4) * 95 * k);
                g.moveTo(0, 0);
                g.lineTo(Math.cos(Math.PI / 4) * 95 * k, Math.sin(Math.PI / 4) * 95 * k);
                g.stroke();
                g.restore();
            }

            const asphalt = (r: SiteRect) => {
                g.fillStyle = "#45474a";
                g.fillRect(...rect(r));
                for (let i = 0; i < (r.w * r.d * k * k) / 30; i++) {
                    g.fillStyle = `rgba(${rnd() < 0.5 ? "20,20,22" : "120,120,118"},0.2)`;
                    const [x0, y0, w, h] = rect(r);
                    g.fillRect(x0 + rnd() * w, y0 + rnd() * h, 1, 1);
                }
                // oil and patch stains
                for (let i = 0; i < (r.w * r.d) / 300; i++) {
                    const [x0, y0, w, h] = rect(r);
                    g.fillStyle = "rgba(25,25,28,0.18)";
                    g.beginPath();
                    g.ellipse(x0 + rnd() * w, y0 + rnd() * h, (1 + rnd() * 4) * k, (0.6 + rnd() * 2) * k, 0, 0, Math.PI * 2);
                    g.fill();
                }
                // curb
                g.strokeStyle = "rgba(200,198,190,0.9)";
                g.lineWidth = Math.max(1, 0.3 * k);
                g.strokeRect(...rect(r));
            };

            for (const p of s.pads) {
                g.fillStyle = "#b4b1aa";
                g.fillRect(...rect(p));
                g.strokeStyle = "rgba(90,88,84,0.14)";
                g.lineWidth = 1;
                const [x0, y0, w, h] = rect(p);
                const step = Math.max(3, 1.5 * k);
                for (let x = x0; x < x0 + w; x += step) {
                    g.beginPath();
                    g.moveTo(x, y0);
                    g.lineTo(x, y0 + h);
                    g.stroke();
                }
                for (let y = y0; y < y0 + h; y += step) {
                    g.beginPath();
                    g.moveTo(x0, y);
                    g.lineTo(x0 + w, y);
                    g.stroke();
                }
            }

            for (const w of s.walks) {
                g.strokeStyle = "#bdb9b0";
                g.lineCap = "round";
                g.lineJoin = "round";
                g.lineWidth = w.width * k;
                g.beginPath();
                w.points.forEach(([x, z], i) => (i ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z))));
                g.stroke();
            }

            for (const lot of s.lots) {
                asphalt(lot);
                // double-loaded rows of 2.75 x 5.5 m stalls along x, 7 m aisles
                const [x0, y0, w, h] = rect(lot, 1.5 * k);
                const stallW = 2.75 * k;
                const stallD = 5.5 * k;
                const module = 2 * stallD + 7 * k;
                g.strokeStyle = "rgba(240,240,232,0.85)";
                g.lineWidth = Math.max(1, 0.12 * k);
                for (let y = y0 + 7 * k; y + 2 * stallD <= y0 + h; y += module) {
                    g.beginPath();
                    g.moveTo(x0, y + stallD);
                    g.lineTo(x0 + w, y + stallD);
                    for (let x = x0; x <= x0 + w; x += stallW) {
                        g.moveTo(x, y);
                        g.lineTo(x, y + 2 * stallD);
                    }
                    g.stroke();
                }
            }

            for (const b of s.bandLots) {
                asphalt(b);
                // yard lines every 5 yards and hashes: where the band learns the show
                const [x0, y0, w, h] = rect(b, 2 * k);
                g.strokeStyle = "rgba(250,250,245,0.9)";
                g.lineWidth = Math.max(1, 0.1 * k);
                g.strokeRect(x0, y0, w, h);
                const yd = 4.572 * k;
                for (let x = x0, i = 0; x <= x0 + w + 0.1; x += yd, i++) {
                    g.beginPath();
                    g.moveTo(x, y0);
                    g.lineTo(x, y0 + h);
                    g.stroke();
                }
                for (const f of [1 / 3, 2 / 3]) {
                    for (let x = x0; x <= x0 + w; x += yd / 5) {
                        g.beginPath();
                        g.moveTo(x, y0 + h * f - 0.3 * k);
                        g.lineTo(x, y0 + h * f + 0.3 * k);
                        g.stroke();
                    }
                }
            }
        },
        { anisotropy: 8 },
    );
}
