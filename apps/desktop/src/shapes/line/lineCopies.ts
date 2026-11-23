import tolgee from "@/global/singletons/Tolgee";
import { COUNT_RATE, scrubValue, spacingRate } from "../editor/scrub";
import { formatSignedSteps, formatSteps, parseSteps } from "../editor/format";
import type {
    ToolCopies,
    ToolEnv,
    ToolKind,
    ToolParam,
} from "../tool/toolKind";
import type { ShapeKind, Slot, XY } from "../types";
import {
    columnsOf,
    copiesOf,
    copyCount,
    lineSpotCount,
    MAX_COPIES,
    type LineCopies,
} from "./copiesParams";
import { lineOutline, type LineParams } from "./lineGeometry";
import { lineFillSpots } from "./lineFill";

/**
 * Copies of a Line, Curve or Arc (spec #1190, steps #1191 and #1192): the drawn line and copies
 * that repeat it behind, in front, to the left and to the right, one shape. The kind itself knows nothing of them: {@link withCopies}
 * hands it the drawn line's own spot count wherever the host gives the whole shape's, so its
 * numbers, handles and spacing read the drawn line, and lays the rows out from its spots. Pure.
 */

type P = LineParams;

const add = (a: XY, b: XY): XY => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: XY, b: XY): XY => ({ x: a.x - b.x, y: a.y - b.y });

/** The drawn line's own spot count, for the shape's `n` */
const per = (p: P, n: number) => (copiesOf(p) ? lineSpotCount(p, n) : n);

/** `p` with `copies` set, or taken off when there are none left */
export function withCopiesSet(p: P, copies: LineCopies | undefined): P {
    if (copies && copyCount(copies) > 0) return { ...p, copies };
    if (p.copies === undefined) return p;
    const { copies: _gone, ...rest } = p;
    return rest;
}

/** How wide `line` is along `axis` (a unit vector) */
function widthAlong(line: readonly XY[], axis: XY): number {
    const at = line.map((q) => q.x * axis.x + q.y * axis.y);
    return at.length ? Math.max(...at) - Math.min(...at) : 0;
}

/**
 * Where each copy sits from the drawn line, row by row from the front, each row from the left
 * (the order the spots run in), the drawn line `{0, 0}` among them. Rows go toward a sideline and
 * columns side to side, the field's way or, `direction: "shape"`, the line's own as turned since
 * drawn (#1192). Columns are the line's width apart plus the gap, so they follow its length; each
 * row behind sits `stagger` further right than the one in front of it.
 */
export function copyOffsets(p: P): XY[] {
    const c = copiesOf(p);
    if (!c) return [{ x: 0, y: 0 }];
    const turn = c.direction === "shape" ? ((p.turn ?? 0) * Math.PI) / 180 : 0;
    // Clockwise on the field, whose y runs toward the front sideline
    const across = { x: Math.cos(turn), y: Math.sin(turn) };
    const deep = { x: -Math.sin(turn), y: Math.cos(turn) };
    const columns = (c.left ?? 0) + (c.right ?? 0) > 0;
    const step = columns
        ? widthAlong(lineOutline(p), across) + (c.gap ?? 0)
        : 0;
    const out: XY[] = [];
    for (let r = c.front; r >= -c.behind; r--)
        for (let col = -(c.left ?? 0); col <= (c.right ?? 0); col++) {
            const side = col * step - r * (c.stagger ?? 0);
            const toward = r * c.apart;
            out.push({
                // + 0: never −0, so the drawn line reads {0, 0}
                x: across.x * side + deep.x * toward + 0,
                y: across.y * side + deep.y * toward + 0,
            });
        }
    return out;
}

/**
 * What an edit of the drawn line gives, its copies kept: the kind builds its params afresh and
 * doesn't know them. A line closed by the edit is filled instead, so it loses them.
 */
function keep(base: P, next: P): P {
    if (next === base || !base.copies) return next;
    if (next.closed === true) return withCopiesSet(next, undefined);
    return next.copies === undefined ? { ...next, copies: base.copies } : next;
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

/** The kind's shape, laying out every row from the drawn line's spots */
export function copiesShape(shape: ShapeKind<P>): ShapeKind<P> {
    return {
        ...shape,
        outline: (p, n, ctx) => {
            const own = shape.outline(p, per(p, n), ctx);
            return copyOffsets(p).flatMap((o) =>
                own.map((line) => line.map((q) => add(q, o))),
            );
        },
        generate: (p, n, ctx) => {
            if (!copiesOf(p)) return shape.generate(p, n, ctx);
            const row = shape.generate(p, per(p, n), ctx);
            return copyOffsets(p)
                .flatMap((o, i) =>
                    row.map(
                        (slot): Slot => ({
                            ...add(slot, o),
                            s: slot.s,
                            row: Math.floor(i / columnsOf(copiesOf(p))),
                            col: i % columnsOf(copiesOf(p)),
                        }),
                    ),
                )
                .slice(0, n);
        },
        // Copy by copy from the front row's left, each along the line the way its spots go
        orderKey: (p, point, ctx, n) => {
            if (!copiesOf(p)) return shape.orderKey(p, point, ctx, n);
            const r = nearestCopy(p, point);
            const o = copyOffsets(p)[r]!;
            return [r, ...shape.orderKey(p, sub(point, o), ctx, per(p, n))];
        },
    };
}

/** The copy (or the drawn line) passing nearest `point` */
function nearestCopy(p: P, point: XY): number {
    const line = lineOutline(p);
    let best = 0;
    let bestDistance = Infinity;
    copyOffsets(p).forEach((o, r) => {
        const d = distanceToLine(line, sub(point, o));
        if (d < bestDistance) {
            bestDistance = d;
            best = r;
        }
    });
    return best;
}

function distanceToLine(line: readonly XY[], q: XY): number {
    if (line.length === 1)
        return Math.hypot(q.x - line[0]!.x, q.y - line[0]!.y);
    let best = Infinity;
    for (let i = 1; i < line.length; i++) {
        const a = line[i - 1]!;
        const b = line[i]!;
        const ab = sub(b, a);
        const len2 = ab.x * ab.x + ab.y * ab.y;
        const t =
            len2 === 0
                ? 0
                : Math.max(
                      0,
                      Math.min(
                          1,
                          ((q.x - a.x) * ab.x + (q.y - a.y) * ab.y) / len2,
                      ),
                  );
        best = Math.min(
            best,
            Math.hypot(q.x - (a.x + t * ab.x), q.y - (a.y + t * ab.y)),
        );
    }
    return best;
}

/** How far apart a first copy's rows and columns start: 2 steps, the usual gap between ranks */
const FIRST_STEPS = 2;

type Way = "behind" | "front" | "left" | "right";

const countOf = (p: P, way: Way) => p.copies?.[way] ?? 0;

/** The shape with `way`'s count set, a first copy starting 2 steps from the line */
function setCount(p: P, way: Way, count: number, env: ToolEnv): P {
    const c = Math.max(0, Math.min(MAX_COPIES, Math.round(count)));
    if (c === countOf(p, way)) return p;
    const was = p.copies;
    const copies: LineCopies = {
        ...was,
        behind: was?.behind ?? 0,
        front: was?.front ?? 0,
        apart: was?.apart ?? FIRST_STEPS * env.stepPx,
        [way]: c,
    };
    // Columns start 2 steps clear of each other
    if ((way === "left" || way === "right") && copies.gap === undefined)
        return withCopiesSet(p, { ...copies, gap: FIRST_STEPS * env.stepPx });
    return withCopiesSet(p, copies);
}

function countParam(
    way: Way,
    label: () => string,
    less: () => string,
    more: () => string,
): ToolParam<P> {
    return {
        key: `copies${way[0]!.toUpperCase()}${way.slice(1)}`,
        get label() {
            return label();
        },
        unit: "count",
        primary: false,
        drag: "x",
        interval: false,
        blends: false,
        range: { min: 0, max: MAX_COPIES },
        shown: (p) => p.closed !== true,
        display: (p) => String(countOf(p, way)),
        type: (p, _n, text, env) => {
            const t = text.trim();
            if (!/^\d+$/.test(t)) return null;
            return setCount(p, way, Number(t), env);
        },
        set: (p, _n, value, env) => setCount(p, way, value, env),
        scrub: (base, _n, move, env) =>
            setCount(
                base,
                way,
                scrubValue(countOf(base, way), move.dx, move.dy, {
                    axis: "x",
                    ...COUNT_RATE,
                }),
                env,
            ),
        stepper: {
            get less() {
                return less();
            },
            get more() {
                return more();
            },
            by: (p, _n, by, env) => {
                const next = countOf(p, way) + by;
                return next < 0 || next > MAX_COPIES
                    ? null
                    : setCount(p, way, next, env);
            },
        },
    };
}

const BEHIND = countParam(
    "behind",
    () => tolgee.t("shapes.copies.behind", "Copies behind"),
    () => tolgee.t("shapes.copies.behindLess", "One fewer behind"),
    () => tolgee.t("shapes.copies.behindMore", "One more behind"),
);
const FRONT = countParam(
    "front",
    () => tolgee.t("shapes.copies.front", "Copies in front"),
    () => tolgee.t("shapes.copies.frontLess", "One fewer in front"),
    () => tolgee.t("shapes.copies.frontMore", "One more in front"),
);
const LEFT = countParam(
    "left",
    () => tolgee.t("shapes.copies.left", "Copies to the left"),
    () => tolgee.t("shapes.copies.leftLess", "One fewer to the left"),
    () => tolgee.t("shapes.copies.leftMore", "One more to the left"),
);
const RIGHT = countParam(
    "right",
    () => tolgee.t("shapes.copies.right", "Copies to the right"),
    () => tolgee.t("shapes.copies.rightLess", "One fewer to the right"),
    () => tolgee.t("shapes.copies.rightMore", "One more to the right"),
);

const hasRows = (p: P) => {
    const c = copiesOf(p);
    return c !== null && c.behind + c.front > 0;
};
const hasColumns = (p: P) => {
    const c = copiesOf(p);
    return c !== null && (c.left ?? 0) + (c.right ?? 0) > 0;
};

/**
 * A distance of the copies' own, in steps: how far apart the rows are, how much clear space
 * between columns, or how far each row is staggered (which can go below 0)
 */
function stepsParam(
    field: "apart" | "gap" | "stagger",
    label: () => string,
    shown: (p: P) => boolean,
): ToolParam<P> {
    const signed = field === "stagger";
    const min = field === "apart" ? 1e-9 : field === "gap" ? 0 : -Infinity;
    const read = (p: P) => p.copies?.[field] ?? 0;
    const write = (p: P, units: number): P | null =>
        p.copies && units >= min
            ? withCopiesSet(p, { ...p.copies, [field]: units })
            : null;
    const readSigned = (text: string): number | null => {
        const t = text.trim().replace(/^[−–]/, "-");
        const negative = t.startsWith("-");
        if (t.replace(/^-/, "").trim() === "0") return 0;
        const steps = parseSteps(t.replace(/^-/, ""));
        return steps === null ? null : negative ? -steps : steps;
    };
    return {
        key: `copies${field[0]!.toUpperCase()}${field.slice(1)}`,
        get label() {
            return label();
        },
        unit: "steps",
        primary: false,
        drag: "x",
        interval: false,
        blends: false,
        shown,
        display: (p, _n, stepPx) =>
            p.copies
                ? signed
                    ? formatSignedSteps(read(p) / stepPx)
                    : formatSteps(read(p) / stepPx)
                : "",
        value: (p, _n, stepPx) => read(p) / stepPx,
        type: (p, _n, text, env) => {
            const steps =
                signed || field === "gap" ? readSigned(text) : parseSteps(text);
            return steps === null ? null : write(p, steps * env.stepPx);
        },
        set: (p, _n, value, env) => write(p, value * env.stepPx),
        scrub: (base, _n, move, env) => {
            if (!base.copies) return base;
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

/** How far apart the rows are; shown with rows */
const APART = stepsParam(
    "apart",
    () => tolgee.t("shapes.copies.apart", "Rows apart, in steps"),
    hasRows,
);
/** Clear space between columns; shown with columns */
const GAP = stepsParam(
    "gap",
    () => tolgee.t("shapes.copies.gap", "Space between columns, in steps"),
    hasColumns,
);
/** How much further right each row sits than the one in front; shown with rows */
const STAGGER = stepsParam(
    "stagger",
    () =>
        tolgee.t(
            "shapes.copies.stagger",
            "How far each row sits to the right of the row in front, in steps",
        ),
    hasRows,
);

/** The Copies menu (spec #1190) */
export const LINE_COPIES: ToolCopies<P> = {
    params: [BEHIND, FRONT, APART, STAGGER, LEFT, RIGHT, GAP],
    summary: (p) => {
        const c = copiesOf(p);
        if (!c) return null;
        const part = (count: number | undefined, words: () => string) =>
            count ? words() : null;
        return [
            part(c.behind, () =>
                tolgee.t("shapes.copies.summaryBehind", "{count} behind", {
                    count: c.behind,
                }),
            ),
            part(c.front, () =>
                tolgee.t("shapes.copies.summaryFront", "{count} in front", {
                    count: c.front,
                }),
            ),
            part(c.left, () =>
                tolgee.t("shapes.copies.summaryLeft", "{count} left", {
                    count: c.left,
                }),
            ),
            part(c.right, () =>
                tolgee.t("shapes.copies.summaryRight", "{count} right", {
                    count: c.right,
                }),
            ),
        ]
            .filter((x): x is string => x !== null)
            .join(" · ");
    },
    clear: (p) => withCopiesSet(p, undefined),
    direction: {
        shown: (p) => copiesOf(p) !== null,
        current: (p) => (p.copies?.direction === "shape" ? "shape" : "field"),
        pick: (p, way) => {
            if (!p.copies) return p;
            const { direction: _was, ...rest } = p.copies;
            return withCopiesSet(
                p,
                way === "shape" ? { ...rest, direction: "shape" } : rest,
            );
        },
    },
};

/**
 * `kind` with copies (spec #1190): every number, handle and gesture of the drawn line given its
 * own spot count, its edits keeping the copies, its shape laying out every row, and the Copies
 * menu. The drawn shape is grabbed by any row.
 */
export function withCopies(kind: ToolKind<P>): ToolKind<P> {
    const { choices, groups, lock, menu, honors } = kind;
    return {
        ...kind,
        shape: copiesShape(kind.shape),
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
        contains: (p, n, at, env) =>
            copyOffsets(p).some((o) =>
                kind.contains(p, per(p, n), sub(at, o), env),
            ),
        move: (b, n, delta, env) =>
            keep(b, kind.move(b, per(b, n), delta, env)),
        frameOf: (p, n) => kind.frameOf(p, per(p, n)),
        withFrame: (p, n, frame) =>
            keep(p, kind.withFrame(p, per(p, n), frame)),
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
        // The back row's spots past the marchers, left empty
        emptySpots: (p, n) => {
            if (!copiesOf(p)) return kind.emptySpots?.(p, n) ?? [];
            const k = per(p, n);
            const row = lineFillSpots(p, k);
            return copyOffsets(p)
                .flatMap((o) => row.map((slot) => add(slot, o)))
                .slice(n);
        },
        copies: LINE_COPIES,
        copyOutlines: (p, n) => {
            if (!copiesOf(p) || !kind.outline) return [];
            const own = kind.outline(p, per(p, n));
            return copyOffsets(p)
                .filter((o) => o.x !== 0 || o.y !== 0)
                .map((o) => own.map((q) => add(q, o)));
        },
    };
}
