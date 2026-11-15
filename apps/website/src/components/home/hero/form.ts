/**
 * Variant A, "Form": follow the leader, then a show where the cursor stops.
 *
 * While the cursor moves, the band is one file behind it, every marcher walking the path the
 * cursor took. When it stops, the leader winds the file into a circle around that spot and the
 * band runs drill there for as long as the cursor stays: the circle turns, closes to a box, the
 * box rotates, its ranks pass through each other, it peels off around a rectangle, pulls into a
 * Z, and opens back to the circle. When the cursor moves, the file steps off after it from
 * wherever the band is. A click or tap skips to the next move.
 *
 * Everything is one continuous motion (a path walked, or a set marched to), so nothing snaps.
 * The box and circle come from the app's shape engine, and who goes to which spot is the app's
 * own rule (least travel, no crossing paths). The field's grid shows faintly behind the band.
 */
import { box, circle, once, arc, whoGoesWhere, type XY } from "./formations";
import type { Colors, Stage, Variant } from "./runtime";

const N = 48;
/** Steps between neighbors in the file while it follows the cursor */
const FILE = 1.5;
/** Steps between neighbors in the show's lines */
const INTERVAL = 2;
/** The circle, and the rectangle, are as long around as the file */
const AROUND = N * INTERVAL;
const RADIUS = AROUND / (2 * Math.PI);
/** The rectangle the file walks around, and the Z it pulls into, in steps */
const WIDE = 30;
const TALL = 18;
/** Steps a second the leader walks in the show */
const WALK = 38;
/** How tightly the leader keeps to the cursor (per second) */
const LEAD = 24;
/** Seconds the cursor is still before the file winds into the show */
const SETTLE = 0.3;
/** Steps the cursor moves from where it stopped before the band steps off after it */
const LEAVE = 2;
/** How fast the file's spacing settles (per second) */
const CLOSE = 2.5;
/** The grid: fine lines and yard lines, in steps */
const LATTICE = 2;
const YARD = 8;

const BOX = once(() => box(N, 8, 3));
const CIRCLE = once(() => circle(N, INTERVAL));
const ARC = once(() => arc(N, 44, 120));

const ease = (t: number) => t * t * (3 - 2 * t);
const far = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);

/** The show's moves, in order; it starts on the last (the circle turning) */
const MOVES = [
    "box",
    "rotate",
    "pass",
    "around",
    "z",
    "circle",
    "turn",
] as const;
const WIND = -1;

export function formVariant(): Variant {
    let step = 8;
    /** The field's origin on the canvas: a yard line through the middle of the hero */
    let origin: XY = { x: 0, y: 0 };
    /** The marchers, in steps from the origin; in a file, the leader first */
    const pos: XY[] = [];
    const drawn: XY[] = Array.from({ length: N }, () => ({ x: 0, y: 0 }));
    let grid: { canvas: HTMLCanvasElement; key: string } | null = null;

    /** Where the band is led: the cursor while a person steers, else where they left it */
    let target: XY = { x: 0, y: 0 };
    let stillFor = 0;
    /** Where the cursor stopped, and the show's center there (kept inside the hero) */
    let anchor: XY = { x: 0, y: 0 };
    let c: XY = { x: 0, y: 0 };

    /** follow: the file trails the cursor. lead: the leader walks a route. set: a marched move */
    let mode: "follow" | "lead" | "set" = "set";
    let move = 0;
    let clock = 0;

    // The trail the leader has walked, oldest first, with the distance walked at each point
    let tx: number[] = [];
    let ty: number[] = [];
    let td: number[] = [];
    /** How far behind the leader each marcher walks, and the spacing that settles toward */
    const lag: number[] = new Array(N).fill(0);
    let spacing = INTERVAL;
    const leader: XY = { x: 0, y: 0 };
    /** Seconds since the leader last had to catch up from far away */
    let chase = 1;

    // The route the leader walks in a "lead" move
    let route: XY[] = [];
    let routeAt: number[] = [];
    let next = 1;
    let walked = 0;
    let hold = 0;

    // A "set" move: where everyone started, and where they are at t (0 to 1)
    let from: XY[] = [];
    let seconds = 1;
    let at: (t: number, i: number, out: XY) => void = () => {};

    const cursorSteps = (stage: Stage): XY => ({
        x: (stage.cursor.x - origin.x) / step,
        y: (stage.cursor.y - origin.y) / step,
    });

    /** The show's center for a cursor at `p`: as near as keeps the circle inside the hero */
    function centerFor(stage: Stage, p: XY): XY {
        const m = RADIUS + 2;
        const clamp = (v: number, lo: number, hi: number) =>
            lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
        return {
            x: clamp(
                p.x,
                -origin.x / step + m,
                (stage.w - origin.x) / step - m,
            ),
            y: clamp(
                p.y,
                -origin.y / step + m,
                (stage.open - origin.y) / step - m,
            ),
        };
    }

    // --- The trail ---
    function push(x: number, y: number) {
        const n = tx.length;
        const d = n ? Math.hypot(x - tx[n - 1]!, y - ty[n - 1]!) : 0;
        if (n && d < 1e-4) return;
        tx.push(x);
        ty.push(y);
        td.push(n ? td[n - 1]! + d : 0);
        if (n > 8000) {
            // Drop what no one walks any more
            const keep = td[n]! - (N * INTERVAL * 2 + 40);
            let cut = 0;
            while (td[cut + 1]! < keep) cut++;
            tx = tx.slice(cut);
            ty = ty.slice(cut);
            td = td.slice(cut);
        }
    }

    /** The point `behind` steps back along the trail from the leader */
    function trailAt(behind: number, out: XY) {
        const n = tx.length;
        const want = td[n - 1]! - behind;
        if (want <= td[0]!) {
            out.x = tx[0]!;
            out.y = ty[0]!;
            return;
        }
        let lo = 0;
        let hi = n - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (td[mid]! <= want) lo = mid;
            else hi = mid;
        }
        const span = td[hi]! - td[lo]!;
        const t = span > 0 ? (want - td[lo]!) / span : 0;
        out.x = tx[lo]! + (tx[hi]! - tx[lo]!) * t;
        out.y = ty[lo]! + (ty[hi]! - ty[lo]!) * t;
    }

    /** Everyone to their place on the trail, the spacing settling as they go */
    function file(dt: number) {
        const k = 1 - Math.exp(-CLOSE * dt);
        for (let i = 0; i < N; i++) {
            lag[i]! += (i * spacing - lag[i]!) * k;
            trailAt(lag[i]!, pos[i]!);
        }
    }

    /**
     * Make a file of the band as it stands: the marcher nearest `near` leads, and each next
     * marcher is the nearest one left, so the trail runs through everyone
     */
    function chain(near: XY) {
        const left = pos.map((p) => ({ ...p }));
        const order: XY[] = [];
        let at = near;
        while (left.length) {
            let best = 0;
            for (let i = 1; i < left.length; i++)
                if (far(left[i]!, at) < far(left[best]!, at)) best = i;
            at = left.splice(best, 1)[0]!;
            order.push(at);
        }
        tx = [];
        ty = [];
        td = [];
        for (let i = N - 1; i >= 0; i--) {
            const p = order[i]!;
            pos[i]!.x = p.x;
            pos[i]!.y = p.y;
            const n = tx.length;
            tx.push(p.x);
            ty.push(p.y);
            td.push(
                n
                    ? td[n - 1]! +
                          Math.hypot(p.x - tx[n - 1]!, p.y - ty[n - 1]!)
                    : 0,
            );
        }
        for (let i = 0; i < N; i++) lag[i] = td[N - 1]! - td[N - 1 - i]!;
        leader.x = pos[0]!.x;
        leader.y = pos[0]!.y;
    }

    /** The leader walks through `points` from where it is; the file follows */
    function lead(points: XY[], then = 0) {
        route = [{ ...leader }, ...points];
        routeAt = [0];
        for (let i = 1; i < route.length; i++)
            routeAt.push(routeAt[i - 1]! + far(route[i]!, route[i - 1]!));
        next = 1;
        walked = 0;
        hold = then;
        clock = 0;
        mode = "lead";
    }

    /** Points around a circle about `o`, from angle `a`, through `turn` radians */
    function round(o: XY, r: number, a: number, turn: number): XY[] {
        const count = Math.max(2, Math.ceil((Math.abs(turn) * r) / 0.5));
        const points: XY[] = [];
        for (let i = 1; i <= count; i++) {
            const b = a + (turn * i) / count;
            points.push({ x: o.x + r * Math.cos(b), y: o.y + r * Math.sin(b) });
        }
        return points;
    }

    /** Everyone marches straight to a spot in `spots` (around the center), least travel */
    function marchTo(spots: readonly XY[], time: number) {
        const goal = spots.map((s) => ({ x: c.x + s.x, y: c.y + s.y }));
        const who = whoGoesWhere(pos, goal);
        set(time, (t, i, out) => {
            const a = from[i]!;
            const b = goal[who[i]!]!;
            const e = ease(t);
            out.x = a.x + (b.x - a.x) * e;
            out.y = a.y + (b.y - a.y) * e;
        });
    }

    function set(time: number, where: typeof at) {
        from = pos.map((p) => ({ ...p }));
        seconds = time;
        at = where;
        clock = 0;
        mode = "set";
    }

    function begin(which: number) {
        move = which;
        spacing = INTERVAL;
        const corner = (x: number, y: number): XY => ({
            x: c.x + (x * WIDE) / 2,
            y: c.y + (y * TALL) / 2,
        });
        switch (MOVES[which]) {
            case "box":
                return marchTo(BOX(), 1.5);
            case "rotate":
                // The box turns half way around its center
                return set(2.4, (t, i, out) => {
                    const a = Math.PI * ease(t);
                    const p = from[i]!;
                    const [x, y] = [p.x - c.x, p.y - c.y];
                    out.x = c.x + x * Math.cos(a) - y * Math.sin(a);
                    out.y = c.y + x * Math.sin(a) + y * Math.cos(a);
                });
            case "pass":
                // Every other rank slides the other way: out, through each other, and back
                return set(3.2, (t, i, out) => {
                    const p = from[i]!;
                    const rank = Math.floor((p.y - c.y) / 3 + 100.01);
                    out.x =
                        p.x + (rank % 2 ? 12 : -12) * Math.sin(2 * Math.PI * t);
                    out.y = p.y;
                });
            case "around":
                // The box peels off into a file that walks around a rectangle, a lap and a half
                chain(corner(-1, -1));
                return lead([
                    corner(-1, -1),
                    corner(1, -1),
                    corner(1, 1),
                    corner(-1, 1),
                    corner(-1, -1),
                    corner(1, -1),
                    corner(1, 1),
                ]);
            case "z":
                // On along the bottom, up the diagonal and back along the top: a Z
                return lead(
                    [corner(-1, 1), corner(1, -1), corner(-1, -1)],
                    0.8,
                );
            case "circle":
                return marchTo(CIRCLE(), 1.5);
            case "turn": {
                // The circle turns: the file walks around it
                chain(pos[0]!);
                const a = Math.atan2(leader.y - c.y, leader.x - c.x);
                const b = Math.atan2(pos[1]!.y - c.y, pos[1]!.x - c.x);
                const way = Math.sin(a - b) >= 0 ? 1 : -1;
                return lead(round(c, RADIUS, a, way * 2 * Math.PI));
            }
        }
    }

    /** The cursor has stopped: the leader winds the file into a circle around it */
    function wind(stage: Stage) {
        anchor = { ...target };
        c = centerFor(stage, target);
        const back = { x: 0, y: 0 };
        trailAt(0.5, back);
        let dir = { x: leader.x - back.x, y: leader.y - back.y };
        const points: XY[] = [];
        if (far(leader, c) > 0.5) {
            dir = { x: c.x - leader.x, y: c.y - leader.y };
            points.push({ ...c });
        }
        const length = Math.hypot(dir.x, dir.y);
        dir =
            length > 1e-3
                ? { x: dir.x / length, y: dir.y / length }
                : { x: 1, y: 0 };
        // Out from the center on a half circle that meets the big circle along its edge
        const side = { x: -dir.y, y: dir.x };
        const small = {
            x: c.x + (side.x * RADIUS) / 2,
            y: c.y + (side.y * RADIUS) / 2,
        };
        const a = Math.atan2(-side.y, -side.x);
        points.push(...round(small, RADIUS / 2, a, Math.PI));
        points.push(...round(c, RADIUS, a + Math.PI, 2.7 * Math.PI));
        move = WIND;
        spacing = INTERVAL;
        lead(points);
    }

    /** The cursor is off again: the band files after it from wherever it stands */
    function stepOff() {
        if (mode === "set") chain(target);
        mode = "follow";
        spacing = FILE;
        chase = 0;
    }

    function start(stage: Stage) {
        target = cursorSteps(stage);
        anchor = { ...target };
        c = centerFor(stage, target);
        const spots = CIRCLE();
        pos.length = 0;
        for (const s of spots) pos.push({ x: c.x + s.x, y: c.y + s.y });
        stillFor = 0;
        begin(MOVES.length - 1);
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
        reach: 18,
        setup(stage, px) {
            step = px;
            origin = {
                x: Math.round(stage.w / 2),
                y: Math.round(stage.open / 2),
            };
            start(stage);
        },
        advance(stage, dt) {
            if (stage.steered) {
                const now = cursorSteps(stage);
                const moved = far(now, target);
                stillFor = moved > 0.02 ? 0 : stillFor + dt;
                // A jump (a tap, or the pointer coming in): the leader eases into the chase
                if (moved > 6) chase = 0;
                target = now;
            } else stillFor += dt;

            if (stage.clicks > 0) {
                stage.clicks = 0;
                if (mode !== "follow" && far(target, anchor) <= LEAVE)
                    begin((move + 1) % MOVES.length);
            }
            if (mode !== "follow" && far(target, anchor) > LEAVE) stepOff();

            clock += dt;
            if (mode === "follow") {
                chase += dt;
                const k = LEAD * Math.min(1, 0.25 + chase / 0.3);
                const pull = 1 - Math.exp(-k * dt);
                leader.x += (target.x - leader.x) * pull;
                leader.y += (target.y - leader.y) * pull;
                push(leader.x, leader.y);
                file(dt);
                if (stillFor >= SETTLE && far(leader, target) < 0.5)
                    wind(stage);
            } else if (mode === "lead") {
                const total = routeAt[routeAt.length - 1]!;
                // Steps off over a moment, not at once
                walked += WALK * Math.min(1, 0.2 + clock / 0.3) * dt;
                while (next < route.length && routeAt[next]! <= walked) {
                    push(route[next]!.x, route[next]!.y);
                    next++;
                }
                if (next < route.length) {
                    const a = route[next - 1]!;
                    const b = route[next]!;
                    const t =
                        (walked - routeAt[next - 1]!) /
                        (routeAt[next]! - routeAt[next - 1]!);
                    leader.x = a.x + (b.x - a.x) * t;
                    leader.y = a.y + (b.y - a.y) * t;
                    push(leader.x, leader.y);
                } else {
                    leader.x = route[route.length - 1]!.x;
                    leader.y = route[route.length - 1]!.y;
                }
                file(dt);
                if (walked >= total + hold * WALK)
                    begin((move + 1) % MOVES.length);
            } else {
                const t = Math.min(1, clock / seconds);
                for (let i = 0; i < N; i++) at(t, i, pos[i]!);
                if (t >= 1) begin((move + 1) % MOVES.length);
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
            // One set, standing: the arc, over the heading
            const spots = ARC();
            const top = Math.min(...spots.map((s) => s.y));
            const y = (22 - origin.y) / step - top;
            pos.length = 0;
            for (const s of spots) pos.push({ x: s.x, y: y + s.y });
            void stage;
        },
    };
}
