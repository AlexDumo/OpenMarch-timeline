import { assignSlots, type AssignMarcher, type OrderMode } from "./assign";
import { shapeKind } from "./registry";
import type {
    AnyShapeKind,
    HandleDef,
    ParamField,
    Readout,
    ShapeContext,
    ShapeIssue,
    Slot,
    XY,
} from "./types";
import { validateSlots } from "./validate";

/**
 * One use of the shape tool: the marchers it places, the kind and its params, and who goes to
 * which slot. Pure functions; `shapeToolStore` holds the current session.
 *
 * The assignment is made when the session starts, and again only when the kind or the order
 * changes or the user asks (Reassign). Dragging handles or changing spacing keeps it, so marchers
 * don't swap spots under the cursor.
 */
export interface ShapeSession {
    readonly kindId: string;
    readonly params: unknown;
    /** In selection order, with where they stand when the tool opened */
    readonly marchers: readonly AssignMarcher[];
    readonly order: OrderMode;
    readonly reverse: boolean;
    /** The slot index for each marcher, in `marchers` order */
    readonly assignment: readonly number[];
}

export const DEFAULT_ORDER: OrderMode = "keep";

function kindOf(id: string): AnyShapeKind {
    const kind = shapeKind(id);
    if (!kind) throw new Error(`Unknown shape kind "${id}"`);
    return kind;
}

function fieldsOf(kind: AnyShapeKind): ParamField[] {
    return kind.groups.flatMap((group) => group.fields);
}

/**
 * `toParams` with the panel fields it shares with the other kind (same key and type) taken from
 * `fromParams`, so a spacing set on a line carries over to an arc.
 */
export function carryOverParams(
    fromKind: AnyShapeKind,
    fromParams: unknown,
    toKind: AnyShapeKind,
    toParams: unknown,
): unknown {
    const from = new Map(fieldsOf(fromKind).map((f) => [f.key, f.type]));
    const next = { ...(toParams as Record<string, unknown>) };
    for (const field of fieldsOf(toKind)) {
        if (from.get(field.key) !== field.type) continue;
        const value = (fromParams as Record<string, unknown>)[field.key];
        if (value !== undefined) next[field.key] = value;
    }
    return next;
}

function withAssignment(
    session: Omit<ShapeSession, "assignment">,
    ctx: ShapeContext,
): ShapeSession {
    const kind = kindOf(session.kindId);
    const slots = kind.generate(session.params, session.marchers.length, ctx);
    return {
        ...session,
        assignment: assignSlots({
            kind,
            params: session.params,
            slots,
            marchers: session.marchers,
            mode: session.order,
            reverse: session.reverse,
            ctx,
        }),
    };
}

export function startSession({
    kindId,
    marchers,
    ctx,
    previous,
}: {
    kindId: string;
    marchers: readonly AssignMarcher[];
    ctx: ShapeContext;
    /** The last session, whose shared settings (spacing, order) carry over */
    previous?: ShapeSession | null;
}): ShapeSession {
    const kind = kindOf(kindId);
    let params = kind.fit({ current: marchers.map((m) => m.at) }, ctx);
    if (previous) {
        params = carryOverParams(
            kindOf(previous.kindId),
            previous.params,
            kind,
            params,
        );
    }
    return withAssignment(
        {
            kindId,
            params,
            marchers,
            order: previous?.order ?? DEFAULT_ORDER,
            reverse: previous?.reverse ?? false,
        },
        ctx,
    );
}

/** Another kind for the same marchers: fitted afresh, shared settings kept, reassigned. */
export function changeKind(
    session: ShapeSession,
    kindId: string,
    ctx: ShapeContext,
): ShapeSession {
    if (kindId === session.kindId) return session;
    return startSession({
        kindId,
        marchers: session.marchers,
        ctx,
        previous: session,
    });
}

export function changeParams(
    session: ShapeSession,
    params: unknown,
): ShapeSession {
    return { ...session, params };
}

export function changeOrder(
    session: ShapeSession,
    order: OrderMode,
    reverse: boolean,
    ctx: ShapeContext,
): ShapeSession {
    return withAssignment({ ...session, order, reverse }, ctx);
}

export function reassign(
    session: ShapeSession,
    ctx: ShapeContext,
): ShapeSession {
    return withAssignment(session, ctx);
}

export function dragHandle(
    session: ShapeSession,
    /** The params when the drag started; every move is planned from them */
    base: unknown,
    key: string,
    to: XY,
    shift: boolean,
    ctx: ShapeContext,
): ShapeSession {
    const kind = kindOf(session.kindId);
    return {
        ...session,
        params: kind.drag(
            base,
            key,
            ctx.snapPoint(to),
            { shift },
            session.marchers.length,
            ctx,
        ),
    };
}

/**
 * The whole shape moved by `delta`, through the kind's move handle, so every kind that has one
 * can be nudged the same way. A kind without a move handle doesn't move.
 */
export function translateSession(
    session: ShapeSession,
    delta: XY,
    ctx: ShapeContext,
): ShapeSession {
    const kind = kindOf(session.kindId);
    const n = session.marchers.length;
    const handle = kind
        .handles(session.params, n, ctx)
        .find((h) => h.role === "move");
    if (!handle) return session;
    const to = { x: handle.at.x + delta.x, y: handle.at.y + delta.y };
    return {
        ...session,
        params: kind.drag(
            session.params,
            handle.key,
            to,
            { shift: false },
            n,
            ctx,
        ),
    };
}

export interface ShapePreview {
    readonly slots: readonly Slot[];
    /** Where each marcher goes, in `session.marchers` order */
    readonly targets: readonly {
        readonly id: number;
        readonly from: XY;
        readonly to: XY;
    }[];
    readonly outline: readonly XY[][];
    readonly handles: readonly HandleDef[];
    readonly readouts: readonly Readout[];
    readonly issues: readonly ShapeIssue[];
    /** False when an error issue stops Apply */
    readonly canApply: boolean;
}

export function previewSession(
    session: ShapeSession,
    ctx: ShapeContext,
): ShapePreview {
    const kind = kindOf(session.kindId);
    const n = session.marchers.length;
    const slots = kind.generate(session.params, n, ctx);
    const targets = session.marchers.map((m, i) => ({
        id: m.id,
        from: m.at,
        to: slots[session.assignment[i]!]!,
    }));
    const issues = [
        ...(kind.validate?.(session.params, slots, ctx) ?? []),
        ...validateSlots(slots, ctx),
    ];
    return {
        slots,
        targets,
        outline: kind.outline(session.params, n, ctx),
        handles: kind.handles(session.params, n, ctx),
        readouts: kind.readouts?.(session.params, n, ctx) ?? [],
        issues,
        canApply: n > 0 && !issues.some((issue) => issue.level === "error"),
    };
}
