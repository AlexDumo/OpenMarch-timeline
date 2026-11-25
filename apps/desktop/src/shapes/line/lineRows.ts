import tolgee from "@/global/singletons/Tolgee";
import { COUNT_RATE, scrubValue, spacingRate } from "../editor/scrub";
import { formatSignedSteps, formatSteps, parseSteps } from "../editor/format";
import type {
    RowsView,
    RowView,
    ToolChoice,
    ToolChoicePicture,
    ToolChoicePictureLine,
    ToolEnv,
    ToolKind,
    ToolParam,
    ToolRows,
} from "../tool/toolKind";
import type { ShapeContext, ShapeKind, Slot, XY } from "../types";
import {
    MAX_ROWS,
    pickRow,
    resolveCounts,
    rowsOf,
    type LineRow,
    type LineRows,
    type RowsGo,
} from "./rowsParams";
import {
    bends,
    lineInterval,
    lineOutline,
    type LineParams,
} from "./lineGeometry";
import { lineFillSpots } from "./lineFill";

/**
 * Rows of a Line, Curve or Arc (spec #1190): the selected marchers split into rows alongside the
 * drawn line, one shape. The kind itself knows nothing of them: {@link withRows} hands it the
 * drawn row's own spot count wherever the host gives the whole shape's, so its numbers, handles
 * and spacing read the drawn line, and lays every row out from the drawn line's spots, at its
 * spacing, across it in its own frame: the rows turn and bend with it. Pure.
 */

type P = LineParams;

const add = (a: XY, b: XY): XY => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: XY, b: XY): XY => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: XY, k: number): XY => ({ x: a.x * k, y: a.y * k });
const dot = (a: XY, b: XY) => a.x * b.x + a.y * b.y;

/** How far apart a first row starts from the line: 2 steps, the usual gap between ranks */
const FIRST_STEPS = 2;

// ── The line's own frame ────────────────────────────────────────────────────────────────

/**
 * The line's frame: `along` its own way (first point to last), `left` its left-hand side walking
 * it (the field's y runs toward the front sideline), and `sign`: +1 when its left-hand side is
 * behind (or to the left, as the audience sees it) and its own way is to the right (or toward the
 * back), −1 when both are the other way. Rows across the field (closer to side to side than front
 * to back) are named behind and in front, up and down it left and right. `step` is the way one row
 * moves from the one before it in the list ({@link LineRows.go}): the line's left-hand side when
 * the rows slide it, straight back or forward when they go front to back (behind and in front
 * whatever the line's slope), straight left or right side to side (left and right), each on the
 * left-hand side's side of the field; null when they follow the line, square to it wherever it is.
 */
export function rowFrame(p: P): {
    along: XY;
    left: XY;
    sign: 1 | -1;
    words: "across" | "upDown";
    step: XY | null;
} {
    const outline = lineOutline(p);
    const d = sub(outline[outline.length - 1]!, outline[0]!);
    const len = Math.hypot(d.x, d.y);
    const along = len > 1e-9 ? scale(d, 1 / len) : { x: 1, y: 0 };
    const left = { x: along.y, y: -along.x };
    const go = rowsOf(p)?.go;
    if (go === "back") {
        const behind = left.y <= 0;
        return {
            along,
            left,
            sign: behind ? 1 : -1,
            words: "across",
            step: { x: 0, y: behind ? -1 : 1 },
        };
    }
    if (go === "side") {
        const toLeft = left.x <= 0;
        return {
            along,
            left,
            sign: toLeft ? 1 : -1,
            words: "upDown",
            step: { x: toLeft ? -1 : 1, y: 0 },
        };
    }
    const across = Math.abs(along.x) >= Math.abs(along.y);
    const sign = (across ? along.x > 0 : along.y < 0) ? 1 : -1;
    return {
        along,
        left,
        sign,
        words: across ? "across" : "upDown",
        step: go === "follow" ? null : left,
    };
}

/**
 * The line's left-hand side where it passes nearest `point`, square to it there: at a corner, half
 * way between its two stretches'
 */
function normalNear(outline: readonly XY[], point: XY): XY {
    const normalOf = (i: number): XY => {
        const d = sub(outline[i + 1]!, outline[i]!);
        const len = Math.hypot(d.x, d.y);
        return len > 1e-9 ? { x: d.y / len, y: -d.x / len } : { x: 0, y: 0 };
    };
    let best = 0;
    let bestT = 0;
    let bestD = Infinity;
    for (let i = 0; i + 1 < outline.length; i++) {
        const a = outline[i]!;
        const d = sub(outline[i + 1]!, a);
        const len2 = dot(d, d);
        const t =
            len2 > 0
                ? Math.max(0, Math.min(1, dot(sub(point, a), d) / len2))
                : 0;
        const q = add(a, scale(d, t));
        const dist = Math.hypot(point.x - q.x, point.y - q.y);
        if (dist < bestD - 1e-9) {
            best = i;
            bestT = t;
            bestD = dist;
        }
    }
    let n = normalOf(best);
    const last = outline.length - 2;
    if (bestT < 1e-6 && best > 0) n = add(n, normalOf(best - 1));
    else if (bestT > 1 - 1e-6 && best < last) n = add(n, normalOf(best + 1));
    const len = Math.hypot(n.x, n.y);
    return len > 1e-9 ? scale(n, 1 / len) : { x: 0, y: -1 };
}

/**
 * Which way the rows step from the drawn line `t` spots along it ({@link at}): the frame's `step`,
 * or square to the line there when they follow it, past its ends as at them
 */
function stepAt(
    frame: { step: XY | null },
    base: readonly XY[],
    normals: readonly XY[] | null,
    t: number,
): XY {
    if (frame.step || !normals || normals.length === 0)
        return frame.step ?? { x: 0, y: -1 };
    const k = normals.length;
    if (k === 1 || t <= 0) return normals[0]!;
    if (t >= k - 1) return normals[k - 1]!;
    const i = Math.floor(t);
    const n = add(
        scale(normals[i]!, 1 - (t - i)),
        scale(normals[i + 1]!, t - i),
    );
    const len = Math.hypot(n.x, n.y);
    return len > 1e-9 ? scale(n, 1 / len) : normals[i]!;
}

/** The rows from the front (or the right) to the back (or the left) */
const frontToBack = (rows: LineRows, sign: 1 | -1): number[] => {
    const order = rows.list.map((_, i) => i);
    return sign === 1 ? order : order.reverse();
};

// ── Laying the rows out ─────────────────────────────────────────────────────────────────

/** One row laid out: where each of its spots is, and which hold a marcher */
export interface RowLayout {
    readonly index: number;
    /** Rows from the drawn line, + toward its left-hand side */
    readonly offset: number;
    readonly count: number;
    readonly spots: readonly Slot[];
    readonly filled: readonly boolean[];
}

/** A row's empty spots that fit in it, holding `count` marchers */
function emptiesOf(row: LineRow, count: number): number[] {
    // Each in order fits when it's short of the row's length with it: its marchers and the
    // empty spots so far
    const out: number[] = [];
    for (const e of row.empty ?? [])
        if (e < count + out.length + 1) out.push(e);
    return out;
}

/** Every row's marchers for `n`, and its spots, empty ones among them */
function rowSizes(p: P, rows: LineRows, n: number) {
    const { sign } = rowFrame(p);
    const counts = resolveCounts(rows, n, frontToBack(rows, sign));
    return rows.list.map((row, i) => {
        const empty = emptiesOf(row, counts[i]!);
        return {
            count: counts[i]!,
            empty,
            length: counts[i]! + empty.length,
        };
    });
}

/** The drawn row's spots, empty ones among them: the spot count the kind sees */
export function drawnSpots(p: P, n: number): number {
    const rows = rowsOf(p);
    if (!rows) return n;
    return rowSizes(p, rows, n)[rows.drawn]!.length;
}

/** The point `t` spots along `spots`, going on straight past either end */
function at(spots: readonly XY[], t: number): XY {
    const k = spots.length;
    if (k === 1) return spots[0]!;
    const i = Math.max(0, Math.min(k - 2, Math.floor(t)));
    const a = spots[i]!;
    const b = spots[i + 1]!;
    return add(a, scale(sub(b, a), t - i));
}

/**
 * Every row laid out for `n` marchers, the drawn one among them: each centered on the drawn line
 * at its spacing (going on straight past its ends), moved along by its own half spots and the
 * slant, and `apart` across it per row. `spotsOf` gives the drawn line's spots for a count.
 */
export function layRows(
    p: P,
    n: number,
    spotsOf: (k: number) => readonly Slot[] = (k) => lineFillSpots(p, k),
): RowLayout[] {
    const rows = rowsOf(p);
    if (!rows) {
        const spots = spotsOf(n);
        return [
            {
                index: 0,
                offset: 0,
                count: n,
                spots,
                filled: spots.map(() => true),
            },
        ];
    }
    const sizes = rowSizes(p, rows, n);
    const k = Math.max(2, sizes[rows.drawn]!.length);
    const base = spotsOf(k);
    let path = 0;
    for (let i = 1; i < base.length; i++)
        path += Math.hypot(
            base[i]!.x - base[i - 1]!.x,
            base[i]!.y - base[i - 1]!.y,
        );
    const interval = base.length > 1 ? path / (base.length - 1) : rows.apart;
    const frame = rowFrame(p);
    const outline = frame.step ? null : lineOutline(p);
    const normals = outline ? base.map((b) => normalNear(outline, b)) : null;
    return rows.list.map((row, index) => {
        const offset = index - rows.drawn;
        const { count, empty, length } = sizes[index]!;
        const start =
            (k - 1) / 2 -
            (length - 1) / 2 +
            (row.shift ?? 0) / 2 +
            (interval > 0 ? (offset * (rows.slant ?? 0)) / interval : 0);
        const spots: Slot[] = [];
        for (let j = 0; j < length; j++) {
            const t = start + j;
            const across = scale(
                stepAt(frame, base, normals, t),
                offset * rows.apart,
            );
            spots.push({ ...add(at(base, t), across), s: t * interval });
        }
        const filled = spots.map((_, j) => !empty.includes(j));
        return { index, offset, count, spots, filled };
    });
}

/** Whether `point` is within `reach` of the run through `spots` */
function nearRun(spots: readonly XY[], point: XY, reach: number): boolean {
    const near = (a: XY, b: XY) => {
        const d = sub(b, a);
        const len2 = dot(d, d);
        const t =
            len2 > 0
                ? Math.max(0, Math.min(1, dot(sub(point, a), d) / len2))
                : 0;
        const q = add(a, scale(d, t));
        return Math.hypot(point.x - q.x, point.y - q.y) <= reach;
    };
    if (spots.length === 1) return near(spots[0]!, spots[0]!);
    return spots.some((a, i) => i > 0 && near(spots[i - 1]!, a));
}

/**
 * The rows of a line just mirrored, back on the side of the field they were on. A mirror keeps
 * the line's points in order but swaps its left-hand side for its right, so the rows go in the
 * other order across it and lean the other way; their marchers, written down as they were
 * before (`before`), keep their rows.
 */
export function mirrorRows(before: P, p: P, n: number): P {
    const rows = rowsOf(p);
    if (!rows) return p;
    // Shared out evenly, which row is short goes by front and back, which a mirror may swap
    const counts =
        rows.list[0]?.count === undefined ? counted(before, rows, n) : null;
    const list = rows.list
        .map((row, i) => (counts ? { ...row, count: counts[i]! } : row))
        .reverse();
    return {
        ...p,
        rows: {
            ...rows,
            list,
            drawn: list.length - 1 - rows.drawn,
            ...(rows.slant ? { slant: -rows.slant } : {}),
        },
    };
}

// ── Editing the rows ────────────────────────────────────────────────────────────────────

/** `p` with `rows` set, or taken off when there's only the drawn line left, as drawn */
export function withRowsSet(p: P, rows: LineRows | undefined): P {
    // The drawn line alone sits on its own ends: a half spot left over from other rows would
    // push it past them, with no arrows left to bring it back
    if (rows?.list.length === 1 && rows.list[0]!.shift) {
        const { shift: _was, ...row } = rows.list[0]!;
        rows = { ...rows, list: [row] };
    }
    const plain =
        !rows || (rows.list.length === 1 && !rows.list[0]!.empty?.length);
    if (!plain) return { ...p, rows };
    if (p.rows === undefined) return p;
    const { rows: _gone, ...rest } = p;
    return rest;
}

/** The rows with every row's marchers written down: an edit's start */
function counted(p: P, rows: LineRows, n: number): number[] {
    return rowSizes(p, rows, n).map((s) => s.count);
}

const withCounts = (rows: LineRows, counts: readonly number[]): LineRows => ({
    ...rows,
    list: rows.list.map((row, i) => ({ ...row, count: counts[i]! })),
});

/** The rows of `p`, or the drawn line alone as one */
const rowsOrOne = (p: P, env: ToolEnv): LineRows =>
    rowsOf(p) ?? {
        list: [{}],
        drawn: 0,
        apart: FIRST_STEPS * env.stepPx,
    };

/**
 * One marcher moved into row `to` from the longest other row, or out of row `from` to the
 * shortest; null when no row can give one
 */
function moveOne(
    p: P,
    rows: LineRows,
    n: number,
    index: number,
    by: -1 | 1,
): LineRows | null {
    const counts = counted(p, rows, n);
    const order = frontToBack(rows, rowFrame(p).sign);
    const other =
        by === 1
            ? pickRow(counts, order, "longest", index, 1)
            : pickRow(counts, order, "shortest", index);
    if (other === null || (by === -1 && counts[index]! <= 1)) return null;
    counts[index]! += by;
    counts[other]! -= by;
    return withCounts(rows, counts);
}

/** Row `index` given `count` marchers, one at a time from or to the others */
function setCount(p: P, n: number, index: number, count: number): P | null {
    let rows = rowsOf(p);
    if (!rows || !Number.isInteger(count) || count < 1) return null;
    let now = counted(p, rows, n)[index]!;
    if (count === now) return p;
    const by = count > now ? 1 : -1;
    while (now !== count) {
        const next = moveOne(p, rows, n, index, by);
        if (!next) break;
        rows = next;
        now += by;
    }
    return withRowsSet(p, rows);
}

/** A new row on `side`, as many marchers as an even share taken from the longest rows */
function addRow(p: P, n: number, side: "far" | "near", env: ToolEnv): P | null {
    const rows = rowsOrOne(p, env);
    if (rows.list.length >= MAX_ROWS || n < rows.list.length + 1) return null;
    const { sign } = rowFrame(p);
    // The far side is the left-hand side when the line's frame agrees with the field's
    const atEnd = (side === "far") === (sign === 1);
    const list = atEnd ? [...rows.list, {}] : [{}, ...rows.list];
    const drawn = atEnd ? rows.drawn : rows.drawn + 1;
    let next: LineRows = { ...rows, list, drawn };
    if (rows.list[0]?.count !== undefined) {
        const counts = counted(p, rows, n);
        const fresh = atEnd ? list.length - 1 : 0;
        const all = atEnd ? [...counts, 0] : [0, ...counts];
        const order = frontToBack(next, sign);
        const want = Math.max(1, Math.floor(n / list.length));
        for (let i = 0; i < want; i++) {
            const from = pickRow(all, order, "longest", fresh, 1);
            if (from === null) break;
            all[from]! -= 1;
            all[fresh]! += 1;
        }
        next = withCounts(next, all);
    }
    return withRowsSet(p, next);
}

/** Row `index` taken off, its marchers going one at a time to the shortest rows */
function removeRow(p: P, n: number, index: number): P {
    const rows = rowsOf(p);
    if (!rows || index === rows.drawn || rows.list[index] === undefined)
        return p;
    const counts =
        rows.list[0]?.count !== undefined ? counted(p, rows, n) : null;
    const list = rows.list.filter((_, i) => i !== index);
    const drawn = index < rows.drawn ? rows.drawn - 1 : rows.drawn;
    let next: LineRows = { ...rows, list, drawn };
    if (counts) {
        const given = counts[index]!;
        const left = counts.filter((_, i) => i !== index);
        const order = frontToBack(next, rowFrame(p).sign);
        for (let i = 0; i < given; i++)
            left[pickRow(left, order, "shortest", -1)!]! += 1;
        next = withCounts(next, left);
    }
    return withRowsSet(p, next);
}

/**
 * Spot `spot` of row `index`, as the menu shows it (left to right), left empty, or an empty one
 * filled in again. The row keeps its length: its marcher there goes to the shortest other row, or
 * one comes from the longest (sim study of #1190: a row that grew moved the dots under the
 * pointer). With no other row to give or take, the row grows a spot, or loses the empty one.
 */
function toggleSpot(
    p: P,
    n: number,
    index: number,
    spot: number,
    env: ToolEnv,
): P | null {
    const rows = rowsOrOne(p, env);
    const sizes = rowSizes(p, rows, n);
    const size = sizes[index];
    if (!size || spot < 0 || spot >= size.length) return null;
    const j = rowFrame(p).sign === 1 ? spot : size.length - 1 - spot;
    const empty = size.empty;
    const was = empty.includes(j);
    const counts = sizes.map((s) => s.count);
    const order = frontToBack(rows, rowFrame(p).sign);
    const other = was
        ? pickRow(counts, order, "longest", index, 1)
        : counts[index]! > 1
          ? pickRow(counts, order, "shortest", index)
          : null;
    const inPlace = other !== null;
    const next = inPlace
        ? was
            ? empty.filter((e) => e !== j)
            : [...empty, j].sort((a, b) => a - b)
        : was
          ? empty.filter((e) => e !== j).map((e) => (e > j ? e - 1 : e))
          : [...empty.map((e) => (e >= j ? e + 1 : e)), j].sort(
                (a, b) => a - b,
            );
    const row = rows.list[index]!;
    const { empty: _was, ...rest } = row;
    const list = rows.list.map((r, i) =>
        i === index ? (next.length ? { ...rest, empty: next } : rest) : r,
    );
    if (!inPlace) return withRowsSet(p, { ...rows, list });
    const by = was ? 1 : -1;
    counts[index]! += by;
    counts[other]! -= by;
    return withRowsSet(p, withCounts({ ...rows, list }, counts));
}

/** Row `index` moved half a spot the menu's way (+ right or back), or centered again */
function shiftRow(p: P, index: number, by: -1 | 0 | 1): P {
    const rows = rowsOf(p);
    const row = rows?.list[index];
    if (!rows || !row) return p;
    const shift = by === 0 ? 0 : (row.shift ?? 0) + by * rowFrame(p).sign;
    const { shift: _was, ...rest } = row;
    const list = rows.list.map((r, i) =>
        i === index ? (shift ? { ...rest, shift } : rest) : r,
    );
    return withRowsSet(p, { ...rows, list });
}

/** The box sizes the menu offers: 2, 3 and 4 rows, so many in each and the back row the rest */
function picks(n: number): { perRow: number; rows: number; last: number }[] {
    const out: { perRow: number; rows: number; last: number }[] = [];
    for (const r of [2, 3, 4]) {
        const perRow = Math.ceil(n / r);
        const last = n - perRow * (r - 1);
        if (perRow < 2 || last < 1 || out.some((x) => x.perRow === perRow))
            continue;
        out.push({ perRow, rows: r, last });
    }
    return out;
}

/** Box size `perRow` in a row laid out, as many of the rows in front kept in front as fit */
function pickBox(p: P, n: number, perRow: number, env: ToolEnv): P {
    const rows = rowsOrOne(p, env);
    const r = Math.max(1, Math.ceil(n / perRow));
    const { sign } = rowFrame(p);
    // Rows in front: before the drawn one in the field's order
    const order = frontToBack(rows, sign);
    const inFront = Math.min(r - 1, order.indexOf(rows.drawn));
    const behind = r - 1 - inFront;
    const before = sign === 1 ? inFront : behind;
    const list: LineRow[] = new Array(r).fill(null).map(() => ({}));
    const next: LineRows = {
        ...rows,
        list,
        drawn: before,
    };
    const fresh = frontToBack(next, sign);
    const counts = new Array<number>(r).fill(0);
    fresh.forEach((row, i) => {
        counts[row] = i < r - 1 ? perRow : n - perRow * (r - 1);
    });
    return withRowsSet(p, withCounts(next, counts));
}

/** What the Rows menu shows */
function rowsView(p: P, n: number): RowsView | null {
    if (p.closed === true) return null;
    const rows = rowsOf(p);
    const { sign, words } = rowFrame(p);
    const one: LineRows = rows ?? { list: [{}], drawn: 0, apart: 1 };
    const sizes = rowSizes(p, one, n);
    const longest = Math.max(...sizes.map((s) => s.length));
    const list: RowView[] = one.list.map((row, index) => {
        const offset = index - one.drawn;
        const { count, empty, length } = sizes[index]!;
        const spots = Array.from(
            { length },
            (_, j) => !empty.includes(sign === 1 ? j : length - 1 - j),
        );
        const far = offset * sign > 0;
        return {
            index,
            away: Math.abs(offset),
            side: offset === 0 ? null : far ? "far" : "near",
            count,
            spots,
            shift: (row.shift ?? 0) * sign,
            short: length < longest,
        };
    });
    // Far side first: behind above the drawn line, in front below it
    const ordered = [...list].sort((a, b) => (b.index - a.index) * sign);
    const counts = sizes.map((s) => s.count);
    const front = frontToBack(one, sign).map((i) => counts[i]!);
    const empty = sizes.reduce((a, s) => a + s.empty.length, 0);
    return {
        words,
        rows: ordered,
        empty,
        picks: picks(n).map((x) => ({
            ...x,
            on:
                empty === 0 &&
                front.length === x.rows &&
                front.every(
                    (c, i) => c === (i < x.rows - 1 ? x.perRow : x.last),
                ),
        })),
    };
}

/** The marchers in row `index`, as a number of the menu's */
const countParams = new Map<number, ToolParam<P>>();
function countParam(index: number): ToolParam<P> {
    const made = countParams.get(index);
    if (made) return made;
    const read = (p: P, n: number) => {
        const rows = rowsOf(p);
        return rows ? (counted(p, rows, n)[index] ?? 0) : n;
    };
    const param: ToolParam<P> = {
        key: `rowCount${index}`,
        get label() {
            return tolgee.t("shapes.rows.count", "Marchers in this row");
        },
        unit: "count",
        primary: false,
        drag: "x",
        interval: false,
        blends: false,
        display: (p, n) => String(read(p, n)),
        type: (p, n, text) => {
            const t = text.trim();
            return /^\d+$/.test(t) ? setCount(p, n, index, Number(t)) : null;
        },
        set: (p, n, value) => setCount(p, n, index, Math.round(value)),
        scrub: (base, n, move) =>
            setCount(
                base,
                n,
                index,
                Math.max(
                    1,
                    scrubValue(read(base, n), move.dx, move.dy, {
                        axis: "x",
                        ...COUNT_RATE,
                    }),
                ),
            ) ?? base,
        stepper: {
            get less() {
                return tolgee.t(
                    "shapes.rows.countLess",
                    "One fewer here: to the shortest other row",
                );
            },
            get more() {
                return tolgee.t(
                    "shapes.rows.countMore",
                    "One more here: from the longest other row",
                );
            },
            by: (p, n, by) => {
                const rows = rowsOf(p);
                const next = rows && moveOne(p, rows, n, index, by);
                return next ? withRowsSet(p, next) : null;
            },
        },
    };
    countParams.set(index, param);
    return param;
}

/**
 * A distance of the rows' own, in steps: how far apart they are, or how much further along each
 * starts than the one in front (which can go below 0)
 */
function stepsParam(field: "apart" | "slant"): ToolParam<P> {
    const signed = field === "slant";
    const read = (p: P) => rowsOf(p)?.[field] ?? 0;
    const write = (p: P, units: number): P | null => {
        const rows = rowsOf(p);
        if (!rows || (!signed && !(units > 0))) return null;
        const { slant: _was, ...rest } = rows;
        return withRowsSet(
            p,
            signed && units === 0 ? rest : { ...rows, [field]: units },
        );
    };
    const readSigned = (text: string): number | null => {
        const t = text.trim().replace(/^[−–]/, "-");
        const negative = t.startsWith("-");
        if (t.replace(/^-/, "").trim() === "0") return 0;
        const steps = parseSteps(t.replace(/^-/, ""));
        return steps === null ? null : negative ? -steps : steps;
    };
    return {
        key: field === "apart" ? "rowsApart" : "rowsSlant",
        get label() {
            return field === "apart"
                ? tolgee.t("shapes.rows.apart", "Rows apart, in steps")
                : tolgee.t(
                      "shapes.rows.slant",
                      "How much further along each row starts than the one in front, in steps",
                  );
        },
        unit: "steps",
        primary: false,
        drag: "x",
        interval: false,
        blends: false,
        showsRowsGap: true,
        display: (p, _n, stepPx) =>
            signed
                ? formatSignedSteps(read(p) / stepPx)
                : formatSteps(read(p) / stepPx),
        value: (p, _n, stepPx) => read(p) / stepPx,
        type: (p, _n, text, env) => {
            const steps = signed ? readSigned(text) : parseSteps(text);
            return steps === null ? null : write(p, steps * env.stepPx);
        },
        set: (p, _n, value, env) => write(p, value * env.stepPx),
        scrub: (base, _n, move, env) => {
            const steps = scrubValue(
                read(base) / env.stepPx,
                move.dx,
                move.dy,
                spacingRate(env.snap, "x"),
            );
            return write(base, steps * env.stepPx) ?? base;
        },
    };
}

/**
 * The gap the Rows apart and Slant numbers set, for the field to draw while they're engaged, at
 * an end of the block so it's clear of the spots: from the drawn row's end spot straight across
 * to the next row behind it (or to its left; in front or to the right when there's none), then
 * along by the slant, into the block. The end is the one the slant leans away from, or with none
 * the right-hand one on screen (the top one up and down the field). `outward` points away from
 * the block there, along the line. Null with only the drawn row.
 */
export function rowsGap(
    p: P,
    n: number,
    stepPx?: number,
): { from: XY; corner: XY; to: XY; outward: XY } | null {
    const rows = rowsOf(p);
    if (!rows || rows.list.length < 2) return null;
    const drawn = layRows(p, n, (k) => lineFillSpots(p, k, stepPx))[
        rows.drawn
    ]!;
    if (drawn.spots.length === 0) return null;
    const frame = rowFrame(p);
    const { sign } = frame;
    // Row +1 is on the line's left-hand side: behind (or to the left) when `sign` is +1
    const offset =
        rows.drawn + sign < rows.list.length && rows.drawn + sign >= 0
            ? sign
            : -sign;
    // How far the next row starts further along the line's own way
    const lean = offset * (rows.slant ?? 0);
    const { along } = frame;
    const last =
        Math.abs(lean) > 1e-9
            ? lean < 0
            : Math.abs(along.x) > 1e-9
              ? along.x > 0
              : along.y < 0;
    const spot = last ? drawn.spots[drawn.spots.length - 1]! : drawn.spots[0]!;
    const from = { x: spot.x, y: spot.y };
    // Following the line, the gap is square to it at that end, and the slant along it there
    const normal = frame.step ?? normalNear(lineOutline(p), from);
    const way = frame.step ? along : { x: -normal.y, y: normal.x };
    const corner = add(from, scale(normal, offset * rows.apart));
    const to = add(corner, scale(way, lean));
    return { from, corner, to, outward: last ? way : scale(way, -1) };
}

// ── Which way the rows go ───────────────────────────────────────────────────────────────

/** Which way the rows step, as the menu names it: absent {@link LineRows.go} is `slide` */
type GoValue = "slide" | RowsGo;

/** What the drawn line is, for the names of the ways its rows can go */
function lineSort(p: P): "straight" | "arc" | "curve" | "bent" {
    const outline = lineOutline(p);
    if (outline.length === 2) return "straight";
    if (p.points.some(bends)) return "arc";
    return outline.length > p.points.length ? "curve" : "bent";
}

/** The ways the rows can go for the drawn line, in the menu's order: a straight line's follow it */
function goValues(p: P): GoValue[] {
    return lineSort(p) === "straight"
        ? ["slide", "back", "side"]
        : ["follow", "slide", "back", "side"];
}

function goWords(p: P, value: GoValue): { label: string; detail: string } {
    const sort = lineSort(p);
    switch (value) {
        case "follow":
            return sort === "arc"
                ? {
                      label: tolgee.t("shapes.rows.goRings", "Rings"),
                      detail: tolgee.t(
                          "shapes.rows.goRingsDetail",
                          "Round the arc's center",
                      ),
                  }
                : {
                      label: tolgee.t(
                          "shapes.rows.goFollow",
                          "Follow the bends",
                      ),
                      detail:
                          sort === "curve"
                              ? tolgee.t(
                                    "shapes.rows.goFollowCurveDetail",
                                    "Each row square to the curve",
                                )
                              : tolgee.t(
                                    "shapes.rows.goFollowLineDetail",
                                    "Each row square to the line",
                                ),
                  };
        case "slide":
            if (sort === "straight")
                return {
                    label: tolgee.t("shapes.rows.goOut", "Out from the line"),
                    detail: tolgee.t(
                        "shapes.rows.goOutDetail",
                        "Each row square to the line",
                    ),
                };
            if (sort === "arc")
                return {
                    label: tolgee.t(
                        "shapes.rows.goSlideArc",
                        "Slide the whole arc",
                    ),
                    detail: tolgee.t(
                        "shapes.rows.goSlideArcDetail",
                        "The same arc, moved",
                    ),
                };
            if (sort === "curve")
                return {
                    label: tolgee.t(
                        "shapes.rows.goSlideCurve",
                        "Slide the whole curve",
                    ),
                    detail: tolgee.t(
                        "shapes.rows.goSlideCurveDetail",
                        "The same curve, moved",
                    ),
                };
            return {
                label: tolgee.t(
                    "shapes.rows.goSlideLine",
                    "Slide the whole line",
                ),
                detail: tolgee.t(
                    "shapes.rows.goSlideLineDetail",
                    "The same line, moved",
                ),
            };
        case "back":
            return {
                label: tolgee.t("shapes.rows.goBack", "Front to back"),
                detail: tolgee.t(
                    "shapes.rows.goBackDetail",
                    "Straight back on the grid",
                ),
            };
        case "side":
            return {
                label: tolgee.t("shapes.rows.goSide", "Side to side"),
                detail: tolgee.t(
                    "shapes.rows.goSideDetail",
                    "Straight across on the grid",
                ),
            };
    }
}

/** `k` points evenly along `outline`, its ends among them */
function evenAlong(outline: readonly XY[], k: number): XY[] {
    const lengths = [0];
    for (let i = 1; i < outline.length; i++)
        lengths.push(
            lengths[i - 1]! +
                Math.hypot(
                    outline[i]!.x - outline[i - 1]!.x,
                    outline[i]!.y - outline[i - 1]!.y,
                ),
        );
    const total = lengths[lengths.length - 1]!;
    const out: XY[] = [];
    let i = 1;
    for (let j = 0; j < k; j++) {
        const want = k > 1 ? (total * j) / (k - 1) : 0;
        while (i < outline.length - 1 && lengths[i]! < want) i++;
        const span = lengths[i]! - lengths[i - 1]!;
        const f = span > 0 ? (want - lengths[i - 1]!) / span : 0;
        out.push(
            add(outline[i - 1]!, scale(sub(outline[i]!, outline[i - 1]!), f)),
        );
    }
    return out;
}

/**
 * The drawn line with a row on either side going `value`'s way, as a sketch: the rows set well
 * apart so their way shows at the menu's small size
 */
function goPicture(p: P, value: GoValue): ToolChoicePicture {
    const outline = lineOutline(p);
    const d = sub(outline[outline.length - 1]!, outline[0]!);
    const apart = Math.max(Math.hypot(d.x, d.y) * 0.3, 1e-6);
    const sample: P = {
        ...p,
        rows: {
            list: [{}, {}, {}],
            drawn: 1,
            apart,
            ...(value === "slide" ? {} : { go: value }),
        },
    };
    const frame = rowFrame(sample);
    const dirAt = (q: XY) => frame.step ?? normalNear(outline, q);
    const dotsOn = evenAlong(outline, 3);
    const lines: ToolChoicePictureLine[] = [];
    const dots: XY[] = [];
    for (const o of [-1, 0, 1]) {
        lines.push({
            points: outline.map((q) => add(q, scale(dirAt(q), o * apart))),
            ...(o === 0 ? {} : { faint: true }),
        });
        for (const q of dotsOn) dots.push(add(q, scale(dirAt(q), o * apart)));
    }
    return { lines, dots };
}

/** The Rows menu's "Rows go" (#1193): which way the rows step from the drawn line */
const GO_CHOICE: ToolChoice<P> = {
    key: "rowsGo",
    get label() {
        return tolgee.t("shapes.rows.go", "Rows go");
    },
    options: (p) =>
        goValues(p).map((value) => ({
            value,
            ...goWords(p, value),
            picture: goPicture(p, value),
        })),
    current: (p) => {
        const go = rowsOf(p)?.go ?? "slide";
        return goValues(p).includes(go) ? go : "slide";
    },
    pick: (p, n, value) => {
        const rows = rowsOf(p);
        if (!rows || !goValues(p).includes(value as GoValue)) return p;
        const { go: _was, ...rest } = rows;
        const next: LineRows =
            value === "slide" ? rest : { ...rest, go: value as RowsGo };
        const picked = withRowsSet(p, next);
        // Marchers shared out evenly: which row is short goes by front and back, which a new
        // way may swap, so they're written down first
        if (
            rows.list[0]?.count === undefined &&
            rowFrame(picked).sign !== rowFrame(p).sign
        )
            return withRowsSet(p, withCounts(next, counted(p, rows, n)));
        return picked;
    },
};

/** The Rows menu (spec #1190) */
export const LINE_ROWS: ToolRows<P> = {
    view: rowsView,
    add: addRow,
    remove: removeRow,
    count: countParam,
    toggleSpot,
    shift: (p, _n, index, by) => shiftRow(p, index, by),
    pick: pickBox,
    clear: (p) => withRowsSet(p, undefined),
    apart: stepsParam("apart"),
    slant: stepsParam("slant"),
    go: GO_CHOICE,
    gap: rowsGap,
};

// ── The kind with rows ──────────────────────────────────────────────────────────────────

/** The drawn row's own spot count, for the shape's `n` */
const per = (p: P, n: number) => drawnSpots(p, n);

/**
 * What an edit of the drawn line gives, its rows kept: the kind builds its params afresh and
 * doesn't know them. A line closed by the edit is filled instead, so it loses them.
 */
function keep(base: P, next: P): P {
    if (next === base || !base.rows) return next;
    if (next.closed === true) return withRowsSet(next, undefined);
    return next.rows === undefined ? { ...next, rows: base.rows } : next;
}
function keepMaybe<R extends P | null | undefined>(base: P, next: R): R {
    return (next ? keep(base, next) : next) as R;
}

/** One of the kind's numbers, reading the drawn line */
function rowParam(x: ToolParam<P>): ToolParam<P> {
    const glyph = x.glyph;
    return {
        ...x,
        ...(x.derived
            ? {
                  derived: (p: P, n: number, s: number) =>
                      x.derived!(p, per(p, n), s),
              }
            : {}),
        ...(x.snap
            ? {
                  snap: (p: P, n: number, env: ToolEnv) =>
                      keep(p, x.snap!(p, per(p, n), env)),
              }
            : {}),
        ...(typeof glyph === "function"
            ? { glyph: (p: P, n: number) => glyph(p, per(p, n)) }
            : {}),
        ...(x.shown
            ? { shown: (p: P, n: number) => x.shown!(p, per(p, n)) }
            : {}),
        display: (p, n, s) => x.display(p, per(p, n), s),
        ...(x.value
            ? {
                  value: (p: P, n: number, s: number) =>
                      x.value!(p, per(p, n), s),
              }
            : {}),
        ...(x.note ? { note: (p: P, n: number) => x.note!(p, per(p, n)) } : {}),
        ...(x.words
            ? { words: (p: P, n: number) => x.words!(p, per(p, n)) }
            : {}),
        type: (p, n, text, env) =>
            keepMaybe(p, x.type(p, per(p, n), text, env)),
        ...(x.set
            ? {
                  set: (p: P, n: number, v: number, env: ToolEnv) =>
                      keepMaybe(p, x.set!(p, per(p, n), v, env)),
              }
            : {}),
        scrub: (b, n, move, env) => keep(b, x.scrub(b, per(b, n), move, env)),
        ...(x.stepper
            ? {
                  stepper: {
                      ...x.stepper,
                      by: (p: P, n: number, by: -1 | 1, env: ToolEnv) =>
                          keepMaybe(p, x.stepper!.by(p, per(p, n), by, env)),
                  },
              }
            : {}),
        ...(x.widen
            ? {
                  widen: (p: P, n: number, by: number, env: ToolEnv) =>
                      keepMaybe(p, x.widen!(p, per(p, n), by, env)),
              }
            : {}),
    };
}

/** The drawn line's spots for a count, as the shape generates them */
const spotsFor =
    (shape: ShapeKind<P>, p: P, ctx: ShapeContext) =>
    (k: number): readonly Slot[] =>
        shape.generate(p, k, ctx);

/** The kind's shape, laying out every row from the drawn line's spots */
export function rowsShape(shape: ShapeKind<P>): ShapeKind<P> {
    return {
        ...shape,
        outline: (p, n, ctx) => {
            const own = shape.outline(p, per(p, n), ctx);
            if (!rowsOf(p)) return own;
            const rows = layRows(p, n, spotsFor(shape, p, ctx))
                .filter((r) => r.offset !== 0 && r.spots.length > 0)
                .map((r) => r.spots.map(({ x, y }) => ({ x, y })));
            return [...own, ...rows];
        },
        generate: (p, n, ctx) => {
            if (!rowsOf(p)) return shape.generate(p, n, ctx);
            // `s` counts the spots row by row, as they're listed: Keep order lays marchers on
            // in that order, so an edit of the rows keeps everyone in their row. Each row's own
            // distance along would tie across rows and deal the marchers out column by column.
            let s = 0;
            return layRows(p, n, spotsFor(shape, p, ctx)).flatMap((r) =>
                r.spots.flatMap((slot, j): Slot[] =>
                    r.filled[j]
                        ? [
                              {
                                  x: slot.x,
                                  y: slot.y,
                                  s: s++,
                                  row: r.index,
                                  col: j,
                              },
                          ]
                        : [],
                ),
            );
        },
        // Row by row from the front, each along the line its own way
        orderKey: (p, point, ctx, n) => {
            const rows = rowsOf(p);
            if (!rows) return shape.orderKey(p, point, ctx, n);
            const { along, left, sign, step } = rowFrame(p);
            const from = sub(point, lineOutline(p)[0]!);
            // A spot knows its row; worked out from where it is, the bow of a curve would put
            // the middle of one row in the next
            const slot = point as Slot;
            if (slot.row !== undefined && slot.col !== undefined)
                return [(slot.row - rows.drawn) * sign, slot.col * sign];
            const offset = Math.round(dot(from, step ?? left) / rows.apart);
            return [offset * sign, dot(from, along) * sign];
        },
    };
}

/**
 * `kind` with rows (spec #1190): every number, handle and gesture of the drawn line given its
 * own spot count, its edits keeping the rows, its shape laying out every row, and the Rows menu.
 * The shape is grabbed by any row.
 */
export function withRows(kind: ToolKind<P>): ToolKind<P> {
    const { choices, groups, lock, menu, honors } = kind;
    return {
        ...kind,
        shape: rowsShape(kind.shape),
        params: kind.params.map(rowParam),
        ...(choices
            ? {
                  choices: choices.map((c) => ({
                      ...c,
                      options: (p: P, n: number) => c.options(p, per(p, n)),
                      current: (p: P, n: number) => c.current(p, per(p, n)),
                      pick: (p: P, n: number, value: string, env: ToolEnv) =>
                          keep(p, c.pick(p, per(p, n), value, env)),
                      ...(c.shown
                          ? {
                                shown: (p: P, n: number) =>
                                    c.shown!(p, per(p, n)),
                            }
                          : {}),
                  })),
              }
            : {}),
        ...(groups
            ? {
                  groups: {
                      ...groups,
                      shown: (p, n, s) => groups.shown(p, per(p, n), s),
                      type: (p, n, i, part, text, env) =>
                          keepMaybe(
                              p,
                              groups.type(p, per(p, n), i, part, text, env),
                          ),
                      scrub: (b, n, i, part, move, env) =>
                          keep(
                              b,
                              groups.scrub(b, per(b, n), i, part, move, env),
                          ),
                      text: (p, n, s) => groups.text(p, per(p, n), s),
                      typeList: (p, n, text, env) =>
                          keepMaybe(
                              p,
                              groups.typeList(p, per(p, n), text, env),
                          ),
                      add: (p, n, env) =>
                          keep(p, groups.add(p, per(p, n), env)),
                      remove: (p, n, i, env) =>
                          keep(p, groups.remove(p, per(p, n), i, env)),
                  },
              }
            : {}),
        ...(lock
            ? {
                  lock: {
                      ...lock,
                      shown: (p: P, n: number) => lock.shown(p, per(p, n)),
                      locked: (p: P, n: number) => lock.locked(p, per(p, n)),
                      toggle: (p: P, n: number, env: ToolEnv) =>
                          keep(p, lock.toggle(p, per(p, n), env)),
                  },
              }
            : {}),
        ...(menu
            ? {
                  menu: {
                      sections: (p: P, n: number, key: string) =>
                          menu.sections(p, per(p, n), key),
                      pick: (
                          p: P,
                          n: number,
                          key: string,
                          value: string,
                          env: ToolEnv,
                      ) => {
                          const picked = menu.pick(
                              p,
                              per(p, n),
                              key,
                              value,
                              env,
                          );
                          return picked
                              ? { ...picked, params: keep(p, picked.params) }
                              : null;
                      },
                  },
              }
            : {}),
        ...(honors
            ? {
                  honors: {
                      ...honors,
                      ...(honors.handle
                          ? {
                                handle: (
                                    key: string,
                                    locked: boolean,
                                    p: P,
                                    n: number,
                                ) => honors.handle!(key, locked, p, per(p, n)),
                            }
                          : {}),
                  },
              }
            : {}),
        ...(kind.step
            ? { step: (p: P, n: number) => kind.step!(p, per(p, n)) }
            : {}),
        ...(kind.ratioLockFor
            ? {
                  ratioLockFor: (p: P, n: number) =>
                      kind.ratioLockFor!(p, per(p, n)),
              }
            : {}),
        handles: (p, n, selected) => kind.handles(p, per(p, n), selected),
        ...(kind.clickHandle
            ? {
                  clickHandle: (p: P, n: number, key: string) =>
                      keepMaybe(p, kind.clickHandle!(p, per(p, n), key)),
              }
            : {}),
        ...(kind.doubleClickHandle
            ? {
                  doubleClickHandle: (p: P, n: number, key: string) =>
                      keepMaybe(p, kind.doubleClickHandle!(p, per(p, n), key)),
              }
            : {}),
        dragHandle: (b, n, key, to, env) =>
            keep(b, kind.dragHandle(b, per(b, n), key, to, env)),
        ...(kind.outline
            ? { outline: (p: P, n: number) => kind.outline!(p, per(p, n)) }
            : {}),
        ...(kind.outlineOpen
            ? {
                  outlineOpen: (p: P, n: number) =>
                      kind.outlineOpen!(p, per(p, n)),
              }
            : {}),
        ...(kind.construction
            ? {
                  construction: (p: P, n: number) =>
                      kind.construction!(p, per(p, n)),
              }
            : {}),
        ...(kind.snapPoints
            ? {
                  snapPoints: (p: P, n: number) =>
                      kind.snapPoints!(p, per(p, n)),
              }
            : {}),
        contains: (p, n, point, env) => {
            if (!rowsOf(p)) return kind.contains(p, n, point, env);
            if (kind.contains(p, per(p, n), point, env)) return true;
            // Every row where it's drawn, moved along by its half spots and the slant (the drawn
            // one too), within the drawn line's own reach
            const half = lineInterval(p, per(p, n)) / 2;
            const reach = env
                ? Math.max(Math.min(half, env.stepPx), env.hitRadius)
                : half;
            return layRows(p, n, (k) => lineFillSpots(p, k, env?.stepPx)).some(
                (r) => nearRun(r.spots, point, reach),
            );
        },
        move: (b, n, delta, env) =>
            keep(b, kind.move(b, per(b, n), delta, env)),
        frameOf: (p, n) => kind.frameOf(p, per(p, n)),
        withFrame: (p, n, frame) => {
            const next = keep(p, kind.withFrame(p, per(p, n), frame));
            const was = kind.frameOf(p, per(p, n));
            const flips =
                (frame.flipX !== frame.flipY) !== (was.flipX !== was.flipY);
            if (flips) return mirrorRows(p, next, n);
            // A half turn swaps front and back: marchers shared out evenly are written down
            // first, or the short row would move to the new back
            const rows = rowsOf(next);
            return rows &&
                rows.list[0]?.count === undefined &&
                rowFrame(next).sign !== rowFrame(p).sign
                ? {
                      ...next,
                      rows: {
                          ...rows,
                          list: rows.list.map((row, i) => ({
                              ...row,
                              count: counted(p, rows, n)[i]!,
                          })),
                      },
                  }
                : next;
        },
        ...(kind.turnOf
            ? { turnOf: (p: P, n: number) => kind.turnOf!(p, per(p, n)) }
            : {}),
        ...(kind.withSize
            ? {
                  withSize: (
                      p: P,
                      n: number,
                      half: { halfWidth: number; halfDepth: number },
                      env: ToolEnv,
                  ) => keep(p, kind.withSize!(p, per(p, n), half, env)),
              }
            : {}),
        ...(kind.atCount
            ? {
                  atCount: (p: P, from: number, n: number, env: ToolEnv) =>
                      keep(p, kind.atCount!(p, per(p, from), per(p, n), env)),
              }
            : {}),
        ...(kind.handleTip
            ? {
                  handleTip: (p: P, n: number, key: string) =>
                      kind.handleTip!(p, per(p, n), key),
              }
            : {}),
        ...(kind.settle
            ? {
                  settle: (p: P, n: number, env: ToolEnv) =>
                      keep(p, kind.settle!(p, per(p, n), env)),
              }
            : {}),
        ...(kind.forPlacing
            ? { forPlacing: (p: P) => keep(p, kind.forPlacing!(p)) }
            : {}),
        // Every row's spots left empty
        emptySpots: (p, n, stepPx) => {
            if (!rowsOf(p)) return kind.emptySpots?.(p, n, stepPx) ?? [];
            return layRows(p, n, (k) => lineFillSpots(p, k, stepPx)).flatMap(
                (r) =>
                    r.spots
                        .filter((_, j) => !r.filled[j])
                        .map(({ x, y }) => ({ x, y })),
            );
        },
        rows: LINE_ROWS,
        rowOutlines: (p, n, stepPx) => {
            if (!rowsOf(p)) return [];
            return layRows(p, n, (k) => lineFillSpots(p, k, stepPx))
                .filter((r) => r.offset !== 0 && r.spots.length > 0)
                .map((r) => r.spots.map(({ x, y }) => ({ x, y })));
        },
    };
}
