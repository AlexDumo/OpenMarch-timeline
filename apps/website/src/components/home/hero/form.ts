/**
 * Variant A, "Form": the band forms a shape around the cursor and re-forms as it moves. Each
 * marcher is on a spring to its spot, a little looser or tighter than its neighbor, so a fast
 * move pulls the shape into a flock that settles back. The shape changes every few seconds, or
 * on a click or tap. Who goes to which spot is the app's own rule (least travel).
 */
import {
    arc,
    box,
    circle,
    once,
    polyline,
    warm,
    whoGoesWhere,
    type Formation,
    type XY,
} from "./formations";
import {
    springTo,
    standing,
    type Marcher,
    type Stage,
    type Variant,
} from "./runtime";

const N = 48;
/** Seconds a shape holds before the next one */
const HOLD = 3.6;

const SHAPES: readonly Formation[] = [
    once(() => box(N, 8, 2)),
    once(() => circle(N, 1.5)),
    once(() => arc(N, 40, 120)),
    once(() => box(N, 12, 2, "stagger")),
    once(() =>
        polyline(N + 1, [
            { x: -19, y: -7 },
            { x: 0, y: 7 },
            { x: 19, y: -7 },
        ]).slice(0, N),
    ),
    once(() => circle(N, 2, true)),
    once(() => box(N, 15, 2, "outline")),
];

export function formVariant(): Variant {
    let step = 8;
    let shape = 0;
    let held = 0;
    /** Each marcher's spot in the current shape, in pixels from the cursor */
    let spots: XY[] = [];
    const marchers: Marcher[] = [];
    /** How tightly each marcher follows: between 5.5 and 10 */
    const omega = Array.from(
        { length: N },
        (_, i) => 5.5 + 4.5 * (((i * 2654435761) >>> 0) / 2 ** 32),
    );

    const scaled = (i: number): XY[] =>
        SHAPES[i % SHAPES.length]!().map((s) => ({
            x: s.x * step,
            y: s.y * step,
        }));

    function take(stage: Stage, next: XY[]) {
        const from = marchers.map((m) => ({
            x: m.x - stage.cursor.x,
            y: m.y - stage.cursor.y,
        }));
        const to = whoGoesWhere(from, next);
        spots = to.map((spot) => next[spot]!);
    }

    return {
        stepFor: (w) => Math.min(9, Math.max(5, w / 60)),
        reach: 20,
        setup(stage, px) {
            step = px;
            const next = scaled(shape);
            if (marchers.length === 0) {
                spots = next;
                for (const s of next)
                    marchers.push({
                        x: stage.cursor.x + s.x,
                        y: stage.cursor.y + s.y,
                        vx: 0,
                        vy: 0,
                    });
            } else take(stage, next);
            warm(SHAPES[(shape + 1) % SHAPES.length]!);
        },
        advance(stage, dt) {
            held += dt;
            if (stage.clicks > 0 || held >= HOLD) {
                stage.clicks = 0;
                held = 0;
                shape++;
                take(stage, scaled(shape));
                warm(SHAPES[(shape + 1) % SHAPES.length]!);
            }
            for (let i = 0; i < N; i++) {
                const s = spots[i]!;
                springTo(
                    marchers[i]!,
                    stage.cursor.x + s.x,
                    stage.cursor.y + s.y,
                    omega[i]!,
                    dt,
                );
            }
        },
        marchers: () => marchers,
        pose(stage) {
            // One formation, standing: the arc, over the heading
            marchers.length = 0;
            for (const s of standing(SHAPES[2]!(), step, stage))
                marchers.push({ ...s, vx: 0, vy: 0 });
        },
    };
}
