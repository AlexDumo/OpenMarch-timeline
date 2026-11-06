import type { CanvasTexture } from "three";
import { paintCanvasTexture } from "../../environment";

/**
 * Procedural textures for the pro dome (no files, no network). All of them
 * repeat along U; V runs from the bottom of a band (0) to its top (1), which
 * is the canvas's bottom edge to its top edge.
 */

/** A small deterministic noise so every build looks the same. */
function hash(i: number, j = 0): number {
    const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return s - Math.floor(s);
}

/**
 * One seating section: an aisle strip at the left, then blocks of seats with
 * a lighter nosing at the front of the tread. `tones` picks the seat colors.
 */
export function seatTexture(tones: {
    seat: string;
    alt: string;
    aisle: string;
}): CanvasTexture {
    return paintCanvasTexture(
        256,
        64,
        (g, W, H) => {
            g.fillStyle = tones.aisle;
            g.fillRect(0, 0, W, H);
            const aisle = W * 0.07;
            const seats = 12;
            const pitch = (W - aisle) / seats;
            for (let i = 0; i < seats; i++) {
                const x = aisle + i * pitch;
                // The middle block is a shade lighter, so sections read apart.
                g.fillStyle = i % 6 < 3 ? tones.seat : tones.alt;
                g.fillRect(x + 1, 3, pitch - 2, H - 6);
                g.fillStyle = "rgba(0,0,0,0.28)";
                g.fillRect(x + 1, 3, pitch - 2, H * 0.34);
                g.fillStyle = "rgba(255,255,255,0.12)";
                g.fillRect(x + 3, H * 0.5, pitch - 6, 3);
            }
            g.fillStyle = "rgba(255,255,255,0.35)";
            g.fillRect(0, H - 3, W, 3);
        },
        { repeat: true },
    );
}

/**
 * The exterior: brick piers, deep glazed slots and a stone plinth. One tile
 * is a bay (12 m wide, 36 m tall). Returns the color map and the emissive map
 * (the lit slots, for night).
 */
export function facadeTextures(): { map: CanvasTexture; glow: CanvasTexture } {
    const W = 512;
    const H = 1024;
    const bay = (g: CanvasRenderingContext2D, glow: boolean) => {
        const plinth = H * 0.06;
        const cornice = H * 0.07;
        const pier = W * 0.3;
        const slotX0 = pier / 2;
        const slotX1 = W - pier / 2;
        if (!glow) {
            // Brick, with mortar lines and a little tone noise per brick.
            g.fillStyle = "#6e3b2c";
            g.fillRect(0, 0, W, H);
            const bh = 9;
            const bw = 26;
            for (let y = 0, r = 0; y < H; y += bh, r++) {
                for (let x = -bw; x < W; x += bw) {
                    const ox = x + (r % 2) * (bw / 2);
                    const t = hash(ox, r);
                    g.fillStyle = `hsl(${12 + t * 8}, ${38 + t * 14}%, ${27 + t * 12}%)`;
                    g.fillRect(ox + 1, y + 1, bw - 2, bh - 2);
                }
            }
            // Stone plinth and cornice.
            g.fillStyle = "#4a4a50";
            g.fillRect(0, H - plinth, W, plinth);
            g.fillStyle = "#9b9aa0";
            g.fillRect(0, 0, W, cornice);
            g.fillStyle = "#6c6b72";
            g.fillRect(0, cornice, W, 6);
        }
        // Glazed slot, with spandrels every 14% of the height.
        const top = cornice + 12;
        const bottom = H - plinth - 8;
        const grad = g.createLinearGradient(0, top, 0, bottom);
        if (glow) {
            grad.addColorStop(0, "#ffd9a0");
            grad.addColorStop(1, "#ff9d4a");
            g.fillStyle = "#000";
            g.fillRect(0, 0, W, H);
        } else {
            grad.addColorStop(0, "#7da3c9");
            grad.addColorStop(0.55, "#2b4766");
            grad.addColorStop(1, "#0f1a2b");
        }
        g.fillStyle = grad;
        g.fillRect(slotX0, top, slotX1 - slotX0, bottom - top);
        g.fillStyle = glow ? "#000" : "#20242b";
        const mullions = 4;
        for (let i = 0; i <= mullions; i++) {
            const x = slotX0 + ((slotX1 - slotX0) * i) / mullions;
            g.fillRect(x - 2, top, 4, bottom - top);
        }
        for (let y = top; y < bottom; y += (bottom - top) / 7)
            g.fillRect(slotX0, y - 3, slotX1 - slotX0, 6);
        if (!glow) {
            // Steel frame around each slot.
            g.strokeStyle = "#b9bdc4";
            g.lineWidth = 5;
            g.strokeRect(slotX0, top, slotX1 - slotX0, bottom - top);
        }
    };
    return {
        map: paintCanvasTexture(W, H, (g) => bay(g, false), { repeat: true }),
        glow: paintCanvasTexture(W, H, (g) => bay(g, true), { repeat: true }),
    };
}

/**
 * Suite level glass between the decks: dark panes in steel mullions, with a
 * warm lit interior behind most of them. Returns color and emissive maps.
 */
export function suiteTextures(): { map: CanvasTexture; glow: CanvasTexture } {
    const W = 512;
    const H = 64;
    const suites = 4;
    const paint = (g: CanvasRenderingContext2D, glow: boolean) => {
        g.fillStyle = glow ? "#000" : "#101826";
        g.fillRect(0, 0, W, H);
        const sw = W / suites;
        for (let i = 0; i < suites; i++) {
            const x = i * sw;
            const lit = hash(i, 9) > 0.18;
            const grad = g.createLinearGradient(0, 0, 0, H);
            if (glow) {
                grad.addColorStop(0, lit ? "#ffcf8a" : "#1a1410");
                grad.addColorStop(1, lit ? "#c9742e" : "#0a0806");
            } else {
                grad.addColorStop(0, "#35506f");
                grad.addColorStop(1, "#142033");
            }
            g.fillStyle = grad;
            g.fillRect(x + 5, 6, sw - 10, H - 12);
            // A table and a pair of chairs, as dark shapes in the glow.
            if (glow && lit) {
                g.fillStyle = "rgba(40,16,4,0.7)";
                g.fillRect(x + sw * 0.35, H * 0.62, sw * 0.3, H * 0.12);
                g.fillRect(x + sw * 0.25, H * 0.5, sw * 0.08, H * 0.34);
                g.fillRect(x + sw * 0.67, H * 0.5, sw * 0.08, H * 0.34);
            }
        }
        g.fillStyle = glow ? "#000" : "#9ea3ab";
        for (let i = 0; i <= suites * 2; i++) {
            const x = (i * W) / (suites * 2);
            g.fillRect(x - 2, 0, 4, H);
        }
        g.fillRect(0, 0, W, 5);
        g.fillRect(0, H - 5, W, 5);
    };
    return {
        map: paintCanvasTexture(W, H, (g) => paint(g, false), { repeat: true }),
        glow: paintCanvasTexture(W, H, (g) => paint(g, true), { repeat: true }),
    };
}

/**
 * The clerestory curtain wall under the roof: pale glass with a steel grid
 * and X-bracing. Transparent, so the sky shows through.
 */
export function clerestoryTexture(): CanvasTexture {
    return paintCanvasTexture(
        512,
        256,
        (g, W, H) => {
            g.clearRect(0, 0, W, H);
            g.fillStyle = "rgba(168,196,224,0.2)";
            g.fillRect(0, 0, W, H);
            g.strokeStyle = "rgba(60,66,76,0.95)";
            g.lineCap = "butt";
            g.lineWidth = 5;
            const bays = 4;
            for (let i = 0; i <= bays; i++) {
                const x = (W * i) / bays;
                g.beginPath();
                g.moveTo(x, 0);
                g.lineTo(x, H);
                g.stroke();
            }
            for (const y of [0, H * 0.34, H * 0.67, H]) {
                g.beginPath();
                g.moveTo(0, y);
                g.lineTo(W, y);
                g.stroke();
            }
            // Mullions, then bracing across alternate bays.
            g.lineWidth = 2;
            for (let i = 1; i < bays * 4; i++) {
                const x = (W * i) / (bays * 4);
                g.beginPath();
                g.moveTo(x, 0);
                g.lineTo(x, H);
                g.stroke();
            }
            g.lineWidth = 4;
            for (let i = 0; i < bays; i += 2) {
                const x0 = (W * i) / bays;
                const x1 = (W * (i + 1)) / bays;
                g.beginPath();
                g.moveTo(x0, H);
                g.lineTo(x1, 0);
                g.moveTo(x0, 0);
                g.lineTo(x1, H);
                g.stroke();
            }
        },
        { repeat: true },
    );
}

/**
 * Field-level LED advertising boards: generic colored panels and chevrons
 * (no brands). Emissive, one tile is 4 panels.
 */
export function adBoardTexture(): CanvasTexture {
    return paintCanvasTexture(
        1024,
        64,
        (g, W, H) => {
            g.fillStyle = "#0a0c18";
            g.fillRect(0, 0, W, H);
            const hues = [262, 205, 38, 330, 160, 12];
            const panels = 4;
            const pw = W / panels;
            for (let i = 0; i < panels; i++) {
                const hue = hues[Math.floor(hash(i, 3) * hues.length)];
                const x = i * pw;
                const grad = g.createLinearGradient(x, 0, x + pw, 0);
                grad.addColorStop(0, `hsl(${hue}, 80%, 52%)`);
                grad.addColorStop(1, `hsl(${hue + 24}, 85%, 38%)`);
                g.fillStyle = grad;
                g.fillRect(x + 4, 6, pw - 8, H - 12);
                g.fillStyle = "rgba(255,255,255,0.85)";
                for (let k = 0; k < 4 + (i % 3); k++) {
                    const cx = x + 30 + k * 30 + (i % 2) * 24;
                    g.beginPath();
                    g.moveTo(cx, 14);
                    g.lineTo(cx + 16, H / 2);
                    g.lineTo(cx, H - 14);
                    g.lineTo(cx - 8, H - 14);
                    g.lineTo(cx + 8, H / 2);
                    g.lineTo(cx - 8, 14);
                    g.closePath();
                    g.fill();
                }
                g.fillRect(x + pw * 0.62, H * 0.3, pw * 0.28, H * 0.12);
                g.fillRect(x + pw * 0.62, H * 0.55, pw * 0.2, H * 0.1);
            }
        },
        { repeat: true },
    );
}

/** Paving for the plaza around the stadium: pale slabs and joints. */
export function plazaTexture(): CanvasTexture {
    return paintCanvasTexture(
        256,
        256,
        (g, W, H) => {
            g.fillStyle = "#8d8e92";
            g.fillRect(0, 0, W, H);
            const n = 4;
            for (let i = 0; i < n; i++)
                for (let j = 0; j < n; j++) {
                    const t = hash(i, j);
                    g.fillStyle = `hsl(220, 4%, ${52 + t * 12}%)`;
                    g.fillRect(
                        (i * W) / n + 2,
                        (j * H) / n + 2,
                        W / n - 4,
                        H / n - 4,
                    );
                }
            // A darker band, like a row of planters.
            g.fillStyle = "rgba(40,60,40,0.35)";
            g.fillRect(0, H * 0.46, W, H * 0.08);
        },
        { repeat: true },
    );
}
