/**
 * Variant A, "Form": the band marches drill with the cursor.
 *
 * The band is never dragged as one piece. It marches the way a show plays: every marcher walks
 * a straight line, changing direction only on the count (each half count), toward its spot in
 * a formation centered on the cursor. A move lasts a few counts and each move is a new
 * formation, so following the cursor the band keeps up and changes form as it goes. Because
 * every half count re-aims at where the cursor is now, the band arrives with the cursor instead
 * of trailing it. Sets land on the field's grid, which shows faintly behind the band. Standing
 * still, the band changes form where it is every couple of bars; a click or tap changes it now.
 *
 * Formations come from the app's shape engine; who goes to which spot is the app's own rule
 * (least travel, no crossing paths), decided once at the start of each move.
 */
import {
    arc,
    box,
    circle,
    line,
    once,
    polyline,
    warm,
    whoGoesWhere,
    type Formation,
    type XY,
} from "./formations";
import type { Colors, Stage, Variant } from "./runtime";

const N = 48;
/** Seconds per count: 200 beats a minute */
const COUNT = 60 / 200;
/** The marchers re-aim at the cursor this often: every half count */
const BEAT = COUNT / 2;
/** Counts in a move while following: a new formation this often */
const MOVE = 4;
/** Counts the band stands still in a set before it changes form where it is */
const HOLD = 8;
/** How far the cursor must be from the band's center, in steps, to march after it */
const NEAR = 3;
/** Every set lands with its first marcher on this grid, in steps */
const LATTICE = 2;
/** Yard lines, in steps */
const YARD = 8;

const SHAPES: readonly Formation[] = [
    once(() => box(N, 8, 2)),
    once(() => circle(N, 2)),
    once(() => arc(N, 44, 120)),
    once(() =>
        polyline(N + 1, [
            { x: -20, y: -8 },
            { x: 0, y: 8 },
            { x: 20, y: -8 },
        ]).slice(0, N),
    ),
    once(() => box(N, 16, 2, "stagger")),
    once(() =>
        polyline(
            N,
            [
                { x: 0, y: -14 },
                { x: 16, y: 10 },
                { x: -16, y: 10 },
            ],
            true,
        ),
    ),
    once(() => box(N, 14, 2, "outline")),
    once(() => line(N, { x: -24, y: 12 }, { x: 24, y: -12 })),
];

const roundTo = (v: number, to: number) => Math.round(v / to) * to;

export function formVariant(): Variant {
    let step = 8;
    /** The field's origin on the canvas: a yard line through the middle of the hero */
    let origin: XY = { x: 0, y: 0 };
    let shape = 0;
    /** Where each marcher is, in steps from the origin */
    let pos: XY[] = [];
    /** Each marcher's spot in the formation, from its center (decided at the move's start) */
    let offsets: XY[] = [];
    /** The set's center, in steps: where the formation stands now */
    let center: XY = { x: 0, y: 0 };
    /** Where each marcher was when the band last re-aimed, and when that was in the move */
    let from: XY[] = [];
    let aimed = 0;
    let marching = false;
    /** Seconds into the current move, or standing in the set */
    let clock = 0;
    const drawn: XY[] = Array.from({ length: N }, () => ({ x: 0, y: 0 }));
    let grid: { canvas: HTMLCanvasElement; key: string } | null = null;

    const cursorSteps = (stage: Stage): XY => ({
        x: (stage.cursor.x - origin.x) / step,
        y: (stage.cursor.y - origin.y) / step,
    });

    /** Where a formation centered near `c` stands: inside the hero, its first marcher on the grid */
    function placeAt(stage: Stage, spots: readonly XY[], c: XY): XY {
        const margin = 12 / step;
        const left = -origin.x / step + margin;
        const right = (stage.w - origin.x) / step - margin;
        const top = -origin.y / step + margin;
        const bottom = (stage.open - origin.y) / step - margin;
        let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
        for (const s of spots) {
            x0 = Math.min(x0, s.x);
            x1 = Math.max(x1, s.x);
            y0 = Math.min(y0, s.y);
            y1 = Math.max(y1, s.y);
        }
        const clamp = (v: number, lo: number, hi: number) =>
            lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
        const x = clamp(c.x, left - x0, right - x1);
        const y = clamp(c.y, top - y0, bottom - y1);
        const first = spots[0]!;
        return {
            x: roundTo(x + first.x, LATTICE) - first.x,
            y: roundTo(y + first.y, LATTICE) - first.y,
        };
    }

    const away = (stage: Stage) => {
        const c = cursorSteps(stage);
        return Math.hypot(c.x - center.x, c.y - center.y) > NEAR;
    };

    /** Start a move: the next formation at the cursor, each marcher given its spot */
    function startMove(stage: Stage) {
        shape++;
        const spots = SHAPES[shape % SHAPES.length]!();
        center = placeAt(stage, spots, cursorSteps(stage));
        const who = whoGoesWhere(
            pos,
            spots.map((s) => ({ x: center.x + s.x, y: center.y + s.y })),
        );
        offsets = who.map((spot) => spots[spot]!);
        from = pos.map((p) => ({ ...p }));
        aimed = 0;
        clock = 0;
        marching = true;
        warm(SHAPES[(shape + 1) % SHAPES.length]!);
    }

    /** Re-aim: the formation moves to where the cursor is now; everyone walks on from here */
    function reAim(stage: Stage) {
        center = placeAt(stage, offsets, cursorSteps(stage));
        from = pos.map((p) => ({ ...p }));
        aimed = clock;
    }

    function standIn(c: XY, spots: readonly XY[]) {
        center = c;
        offsets = spots.map((s) => ({ ...s }));
        pos = spots.map((s) => ({ x: c.x + s.x, y: c.y + s.y }));
        from = pos.map((p) => ({ ...p }));
        marching = false;
        clock = 0;
    }

    function fieldGrid(
        ctx: CanvasRenderingContext2D,
        stage: Stage,
        ink: string,
    ) {
        const { width, height } = ctx.canvas;
        const key = `${width}x${height}:${step}:${ink}:${origin.x},${origin.y}`;
        if (grid?.key === key) return grid.canvas;
        const canvas = grid?.canvas ?? document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const g = canvas.getContext("2d")!;
        const scale = width / stage.w;
        g.setTransform(scale, 0, 0, scale, 0, 0);
        g.clearRect(0, 0, stage.w, stage.h);
        g.strokeStyle = ink;
        g.lineWidth = 1 / scale;
        // Fine lines on the grid the sets land on; on a small screen every other one
        const fine = LATTICE * step >= 14 ? LATTICE : LATTICE * 2;
        const lines = (every: number, alpha: number) => {
            g.globalAlpha = alpha;
            g.beginPath();
            const gap = every * step;
            const snap = (v: number) => (Math.round(v * scale) + 0.5) / scale;
            for (let x = origin.x % gap; x < stage.w; x += gap) {
                g.moveTo(snap(x), 0);
                g.lineTo(snap(x), stage.h);
            }
            for (let y = origin.y % gap; y < stage.h; y += gap) {
                g.moveTo(0, snap(y));
                g.lineTo(stage.w, snap(y));
            }
            g.stroke();
        };
        lines(fine, 0.07);
        lines(YARD, 0.12);
        grid = { canvas, key };
        return canvas;
    }

    return {
        stepFor: (w) => Math.min(9, Math.max(5, w / 60)),
        reach: 22,
        setup(stage, px) {
            step = px;
            origin = {
                x: Math.round(stage.w / 2),
                y: Math.round(stage.open / 2),
            };
            if (pos.length === 0) {
                const spots = SHAPES[shape]!();
                standIn(placeAt(stage, spots, cursorSteps(stage)), spots);
                warm(SHAPES[1]!);
            } else {
                // Resized: stand in the set where it was going
                standIn(center, offsets);
            }
        },
        advance(stage, dt) {
            // A click starts the next formation now, from wherever the band is
            if (stage.clicks > 0) {
                stage.clicks = 0;
                startMove(stage);
            }
            const before = clock;
            clock += dt;
            const onBeat = Math.floor(clock / BEAT) > Math.floor(before / BEAT);
            if (!marching) {
                // Standing: step off on the next half count once the cursor moves away, or
                // change form here after a couple of bars
                if (onBeat && (away(stage) || clock >= HOLD * COUNT))
                    startMove(stage);
                if (!marching) return;
            }
            const length = MOVE * COUNT;
            if (onBeat && clock < length - BEAT / 2) reAim(stage);
            const t = Math.min(1, (clock - aimed) / (length - aimed));
            for (let i = 0; i < N; i++) {
                const a = from[i]!;
                const o = offsets[i]!;
                const p = pos[i]!;
                p.x = a.x + (center.x + o.x - a.x) * t;
                p.y = a.y + (center.y + o.y - a.y) * t;
            }
            if (clock < length) return;
            // In the set. Still away from the cursor: the next formation, on the count
            marching = false;
            const over = clock - length;
            clock = 0;
            if (away(stage)) {
                startMove(stage);
                clock = over;
            }
        },
        marchers() {
            for (let i = 0; i < pos.length; i++) {
                drawn[i]!.x = origin.x + pos[i]!.x * step;
                drawn[i]!.y = origin.y + pos[i]!.y * step;
            }
            return pos.length ? drawn : [];
        },
        under(ctx, stage, colors: Colors) {
            if (pos.length === 0) return;
            ctx.drawImage(
                fieldGrid(ctx, stage, colors.ink),
                0,
                0,
                stage.w,
                stage.h,
            );
            // The grid shows most around the band and fades out away from it and toward the
            // screenshots
            let mx = 0;
            let my = 0;
            for (const p of pos) {
                mx += p.x;
                my += p.y;
            }
            const cx = origin.x + (mx / pos.length) * step;
            const cy = origin.y + (my / pos.length) * step;
            ctx.save();
            ctx.globalCompositeOperation = "destination-in";
            const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 34 * step);
            glow.addColorStop(0, "rgba(0,0,0,1)");
            glow.addColorStop(0.55, "rgba(0,0,0,0.55)");
            glow.addColorStop(1, "rgba(0,0,0,0.22)");
            ctx.fillStyle = glow;
            ctx.fillRect(0, 0, stage.w, stage.h);
            const fade = ctx.createLinearGradient(0, 0, 0, stage.open);
            fade.addColorStop(0, "rgba(0,0,0,1)");
            fade.addColorStop(0.7, "rgba(0,0,0,1)");
            fade.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = fade;
            ctx.fillRect(0, 0, stage.w, stage.h);
            ctx.restore();
        },
        pose(stage) {
            // One set, standing on the grid: the arc, over the heading
            const spots = SHAPES[2]!();
            const top = Math.min(...spots.map((s) => s.y));
            standIn(
                placeAt(stage, spots, {
                    x: 0,
                    y: (22 - origin.y) / step - top,
                }),
                spots,
            );
        },
    };
}
