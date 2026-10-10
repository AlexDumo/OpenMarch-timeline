// cspell:words lerp
import type { XY } from "../types";

export const xy = (x: number, y: number): XY => ({ x, y });
export const add = (a: XY, b: XY): XY => xy(a.x + b.x, a.y + b.y);
export const sub = (a: XY, b: XY): XY => xy(a.x - b.x, a.y - b.y);
export const scale = (a: XY, k: number): XY => xy(a.x * k, a.y * k);
export const dot = (a: XY, b: XY): number => a.x * b.x + a.y * b.y;
export const cross = (a: XY, b: XY): number => a.x * b.y - a.y * b.x;
export const len = (a: XY): number => Math.hypot(a.x, a.y);
export const dist = (a: XY, b: XY): number => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: XY, b: XY): XY => xy((a.x + b.x) / 2, (a.y + b.y) / 2);
export const lerp = (a: XY, b: XY, t: number): XY =>
    xy(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
/** Unit vector, or (1, 0) for a zero vector */
export const unit = (a: XY): XY => {
    const l = len(a);
    return l === 0 ? xy(1, 0) : xy(a.x / l, a.y / l);
};
/** `a` turned 90° counterclockwise in math axes (clockwise on the canvas, whose y points down) */
export const perp = (a: XY): XY => xy(-a.y, a.x);
export const polar = (center: XY, r: number, angle: number): XY =>
    xy(center.x + r * Math.cos(angle), center.y + r * Math.sin(angle));
export const centroid = (points: readonly XY[]): XY => {
    let x = 0;
    let y = 0;
    for (const p of points) {
        x += p.x;
        y += p.y;
    }
    const n = Math.max(points.length, 1);
    return xy(x / n, y / n);
};

/** `to` moved so the direction from `from` is a multiple of `stepRad` */
export function snapAngle(from: XY, to: XY, stepRad: number): XY {
    const d = sub(to, from);
    const angle = Math.round(Math.atan2(d.y, d.x) / stepRad) * stepRad;
    return polar(from, len(d), angle);
}
