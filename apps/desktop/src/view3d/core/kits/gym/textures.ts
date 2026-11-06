import { RepeatWrapping, type CanvasTexture } from "three";
import { paintCanvasTexture, TEXTURE_FONT } from "../../environment";

/** Basketball court size in meters (28.65 x 15.24, the demo's 94 x 50 ft). */
export const COURT_LENGTH = 28.65;
export const COURT_WIDTH = 15.24;
/** The safety tape runs this far outside the performance area. */
export const TAPE_MARGIN = 1.5;

export interface FloorTextureOptions {
    /** Room floor extent in world meters. */
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    /** Performance area (the footprint) in world meters. */
    footprint: { minX: number; maxX: number; minZ: number; maxZ: number };
    /** School colors "#rrggbb": painted lanes and the center circle. */
    homeColor?: string;
    /** Center-circle lettering. */
    text?: string;
    /** Largest canvas side in pixels; 4096 by default. */
    maxSize?: number;
}

/** Small deterministic random source so textures never change between builds. */
export function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * The room floor: lacquered maple boards with staggered butt joints, a
 * basketball court centered under the performance area (painted lanes and
 * center circle in the school color) and the yellow safety tape 1.5 m outside
 * the performance area. The canvas top is the back wall (most negative z) and
 * its left is minX.
 */
export function floorTexture(o: FloorTextureOptions): CanvasTexture {
    const roomW = o.maxX - o.minX;
    const roomD = o.maxZ - o.minZ;
    const s = Math.min(32, (o.maxSize ?? 4096) / Math.max(roomW, roomD));
    const X = (x: number) => (x - o.minX) * s;
    const Y = (z: number) => (z - o.minZ) * s;
    const home = o.homeColor ?? "#6442ff";
    return paintCanvasTexture(
        Math.ceil(roomW * s),
        Math.ceil(roomD * s),
        (g, W, H) => {
            const rnd = seeded(7);
            const plank = Math.max(2, Math.round(0.09 * s));
            for (let i = 0, k = 0; i < H; i += plank, k++) {
                // Boards run along x with a butt joint every 1.2 to 3 m.
                let x = -rnd() * 2.4 * s;
                while (x < W) {
                    const len = (1.2 + rnd() * 1.8) * s;
                    const l = 61 + rnd() * 6;
                    g.fillStyle = `hsl(${32 + rnd() * 3}, ${48 + rnd() * 10}%, ${l}%)`;
                    g.fillRect(x, i, len, plank);
                    g.fillStyle = "rgba(90,50,10,0.35)";
                    g.fillRect(x, i, 1, plank);
                    x += len;
                }
                g.fillStyle = "rgba(90,50,10,0.28)";
                g.fillRect(0, i, W, 1);
                g.fillStyle = "rgba(255,246,220,0.10)";
                g.fillRect(0, i + 1, W, 1);
            }
            // Faint scuffs and wear streaks.
            g.fillStyle = "rgba(255,255,255,0.05)";
            for (let i = 0; i < 160; i++)
                g.fillRect(rnd() * W, rnd() * H, 20 + rnd() * 90, 1);
            const fp = o.footprint;
            const cx = (fp.minX + fp.maxX) / 2;
            const cz = (fp.minZ + fp.maxZ) / 2;
            const halfL = COURT_LENGTH / 2;
            const halfW = COURT_WIDTH / 2;
            const line = "rgba(246,242,230,0.96)";
            if (halfL * 2 <= roomW - 1 && halfW * 2 <= roomD - 1) {
                // Painted lanes (the key) and the center circle.
                g.fillStyle = home;
                for (const sg of [-1, 1]) {
                    const baseX = cx + sg * halfL;
                    g.globalAlpha = 0.9;
                    g.fillRect(
                        X(sg > 0 ? baseX - 5.79 : baseX),
                        Y(cz - 1.83),
                        5.79 * s,
                        3.66 * s,
                    );
                    g.globalAlpha = 1;
                }
                g.globalAlpha = 0.9;
                g.beginPath();
                g.arc(X(cx), Y(cz), 1.83 * s, 0, Math.PI * 2);
                g.fill();
                g.globalAlpha = 1;
                g.fillStyle = "#fff";
                g.textAlign = "center";
                g.textBaseline = "middle";
                g.font = `800 ${0.8 * s}px ${TEXTURE_FONT}`;
                g.fillText(o.text || "HOME", X(cx), Y(cz));
                g.strokeStyle = line;
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
                    // Free-throw lane, 5.79 x 3.66 m, against the baseline.
                    g.strokeRect(
                        X(sg > 0 ? baseX - 5.79 : baseX),
                        Y(cz - 1.83),
                        5.79 * s,
                        3.66 * s,
                    );
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
            }
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

const repeating = (t: CanvasTexture): CanvasTexture => {
    t.wrapS = t.wrapT = RepeatWrapping;
    return t;
};

/** Meters one `wallTexture` tile covers along the wall. */
export const WALL_TILE = 4;

/**
 * Painted cinder block, one 4 m tile that repeats along U and covers the
 * wall's full height: school-color wainscot with a white stripe and a rubber
 * base below, cream block above with grime near the ceiling.
 */
export function wallTexture(height: number, home: string): CanvasTexture {
    const ppm = 112;
    return repeating(
        paintCanvasTexture(
            WALL_TILE * ppm,
            Math.round(height * ppm),
            (g, W, H) => {
                const rnd = seeded(3);
                const rowH = 0.2 * ppm;
                const blockW = 0.4 * ppm;
                const wains = 2.5 * ppm;
                g.fillStyle = "#e7dfca";
                g.fillRect(0, 0, W, H);
                for (let r = 0; r * rowH < H; r++) {
                    const y = H - (r + 1) * rowH;
                    const painted = (r + 1) * rowH <= wains;
                    for (let b = -1; b * blockW < W; b++) {
                        const x = b * blockW + (r % 2 ? blockW / 2 : 0);
                        g.fillStyle = painted ? home : "#e9e1cc";
                        g.fillRect(x, y, blockW, rowH);
                        g.fillStyle =
                            rnd() > 0.5
                                ? `rgba(255,255,255,${rnd() * 0.07})`
                                : `rgba(0,0,0,${rnd() * 0.08})`;
                        g.fillRect(x, y, blockW, rowH);
                    }
                    g.fillStyle = painted
                        ? "rgba(0,0,0,0.30)"
                        : "rgba(80,70,50,0.22)";
                    g.fillRect(0, y + rowH - 1.5, W, 1.5);
                    for (let b = -1; b * blockW < W; b++) {
                        g.fillRect(
                            b * blockW + (r % 2 ? blockW / 2 : 0),
                            y,
                            1.5,
                            rowH,
                        );
                    }
                }
                // Stripes above the wainscot.
                g.fillStyle = "#f6f3ea";
                g.fillRect(0, H - wains - 0.16 * ppm, W, 0.14 * ppm);
                g.fillStyle = home;
                g.fillRect(0, H - wains - 0.24 * ppm, W, 0.06 * ppm);
                // Rubber base.
                g.fillStyle = "#26262b";
                g.fillRect(0, H - 0.14 * ppm, W, 0.14 * ppm);
                // Scuffs low on the wall, grime high.
                for (let i = 0; i < 70; i++) {
                    g.fillStyle = `rgba(255,255,255,${rnd() * 0.18})`;
                    g.fillRect(
                        rnd() * W,
                        H - 0.2 * ppm - rnd() * 1.3 * ppm,
                        6 + rnd() * 30,
                        2,
                    );
                }
                const grime = g.createLinearGradient(0, 0, 0, 3 * ppm);
                grime.addColorStop(0, "rgba(40,30,15,0.5)");
                grime.addColorStop(1, "rgba(40,30,15,0)");
                g.fillStyle = grime;
                g.fillRect(0, 0, W, 3 * ppm);
            },
            { repeat: true },
        ),
    );
}

/** Ribbed steel roof deck that repeats every 1.6 m. */
export function deckTexture(): CanvasTexture {
    return paintCanvasTexture(
        128,
        128,
        (g, W, H) => {
            for (let i = 0; i < 8; i++) {
                const x = (i * W) / 8;
                const grad = g.createLinearGradient(x, 0, x + W / 8, 0);
                grad.addColorStop(0, "#cfcdc4");
                grad.addColorStop(0.5, "#aeaca3");
                grad.addColorStop(1, "#8f8d85");
                g.fillStyle = grad;
                g.fillRect(x, 0, W / 8, H);
            }
        },
        { repeat: true },
    );
}

/** Bleacher boards: three planks across the tread, grain along U. */
export function woodTexture(): CanvasTexture {
    return paintCanvasTexture(256, 96, (g, W, H) => {
        const rnd = seeded(11);
        for (let p = 0; p < 3; p++) {
            const y = (p * H) / 3;
            g.fillStyle = `hsl(${32 + rnd() * 4}, ${40 + rnd() * 8}%, ${56 + rnd() * 8}%)`;
            g.fillRect(0, y, W, H / 3);
            for (let i = 0; i < 26; i++) {
                g.fillStyle = `rgba(80,40,10,${0.05 + rnd() * 0.12})`;
                g.fillRect(0, y + rnd() * (H / 3), W, 1);
            }
            g.fillStyle = "rgba(40,20,5,0.55)";
            g.fillRect(0, y, W, 1.5);
        }
    });
}

/** Padded wall mat in the school color, with panel seams and a stitched edge. */
export function matTexture(home: string): CanvasTexture {
    return paintCanvasTexture(256, 128, (g, W, H) => {
        g.fillStyle = home;
        g.fillRect(0, 0, W, H);
        g.fillStyle = "rgba(0,0,0,0.28)";
        for (let x = 0; x <= W; x += W / 2) g.fillRect(x - 2, 0, 4, H);
        g.fillRect(0, 0, W, 3);
        g.fillRect(0, H - 3, W, 3);
        const sheen = g.createLinearGradient(0, 0, 0, H);
        sheen.addColorStop(0, "rgba(255,255,255,0.18)");
        sheen.addColorStop(0.5, "rgba(255,255,255,0)");
        sheen.addColorStop(1, "rgba(0,0,0,0.2)");
        g.fillStyle = sheen;
        g.fillRect(0, 0, W, H);
    });
}

/** Clerestory windows, one 3 m tile that repeats along U. */
export function windowTexture(): CanvasTexture {
    return paintCanvasTexture(
        192,
        64,
        (g, W, H) => {
            g.fillStyle = "#59606a";
            g.fillRect(0, 0, W, H);
            for (let i = 0; i < 2; i++) {
                const x = 6 + i * 94;
                const grad = g.createLinearGradient(0, 0, 0, H);
                grad.addColorStop(0, "#f2f7ff");
                grad.addColorStop(1, "#bcd0ea");
                g.fillStyle = grad;
                g.fillRect(x, 6, 86, H - 12);
                g.fillStyle = "#59606a";
                g.fillRect(x + 42, 6, 2, H - 12);
                g.fillRect(x, 30, 86, 2);
            }
        },
        { repeat: true },
    );
}

/** Softly fading beam, bright at the fixture (V = 1) and gone at the floor. */
export function beamTexture(): CanvasTexture {
    return paintCanvasTexture(4, 64, (g, W, H) => {
        const grad = g.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, "#202020");
        grad.addColorStop(1, "#ffffff");
        g.fillStyle = grad;
        g.fillRect(0, 0, W, H);
    });
}

/** Wall scoreboard: a black panel with red digits and an amber clock. */
export function scoreboardTexture(): CanvasTexture {
    return paintCanvasTexture(1024, 384, (g, W, H) => {
        g.fillStyle = "#101114";
        g.fillRect(0, 0, W, H);
        g.strokeStyle = "#2c2f36";
        g.lineWidth = 10;
        g.strokeRect(5, 5, W - 10, H - 10);
        g.textAlign = "center";
        g.fillStyle = "#e9e9e9";
        g.font = `700 52px ${TEXTURE_FONT}`;
        g.fillText("HOME", 190, 80);
        g.fillText("GUEST", 834, 80);
        g.fillText("PERIOD", 512, 238);
        g.font = `700 190px ${TEXTURE_FONT}`;
        g.fillStyle = "#ff3b2d";
        g.fillText("00", 190, 262);
        g.fillText("00", 834, 262);
        g.fillStyle = "#ffb020";
        g.font = `700 150px ${TEXTURE_FONT}`;
        g.fillText("0:00", 512, 175);
        g.fillStyle = "#ff3b2d";
        g.font = `700 90px ${TEXTURE_FONT}`;
        g.fillText("1", 512, 345);
    });
}

/** Big painted lettering for a side wall, transparent around the letters. */
export function wordmarkTexture(text: string, color: string): CanvasTexture {
    return paintCanvasTexture(1024, 256, (g, W, H) => {
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = `800 190px ${TEXTURE_FONT}`;
        g.lineJoin = "round";
        g.lineWidth = 26;
        g.strokeStyle = "#f6f3ea";
        g.strokeText(text, W / 2, H / 2, W - 40);
        g.fillStyle = color;
        g.fillText(text, W / 2, H / 2, W - 40);
    });
}

/** A hanging banner: a swallowtail pennant, trim, up to three lines and a star. */
export function bannerTexture(lines: string[], color: string): CanvasTexture {
    return paintCanvasTexture(256, 360, (g, W, H) => {
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(W, 0);
        g.lineTo(W, H);
        g.lineTo(W / 2, H - 52);
        g.lineTo(0, H);
        g.closePath();
        g.fillStyle = color;
        g.fill();
        g.save();
        g.clip();
        g.fillStyle = "rgba(255,255,255,0.92)";
        g.fillRect(0, 0, W, 14);
        g.fillRect(0, 0, 10, H);
        g.fillRect(W - 10, 0, 10, H);
        g.fillStyle = "rgba(0,0,0,0.18)";
        g.fillRect(0, 14, W, 8);
        g.restore();
        g.fillStyle = "#fff";
        g.textAlign = "center";
        g.font = `700 32px ${TEXTURE_FONT}`;
        lines.forEach((l, i) => g.fillText(l, 128, 110 + i * 46, 210));
        g.fillStyle = "#ffd75e";
        g.font = `700 44px ${TEXTURE_FONT}`;
        g.fillText("★", 128, 62);
    });
}
