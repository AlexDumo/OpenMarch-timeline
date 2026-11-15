/**
 * Variant A, "Form": the band marches drill behind the cursor.
 *
 * The band is never dragged. It stands in a set, then marches to the next one the way a show
 * plays: every marcher walks a straight line at an even pace, all starting and stopping on the
 * count. Each new set is a new formation, placed toward the cursor, so following the cursor is a
 * run of drill moves and the shape changes on every move. A set lands on the field's grid, which
 * shows faintly behind the band. Standing still, the band changes form where it is every couple
 * of bars; a click or tap changes it now.
 *
 * Formations come from the app's shape engine; who goes to which spot is the app's own rule
 * (least travel, no crossing paths).
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
/** Seconds per count: 176 beats a minute */
const COUNT = 60 / 176;
/** The biggest step the band takes, in steps a count (8 to 5 is 1) */
const MAX_STEP = 4.5;
/** Shortest and longest move, in counts */
const MIN_COUNTS = 4;
const MAX_COUNTS = 8;
/** The farthest the band's center goes toward the cursor in one move, in steps */
const TRAVEL = 26;
/** Counts the band stands still in a set before it changes form where it is */
const HOLD = 8;
/** How far the cursor must be from the band's center, in steps, to march toward it */
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
    /** Where each marcher is, starts and ends this move, in steps from the origin */
    let pos: XY[] = [];
    let from: XY[] = [];
    let to: XY[] = [];
    /** The current set's center, in steps */
    let center: XY = { x: 0, y: 0 };
    let marching = false;
    let counts = MIN_COUNTS;
    /** Seconds into the current move, or standing in the set */
    let clock = 0;
    const drawn: XY[] = Array.from({ length: N }, () => ({ x: 0, y: 0 }));
    let grid: { canvas: HTMLCanvasElement; key: string } | null = null;

    const cursorSteps = (stage: Stage): XY => ({
        x: (stage.cursor.x - origin.x) / step,
        y: (stage.cursor.y - origin.y) / step,
    });

    /** A formation centered at `c`, moved so its first marcher stands on the grid */
    function placed(spots: readonly XY[], c: XY): { spots: XY[]; center: XY } {
        const first = spots[0]!;
        const dx = roundTo(c.x + first.x, LATTICE) - (c.x + first.x);
        const dy = roundTo(c.y + first.y, LATTICE) - (c.y + first.y);
        const at = { x: c.x + dx, y: c.y + dy };
        return {
            spots: spots.map((s) => ({ x: at.x + s.x, y: at.y + s.y })),
            center: at,
        };
    }

    /** `c` moved so a formation centered there stays inside the hero's open area */
    function inside(stage: Stage, spots: readonly XY[], c: XY): XY {
        const margin = 12 / step;
        const left = -origin.x / step + margin;
        const right = (stage.w - origin.x) / step - margin;
        const top = -origin.y / step + margin;
        const bottom = (stage.open - origin.y) / step - margin;
        const xs = spots.map((s) => s.x);
        const ys = spots.map((s) => s.y);
        const clamp = (v: number, lo: number, hi: number) =>
            lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
        return {
            x: clamp(c.x, left - Math.min(...xs), right - Math.max(...xs)),
            y: clamp(c.y, top - Math.min(...ys), bottom - Math.max(...ys)),
        };
    }

    /** Start marching to the next set: the next formation, toward the cursor */
    function nextSet(stage: Stage) {
        const target = cursorSteps(stage);
        let dx = target.x - center.x;
        let dy = target.y - center.y;
        const far = Math.hypot(dx, dy);
        if (far > TRAVEL) {
            dx *= TRAVEL / far;
            dy *= TRAVEL / far;
        }
        shape++;
        const spots = SHAPES[shape % SHAPES.length]!();
        const set = placed(
            spots,
            inside(stage, spots, { x: center.x + dx, y: center.y + dy }),
        );
        const who = whoGoesWhere(pos, set.spots);
        from = pos.map((p) => ({ ...p }));
        to = who.map((spot) => set.spots[spot]!);
        // As many counts as the longest walk needs at the biggest step, in whole pairs
        let longest = 0;
        for (let i = 0; i < N; i++)
            longest = Math.max(
                longest,
                Math.hypot(to[i]!.x - from[i]!.x, to[i]!.y - from[i]!.y),
            );
        const needed = Math.ceil(longest / MAX_STEP / 2) * 2;
        counts = Math.min(MAX_COUNTS, Math.max(MIN_COUNTS, needed));
        center = set.center;
        marching = true;
        clock = 0;
        warm(SHAPES[(shape + 1) % SHAPES.length]!);
    }

    function standIn(spots: readonly XY[]) {
        pos = spots.map((s) => ({ ...s }));
        from = pos.map((p) => ({ ...p }));
        to = pos.map((p) => ({ ...p }));
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
            const at = cursorSteps(stage);
            if (pos.length === 0) {
                const set = placed(SHAPES[shape]!(), at);
                center = set.center;
                standIn(set.spots);
                warm(SHAPES[1]!);
            } else if (marching) {
                // Resized mid-move: land the set where it was going
                standIn(to);
            }
        },
        advance(stage, dt) {
            if (stage.clicks > 0) {
                stage.clicks = 0;
                // A click starts the next set now, from wherever the band is
                nextSet(stage);
            }
            const before = clock;
            clock += dt;
            if (marching) {
                const length = counts * COUNT;
                const t = Math.min(1, clock / length);
                for (let i = 0; i < N; i++) {
                    const a = from[i]!;
                    const b = to[i]!;
                    const p = pos[i]!;
                    p.x = a.x + (b.x - a.x) * t;
                    p.y = a.y + (b.y - a.y) * t;
                }
                if (clock < length) return;
                // In the set. Still behind the cursor: on to the next set, on the count
                marching = false;
                clock -= length;
                const c = cursorSteps(stage);
                if (Math.hypot(c.x - center.x, c.y - center.y) > NEAR) {
                    const over = clock;
                    nextSet(stage);
                    clock = over;
                }
                return;
            }
            // Standing: step off on the next count once the cursor moves away, or change form
            // here after a couple of bars
            const onCount =
                Math.floor(clock / COUNT) > Math.floor(before / COUNT);
            if (!onCount) return;
            const c = cursorSteps(stage);
            const away = Math.hypot(c.x - center.x, c.y - center.y) > NEAR;
            if (away || clock >= HOLD * COUNT) nextSet(stage);
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
            const set = placed(spots, {
                x: 0,
                y: (22 - origin.y) / step - top,
            });
            center = set.center;
            standIn(set.spots);
        },
    };
}
