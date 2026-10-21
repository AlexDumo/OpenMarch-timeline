import type { SavedShape } from "@/db-functions/savedShapes";
import type { ShapeFrame } from "../frame/frame";
import { typedValue } from "../command/shapeSteps";
import type { AnyToolKind, ToolEnv, ToolParam } from "../tool/toolKind";
import type { ShapeToolEntry } from "../tool/shapeTools";
import type { XY } from "../types";
import { intervalNote, type ShapeLibraryRow } from "./shapeLibrary";

/**
 * A saved shape (#353, spec #344): a kind and its intervals, under a name. It keeps no size and
 * no marcher count, so it fits any selection: applied to another count, the kind lays out that
 * many spots the saved distance apart. It lives in the user's library across shows, with a copy
 * in each show that uses one (ADR 0006, saved shapes). Everything here is pure.
 */
export type { SavedShape };

/** A kind a saved shape opens: its own kind, set to the saved intervals as it's drawn */
export interface SavedToolKind extends AnyToolKind {
    readonly saved: SavedShape;
    /** The kind it is made from */
    readonly base: AnyToolKind;
}

export function isSavedKind(kind: AnyToolKind): kind is SavedToolKind {
    return "saved" in kind;
}

/** The basic kind a kind is: itself, or the kind a saved shape opens */
export const baseKindOf = (kind: AnyToolKind): AnyToolKind =>
    isSavedKind(kind) ? kind.base : kind;

const intervalParams = (kind: AnyToolKind) =>
    (kind.params as readonly ToolParam<unknown>[]).filter(
        (p) => p.interval && p.value,
    );

/** The intervals of a shape of `kind`, in steps, by each interval parameter's key */
export function intervalsOf(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    stepPx: number,
): Record<string, number> {
    return Object.fromEntries(
        intervalParams(kind).map((p) => [p.key, p.value!(params, n, stepPx)]),
    );
}

/** What saving a shape of `kind` keeps: the kind and its intervals, under `name` */
export function savedShapeOf(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    stepPx: number,
    named: { readonly id: string; readonly name: string },
): SavedShape {
    const base = baseKindOf(kind);
    return {
        id: named.id,
        name: named.name.trim(),
        kind: base.shape.id,
        kindVersion: base.shape.version,
        intervals: intervalsOf(base, params, n, stepPx),
    };
}

/** The name saving offers: the kind and its spacing, "Box 2 apart" */
export function suggestedName(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    stepPx: number,
): string {
    const base = baseKindOf(kind);
    const note = intervalNote(
        Object.values(intervalsOf(base, params, n, stepPx)),
    );
    return note ? `${base.shape.label} ${note}` : base.shape.label;
}

/**
 * `params` set to `intervals`, each through its parameter's own typing as the chip and the
 * command bar set it. An interval the kind no longer has, or can't take, is left as it is.
 */
export function withIntervals(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    intervals: Readonly<Record<string, number>>,
    env: ToolEnv,
): unknown {
    let next = params;
    for (const param of intervalParams(kind)) {
        const steps = intervals[param.key];
        if (steps === undefined) continue;
        next = param.type(next, n, typedValue(param, steps), env) ?? next;
    }
    return next;
}

/** `params` moved so the frame's corner toward `from` stays where `was` had it */
function keepCorner(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    was: ShapeFrame,
    from: XY,
    env: ToolEnv,
): unknown {
    const now = kind.frameOf(params, n);
    const sx = Math.sign(from.x - was.center.x) || -1;
    const sy = Math.sign(from.y - was.center.y) || -1;
    const delta = {
        x:
            was.center.x +
            sx * was.halfWidth -
            (now.center.x + sx * now.halfWidth),
        y:
            was.center.y +
            sy * was.halfDepth -
            (now.center.y + sy * now.halfDepth),
    };
    if (Math.abs(delta.x) < 1e-9 && Math.abs(delta.y) < 1e-9) return params;
    return kind.move(params, n, delta, env);
}

const KINDS = new Map<string, SavedToolKind>();

/**
 * The kind `saved` opens, made from its own kind `base`: everything is the base kind's, except
 * that drawing, turning another shape into it and the command bar's starting numbers lay the
 * spots out the saved intervals apart.
 * A drawn shape keeps the corner the drag started from. The same saved shape gives the same
 * kind object, so pickers can tell which one is armed.
 */
export function savedToolKind(
    base: AnyToolKind,
    saved: SavedShape,
): SavedToolKind {
    const key = JSON.stringify([base.shape.id, saved]);
    const known = KINDS.get(key);
    if (known) return known;
    const kind: SavedToolKind = {
        ...base,
        saved,
        base,
        // The command bar starts from each parameter's default: the saved intervals here
        params: base.params.map((p) =>
            p.interval && saved.intervals[p.key] !== undefined
                ? { ...p, default: saved.intervals[p.key] }
                : p,
        ),
        draw(from: XY, to: XY, n: number, env: ToolEnv, previous?: unknown) {
            const drawn = base.draw(from, to, n, env, previous);
            if (drawn === undefined) return undefined;
            const was = base.frameOf(drawn, n);
            const set = withIntervals(base, drawn, n, saved.intervals, env);
            return keepCorner(base, set, n, was, from, env);
        },
        fromFrame(frame: ShapeFrame, n: number, env: ToolEnv) {
            return withIntervals(
                base,
                base.fromFrame(frame, n, env),
                n,
                saved.intervals,
                env,
            );
        },
    };
    KINDS.set(key, kind);
    return kind;
}

/**
 * The library's Saved group: the user's saved shapes, then the ones only the open show has (a
 * show from another computer), noted as such. Each note starts with the kind: "Box · 2 apart". A saved shape whose kind this app doesn't have is
 * left out.
 */
export function savedShapeRows(
    library: readonly SavedShape[],
    show: readonly SavedShape[],
    tools: readonly ShapeToolEntry[],
): ShapeLibraryRow[] {
    const mine = new Set(library.map((s) => s.id));
    const rows = (shapes: readonly SavedShape[], inLibrary: boolean) =>
        shapes.flatMap((saved): ShapeLibraryRow[] => {
            const base = tools.find(
                (t) => t.kind.shape.id === saved.kind,
            )?.kind;
            if (!base) return [];
            // A saved shape has its own name, so its note says which kind it is (story 22)
            const note = [
                base.shape.label,
                intervalNote(Object.values(saved.intervals)),
                inLibrary ? null : "this show only",
            ]
                .filter(Boolean)
                .join(" · ");
            return [
                {
                    id: saved.id,
                    group: "saved",
                    label: saved.name,
                    icon: base.shape.icon,
                    kind: savedToolKind(base, saved),
                    note,
                    saved: { shape: saved, inLibrary },
                },
            ];
        });
    return [
        ...rows(library, true),
        ...rows(
            show.filter((s) => !mine.has(s.id)),
            false,
        ),
    ];
}
