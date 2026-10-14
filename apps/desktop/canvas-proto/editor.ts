/**
 * PROTOTYPE. The editor: time, playback, selection, gestures and undo, on top
 * of FieldScene. Plain TypeScript with no React, so playback and drags never
 * go through a React render; React only draws the chrome (toolbar, overlay)
 * from `version` notifications.
 *
 * Edits are in-memory offsets per page (`deltas`), added to the show's own
 * positions. Between pages the offset blends linearly from the previous
 * page's to the next page's, so edited pages play back. Nothing is saved.
 */
import type { ShowSource } from "./source";
import { FieldScene } from "./render/scene";

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rot";

export interface Box {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

type Gesture =
    | { kind: "pan"; lastX: number; lastY: number }
    | {
          kind: "marquee";
          x0: number;
          y0: number;
          x1: number;
          y1: number;
          base: Uint8Array;
      }
    | {
          kind: "transform";
          mode: "move" | Handle;
          startField: [number, number];
          startPos: Float64Array;
          startDelta: Float64Array;
          before: Float64Array | null;
          box: Box;
          grabbed: number;
          moved: boolean;
      };

interface UndoEntry {
    page: number;
    before: Float64Array | null;
    after: Float64Array | null;
}

export interface FrameStats {
    frames: number;
    seconds: number;
    fps: number;
    intervalP50: number;
    intervalP95: number;
    intervalMax: number;
    /** Frames that took longer than 1.5 × the median interval. */
    jank: number;
    cpuAvg: number;
    cpuP95: number;
    cpuMax: number;
    gpuAvg: number | null;
    drawCalls: number;
}

const HANDLE_PX = 6;
const ROT_OFFSET_PX = 26;

const pct = (sorted: number[], p: number) =>
    sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;

export class Editor {
    readonly scene: FieldScene;
    source: ShowSource | null = null;
    time = 0;
    playing = false;
    private playStartTime = 0;
    private playStartNow = 0;
    private base = new Float64Array(0);
    display = new Float64Array(0);
    private deltas: (Float64Array | null)[] = [];
    selected: Uint8Array = new Uint8Array(0);
    selectedCount = 0;
    private undoStack: UndoEntry[] = [];
    private redoStack: UndoEntry[] = [];
    gesture: Gesture | null = null;
    private spaceHeld = false;

    private positionsDirty = true;
    private pathsDirty = true;
    private frameScheduled = false;
    private lastNotify = 0;
    version = 0;
    private listeners = new Set<() => void>();

    // Frame timing
    private recording = false;
    private intervals: number[] = [];
    private cpu: number[] = [];
    private gpu: number[] = [];
    private lastFrameAt = 0;
    private continuous: ((now: number, dt: number) => boolean) | null = null;
    lastCpuMs = 0;
    fpsDisplay = 0;
    private fpsWindow: number[] = [];

    constructor(readonly container: HTMLElement, canvas: HTMLCanvasElement, opts: { antialias: boolean; dprCap: number }) {
        this.scene = new FieldScene(canvas, opts);
        this.attachInput();
        const ro = new ResizeObserver(() => {
            const r = container.getBoundingClientRect();
            this.scene.resize(r.width, r.height);
            this.invalidate(true);
        });
        ro.observe(container);
    }

    // ----- show and time -----

    setShow(source: ShowSource) {
        this.stop();
        this.source = source;
        this.scene.setShow(source);
        this.base = new Float64Array(source.count * 2);
        this.display = new Float64Array(source.count * 2);
        this.deltas = source.pages.map(() => null);
        this.prev = null;
        this.prevDirty = true;
        this.selected = new Uint8Array(source.count);
        this.selectedCount = 0;
        this.undoStack = [];
        this.redoStack = [];
        this.scene.setSelected(this.selected);
        const r = this.container.getBoundingClientRect();
        this.scene.resize(r.width, r.height);
        this.fitField();
        this.goToPage(Math.min(1, source.pages.length - 1));
    }

    fitField() {
        const f = this.source?.field;
        if (!f) return;
        this.scene.view.fit(-60, -40, f.width + 60, f.height + 40);
        this.invalidate(false);
    }

    get pageTimes() {
        return this.source?.pages.map((p) => p.timeMs) ?? [];
    }

    /** The page whose positions are showing, or -1 between pages. */
    get pageIndex(): number {
        const pages = this.source?.pages ?? [];
        return pages.findIndex((p) => Math.abs(p.timeMs - this.time) < 0.5);
    }

    /** The page the playhead is in (for the readout), even between pages. */
    get pageAtTime(): number {
        const pages = this.source?.pages ?? [];
        let k = 0;
        for (let i = 0; i < pages.length; i++) if (pages[i].timeMs <= this.time + 0.5) k = i;
        return k;
    }

    get editable() {
        return !this.playing && this.pageIndex >= 0;
    }

    goToPage(k: number) {
        const pages = this.source?.pages;
        if (!pages?.length) return;
        k = Math.max(0, Math.min(pages.length - 1, k));
        this.seek(pages[k].timeMs);
    }

    seek(ms: number) {
        this.time = Math.max(0, Math.min(this.source?.durationMs ?? 0, ms));
        this.invalidate(true);
        this.pathsDirty = true;
        this.prevDirty = true;
    }

    play() {
        if (!this.source || this.playing) return;
        if (this.time >= this.source.durationMs - 1) this.time = 0;
        this.playing = true;
        this.playStartTime = this.time;
        this.playStartNow = performance.now();
        this.pathsDirty = true;
        this.runContinuous((now) => {
            if (!this.playing || !this.source) return false;
            this.time = this.playStartTime + (now - this.playStartNow);
            if (this.time >= this.source.durationMs) {
                this.time = this.source.durationMs;
                this.playing = false;
            }
            this.positionsDirty = true;
            return this.playing;
        });
        this.notify(true);
    }

    stop() {
        if (!this.playing) return;
        this.playing = false;
        this.continuous = null;
        this.pathsDirty = true;
        this.invalidate(true);
    }

    togglePlay() {
        if (this.playing) this.stop();
        else this.play();
    }

    // ----- positions -----

    /** Show positions plus edits at `ms`, into `out`. */
    private positionsAt(ms: number, out: Float64Array) {
        const src = this.source!;
        src.positionsAt(ms, out);
        const pages = src.pages;
        let k = pages.findIndex((p) => p.timeMs >= ms - 0.5);
        if (k < 0) k = pages.length - 1;
        const dk = this.deltas[k];
        if (Math.abs(pages[k].timeMs - ms) < 0.5 || k === 0) {
            if (dk) for (let i = 0; i < out.length; i++) out[i] += dk[i];
            return;
        }
        const dp = this.deltas[k - 1];
        if (!dk && !dp) return;
        const t0 = pages[k - 1].timeMs;
        const f = (ms - t0) / (pages[k].timeMs - t0);
        for (let i = 0; i < out.length; i++)
            out[i] += (dp ? dp[i] * (1 - f) : 0) + (dk ? dk[i] * f : 0);
    }

    /** Previous page's positions, recomputed only when the page or its edits change. */
    private prev: Float64Array | null = null;
    private prevPage = -2;
    private prevDirty = true;

    private updatePaths() {
        const k = this.pageIndex;
        if (this.playing || k <= 0) {
            this.scene.setGhostPositions(null);
            this.scene.setPathways(null, null);
            this.prevPage = -2;
            return;
        }
        if (this.prevPage !== k || this.prevDirty || !this.prev) {
            this.prev ??= new Float64Array(this.display.length);
            if (this.prev.length !== this.display.length)
                this.prev = new Float64Array(this.display.length);
            this.positionsAt(this.source!.pages[k - 1].timeMs, this.prev);
            this.scene.setGhostPositions(this.prev);
            this.prevPage = k;
            this.prevDirty = false;
        }
        this.scene.setPathways(this.prev, this.display);
    }

    // ----- frame loop -----

    /** Draws one frame soon. */
    invalidate(positions: boolean) {
        if (positions) this.positionsDirty = true;
        if (this.frameScheduled) return;
        this.frameScheduled = true;
        requestAnimationFrame((now) => this.frame(now));
    }

    private runContinuous(step: (now: number, dt: number) => boolean) {
        this.continuous = step;
        this.lastFrameAt = 0;
        this.invalidate(true);
    }

    private frame(now: number) {
        this.frameScheduled = false;
        if (!this.source) return;
        const t0 = performance.now();
        const dt = this.lastFrameAt ? now - this.lastFrameAt : 0;
        let keepGoing = false;
        if (this.continuous) {
            keepGoing = this.continuous(now, dt);
            if (!keepGoing) this.continuous = null;
        }
        if (this.positionsDirty) {
            this.positionsAt(this.time, this.display);
            this.scene.setPositions(this.display);
            this.positionsDirty = false;
        }
        if (this.pathsDirty) {
            this.updatePaths();
            this.pathsDirty = false;
        }
        this.scene.render();
        const cpu = performance.now() - t0;
        this.lastCpuMs = cpu;
        if (this.lastFrameAt) {
            this.fpsWindow.push(dt);
            if (this.fpsWindow.length > 60) this.fpsWindow.shift();
            const avg = this.fpsWindow.reduce((a, b) => a + b, 0) / this.fpsWindow.length;
            this.fpsDisplay = 1000 / avg;
            if (this.recording) {
                this.intervals.push(dt);
                this.cpu.push(cpu);
                if (this.scene.gpuMs !== null) this.gpu.push(this.scene.gpuMs);
            }
        }
        this.lastFrameAt = keepGoing ? now : 0;
        if (!keepGoing) this.fpsWindow = [];
        if (keepGoing) this.invalidate(false);
        this.notify(false);
    }

    // ----- notifications for React -----

    subscribe = (fn: () => void) => {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    };

    getVersion = () => this.version;

    /** Tells React something changed; throttled to ~8 Hz while playing. */
    notify(force: boolean) {
        const now = performance.now();
        if (!force && this.continuous && now - this.lastNotify < 120) return;
        this.lastNotify = now;
        this.version++;
        for (const fn of this.listeners) fn();
    }

    // ----- selection -----

    private setSelection(sel: Uint8Array) {
        this.selected = sel;
        let n = 0;
        for (let i = 0; i < sel.length; i++) n += sel[i];
        this.selectedCount = n;
        this.scene.setSelected(sel);
        this.invalidate(false);
        this.notify(true);
    }

    selectAll() {
        this.setSelection(new Uint8Array(this.selected.length).fill(1));
    }

    clearSelection() {
        this.setSelection(new Uint8Array(this.selected.length));
    }

    selectionBox(): Box | null {
        if (!this.selectedCount) return null;
        const d = this.display;
        let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity;
        for (let i = 0; i < this.selected.length; i++) {
            if (!this.selected[i]) continue;
            const x = d[i * 2];
            const y = d[i * 2 + 1];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        const pad = 8;
        return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
    }

    /** Handle positions in screen pixels for the current selection box. */
    handlePoints(box: Box): Record<Handle, [number, number]> {
        const v = this.scene.view;
        const [x0, y0] = v.fieldToScreen(box.minX, box.minY);
        const [x1, y1] = v.fieldToScreen(box.maxX, box.maxY);
        const mx = (x0 + x1) / 2;
        const my = (y0 + y1) / 2;
        return {
            nw: [x0, y0],
            n: [mx, y0],
            ne: [x1, y0],
            e: [x1, my],
            se: [x1, y1],
            s: [mx, y1],
            sw: [x0, y1],
            w: [x0, my],
            rot: [mx, y0 - ROT_OFFSET_PX],
        };
    }

    /** Linear scan: at 2000 marchers this is ~10 µs, no spatial index needed. */
    private hitMarcher(fx: number, fy: number): number {
        const d = this.display;
        const r = Math.max(6, 6 / this.scene.view.zoom);
        let best = -1;
        let bestD = r * r;
        for (let i = 0; i < d.length / 2; i++) {
            const dx = d[i * 2] - fx;
            const dy = d[i * 2 + 1] - fy;
            const dd = dx * dx + dy * dy;
            if (dd <= bestD) {
                bestD = dd;
                best = i;
            }
        }
        return best;
    }

    private hitHandle(sx: number, sy: number): Handle | null {
        const box = this.selectionBox();
        if (!box || this.selectedCount < 2) return null;
        const pts = this.handlePoints(box);
        for (const h of Object.keys(pts) as Handle[]) {
            const [hx, hy] = pts[h];
            if (Math.abs(hx - sx) <= HANDLE_PX + 2 && Math.abs(hy - sy) <= HANDLE_PX + 2) return h;
        }
        return null;
    }

    // ----- editing -----

    private deltaFor(page: number): Float64Array {
        let d = this.deltas[page];
        if (!d) {
            d = new Float64Array(this.display.length);
            this.deltas[page] = d;
        }
        return d;
    }

    private beginTransform(mode: "move" | Handle, sx: number, sy: number, grabbed: number) {
        const page = this.pageIndex;
        const field = this.scene.view.screenToField(sx, sy);
        this.gesture = {
            kind: "transform",
            mode,
            startField: field,
            startPos: this.display.slice(),
            before: this.deltas[page]?.slice() ?? null,
            startDelta: this.deltaFor(page).slice(),
            box: this.selectionBox()!,
            grabbed,
            moved: false,
        };
    }

    /** Applies a gesture's transform from its start state. */
    private applyTransform(fx: number, fy: number, free: boolean) {
        const g = this.gesture;
        if (!g || g.kind !== "transform" || !this.source) return;
        const field = this.source.field;
        const step = field.pixelsPerStep;
        const cf = field.centerFrontPoint;
        const sp = g.startPos;
        let map: (x: number, y: number) => [number, number];

        if (g.mode === "move") {
            let dx = fx - g.startField[0];
            let dy = fy - g.startField[1];
            if (!free) {
                // Snap the grabbed marcher to the step grid; the rest keep their spacing.
                const gx = sp[g.grabbed * 2] + dx;
                const gy = sp[g.grabbed * 2 + 1] + dy;
                dx = cf.xPixels + Math.round((gx - cf.xPixels) / step) * step - sp[g.grabbed * 2];
                dy = cf.yPixels + Math.round((gy - cf.yPixels) / step) * step - sp[g.grabbed * 2 + 1];
            }
            map = (x, y) => [x + dx, y + dy];
        } else if (g.mode === "rot") {
            const cx = (g.box.minX + g.box.maxX) / 2;
            const cy = (g.box.minY + g.box.maxY) / 2;
            let a =
                Math.atan2(fy - cy, fx - cx) -
                Math.atan2(g.startField[1] - cy, g.startField[0] - cx);
            if (free) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
            const c = Math.cos(a);
            const s = Math.sin(a);
            map = (x, y) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
        } else {
            const b = g.box;
            const h = g.mode;
            const ax = h.includes("w") ? b.maxX : h.includes("e") ? b.minX : (b.minX + b.maxX) / 2;
            const ay = h.includes("n") ? b.maxY : h.includes("s") ? b.minY : (b.minY + b.maxY) / 2;
            const hx = h.includes("w") ? b.minX : b.maxX;
            const hy = h.includes("n") ? b.minY : b.maxY;
            let sx = h === "n" || h === "s" ? 1 : (fx - ax) / (hx - ax || 1);
            let sy = h === "e" || h === "w" ? 1 : (fy - ay) / (hy - ay || 1);
            if (h.length === 2 && !free) {
                // Corners scale uniformly, like Fabric's default; Shift frees them.
                const vx = hx - ax;
                const vy = hy - ay;
                const s = ((fx - ax) * vx + (fy - ay) * vy) / (vx * vx + vy * vy || 1);
                sx = sy = s;
            }
            map = (x, y) => [ax + (x - ax) * sx, ay + (y - ay) * sy];
        }

        const delta = this.deltaFor(this.pageIndex);
        for (let i = 0; i < this.selected.length; i++) {
            if (!this.selected[i]) continue;
            const [nx, ny] = map(sp[i * 2], sp[i * 2 + 1]);
            delta[i * 2] = g.startDelta[i * 2] + (nx - sp[i * 2]);
            delta[i * 2 + 1] = g.startDelta[i * 2 + 1] + (ny - sp[i * 2 + 1]);
        }
        g.moved = true;
        this.pathsDirty = true;
        this.invalidate(true);
    }

    private commitTransform() {
        const g = this.gesture;
        if (!g || g.kind !== "transform" || !g.moved) return;
        const page = this.pageIndex;
        this.undoStack.push({ page, before: g.before, after: this.deltas[page]?.slice() ?? null });
        this.redoStack = [];
    }

    nudge(dx: number, dy: number) {
        if (!this.editable || !this.selectedCount || !this.source) return;
        const page = this.pageIndex;
        const before = this.deltas[page]?.slice() ?? null;
        const step = this.source.field.pixelsPerStep;
        const d = this.deltaFor(page);
        for (let i = 0; i < this.selected.length; i++) {
            if (!this.selected[i]) continue;
            d[i * 2] += dx * step;
            d[i * 2 + 1] += dy * step;
        }
        this.undoStack.push({ page, before, after: d.slice() });
        this.redoStack = [];
        this.pathsDirty = true;
        this.invalidate(true);
        this.notify(true);
    }

    undo() {
        const e = this.undoStack.pop();
        if (!e) return;
        this.deltas[e.page] = e.before?.slice() ?? null;
        this.prevDirty = true;
        this.redoStack.push(e);
        this.goToPage(e.page);
        this.notify(true);
    }

    redo() {
        const e = this.redoStack.pop();
        if (!e) return;
        this.deltas[e.page] = e.after?.slice() ?? null;
        this.prevDirty = true;
        this.undoStack.push(e);
        this.goToPage(e.page);
        this.notify(true);
    }

    get canUndo() {
        return this.undoStack.length > 0;
    }

    get canRedo() {
        return this.redoStack.length > 0;
    }

    // ----- input -----

    private local(e: { clientX: number; clientY: number }): [number, number] {
        const r = this.container.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
    }

    private attachInput() {
        const el = this.container;
        el.addEventListener("pointerdown", (e) => this.onPointerDown(e));
        el.addEventListener("pointermove", (e) => this.onPointerMove(e));
        el.addEventListener("pointerup", (e) => this.onPointerUp(e));
        el.addEventListener("pointercancel", (e) => this.onPointerUp(e));
        el.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
        window.addEventListener("keydown", (e) => this.onKey(e));
        window.addEventListener("keyup", (e) => {
            if (e.code === "KeyH") this.spaceHeld = false;
        });
    }

    private onPointerDown(e: PointerEvent) {
        if (!this.source) return;
        this.container.setPointerCapture(e.pointerId);
        const [sx, sy] = this.local(e);
        if (e.button === 1 || (e.button === 0 && (e.altKey || this.spaceHeld))) {
            this.gesture = { kind: "pan", lastX: sx, lastY: sy };
            this.container.style.cursor = "grabbing";
            return;
        }
        if (e.button !== 0) return;
        const [fx, fy] = this.scene.view.screenToField(sx, sy);
        if (this.editable) {
            const handle = this.hitHandle(sx, sy);
            if (handle) {
                this.beginTransform(handle, sx, sy, -1);
                return;
            }
        }
        const hit = this.hitMarcher(fx, fy);
        if (hit >= 0) {
            const sel = this.selected.slice();
            if (e.shiftKey) sel[hit] = sel[hit] ? 0 : 1;
            else if (!sel[hit]) {
                sel.fill(0);
                sel[hit] = 1;
            }
            this.setSelection(sel);
            if (sel[hit] && this.editable) this.beginTransform("move", sx, sy, hit);
            return;
        }
        const base = e.shiftKey ? this.selected.slice() : new Uint8Array(this.selected.length);
        if (!e.shiftKey) this.setSelection(base.slice());
        this.gesture = { kind: "marquee", x0: fx, y0: fy, x1: fx, y1: fy, base };
    }

    private onPointerMove(e: PointerEvent) {
        const [sx, sy] = this.local(e);
        const g = this.gesture;
        if (!g) {
            this.updateHoverCursor(sx, sy);
            return;
        }
        if (g.kind === "pan") {
            this.scene.view.panBy(sx - g.lastX, sy - g.lastY);
            g.lastX = sx;
            g.lastY = sy;
            this.invalidate(false);
            this.notify(true);
            return;
        }
        const [fx, fy] = this.scene.view.screenToField(sx, sy);
        if (g.kind === "marquee") {
            g.x1 = fx;
            g.y1 = fy;
            const minX = Math.min(g.x0, g.x1);
            const maxX = Math.max(g.x0, g.x1);
            const minY = Math.min(g.y0, g.y1);
            const maxY = Math.max(g.y0, g.y1);
            const sel = g.base.slice();
            const d = this.display;
            for (let i = 0; i < sel.length; i++) {
                const x = d[i * 2];
                const y = d[i * 2 + 1];
                if (x >= minX && x <= maxX && y >= minY && y <= maxY) sel[i] = 1;
            }
            this.setSelection(sel);
            return;
        }
        this.applyTransform(fx, fy, e.shiftKey);
        this.notify(true);
    }

    private onPointerUp(e: PointerEvent) {
        const g = this.gesture;
        if (g?.kind === "transform") this.commitTransform();
        this.gesture = null;
        this.container.style.cursor = "";
        if (this.container.hasPointerCapture(e.pointerId))
            this.container.releasePointerCapture(e.pointerId);
        this.notify(true);
    }

    private updateHoverCursor(sx: number, sy: number) {
        const cursors: Record<Handle, string> = {
            nw: "nwse-resize",
            se: "nwse-resize",
            ne: "nesw-resize",
            sw: "nesw-resize",
            n: "ns-resize",
            s: "ns-resize",
            e: "ew-resize",
            w: "ew-resize",
            rot: "grab",
        };
        if (this.spaceHeld) {
            this.container.style.cursor = "grab";
            return;
        }
        const h = this.editable ? this.hitHandle(sx, sy) : null;
        if (h) {
            this.container.style.cursor = cursors[h];
            return;
        }
        const [fx, fy] = this.scene.view.screenToField(sx, sy);
        this.container.style.cursor = this.hitMarcher(fx, fy) >= 0 ? "move" : "";
    }

    private onWheel(e: WheelEvent) {
        e.preventDefault();
        const [sx, sy] = this.local(e);
        const v = this.scene.view;
        const lines = e.deltaMode === 1 ? 33 : 1;
        if (e.ctrlKey || e.metaKey) {
            // Trackpad pinch (Ctrl+wheel) or Ctrl+mouse wheel
            v.zoomAt(sx, sy, Math.exp(-e.deltaY * lines * 0.01));
        } else if (e.deltaX !== 0 || !Number.isInteger(e.deltaY) || e.shiftKey) {
            // Two-finger trackpad scroll pans
            v.panBy(-e.deltaX * lines, -e.deltaY * lines);
        } else {
            // A mouse wheel zooms at the cursor
            v.zoomAt(sx, sy, Math.exp(-e.deltaY * lines * 0.0015));
        }
        this.invalidate(false);
        this.notify(true);
    }

    private onKey(e: KeyboardEvent) {
        if ((e.target as HTMLElement)?.closest?.("input, select, textarea")) return;
        const mod = e.ctrlKey || e.metaKey;
        if (e.code === "KeyH") {
            this.spaceHeld = true;
            return;
        }
        if (e.code === "Space") {
            e.preventDefault();
            this.togglePlay();
        } else if (e.code === "KeyQ" || e.code === "BracketLeft") {
            this.stop();
            this.goToPage(this.pageIndex >= 0 ? this.pageIndex - 1 : this.pageAtTime);
            this.notify(true);
        } else if (e.code === "KeyE" || e.code === "BracketRight") {
            this.stop();
            this.goToPage((this.pageIndex >= 0 ? this.pageIndex : this.pageAtTime) + 1);
            this.notify(true);
        } else if (mod && e.code === "KeyZ") {
            e.preventDefault();
            if (e.shiftKey) this.redo();
            else this.undo();
        } else if (mod && e.code === "KeyY") {
            e.preventDefault();
            this.redo();
        } else if (mod && e.code === "KeyA") {
            e.preventDefault();
            this.selectAll();
        } else if (e.code === "Escape") {
            this.clearSelection();
        } else if (e.code === "KeyF") {
            this.fitField();
            this.notify(true);
        } else if (e.key.startsWith("Arrow")) {
            e.preventDefault();
            const n = e.shiftKey ? 4 : 1;
            const [dx, dy] =
                e.key === "ArrowLeft" ? [-n, 0] : e.key === "ArrowRight" ? [n, 0] : e.key === "ArrowUp" ? [0, -n] : [0, n];
            this.nudge(dx, dy);
        }
    }

    // ----- benchmarks -----

    /**
     * Runs a scripted scenario for `ms` and returns frame statistics, measured
     * in the page (rAF intervals, CPU time per frame, GPU timer queries).
     */
    async bench(kind: "play" | "scrub" | "zoom" | "pan" | "drag" | "render", ms = 5000): Promise<FrameStats> {
        if (!this.source) throw new Error("no show");
        this.stop();
        const v = this.scene.view;
        const startZoom = v.zoom;
        const start = performance.now();
        if (kind === "drag") {
            this.goToPage(Math.min(2, this.source.pages.length - 1));
            this.selectAll();
        }
        await new Promise((r) => requestAnimationFrame(r));
        let dragStarted = false;
        let lastZoomPhase = 0;
        const done = new Promise<void>((resolve) => {
            this.recording = true;
            this.intervals = [];
            this.cpu = [];
            this.gpu = [];
            const t0 = performance.now();
            if (kind === "play") {
                this.time = this.source!.pages[0].timeMs;
            }
            this.runContinuous((now) => {
                const t = now - t0;
                const src = this.source!;
                if (kind === "play") {
                    this.time = (src.pages[0].timeMs + t) % src.durationMs;
                    this.positionsDirty = true;
                } else if (kind === "scrub") {
                    // Back and forth across the whole show, like a fast playhead drag.
                    const phase = (t / ms) * 2;
                    const f = phase <= 1 ? phase : 2 - phase;
                    this.time = f * src.durationMs;
                    this.positionsDirty = true;
                } else if (kind === "zoom") {
                    const z = startZoom * Math.pow(8, (1 - Math.cos((t / 1500) * Math.PI)) / 2);
                    v.zoomAt(v.width / 2, v.height / 2, z / v.zoom);
                    lastZoomPhase = z;
                } else if (kind === "pan") {
                    v.panBy(Math.cos(t / 400) * 12, Math.sin(t / 400) * 6);
                } else if (kind === "drag") {
                    const [cx, cy] = [v.width / 2, v.height / 2];
                    if (!dragStarted) {
                        this.beginTransform("move", cx, cy, 0);
                        dragStarted = true;
                    }
                    const [fx, fy] = v.screenToField(cx + Math.sin(t / 300) * 120, cy + Math.cos(t / 300) * 60);
                    this.applyTransform(fx, fy, false);
                    // A real drag re-renders the React overlay on every pointer move.
                    this.notify(true);
                }
                if (t >= ms) {
                    resolve();
                    return false;
                }
                return true;
            });
        });
        await done;
        this.recording = false;
        if (kind === "drag") {
            this.commitTransform();
            this.gesture = null;
            this.undo();
            this.clearSelection();
        }
        if (kind === "zoom") {
            v.zoom = startZoom;
            v.update();
            void lastZoomPhase;
        }
        this.invalidate(true);
        // Skip warm-up frames (shader compiles, first uploads).
        const iv = this.intervals.slice(5).sort((a, b) => a - b);
        const cpu = this.cpu.slice(5).sort((a, b) => a - b);
        const med = pct(iv, 0.5);
        const seconds = (performance.now() - start) / 1000;
        return {
            frames: iv.length,
            seconds,
            fps: iv.length / (iv.reduce((a, b) => a + b, 0) / 1000 || 1),
            intervalP50: med,
            intervalP95: pct(iv, 0.95),
            intervalMax: iv[iv.length - 1] ?? 0,
            jank: iv.filter((x) => x > med * 1.5).length,
            cpuAvg: cpu.reduce((a, b) => a + b, 0) / (cpu.length || 1),
            cpuP95: pct(cpu, 0.95),
            cpuMax: cpu[cpu.length - 1] ?? 0,
            gpuAvg: this.gpu.length ? this.gpu.reduce((a, b) => a + b, 0) / this.gpu.length : null,
            drawCalls: this.scene.drawCalls,
        };
    }
}
