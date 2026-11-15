/**
 * Variant C, "File": follow the leader. A single file trails the cursor along the path it took,
 * two steps apart. When the cursor stops, the leader walks the file into a shape around it (a
 * circle, an arc, a diamond, a front), and they step off again when it moves.
 *
 * The shapes come from the app's shape engine, sized so their spots are two steps apart; the
 * trail itself is plain distance-along-a-path, not engine math.
 */
import {
    arc,
    circle,
    line,
    once,
    polyline,
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

const N = 28;
/** Steps between neighbors in the file */
const INTERVAL = 2;
/** Seconds the cursor is still before the file forms a shape */
const SETTLE = 0.55;
/** Steps a second the leader walks the file into a shape */
const WALK = 46;
/** How tightly the leader follows the cursor */
const LEAD = 12;

const FILE_LENGTH = (N - 1) * INTERVAL;
const SHAPES: readonly Formation[] = [
    once(() => circle(N, INTERVAL)),
    // A half circle whose length is the file's
    once(() => arc(N, (2 * FILE_LENGTH) / Math.PI, 180)),
    // A diamond, 7 to a side
    once(() => {
        const r = (7 * INTERVAL) / Math.SQRT2;
        return polyline(
            N,
            [
                { x: 0, y: -r },
                { x: r, y: 0 },
                { x: 0, y: r },
                { x: -r, y: 0 },
            ],
            true,
        );
    }),
    once(() =>
        line(N, { x: -FILE_LENGTH / 2, y: 0 }, { x: FILE_LENGTH / 2, y: 0 }),
    ),
];

export function fileVariant(): Variant {
    let step = 8;
    let shape = 0;
    /** The leader's path, oldest first, with the distance walked at each point */
    let trail: { x: number; y: number; s: number }[] = [];
    const head: Marcher = { x: 0, y: 0, vx: 0, vy: 0 };
    const marchers: XY[] = [];
    /** Forming: the path the leader still has to walk, and each marcher's spot at the end */
    let route: XY[] | null = null;
    let spots: XY[] = [];
    /** 0 while walking in, rising to 1 as the file settles onto its exact spots */
    let landed = 0;
    let formed = false;

    const push = (x: number, y: number) => {
        const last = trail[trail.length - 1];
        if (!last) return trail.push({ x, y, s: 0 });
        const d = Math.hypot(x - last.x, y - last.y);
        if (d < 1) return;
        trail.push({ x, y, s: last.s + d });
        // Keep what the file stands on, and a little more
        const keep = last.s + d - (FILE_LENGTH + 4) * step;
        let drop = 0;
        while (drop < trail.length - 2 && trail[drop + 1]!.s < keep) drop++;
        if (drop > 64) trail = trail.slice(drop);
    };

    /** Every marcher's place on the trail: `INTERVAL` steps behind the one ahead */
    function onTrail() {
        const end = trail[trail.length - 1]!;
        let k = trail.length - 1;
        for (let i = 0; i < N; i++) {
            const at = end.s - i * INTERVAL * step;
            while (k > 0 && trail[k - 1]!.s > at) k--;
            const b = trail[k]!;
            const a = trail[Math.max(0, k - 1)]!;
            const span = b.s - a.s;
            const t =
                span > 0 ? Math.min(1, Math.max(0, (at - a.s) / span)) : 0;
            const m = (marchers[i] ??= { x: 0, y: 0 });
            m.x = a.x + (b.x - a.x) * t;
            m.y = a.y + (b.y - a.y) * t;
        }
    }

    function lineUp(stage: Stage) {
        trail = [];
        // Standing in a file to the left of the cursor
        push(stage.cursor.x - (FILE_LENGTH + 2) * step, stage.cursor.y);
        push(stage.cursor.x, stage.cursor.y);
        head.x = stage.cursor.x;
        head.y = stage.cursor.y;
        onTrail();
    }

    function form(stage: Stage) {
        const made = SHAPES[shape % SHAPES.length]!();
        shape++;
        spots = made.map((s) => ({
            x: stage.cursor.x + s.x * step,
            y: stage.cursor.y + s.y * step,
        }));
        // The leader walks to the last spot and on through the shape to the first, so the
        // file ends with marcher i on spot i
        route = [...spots].reverse();
        landed = 0;
        formed = true;
    }

    return {
        stepFor: (w) => Math.min(9, Math.max(5, w / 60)),
        reach: FILE_LENGTH / 2,
        setup(stage, px) {
            step = px;
            route = null;
            formed = false;
            lineUp(stage);
        },
        advance(stage, dt) {
            if (stage.clicks > 0) {
                stage.clicks = 0;
                // A click or tap forms the next shape here, now
                form(stage);
            } else if (formed && stage.still === 0) {
                // Stepping off: follow the cursor again
                formed = false;
                route = null;
                head.vx = head.vy = 0;
            } else if (!formed && stage.still >= SETTLE) form(stage);

            if (!formed) {
                springTo(head, stage.cursor.x, stage.cursor.y, LEAD, dt);
                push(head.x, head.y);
                onTrail();
                return;
            }
            if (route && route.length > 0) {
                let left = WALK * step * dt;
                while (left > 0 && route.length > 0) {
                    const next = route[0]!;
                    const d = Math.hypot(next.x - head.x, next.y - head.y);
                    if (d <= left) {
                        head.x = next.x;
                        head.y = next.y;
                        left -= d;
                        route.shift();
                    } else {
                        head.x += ((next.x - head.x) / d) * left;
                        head.y += ((next.y - head.y) / d) * left;
                        left = 0;
                    }
                    push(head.x, head.y);
                }
                onTrail();
                return;
            }
            // Standing in the shape: ease the last fraction of a step onto the exact spots
            landed = Math.min(1, landed + dt * 4);
            onTrail();
            for (let i = 0; i < N; i++) {
                const m = marchers[i]!;
                m.x += (spots[i]!.x - m.x) * landed;
                m.y += (spots[i]!.y - m.y) * landed;
            }
        },
        marchers: () => marchers,
        pose(stage) {
            // The file standing in an arc over the heading
            marchers.length = 0;
            marchers.push(...standing(arc(N, 40, 120), step, stage));
        },
    };
}
