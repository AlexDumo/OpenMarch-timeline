import { and, asc, eq, inArray, lt, or, gt } from "drizzle-orm";
import {
    validateDestination,
    validateDestinations,
    validatePathParams,
    type OrderMode,
    type PathStyle,
    type XY,
} from "@openmarch/core";
import { schema } from "@/global/database/db";
import { DbTransaction } from "./types";
import {
    assertValid,
    mapDbErrors,
    refuse,
    TimelineWriteError,
} from "./timelineErrors";

/** A row of `timeline_transitions`; `path_params` is JSON text (spec 5.2). */
export type DatabaseTimelineTransition =
    typeof schema.timeline_transitions.$inferSelect;
/** A row of `timeline_slot_destinations`. */
export type DatabaseTimelineSlotDestination =
    typeof schema.timeline_slot_destinations.$inferSelect;

/** Where a transition ends: a shape, or one point per slot (D-16). */
export type TimelineTransitionDestination =
    | { kind: "shape"; shapeId: number }
    | { kind: "individual"; points: XY[] };

/** Path parameters by style: `null` (direct), `{bulge}` (arc), `{waypoints}` (follow_the_leader). */
export type TimelinePathParams = { bulge: number } | { waypoints: XY[] } | null;

export interface NewTimelineTransitionArgs {
    timelineId: number;
    startBeat: number;
    endBeat: number;
    slotCount: number;
    destination: TimelineTransitionDestination;
    pathStyle?: PathStyle;
    pathParams?: TimelinePathParams;
    orderMode?: OrderMode;
}

export interface ModifiedTimelineTransitionArgs {
    id: number;
    /** Changing the style needs its `pathParams` too (null for direct). */
    pathStyle?: PathStyle;
    pathParams?: TimelinePathParams;
    orderMode?: OrderMode;
    /**
     * Shapeless transitions keep one destination per slot, so a new `slotCount` needs the full
     * new `points` in the same call.
     */
    slotCount?: number;
    points?: XY[];
    /**
     * A plain range update. It is rejected (E-A1) when it would strand an assignment; the R-E1
     * range procedure (P4.5) is what moves anchored assignments.
     */
    startBeat?: number;
    endBeat?: number;
}

const paramsToJson = (params: TimelinePathParams | undefined): string | null =>
    params === undefined || params === null ? null : JSON.stringify(params);

const requireTransition = async (
    tx: DbTransaction,
    id: number,
): Promise<DatabaseTimelineTransition> => {
    const row = await tx
        .select()
        .from(schema.timeline_transitions)
        .where(eq(schema.timeline_transitions.id, id))
        .get();
    if (!row) refuse(`transition ${id} does not exist`);
    return row;
};

const insertDestinations = async (
    tx: DbTransaction,
    transitionId: number,
    points: readonly XY[],
) => {
    if (points.length === 0) return;
    await tx.insert(schema.timeline_slot_destinations).values(
        points.map((p, slot) => ({
            transition_id: transitionId,
            slot_index: slot,
            x: p[0],
            y: p[1],
        })),
    );
};

const refuseFtlWithoutShape = (): never => {
    throw new TimelineWriteError(
        "E-T5",
        "follow_the_leader needs a destination shape",
    );
};

export const getTimelineTransitionById = async ({
    tx,
    id,
}: {
    tx: DbTransaction;
    id: number;
}): Promise<DatabaseTimelineTransition | undefined> =>
    await tx
        .select()
        .from(schema.timeline_transitions)
        .where(eq(schema.timeline_transitions.id, id))
        .get();

export const getTimelineSlotDestinations = async ({
    tx,
    transitionId,
}: {
    tx: DbTransaction;
    transitionId: number;
}): Promise<DatabaseTimelineSlotDestination[]> =>
    await tx
        .select()
        .from(schema.timeline_slot_destinations)
        .where(
            eq(schema.timeline_slot_destinations.transition_id, transitionId),
        )
        .orderBy(asc(schema.timeline_slot_destinations.slot_index));

/**
 * Creates transitions, each with its destination in the same edit: a shape id, or one point per
 * slot (I-T6). Path parameters and points are validated first (E-P1, E-D2).
 */
export const createTimelineTransitionsInTransaction = async ({
    newTransitions,
    tx,
}: {
    newTransitions: NewTimelineTransitionArgs[];
    tx: DbTransaction;
}): Promise<DatabaseTimelineTransition[]> => {
    for (const t of newTransitions) {
        const style = t.pathStyle ?? "direct";
        assertValid(
            validatePathParams(style, t.pathParams ?? null),
            "path parameters",
        );
        if (t.destination.kind === "individual") {
            assertValid(
                validateDestinations(t.destination.points, t.slotCount),
                "destinations",
            );
            if (style === "follow_the_leader") refuseFtlWithoutShape();
        }
    }
    const created: DatabaseTimelineTransition[] = [];
    for (const t of newTransitions) {
        const row = await mapDbErrors(async () => {
            const inserted = await tx
                .insert(schema.timeline_transitions)
                .values({
                    timeline_id: t.timelineId,
                    dest_shape_id:
                        t.destination.kind === "shape"
                            ? t.destination.shapeId
                            : null,
                    path_style: t.pathStyle ?? "direct",
                    path_params: paramsToJson(t.pathParams),
                    order_mode: t.orderMode ?? "inherit",
                    slot_count: t.slotCount,
                    start_beat: t.startBeat,
                    end_beat: t.endBeat,
                })
                .returning()
                .get();
            if (t.destination.kind === "individual")
                await insertDestinations(tx, inserted.id, t.destination.points);
            return inserted;
        });
        created.push(row);
    }
    return created;
};

/**
 * Updates transitions' style, params, order mode, slot count and plain range. Everything is
 * validated before the first write. Ranges that would strand an assignment are refused (E-A1).
 */
// eslint-disable-next-line max-lines-per-function
export const updateTimelineTransitionsInTransaction = async ({
    modifiedTransitions,
    tx,
}: {
    modifiedTransitions: ModifiedTimelineTransitionArgs[];
    tx: DbTransaction;
}): Promise<DatabaseTimelineTransition[]> => {
    const plans: {
        m: ModifiedTimelineTransitionArgs;
        set: Partial<typeof schema.timeline_transitions.$inferInsert>;
        replaceDestinations: boolean;
    }[] = [];
    for (const m of modifiedTransitions) {
        const existing = await requireTransition(tx, m.id);
        const set: Partial<typeof schema.timeline_transitions.$inferInsert> =
            {};
        const style = m.pathStyle ?? (existing.path_style as PathStyle);
        if (m.pathStyle !== undefined || m.pathParams !== undefined) {
            let params: unknown = null;
            if (m.pathStyle !== undefined) params = m.pathParams ?? null;
            else if (m.pathParams !== undefined) params = m.pathParams;
            assertValid(validatePathParams(style, params), "path parameters");
            set.path_style = style;
            set.path_params = paramsToJson(m.pathParams);
        }
        if (style === "follow_the_leader" && existing.dest_shape_id === null)
            refuseFtlWithoutShape();
        if (m.orderMode !== undefined) set.order_mode = m.orderMode;

        let replaceDestinations = false;
        const slotCount = m.slotCount ?? existing.slot_count;
        if (m.slotCount !== undefined) set.slot_count = m.slotCount;
        if (existing.dest_shape_id === null) {
            if (
                m.slotCount !== undefined &&
                m.slotCount !== existing.slot_count
            ) {
                if (m.points === undefined)
                    refuse(
                        "changing the slot count of a transition with individual destinations needs the new points",
                    );
            }
            if (m.points !== undefined) {
                assertValid(
                    validateDestinations(m.points, slotCount),
                    "destinations",
                );
                replaceDestinations = true;
            }
        } else if (m.points !== undefined) {
            refuse("a transition with a destination shape has no points");
        }

        if (m.startBeat !== undefined || m.endBeat !== undefined) {
            const start = m.startBeat ?? existing.start_beat;
            const end = m.endBeat ?? existing.end_beat;
            set.start_beat = start;
            set.end_beat = end;
            const stranded = await tx
                .select({ id: schema.timeline_assignments.id })
                .from(schema.timeline_assignments)
                .where(
                    and(
                        eq(schema.timeline_assignments.transition_id, m.id),
                        or(
                            lt(schema.timeline_assignments.start_beat, start),
                            gt(schema.timeline_assignments.end_beat, end),
                        ),
                    ),
                )
                .all();
            if (stranded.length > 0)
                throw new TimelineWriteError(
                    "E-A1",
                    `range [${start}, ${end}) would strand assignment(s) ${stranded
                        .map((a) => a.id)
                        .join(", ")}`,
                );
        }
        plans.push({ m, set, replaceDestinations });
    }

    const updated: DatabaseTimelineTransition[] = [];
    for (const { m, set, replaceDestinations } of plans) {
        const row = await mapDbErrors(async () => {
            // The triggers reject a slot count below a placed destination, so clear first
            if (replaceDestinations)
                await tx
                    .delete(schema.timeline_slot_destinations)
                    .where(
                        eq(
                            schema.timeline_slot_destinations.transition_id,
                            m.id,
                        ),
                    );
            const result =
                Object.keys(set).length === 0
                    ? await requireTransition(tx, m.id)
                    : await tx
                          .update(schema.timeline_transitions)
                          .set(set)
                          .where(eq(schema.timeline_transitions.id, m.id))
                          .returning()
                          .get();
            if (replaceDestinations)
                await insertDestinations(tx, m.id, m.points!);
            return result;
        });
        updated.push(row);
    }
    return updated;
};

/**
 * Sets a transition's destination, switching between a shape and individual points in one edit.
 *
 * The triggers fix the order (I-T6): to individual points, the shape is cleared first and then
 * every point is inserted; to a shape, the points are deleted first and then the shape is set.
 * Points are validated (E-D2) before anything is written.
 */
export const setTimelineTransitionDestinationInTransaction = async ({
    transitionId,
    destination,
    tx,
}: {
    transitionId: number;
    destination: TimelineTransitionDestination;
    tx: DbTransaction;
}): Promise<DatabaseTimelineTransition> => {
    const existing = await requireTransition(tx, transitionId);
    if (destination.kind === "individual") {
        assertValid(
            validateDestinations(destination.points, existing.slot_count),
            "destinations",
        );
        if (existing.path_style === "follow_the_leader")
            refuseFtlWithoutShape();
    }
    return await mapDbErrors(async () => {
        const destinations = schema.timeline_slot_destinations;
        if (destination.kind === "shape") {
            await tx
                .delete(destinations)
                .where(eq(destinations.transition_id, transitionId));
            return await tx
                .update(schema.timeline_transitions)
                .set({ dest_shape_id: destination.shapeId })
                .where(eq(schema.timeline_transitions.id, transitionId))
                .returning()
                .get();
        }
        const row = await tx
            .update(schema.timeline_transitions)
            .set({ dest_shape_id: null })
            .where(eq(schema.timeline_transitions.id, transitionId))
            .returning()
            .get();
        await tx
            .delete(destinations)
            .where(eq(destinations.transition_id, transitionId));
        await insertDestinations(tx, transitionId, destination.points);
        return row;
    });
};

/** Replaces the individual destinations of a shapeless transition (one point per slot). */
export const setTimelineSlotDestinationsInTransaction = async ({
    transitionId,
    points,
    tx,
}: {
    transitionId: number;
    points: XY[];
    tx: DbTransaction;
}): Promise<DatabaseTimelineSlotDestination[]> => {
    const existing = await requireTransition(tx, transitionId);
    if (existing.dest_shape_id !== null)
        refuse(
            `transition ${transitionId} has a destination shape; switch it to individual destinations instead`,
        );
    assertValid(
        validateDestinations(points, existing.slot_count),
        "destinations",
    );
    await mapDbErrors(async () => {
        await tx
            .delete(schema.timeline_slot_destinations)
            .where(
                eq(
                    schema.timeline_slot_destinations.transition_id,
                    transitionId,
                ),
            );
        await insertDestinations(tx, transitionId, points);
    });
    return await getTimelineSlotDestinations({ tx, transitionId });
};

/** Moves one slot's individual destination. */
export const updateTimelineSlotDestinationInTransaction = async ({
    transitionId,
    slotIndex,
    point,
    tx,
}: {
    transitionId: number;
    slotIndex: number;
    point: XY;
    tx: DbTransaction;
}): Promise<DatabaseTimelineSlotDestination> => {
    assertValid(validateDestination(point), "destination");
    const d = schema.timeline_slot_destinations;
    const row = await mapDbErrors(() =>
        tx
            .update(d)
            .set({ x: point[0], y: point[1] })
            .where(
                and(
                    eq(d.transition_id, transitionId),
                    eq(d.slot_index, slotIndex),
                ),
            )
            .returning()
            .get(),
    );
    if (!row)
        refuse(
            `transition ${transitionId} has no destination at slot ${slotIndex}`,
        );
    return row;
};

/**
 * Deletes the children of transitions, in the order the foreign keys need (C-1, P4.6): their
 * assignments, then their slot destinations. The app's BEFORE DELETE history trigger logs rows in
 * the order they are deleted and undo replays that log in reverse, so a parent must never be
 * deleted before its children.
 */
export const deleteTimelineTransitionChildrenInTransaction = async ({
    transitionIds,
    tx,
}: {
    transitionIds: number[];
    tx: DbTransaction;
}): Promise<void> => {
    if (transitionIds.length === 0) return;
    await tx
        .delete(schema.timeline_assignments)
        .where(
            inArray(schema.timeline_assignments.transition_id, transitionIds),
        );
    await tx
        .delete(schema.timeline_slot_destinations)
        .where(
            inArray(
                schema.timeline_slot_destinations.transition_id,
                transitionIds,
            ),
        );
};

/**
 * Deletes transitions and everything under them: assignments and slot destinations first, then
 * the transitions (C-1). Returns the deleted transitions; missing ids are ignored.
 */
export const deleteTimelineTransitionsInTransaction = async ({
    transitionIds,
    tx,
}: {
    transitionIds: Set<number>;
    tx: DbTransaction;
}): Promise<DatabaseTimelineTransition[]> => {
    if (transitionIds.size === 0) return [];
    const ids = [...transitionIds];
    return await mapDbErrors(async () => {
        await deleteTimelineTransitionChildrenInTransaction({
            transitionIds: ids,
            tx,
        });
        return await tx
            .delete(schema.timeline_transitions)
            .where(inArray(schema.timeline_transitions.id, ids))
            .returning();
    });
};
