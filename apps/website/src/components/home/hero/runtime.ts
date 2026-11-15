/**
 * Prototype (#968): what the three hero variants share. One canvas behind the hero's content;
 * a cursor to form around (the pointer, a finger, or a slow autopilot when there is neither);
 * a frame loop that only runs while the hero is on screen; and one still frame, no loop and no
 * listeners, for people who ask for reduced motion.
 */
import type { XY } from "./formations";

export interface Marcher extends XY {
    vx: number;
    vy: number;
}

export interface Stage {
    /** The canvas, in CSS pixels */
    w: number;
    h: number;
    /** How far down the open area runs before the screenshots cover the canvas */
    open: number;
    /** Seconds since the hero started */
    time: number;
    /** Where the marchers form: the pointer, the finger, or the autopilot */
    cursor: XY;
    /** A person is steering (not the autopilot) */
    steered: boolean;
    /** Seconds the cursor has been still */
    still: number;
    /** Clicks and taps not yet used by the variant */
    clicks: number;
}

export interface Variant {
    /** Pixels per 8-to-5 step at this width */
    stepFor(w: number): number;
    /** Half the widest formation, in steps: the autopilot keeps that far from the sides */
    reach: number;
    /** Lay out for a new size; called before the first frame and on resize */
    setup(stage: Stage, step: number): void;
    advance(stage: Stage, dt: number): void;
    marchers(): readonly XY[];
    /** Extra drawing under the marchers (the field's lines) */
    under?(ctx: CanvasRenderingContext2D, stage: Stage, line: string): void;
    /** Reduced motion: put the marchers where one still frame shows them */
    pose(stage: Stage): void;
}

/** A critically damped spring toward (tx, ty): no overshoot, exact at any frame length */
export function springTo(
    m: Marcher,
    tx: number,
    ty: number,
    omega: number,
    dt: number,
): void {
    const e = Math.exp(-omega * dt);
    const ex = m.x - tx;
    const ey = m.y - ty;
    const kx = (m.vx + omega * ex) * dt;
    const ky = (m.vy + omega * ey) * dt;
    m.x = tx + (ex + kx) * e;
    m.y = ty + (ey + ky) * e;
    m.vx = (m.vx - omega * kx) * e;
    m.vy = (m.vy - omega * ky) * e;
}

/**
 * Reduced motion: a formation (in steps) standing centered across the hero, its top a little
 * below the hero's top edge so it frames the heading
 */
export function standing(
    spots: readonly XY[],
    step: number,
    stage: Stage,
): XY[] {
    const top = Math.min(...spots.map((s) => s.y));
    return spots.map((s) => ({
        x: stage.w / 2 + s.x * step,
        y: 22 + (s.y - top) * step,
    }));
}

/** Where the autopilot stops, as fractions of the open area, and how long each leg takes */
const WAYPOINTS: readonly XY[] = [
    { x: 0.5, y: 0.34 },
    { x: 0.22, y: 0.6 },
    { x: 0.74, y: 0.3 },
    { x: 0.36, y: 0.72 },
    { x: 0.8, y: 0.66 },
    { x: 0.2, y: 0.26 },
];
const GLIDE = 1.7;
const REST = 2.8;
/** Seconds after a person lets go before the autopilot takes over */
const HAND_BACK = 1.4;

const ease = (t: number) => t * t * (3 - 2 * t);

export interface HeroHandle {
    /** Recording and tests: move time on by `dt` seconds and draw (the loop is off) */
    advance(dt: number): void;
    perf(): { frames: number; meanMs: number; maxMs: number; fps: number };
    resetPerf(): void;
    stop(): void;
}

export function startHero(
    canvas: HTMLCanvasElement,
    variant: Variant,
    options: { manual?: boolean } = {},
): HeroHandle {
    const section = canvas.parentElement!;
    const ctx = canvas.getContext("2d")!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const stage: Stage = {
        w: 0,
        h: 0,
        open: 0,
        time: 0,
        cursor: { x: 0, y: 0 },
        steered: false,
        still: 0,
        clicks: 0,
    };
    let step = 8;
    let colors = { dot: "#6442ff", line: "rgba(0,0,0,0.1)" };

    // The autopilot: glide to a waypoint, rest, glide to the next
    let leg = 0;
    let legTime = GLIDE; // start resting on the first waypoint
    let legFrom: XY = { x: 0, y: 0 };
    let released = Infinity; // seconds since a person let go
    const waypoint = (i: number): XY => {
        const p = WAYPOINTS[i % WAYPOINTS.length]!;
        // On a narrow screen the stops close in so the whole formation stays in view
        const side = Math.min(stage.w / 2, variant.reach * step + 10);
        return {
            x: Math.min(stage.w - side, Math.max(side, p.x * stage.w)),
            y: p.y * stage.open,
        };
    };

    function readColors() {
        const css = getComputedStyle(document.documentElement);
        colors = {
            dot: css.getPropertyValue("--color-accent").trim() || "#6442ff",
            line: css.getPropertyValue("--color-stroke").trim() || colors.line,
        };
    }

    function measure() {
        const box = section.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        stage.w = box.width;
        stage.h = box.height;
        // The screenshots sit over the canvas: the open area ends where the first one starts
        const shot = section.querySelector("img");
        stage.open = shot
            ? Math.max(200, shot.getBoundingClientRect().top - box.top)
            : box.height;
        canvas.width = Math.round(box.width * dpr);
        canvas.height = Math.round(box.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        step = variant.stepFor(stage.w);
        if (!stage.steered) stage.cursor = waypoint(leg);
        legFrom = { ...stage.cursor };
        variant.setup(stage, step);
    }

    function draw() {
        ctx.clearRect(0, 0, stage.w, stage.h);
        variant.under?.(ctx, stage, colors.line);
        const r = Math.max(1.6, step * 0.34);
        ctx.fillStyle = colors.dot;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        for (const m of variant.marchers()) {
            ctx.moveTo(m.x + r, m.y);
            ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    function autopilot(dt: number) {
        legTime += dt;
        if (legTime >= GLIDE + REST) {
            legTime = 0;
            legFrom = { ...stage.cursor };
            leg++;
        }
        const to = waypoint(leg);
        const t = ease(Math.min(1, legTime / GLIDE));
        // A shallow curve, not a straight slide
        const bow = Math.sin(t * Math.PI) * 0.12;
        stage.cursor = {
            x: legFrom.x + (to.x - legFrom.x) * t - (to.y - legFrom.y) * bow,
            y: legFrom.y + (to.y - legFrom.y) * t + (to.x - legFrom.x) * bow,
        };
    }

    let last: XY = { x: 0, y: 0 };
    function tick(dt: number) {
        stage.time += dt;
        if (!stage.steered) {
            released += dt;
            if (released >= HAND_BACK) autopilot(dt);
        }
        const moved = Math.hypot(
            stage.cursor.x - last.x,
            stage.cursor.y - last.y,
        );
        stage.still =
            moved > 0.5 * Math.max(dt * 60, 0.2) ? 0 : stage.still + dt;
        last = { ...stage.cursor };
        variant.advance(stage, dt);
    }

    // --- Reduced motion: one still frame, nothing listening but resize and theme ---
    function poseStill() {
        stage.cursor = waypoint(0);
        variant.pose(stage);
        draw();
    }

    // --- The pointer ---
    const local = (e: PointerEvent): XY & { inside: boolean } => {
        const box = section.getBoundingClientRect();
        const x = e.clientX - box.left;
        const y = e.clientY - box.top;
        return {
            x,
            y,
            inside: x >= 0 && y >= 0 && x <= box.width && y <= box.height,
        };
    };
    function letGo() {
        if (!stage.steered) return;
        stage.steered = false;
        released = 0;
        // The autopilot carries on from here to its next stop
        legFrom = { ...stage.cursor };
        legTime = 0;
        leg++;
    }
    let touchStart: XY | null = null;
    const onMove = (e: PointerEvent) => {
        const p = local(e);
        if (e.pointerType === "touch" && !touchStart) return;
        if (!p.inside) return letGo();
        stage.cursor = { x: p.x, y: p.y };
        stage.steered = true;
    };
    const onDown = (e: PointerEvent) => {
        const p = local(e);
        if (!p.inside) return;
        if (e.pointerType === "touch") touchStart = { x: p.x, y: p.y };
        else stage.clicks++;
        stage.cursor = { x: p.x, y: p.y };
        stage.steered = true;
    };
    const onUp = (e: PointerEvent) => {
        if (e.pointerType !== "touch") return;
        const p = local(e);
        // A tap (not the start of a scroll) also asks for the next shape
        if (
            touchStart &&
            e.type === "pointerup" &&
            Math.hypot(p.x - touchStart.x, p.y - touchStart.y) < 12
        )
            stage.clicks++;
        touchStart = null;
        letGo();
    };

    // --- The loop: only while the hero is on screen and the tab is showing ---
    let frame = 0;
    let before = 0;
    let onScreen = true;
    const stats = { frames: 0, ms: 0, max: 0, since: 0 };
    function loop(now: number) {
        frame = 0;
        const dt = Math.min(0.05, (now - before) / 1000);
        before = now;
        const t0 = performance.now();
        tick(dt);
        draw();
        const ms = performance.now() - t0;
        if (stats.frames === 0) stats.since = now;
        stats.frames++;
        stats.ms += ms;
        stats.max = Math.max(stats.max, ms);
        schedule();
    }
    function schedule() {
        if (frame || options.manual || reduced.matches) return;
        if (!onScreen || document.hidden) return;
        frame = requestAnimationFrame((now) => {
            if (!before || now - before > 250) before = now - 16;
            loop(now);
        });
    }

    const listeners = new AbortController();
    const { signal } = listeners;
    const passive = { passive: true, signal } as const;
    function listen() {
        window.addEventListener("pointermove", onMove, passive);
        window.addEventListener("pointerdown", onDown, passive);
        window.addEventListener("pointerup", onUp, passive);
        window.addEventListener("pointercancel", onUp, passive);
        document.addEventListener("mouseleave", letGo, passive);
        document.addEventListener("visibilitychange", schedule, passive);
    }

    const watcher = new IntersectionObserver(([entry]) => {
        onScreen = entry?.isIntersecting ?? true;
        schedule();
    });
    const sizeWatcher = new ResizeObserver(() => {
        measure();
        if (reduced.matches) poseStill();
        else if (options.manual) draw();
    });
    const themeWatcher = new MutationObserver(() => {
        readColors();
        if (reduced.matches) poseStill();
    });

    readColors();
    measure();
    themeWatcher.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "data-theme"],
    });
    sizeWatcher.observe(section);
    if (reduced.matches) {
        poseStill();
    } else {
        listen();
        watcher.observe(section);
        schedule();
    }

    return {
        advance(dt) {
            tick(dt);
            draw();
        },
        perf() {
            const seconds = (performance.now() - stats.since) / 1000;
            return {
                frames: stats.frames,
                meanMs: stats.frames ? stats.ms / stats.frames : 0,
                maxMs: stats.max,
                fps: seconds > 0 ? stats.frames / seconds : 0,
            };
        },
        resetPerf() {
            stats.frames = 0;
            stats.ms = 0;
            stats.max = 0;
        },
        stop() {
            listeners.abort();
            watcher.disconnect();
            sizeWatcher.disconnect();
            themeWatcher.disconnect();
            if (frame) cancelAnimationFrame(frame);
        },
    };
}
