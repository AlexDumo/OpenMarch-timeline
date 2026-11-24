import { afterEach, describe, expect, it as unitIt } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { type DbConnection, describeDbTests, schema } from "@/test/base";
import { readShowTiming } from "@/timeline/showTiming";
import {
    startTimelineResolver,
    stopTimelineResolver,
    timelineResolverSettled,
    useTimelineResolverStore,
} from "@/timeline/timelineStore";
import type { CanvasEditPlan } from "@/timeline/timelineCoordinateWrites";
import { performRedo, performUndo } from "@/db-functions/history";
import { createLastPage, deletePages } from "@/db-functions/page";
import { moveMarchersInTarget } from "@/db-functions/timelineMoves";
import {
    readAllShapeRecipes,
    saveShapeRecipeInTransaction,
    type ShapeRecipeRecord,
} from "@/db-functions/shapeRecipes";
import { lineShape } from "../../line/lineShape";
import { lineSpots, type LineParams } from "../../line/lineGeometry";
import { endPoint } from "../../line/lineLinks";
import { arcShape } from "../../arc/arcShape";
import { writePlacement } from "../../tool/shapePlacement";
import type { ShapeContext, XY } from "../../types";
import { boxesAt, type PlacedBox, type PlacedRecipe } from "../placedBox";
import { linkedPlacements, linkedSave } from "../commitBox";
import { liveTargets } from "../liveBox";
import {
    attachedParams,
    attachSnap,
    detachedParams,
    followersOf,
    liveLinks,
    withoutDeadLinks,
} from "../shapeLinks";

/**
 * Linked shapes (#1235): which stored attachments are live, where a dragged end snaps, who follows
 * an edit and how far, and that saving an edit with its followers is one undo step that redo
 * brings back, the link read back as saved.
 */

const STEP = 12;
const ctx: ShapeContext = { stepPx: STEP, snapPoint: (p) => p };
const FIT = { mode: "fit" } as const;

const straight = (from: XY, to: XY): LineParams => ({
    points: [
        { ...from, tension: 0 },
        { ...to, tension: 0 },
    ],
    spacing: FIT,
});
const arc = (from: XY, to: XY): LineParams => ({
    points: [
        { ...from, tension: 0, bend: 180 },
        { ...to, tension: 0 },
    ],
    spacing: FIT,
});

/** A recipe of `kind` with members `ids` on its spots in order, in move `timelineId` */
function recipe(
    id: number,
    kind: { id: string; version: number },
    params: LineParams,
    ids: readonly number[],
    timelineId: number | null = 5,
): PlacedRecipe {
    const spots = lineSpots(params, ids.length);
    return {
        id,
        timelineId,
        kind: kind.id,
        kindVersion: kind.version,
        params: { ...params, spots: ids.length },
        orderMode: "nearest",
        reverse: false,
        members: ids.map((marcherId, slot) => ({
            marcherId,
            slot,
            x: spots[slot]!.x,
            y: spots[slot]!.y,
        })),
    };
}

/** The recipes as placed shapes at `beat`, each member on its spot, every move ending at 0 */
function placed(recipes: readonly PlacedRecipe[], beat = 0): PlacedBox[] {
    const at = new Map(
        recipes.flatMap((r) =>
            r.members.map((m) => [m.marcherId, { x: m.x, y: m.y }] as const),
        ),
    );
    return boxesAt({
        recipes,
        endBeatOf: () => 0,
        beat,
        positionOf: (id) => at.get(id),
    });
}

const byId = (boxes: readonly PlacedBox[], id: number) =>
    boxes.find((b) => b.recipe.id === id)!;

// The trumpets' line straight down, the tubas' arc from its bottom end round to the left (a J)
const LINE = straight({ x: 0, y: 0 }, { x: 0, y: 60 });
const ARC = arc({ x: 0, y: 60 }, { x: -40, y: 60 });
const attachedArc: LineParams = {
    ...ARC,
    attach: { start: { recipe: 1, end: "end" } },
};
const J = () =>
    placed([
        recipe(1, lineShape, LINE, [11, 12, 13, 14]),
        recipe(2, arcShape, attachedArc, [21, 22, 23]),
    ]);

describe("liveLinks", () => {
    unitIt(
        "links an attached end on the other shape's end, on the same move",
        () => {
            const links = liveLinks(J(), 0);
            expect(links).toHaveLength(1);
            expect(links[0]!.attacher.recipe.id).toBe(2);
            expect(links[0]!.owner.recipe.id).toBe(1);
            expect(links[0]!.at).toEqual({ x: 0, y: 60 });
        },
    );

    unitIt("puts exactly one marcher on the joint, the line's", () => {
        const boxes = J();
        const onJoint = boxes.flatMap((b) =>
            b.recipe.members.filter(
                (m) => Math.hypot(m.x - 0, m.y - 60) < 1e-6,
            ),
        );
        expect(onJoint.map((m) => m.marcherId)).toEqual([14]);
        // The arc's first tuba is one of the arc's own intervals past the joint, along it
        const arcBox = byId(boxes, 2);
        const spots = lineSpots(arcBox.params as LineParams, 3);
        expect(spots[0]!.s).toBeGreaterThan(0);
    });

    unitIt(
        "is dead on another move, off the joint, on a later page or when its shape is gone",
        () => {
            const other = placed([
                recipe(1, lineShape, LINE, [11, 12, 13, 14], 6),
                recipe(2, arcShape, attachedArc, [21, 22, 23], 5),
            ]);
            expect(liveLinks(other, 0)).toEqual([]);
            const off = placed([
                recipe(
                    1,
                    lineShape,
                    straight({ x: 0, y: 0 }, { x: 0, y: 48 }),
                    [11, 12, 13, 14],
                ),
                recipe(2, arcShape, attachedArc, [21, 22, 23]),
            ]);
            expect(liveLinks(off, 0)).toEqual([]);
            // Carried onto a later page: shown, but not linked there
            expect(liveLinks(J(), 8)).toEqual([]);
            const alone = placed([
                recipe(2, arcShape, attachedArc, [21, 22, 23]),
            ]);
            expect(liveLinks(alone, 0)).toEqual([]);
            // The next save drops the dead attachment: the end holds its marcher again
            const arcBox = alone[0]!;
            expect(
                (
                    withoutDeadLinks(
                        arcBox,
                        arcBox.params,
                        alone,
                        0,
                    ) as LineParams
                ).attach,
            ).toBeUndefined();
        },
    );
});

describe("attachSnap", () => {
    const apart = () =>
        placed([
            recipe(1, lineShape, LINE, [11, 12, 13, 14]),
            recipe(
                2,
                arcShape,
                arc({ x: 30, y: 80 }, { x: -10, y: 80 }),
                [21, 22, 23],
            ),
        ]);

    unitIt(
        "snaps a dragged end near another shape's free end, and attaches it there",
        () => {
            const boxes = apart();
            const arcBox = byId(boxes, 2);
            // Dragged whole so its start comes near the line's bottom end
            const dragged = arc({ x: 2, y: 61 }, { x: -38, y: 61 });
            const snap = attachSnap({
                box: arcBox,
                params: dragged,
                boxes,
                links: [],
                radius: 5,
                beat: 0,
            });
            expect(snap).toMatchObject({
                end: "start",
                ownerEnd: "end",
                at: { x: 0, y: 60 },
            });
            const attached = attachedParams(dragged, snap!, true);
            expect(endPoint(attached, "start")).toEqual({ x: 0, y: 60 });
            expect(endPoint(attached, "end")).toEqual({ x: -40, y: 60 });
            expect(attached.attach).toEqual({
                start: { recipe: 1, end: "end" },
            });
            // Saving it keeps the new attachment: it links once saved
            const saved = linkedSave(arcBox, attached, boxes, 0, false);
            expect((saved.params as LineParams).attach).toEqual(
                attached.attach,
            );
            expect(saved.others).toEqual([]);
            // But not on a later page the shapes are only carried onto
            const carried = linkedSave(arcBox, attached, boxes, 0, true);
            expect((carried.params as LineParams).attach).toBeUndefined();
        },
    );

    unitIt(
        "keeps the link when the attached shape is moved whole: the other's end follows",
        () => {
            const boxes = J();
            const arcBox = byId(boxes, 2);
            const moved: LineParams = {
                ...attachedArc,
                points: attachedArc.points.map((q) => ({ ...q, y: q.y + 12 })),
            };
            const saved = linkedSave(arcBox, moved, boxes, 0, false);
            expect((saved.params as LineParams).attach).toEqual(
                attachedArc.attach,
            );
            expect(saved.others).toHaveLength(1);
            expect(
                endPoint(saved.others[0]!.params as LineParams, "end"),
            ).toEqual({
                x: 0,
                y: 72,
            });
        },
    );

    unitIt(
        "doesn't snap out of reach, to a linked end, or an end the drag didn't move",
        () => {
            const boxes = apart();
            const arcBox = byId(boxes, 2);
            const far = arc({ x: 20, y: 61 }, { x: -20, y: 61 });
            expect(
                attachSnap({
                    box: arcBox,
                    params: far,
                    boxes,
                    links: [],
                    radius: 5,
                    beat: 0,
                }),
            ).toBeNull();
            // The line's bottom end is already in a link
            const linked = J();
            const third = placed([
                ...linked.map((b) => b.recipe),
                recipe(
                    3,
                    lineShape,
                    straight({ x: 30, y: 80 }, { x: 60, y: 80 }),
                    [31, 32],
                ),
            ]);
            const thirdBox = byId(third, 3);
            expect(
                attachSnap({
                    box: thirdBox,
                    params: straight({ x: 1, y: 61 }, { x: 60, y: 80 }),
                    boxes: third,
                    links: liveLinks(third, 0),
                    radius: 5,
                    beat: 0,
                }),
            ).toBeNull();
        },
    );
});

describe("followersOf", () => {
    unitIt("stretches the arc when the line moves, its far end staying", () => {
        const boxes = J();
        const links = liveLinks(boxes, 0);
        const moved = straight({ x: 24, y: 0 }, { x: 24, y: 60 });
        const followers = followersOf(byId(boxes, 1), moved, links);
        expect(followers).toHaveLength(1);
        const p = followers[0]!.params;
        expect(endPoint(p, "start")).toEqual({ x: 24, y: 60 });
        expect(endPoint(p, "end")).toEqual({ x: -40, y: 60 });
        expect(p.attach).toEqual(attachedArc.attach);
    });

    unitIt(
        "moves the line's end when the arc's attached end is dragged (the joint)",
        () => {
            const boxes = J();
            const links = liveLinks(boxes, 0);
            const arcBox = byId(boxes, 2);
            const dragged = {
                ...attachedArc,
                points: [
                    { ...attachedArc.points[0]!, x: 12, y: 72 },
                    attachedArc.points[1]!,
                ],
            };
            const [line] = followersOf(arcBox, dragged, links);
            expect(line!.box.recipe.id).toBe(1);
            expect(endPoint(line!.params, "end")).toEqual({ x: 12, y: 72 });
            expect(endPoint(line!.params, "start")).toEqual({ x: 0, y: 0 });
        },
    );

    unitIt("leaves out shapes whose joint didn't move (a bend deeper)", () => {
        const boxes = J();
        const links = liveLinks(boxes, 0);
        const deeper = {
            ...attachedArc,
            points: [
                { ...attachedArc.points[0]!, bend: 240 },
                attachedArc.points[1]!,
            ],
        };
        expect(followersOf(byId(boxes, 2), deeper, links)).toEqual([]);
    });
});

afterEach(() => stopTimelineResolver());

const PAGE2 = { start: 9, end: 17 };
const PAGE2_PLAN: CanvasEditPlan = {
    ok: true,
    target: { kind: "range", ...PAGE2 },
    beat: PAGE2.end,
};
const resolver = () => useTimelineResolverStore.getState().resolver!;

/** The line and the attached arc placed on page 2 in one move */
async function placeJ(db: DbConnection) {
    const pages = [...(await readShowTiming(db)).pages].sort(
        (a, b) => a.order - b.order,
    );
    await deletePages({
        db,
        pageIds: new Set(pages.filter((p) => p.order >= 2).map((p) => p.id)),
    });
    for (let i = 0; i < 2; i++) await createLastPage({ db, newPageCounts: 8 });
    await startTimelineResolver(db);
    const ids = resolver().marcherIds().slice(0, 7);
    const at = { x: 200, y: 200 };
    const shift = (p: LineParams): LineParams => ({
        ...p,
        points: p.points.map((q) => ({ ...q, x: q.x + at.x, y: q.y + at.y })),
    });
    const line = recipe(0, lineShape, shift(LINE), ids.slice(0, 4));
    const saved: PlacedRecipe[] = [];
    await moveMarchersInTarget({
        db,
        target: { kind: "range", ...PAGE2 },
        moves: line.members.map(({ marcherId, x, y }) => ({ marcherId, x, y })),
        afterWrite: async (tx, timelineId) => {
            const record: ShapeRecipeRecord = line;
            const id = await saveShapeRecipeInTransaction({
                tx,
                timelineId,
                recipe: record,
                members: line.members,
            });
            saved.push({ ...line, id, timelineId });
        },
    });
    // The arc, attached to the line's bottom end
    const lineId = saved[0]!.id;
    const arcParams: LineParams = {
        ...shift(ARC),
        attach: { start: { recipe: lineId, end: "end" } },
    };
    const arcRecipe = recipe(0, arcShape, arcParams, ids.slice(4));
    expect(
        await writePlacement(
            { recipe: arcRecipe, members: arcRecipe.members },
            new QueryClient(),
            "Couldn't place",
            PAGE2_PLAN,
        ),
    ).toBe(true);
    await timelineResolverSettled();
    return { ids, lineId };
}

const undoSteps = async (db: DbConnection) =>
    new Set(
        (await db.select().from(schema.history_undo).all()).map(
            (r) => r.history_group,
        ),
    ).size;

describeDbTests("linked shapes saved", (it) => {
    it("saves the link and reads it back, one marcher on the joint", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { lineId } = await placeJ(db);
        const recipes = await readAllShapeRecipes(db);
        expect(recipes).toHaveLength(2);
        const boxes = placed(recipes);
        const links = liveLinks(boxes, 0);
        expect(links).toHaveLength(1);
        expect(links[0]!.owner.recipe.id).toBe(lineId);
        const joint = links[0]!.at;
        const onJoint = recipes.flatMap((r) =>
            r.members.filter(
                (m) => Math.hypot(m.x - joint.x, m.y - joint.y) < 1e-6,
            ),
        );
        expect(onJoint).toHaveLength(1);
    });

    it("moves the line and stretches the arc as one undo step; undo takes both back, redo brings both", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { lineId } = await placeJ(db);
        const before = await readAllShapeRecipes(db);
        const boxes = placed(before);
        const line = byId(boxes, lineId);
        const moved: LineParams = {
            ...(line.params as LineParams),
            points: (line.params as LineParams).points.map((q) => ({
                ...q,
                x: q.x + 24,
            })),
        };
        const linked = linkedSave(line, moved, boxes, 0, false);
        expect(linked.others).toHaveLength(1);
        const targets = liveTargets(line, linked.params, ctx);
        const steps = await undoSteps(db);
        expect(
            await writePlacement(
                {
                    recipe: {
                        ...line.recipe,
                        params: { ...moved, spots: targets.spots },
                    },
                    members: targets.members,
                    replaces: line.recipe,
                    also: linkedPlacements(linked.others, ctx),
                },
                new QueryClient(),
                "Couldn't edit",
                PAGE2_PLAN,
            ),
        ).toBe(true);
        await timelineResolverSettled();
        expect(await undoSteps(db)).toBe(steps + 1);

        const after = await readAllShapeRecipes(db);
        const arcAfter = after.find((r) => r.id !== lineId)!;
        const arcParams = arcAfter.params as LineParams;
        expect(endPoint(arcParams, "start")).toEqual({ x: 224, y: 260 });
        expect(endPoint(arcParams, "end")).toEqual({ x: 160, y: 260 });
        // Still linked, read back
        expect(liveLinks(placed(after), 0)).toHaveLength(1);
        // The arc's tubas moved with it
        const arcBefore = before.find((r) => r.id !== lineId)!;
        expect(arcAfter.members).not.toEqual(arcBefore.members);

        await performUndo(db);
        await timelineResolverSettled();
        const undone = await readAllShapeRecipes(db);
        expect(undone.map((r) => r.params)).toEqual(
            before.map((r) => r.params),
        );

        await performRedo(db);
        await timelineResolverSettled();
        const redone = await readAllShapeRecipes(db);
        expect(redone.map((r) => r.params)).toEqual(after.map((r) => r.params));
        expect(liveLinks(placed(redone), 0)).toHaveLength(1);
    });

    it("detaches: the arc's end holds its own marcher again", async ({
        db,
        marchersAndPages: _,
    }) => {
        await placeJ(db);
        const boxes = placed(await readAllShapeRecipes(db));
        const [link] = liveLinks(boxes, 0);
        const params = detachedParams(link!);
        const targets = liveTargets(link!.attacher, params, ctx);
        expect(
            await writePlacement(
                {
                    recipe: {
                        ...link!.attacher.recipe,
                        params: { ...params, spots: targets.spots },
                    },
                    members: targets.members,
                    replaces: link!.attacher.recipe,
                },
                new QueryClient(),
                "Couldn't detach",
                PAGE2_PLAN,
            ),
        ).toBe(true);
        await timelineResolverSettled();
        const after = await readAllShapeRecipes(db);
        expect(liveLinks(placed(after), 0)).toEqual([]);
        const joint = link!.at;
        const onJoint = after.flatMap((r) =>
            r.members.filter(
                (m) => Math.hypot(m.x - joint.x, m.y - joint.y) < 1e-6,
            ),
        );
        // The line's marcher and the arc's own, until one is dragged away
        expect(onJoint).toHaveLength(2);
    });
});
