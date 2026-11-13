/**
 * Linked Adjust, pathways step 26 (spec v0.10 AP-R12, J.1, J.2; R-14′ item 7): one Adjust shared
 * by a sub-group of a group path's spots, with each spot's own Adjust added on top. A lane drag
 * with several lanes picked makes or edits the sub-group's shared tweak; with one lane picked it
 * stays step 3b's own Adjust (`timelinePathAdjust.ts`). Each edit here is one undo step and writes
 * the shared profile as a whole new value. The key rules are step 3b's (`placeAdjustKey` and I-J4
 * in `@openmarch/core`), applied to the shared profile.
 */
import {
    adjustRefusal,
    groupSchedule,
    placeAdjustKey,
    pruneZeroKeys,
    removeAdjustKey as removeKey,
    validateAdjustProfile,
    type AdjustProfile,
    type AdjustRefusal,
    type RouteGeometry,
    type RouteWalk,
    type XY,
} from "@openmarch/core";
import { and, asc, eq, inArray } from "drizzle-orm";
import { schema } from "@/global/database/db";
import { text } from "@/timeline/timelineText";
import type { DbConnection, DbTransaction } from "./types";
import { transactionWithHistory } from "./history";
import { assertValid, mapDbErrors, refuse } from "./timelineErrors";
import {
    deleteUnsharedLinkedAdjustsInTransaction,
    markLinkedAdjustModelInTransaction,
    type DatabaseTimelineLane,
} from "./timelineLanes";
import { marcherName, refuseSharedSpot, routeRefusal } from "./timelineRoutes";

/** The refusals of AP-R12, translated where they are shown */
export const subgroupRefusal = {
    /** A shared tweak needs two spots or more */
    tooFew: () => text.t("timeline.refusals.route.subgroupTooFew"),
    /** The picked lanes walk different paths */
    twoPaths: () => text.t("timeline.refusals.route.subgroupTwoPaths"),
    /** A picked spot already shares another tweak, or the pick is part of a sub-group */
    mixed: (marcher: string) =>
        text.t("timeline.refusals.route.subgroupMixed", { marcher }),
};

const refusalText = (reason: AdjustRefusal) =>
    reason === "tooShort"
        ? routeRefusal.adjustTooShort()
        : reason === "outside"
          ? routeRefusal.adjustOutside()
          : routeRefusal.adjustTooClose();

/** A spot an edit names: its lane, and the marcher whose spot it is (D-22 names whoever else) */
export interface SubgroupLane {
    laneId: number;
    marcherId: number;
}

/** A linked Adjust's stored profile */
const profileOf = (row: { profile: string }): AdjustProfile =>
    JSON.parse(row.profile) as AdjustProfile;

async function routeOf(tx: DbTransaction, routeId: number) {
    const R = schema.timeline_routes;
    const route = await tx.select().from(R).where(eq(R.id, routeId)).get();
    if (!route) refuse(`route ${routeId} does not exist`);
    const geometry = JSON.parse(route.geometry) as RouteGeometry;
    return {
        geometry,
        schedule: groupSchedule(geometry as unknown as RouteWalk),
    };
}

/** D-22 for every lane: refused while a spot is held by more than one marcher in the move */
async function refuseSharedLanes(
    tx: DbTransaction,
    lanes: readonly DatabaseTimelineLane[],
    marcherOf: (lane: DatabaseTimelineLane) => number | undefined,
): Promise<void> {
    const T = schema.timeline_transitions;
    const A = schema.timeline_assignments;
    for (const lane of lanes) {
        const t = await tx
            .select()
            .from(T)
            .where(eq(T.id, lane.transition_id))
            .get();
        const holder =
            marcherOf(lane) ??
            (
                await tx
                    .select({ m: A.marcher_id })
                    .from(A)
                    .where(
                        and(
                            eq(A.transition_id, lane.transition_id),
                            eq(A.slot_index, lane.slot_index),
                        ),
                    )
                    .orderBy(asc(A.start_beat), asc(A.id))
                    .get()
            )?.m;
        if (t && holder !== undefined)
            await refuseSharedSpot(tx, t, lane.slot_index, holder);
    }
}

/** The lanes sharing linked Adjust `groupAdjustId`, by id */
async function lanesSharing(
    tx: DbConnection | DbTransaction,
    groupAdjustId: number,
): Promise<DatabaseTimelineLane[]> {
    const L = schema.timeline_lanes;
    return await tx
        .select()
        .from(L)
        .where(eq(L.group_adjust_id, groupAdjustId))
        .orderBy(asc(L.id))
        .all();
}

/** I-J3's shape and I-J4 on the route, before a shared profile is written */
function checkProfile(
    geometry: RouteGeometry,
    schedule: ReturnType<typeof groupSchedule>,
    profile: AdjustProfile,
): void {
    assertValid(validateAdjustProfile(profile), "adjust");
    const reason = adjustRefusal(schedule, geometry.points, profile.keys);
    if (reason) refuse(refusalText(reason));
}

/**
 * AP-R12's reset (06 m5): the lanes stop sharing linked Adjust `groupAdjustId` first, then it
 * goes. The spots' own Adjusts stay, since they are relative to the path (S-14-a default).
 */
async function unlink(tx: DbTransaction, groupAdjustId: number) {
    const L = schema.timeline_lanes;
    await tx
        .update(L)
        .set({ group_adjust_id: null })
        .where(eq(L.group_adjust_id, groupAdjustId));
    await deleteUnsharedLinkedAdjustsInTransaction(tx);
}

/** Writes linked Adjust `groupAdjustId`'s profile, or resets it when nothing displaces. */
async function writeShared(
    tx: DbTransaction,
    groupAdjustId: number,
    geometry: RouteGeometry,
    schedule: ReturnType<typeof groupSchedule>,
    profile: AdjustProfile | null,
): Promise<void> {
    if (profile) checkProfile(geometry, schedule, profile);
    await mapDbErrors(async () => {
        if (!profile) return await unlink(tx, groupAdjustId);
        await tx
            .update(schema.timeline_route_adjusts)
            .set({ profile: JSON.stringify(profile) })
            .where(eq(schema.timeline_route_adjusts.id, groupAdjustId));
    });
}

/**
 * AP-R12's refusals for a drag on the lanes `lanes`, and what it writes to: the linked Adjust they
 * are exactly the sharers of, or null for a new one.
 */
async function readPick(tx: DbTransaction, lanes: readonly SubgroupLane[]) {
    const ids = [...new Set(lanes.map((l) => l.laneId))];
    if (ids.length < 2) refuse(subgroupRefusal.tooFew());
    const L = schema.timeline_lanes;
    const rows = await tx
        .select()
        .from(L)
        .where(inArray(L.id, ids))
        .orderBy(asc(L.id))
        .all();
    const marcherOfLane = new Map(lanes.map((l) => [l.laneId, l.marcherId]));
    const nameOf = (lane: DatabaseTimelineLane) =>
        marcherName(tx, marcherOfLane.get(lane.id) ?? -1);
    if (rows.length !== ids.length)
        refuse(
            `lane ${ids.find((id) => !rows.some((r) => r.id === id))} does not exist`,
        );
    for (const lane of rows)
        if (lane.offset_x === null)
            refuse(routeRefusal.notOnGroupPath(await nameOf(lane)));
    if (new Set(rows.map((l) => l.route_id)).size > 1)
        refuse(subgroupRefusal.twoPaths());
    await refuseSharedLanes(tx, rows, (lane) => marcherOfLane.get(lane.id));
    const groups = new Set(rows.map((l) => l.group_adjust_id));
    const only = groups.size === 1 ? [...groups][0]! : undefined;
    let editing: number | null = null;
    if (only !== undefined && only !== null) {
        const sharing = await lanesSharing(tx, only);
        if (
            sharing.length !== rows.length ||
            sharing.some((l) => !ids.includes(l.id))
        )
            refuse(subgroupRefusal.mixed(await nameOf(rows[0]!)));
        editing = only;
    } else if (only === undefined) {
        const inOne = rows.find((l) => l.group_adjust_id !== null)!;
        refuse(subgroupRefusal.mixed(await nameOf(inOne)));
    }
    return { ids, rows, editing };
}

/**
 * AP-R12 by a lane drag with several lanes picked: the sub-group of `lanes` is displaced by `d` at
 * place `x` along its route, `d` being the shared profile's whole value there (the grabbed lane's
 * displacement less its own Adjust). When the lanes are exactly the sharers of one linked Adjust,
 * that one is edited; when none of them shares one, a new one is made for them. Refused for fewer
 * than two, lanes of different paths or not on a group path, a spot held by two marchers (D-22),
 * and a pick that mixes a sub-group with others (a spot can share only one tweak; resetting it
 * first, or picking the whole sub-group, is the way). Returns the linked Adjust's id, or null when
 * the edit left nothing that displaces (it is then reset).
 */
export async function adjustSubgroupInTransaction({
    tx,
    lanes,
    x,
    d,
}: {
    tx: DbTransaction;
    lanes: readonly SubgroupLane[];
    x: number;
    d: XY;
}): Promise<{ groupAdjustId: number | null }> {
    const { ids, rows, editing } = await readPick(tx, lanes);
    const routeId = rows[0]!.route_id;
    const { geometry, schedule } = await routeOf(tx, routeId);
    const G = schema.timeline_route_adjusts;
    const current =
        editing === null
            ? null
            : profileOf(
                  (await tx.select().from(G).where(eq(G.id, editing)).get())!,
              );
    const placed = placeAdjustKey({
        schedule,
        points: geometry.points,
        profile: current,
        x,
        d,
    });
    if (!placed.ok) refuse(refusalText(placed.reason));
    if (editing !== null) {
        await writeShared(tx, editing, geometry, schedule, placed.profile);
        return { groupAdjustId: placed.profile ? editing : null };
    }
    if (!placed.profile) return { groupAdjustId: null };
    checkProfile(geometry, schedule, placed.profile);
    return await mapDbErrors(async () => {
        const made = (await tx
            .insert(G)
            .values({
                route_id: routeId,
                profile: JSON.stringify(placed.profile),
            })
            .returning()
            .get())!;
        const L = schema.timeline_lanes;
        await tx
            .update(L)
            .set({ group_adjust_id: made.id })
            .where(inArray(L.id, ids));
        await markLinkedAdjustModelInTransaction(tx);
        return { groupAdjustId: made.id };
    });
}

/** The linked Adjust `groupAdjustId` with its route, after D-22 on every lane sharing it. */
async function readShared(tx: DbTransaction, groupAdjustId: number) {
    const G = schema.timeline_route_adjusts;
    const row = await tx.select().from(G).where(eq(G.id, groupAdjustId)).get();
    if (!row) refuse(`linked Adjust ${groupAdjustId} does not exist`);
    await refuseSharedLanes(
        tx,
        await lanesSharing(tx, groupAdjustId),
        () => undefined,
    );
    return {
        row,
        profile: profileOf(row),
        ...(await routeOf(tx, row.route_id)),
    };
}

/** A dragged key handle of a shared profile: key `index` takes displacement `d`, its place kept. */
export async function setSubgroupKeyInTransaction({
    tx,
    groupAdjustId,
    index,
    d,
}: {
    tx: DbTransaction;
    groupAdjustId: number;
    index: number;
    d: XY;
}): Promise<void> {
    const { profile, geometry, schedule } = await readShared(tx, groupAdjustId);
    if (!profile.keys[index])
        refuse(`linked Adjust ${groupAdjustId} has no key ${index}`);
    const keys = pruneZeroKeys(
        profile.keys.map((k, i) =>
            i === index ? { ...k, d: [d[0], d[1]] as XY } : k,
        ),
    );
    await writeShared(
        tx,
        groupAdjustId,
        geometry,
        schedule,
        keys ? { v: 1, keys } : null,
    );
}

/** Removes key `index` of a shared profile, and any zero key it leaves stranded. */
export async function removeSubgroupKeyInTransaction({
    tx,
    groupAdjustId,
    index,
}: {
    tx: DbTransaction;
    groupAdjustId: number;
    index: number;
}): Promise<void> {
    const { profile, geometry, schedule } = await readShared(tx, groupAdjustId);
    if (!profile.keys[index])
        refuse(`linked Adjust ${groupAdjustId} has no key ${index}`);
    await writeShared(
        tx,
        groupAdjustId,
        geometry,
        schedule,
        removeKey(profile, index),
    );
}

/**
 * AP-R12 Reset: the sub-group's spots stop sharing the tweak and it goes. Each spot's own Adjust
 * stays as it is, so a spot tweaked on top keeps that tweak, now relative to the group path.
 */
export async function resetSubgroupInTransaction({
    tx,
    groupAdjustId,
}: {
    tx: DbTransaction;
    groupAdjustId: number;
}): Promise<void> {
    await readShared(tx, groupAdjustId);
    await mapDbErrors(() => unlink(tx, groupAdjustId));
}

/** Takes the "re-homed" badge off linked Adjust `groupAdjustId`. Positions don't change. */
export async function acknowledgeSubgroupRehomedInTransaction(
    tx: DbTransaction,
    routeId: number,
): Promise<void> {
    const G = schema.timeline_route_adjusts;
    for (const row of await tx
        .select()
        .from(G)
        .where(eq(G.route_id, routeId))
        .all()) {
        const profile = profileOf(row);
        if (!profile.rehomed) continue;
        await tx
            .update(G)
            .set({ profile: JSON.stringify({ v: 1, keys: profile.keys }) })
            .where(eq(G.id, row.id));
    }
}

/** Runs `edit` as one undoable edit named `name`. */
const undoable =
    <A extends { tx: DbTransaction }, R>(
        name: string,
        edit: (args: A) => Promise<R>,
    ) =>
    ({ db, ...rest }: Omit<A, "tx"> & { db: DbConnection }): Promise<R> =>
        transactionWithHistory(db, name, (tx) =>
            edit({ tx, ...rest } as unknown as A),
        );

export const adjustSubgroup = undoable(
    "adjustSubgroup",
    adjustSubgroupInTransaction,
);
export const setSubgroupKey = undoable(
    "setSubgroupKey",
    setSubgroupKeyInTransaction,
);
export const removeSubgroupKey = undoable(
    "removeSubgroupKey",
    removeSubgroupKeyInTransaction,
);
export const resetSubgroup = undoable(
    "resetSubgroup",
    resetSubgroupInTransaction,
);
