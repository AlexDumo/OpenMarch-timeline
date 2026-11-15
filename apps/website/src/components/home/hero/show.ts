/**
 * Variant B, "Show": a small live drill. The band marches a loop of sets the way the app plays a
 * show: straight to the next spot over 8 counts, hold 4, in tempo. The cursor steers where on
 * the field the band is, slowly, like a whole band following a drum major. Yard lines every 8
 * steps show it as a field.
 */
import {
    arc,
    box,
    centered,
    circle,
    line,
    once,
    polyline,
    together,
    warm,
    whoGoesWhere,
    type Formation,
    type XY,
} from "./formations";
import { springTo, standing, type Marcher, type Variant } from "./runtime";

const N = 64;
/** Seconds per count: 144 beats a minute */
const COUNT = 60 / 144;
const MOVE = 8 * COUNT;
const HOLD = 4 * COUNT;
/** How tightly the band's center follows the cursor */
const STEER = 2.2;
/** Half the widest set, in steps: the band's center stays that far inside the hero */
const REACH = 29;

const SETS: readonly Formation[] = [
    once(() => box(N, 16, 2)),
    once(() => arc(N, 58, 110)),
    once(() =>
        together(
            [circle(N / 2, 1.5), { x: -13, y: 0 }],
            [circle(N / 2, 1.5), { x: 13, y: 0 }],
        ),
    ),
    once(() =>
        centered(
            polyline(N + 1, [
                { x: -27, y: -7 },
                { x: 0, y: 7 },
                { x: 27, y: -7 },
            ]).slice(0, N),
        ),
    ),
    once(() =>
        together(
            [line(N / 2, { x: -27, y: 0 }, { x: 27, y: 0 }), { x: 0, y: -2 }],
            [line(N / 2, { x: -27, y: 0 }, { x: 27, y: 0 }), { x: 0, y: 2 }],
        ),
    ),
    once(() => circle(N, 2, true)),
    once(() => box(N, 20, 2, "outline")),
];

export function showVariant(): Variant {
    let step = 8;
    let set = 0;
    let clock = MOVE; // start standing in the first set
    /** Where each marcher starts and ends this move, in steps around the band's center */
    let from: XY[] = [];
    let to: XY[] = [];
    const center: Marcher = { x: 0, y: 0, vx: 0, vy: 0 };
    const marchers: XY[] = [];

    function next() {
        set++;
        from = to;
        const spots = SETS[set % SETS.length]!();
        to = whoGoesWhere(from, spots).map((spot) => spots[spot]!);
        warm(SETS[(set + 1) % SETS.length]!);
    }

    function place(t: number) {
        for (let i = 0; i < N; i++) {
            const a = from[i]!;
            const b = to[i]!;
            const m = (marchers[i] ??= { x: 0, y: 0 });
            m.x = center.x + (a.x + (b.x - a.x) * t) * step;
            m.y = center.y + (a.y + (b.y - a.y) * t) * step;
        }
    }

    return {
        stepFor: (w) => Math.min(11, Math.max(4.6, w / 76)),
        reach: REACH,
        setup(stage, px) {
            step = px;
            if (to.length === 0) {
                to = SETS[0]!();
                from = to;
                center.x = stage.cursor.x;
                center.y = stage.cursor.y;
                warm(SETS[1]!);
            }
            place(Math.min(1, clock / MOVE));
        },
        advance(stage, dt) {
            clock += dt;
            if (stage.clicks > 0 || clock >= MOVE + HOLD) {
                // A click starts the next move now, from wherever the band is
                if (clock < MOVE) {
                    const t = clock / MOVE;
                    to = to.map((b, i) => ({
                        x: from[i]!.x + (b.x - from[i]!.x) * t,
                        y: from[i]!.y + (b.y - from[i]!.y) * t,
                    }));
                }
                stage.clicks = 0;
                clock = 0;
                next();
            }
            // The whole band stays on the field: its center stops short of the sides
            const side = Math.min(stage.w / 2, REACH * step + 10);
            const x = Math.min(stage.w - side, Math.max(side, stage.cursor.x));
            springTo(center, x, stage.cursor.y, STEER, dt);
            place(Math.min(1, clock / MOVE));
        },
        marchers: () => marchers,
        under(ctx, stage, color) {
            // Yard lines every 8 steps from the middle of the hero, fading out toward the
            // screenshots
            const fade = ctx.createLinearGradient(0, 0, 0, stage.open);
            fade.addColorStop(0, color);
            fade.addColorStop(0.75, color);
            fade.addColorStop(1, "transparent");
            ctx.strokeStyle = fade;
            ctx.lineWidth = 1;
            ctx.beginPath();
            const gap = 8 * step;
            const first = (stage.w / 2) % gap;
            for (let x = first; x < stage.w; x += gap) {
                ctx.moveTo(Math.round(x) + 0.5, 0);
                ctx.lineTo(Math.round(x) + 0.5, stage.open);
            }
            ctx.stroke();
        },
        pose(stage) {
            // The band standing in its arc, on the field
            const still = standing(SETS[1]!(), step, stage);
            marchers.length = 0;
            marchers.push(...still);
        },
    };
}
