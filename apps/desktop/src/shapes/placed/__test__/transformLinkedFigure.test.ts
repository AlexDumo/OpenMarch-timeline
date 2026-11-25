import { describe, expect, it } from "vitest";
import { rotatePositions, scalePositions } from "@/field/editor/groupTransform";
import { lineSpots, type LineParams } from "../../line/lineGeometry";
import { endPoint } from "../../line/lineLinks";
import { lineShape } from "../../line/lineShape";
import { arcShape } from "../../arc/arcShape";
import { boxShape } from "../../box/boxShape";
import { drawBox } from "../../box/boxGeometry";
import { boxTool } from "../../box/boxTool";
import type { ToolEnv } from "../../tool/toolKind";
import {
    applySimilarity,
    fitSimilarity,
    type Similarity,
} from "../../frame/similarity";
import type { ShapeContext, XY } from "../../types";
import {
    boxesAt,
    membershipAfter,
    transformedBox,
    transformedParams,
    type PlacedBox,
    type PlacedRecipe,
} from "../placedBox";
import {
    shapesMoved,
    shapesTransformed,
    similarityOfDrop,
} from "../movedShapes";
import { liveLinks } from "../shapeLinks";

/**
 * Turning and scaling a linked figure (#1236): a J (a line, an arc linked to its end, a tail
 * linked to the arc's far end) selected whole and turned or scaled with the selection's handles
 * kept its marchers but lost every shape, since only a move kept a shape. Now each shape goes
 * through the same turn or scale through its kind, so it keeps its kind, count and links.
 */

const ctx: ShapeContext = { stepPx: 12, snapPoint: (p) => p };
const FIT = { mode: "fit" } as const;
const straight = (from: XY, to: XY): LineParams => ({
    points: [
        { ...from, tension: 0 },
        { ...to, tension: 0 },
    ],
    spacing: FIT,
});

function recipe(
    id: number,
    kind: { id: string; version: number },
    params: LineParams,
    ids: readonly number[],
): PlacedRecipe {
    const spots = lineSpots(params, ids.length);
    return {
        id,
        timelineId: 5,
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

/** The recipes as placed shapes, each member on its spot, every move ending at 0 */
function placed(recipes: readonly PlacedRecipe[]): PlacedBox[] {
    const at = new Map(
        recipes.flatMap((r) =>
            r.members.map((m) => [m.marcherId, { x: m.x, y: m.y }] as const),
        ),
    );
    return boxesAt({
        recipes,
        endBeatOf: () => 0,
        beat: 0,
        positionOf: (id) => at.get(id),
    });
}

const LINE = [11, 12, 13, 14];
const ARC = [21, 22, 23, 24];
const TAIL = [31, 32];

/** A J and its tail */
const jRecipes = () => [
    recipe(1, lineShape, straight({ x: 0, y: 0 }, { x: 0, y: 60 }), LINE),
    recipe(
        2,
        arcShape,
        {
            points: [
                { x: 0, y: 60, tension: 0, bend: 180 },
                { x: -40, y: 60, tension: 0 },
            ],
            spacing: FIT,
            attach: { start: { recipe: 1, end: "end" } },
        },
        ARC,
    ),
    recipe(
        3,
        lineShape,
        {
            ...straight({ x: -40, y: 60 }, { x: -40, y: 100 }),
            attach: { start: { recipe: 2, end: "end" } },
        },
        TAIL,
    ),
];

const ids = (boxes: readonly { recipe: { id: number } }[]) =>
    boxes.map((b) => b.recipe.id);
const linkIds = (boxes: readonly PlacedBox[]) =>
    liveLinks(boxes, 0).map((l) => [l.attacher.recipe.id, l.owner.recipe.id]);
const starts = (boxes: readonly PlacedBox[]) =>
    boxes.flatMap((b) =>
        b.recipe.members.map((m) => ({ id: m.marcherId, x: m.x, y: m.y })),
    );

/** `box` saved as `params`, its members on their spots in it, read back as a recipe */
function savedAs(box: PlacedBox, params: unknown): PlacedRecipe {
    const spots = box.kind.shape.generate(params, box.spots, ctx);
    return {
        ...box.recipe,
        params: { ...(params as object), spots: box.spots },
        members: box.recipe.members.map((m) => ({
            ...m,
            x: spots[m.slot]!.x,
            y: spots[m.slot]!.y,
        })),
    };
}

const near = (a: XY, b: XY, within = 0.01) =>
    Math.hypot(a.x - b.x, a.y - b.y) <= within;

describe("a linked figure turned or scaled by the selection's handles", () => {
    const figure = placed(jRecipes());
    const pivot = { x: -20, y: 50 };
    const drops: [string, ReturnType<typeof rotatePositions>][] = [
        ["turned 90°", rotatePositions(starts(figure), pivot, 90)],
        ["turned 37°", rotatePositions(starts(figure), pivot, 37)],
        [
            "scaled 1.5",
            scalePositions(starts(figure), { anchor: pivot, x: 1.5, y: 1.5 }),
        ],
        [
            "scaled 0.5",
            scalePositions(starts(figure), {
                anchor: { x: 0, y: 0 },
                x: 0.5,
                y: 0.5,
            }),
        ],
    ];

    it.each(drops)(
        "%s: every shape keeps its kind, count and links, its joints together",
        (_, positions) => {
            expect(linkIds(figure)).toEqual([
                [2, 1],
                [3, 2],
            ]);
            const sim = similarityOfDrop(figure, positions);
            expect(sim).not.toBeNull();
            const edits = shapesTransformed(figure, sim!, [], ctx);
            expect(edits).not.toBeNull();
            expect(ids(edits!.map((e) => e.box))).toEqual([1, 2, 3]);
            const after = placed(edits!.map((e) => savedAs(e.box, e.params)));
            // Every shape reads back, the same kind with the same marchers
            expect(ids(after)).toEqual([1, 2, 3]);
            expect(after.map((b) => b.kind)).toEqual(figure.map((b) => b.kind));
            expect(after.map((b) => b.recipe.members.length)).toEqual([
                4, 4, 2,
            ]);
            // Each marcher's spot is where it was dropped
            const dropped = new Map(positions.map((p) => [p.id, p]));
            for (const m of after.flatMap((b) => b.recipe.members))
                expect(near(m, dropped.get(m.marcherId)!)).toBe(true);
            // Both links hold, their ends on one joint
            expect(linkIds(after)).toEqual([
                [2, 1],
                [3, 2],
            ]);
            const [line, arc, tail] = after.map((b) => b.params as LineParams);
            expect(
                near(endPoint(line!, "end"), endPoint(arc!, "start"), 1e-6),
            ).toBe(true);
            expect(
                near(endPoint(arc!, "end"), endPoint(tail!, "start"), 1e-6),
            ).toBe(true);
            // The arc is still a half circle, not bent out of form
            expect(arc!.points[0]!.bend).toBe(180);
            expect(arc!.attach).toEqual({ start: { recipe: 1, end: "end" } });
        },
    );

    it("takes every point of each shape through the turn and scale, its spacing with it", () => {
        const sim = fitSimilarity(
            [
                { from: { x: 0, y: 0 }, to: { x: 10, y: 5 } },
                {
                    from: { x: 10, y: 0 },
                    to: { x: 10 + 15 * 0.8, y: 5 + 15 * 0.6 },
                },
            ],
            1e-9,
        )!;
        const [line, arc] = figure;
        const lineAfter = transformedParams(line!, sim, ctx) as LineParams;
        const arcAfter = transformedParams(arc!, sim, ctx) as LineParams;
        for (const [box, out] of [
            [line!, lineAfter],
            [arc!, arcAfter],
        ] as const)
            (box.params as LineParams).points.forEach((q, i) =>
                expect(
                    near(out.points[i]!, applySimilarity(sim, q), 1e-9),
                ).toBe(true),
            );
        // Turned 37° (a 3-4-5 triangle), half as big again
        expect(lineAfter.turn).toBeCloseTo(
            (Math.atan2(0.6, 0.8) * 180) / Math.PI,
        );
    });

    it("keeps a line's interior bend points and its interval, scaled with it", () => {
        const bent = placed([
            recipe(
                7,
                lineShape,
                {
                    points: [
                        { x: 0, y: 0, tension: 0 },
                        { x: 24, y: 12, tension: 1 },
                        { x: 48, y: 0, tension: 0, bend: 90 },
                        { x: 72, y: 24, tension: 0 },
                    ],
                    spacing: { mode: "keep", groups: [{ interval: 12 }] },
                },
                [71, 72, 73, 74, 75, 76],
            ),
        ])[0]!;
        const positions = scalePositions(
            rotatePositions(starts([bent]), { x: 30, y: 10 }, 37),
            { anchor: { x: 0, y: 0 }, x: 1.5, y: 1.5 },
        );
        const sim = similarityOfDrop([bent], positions)!;
        expect(sim).not.toBeNull();
        const out = transformedParams(bent, sim, ctx) as LineParams;
        expect(out).not.toBeNull();
        (bent.params as LineParams).points.forEach((q, i) => {
            expect(near(out.points[i]!, applySimilarity(sim, q), 1e-9)).toBe(
                true,
            );
            expect(out.points[i]!.tension).toBe(q.tension);
            expect(out.points[i]!.bend).toBe(q.bend);
        });
        expect(out.spacing).toEqual({
            mode: "keep",
            groups: [{ interval: 18 }],
        });
    });

    it("mirrors an arc's bend when the marchers are mirrored", () => {
        const arc = figure[1]!;
        const mirrored = starts([arc]).map((p) => ({ ...p, x: -p.x }));
        const sim = similarityOfDrop([arc], mirrored)!;
        expect(sim.mirror).toBe(true);
        const out = transformedBox(arc, sim, ctx)!;
        expect(out).not.toBeNull();
        expect((out.params as LineParams).points[0]!.bend).toBe(-180);
        out.members.forEach((m, i) => expect(near(m, mirrored[i]!)).toBe(true));
    });
});

describe("shapes linked to a turned or scaled figure", () => {
    it("follow as for a move: the end at the joint stretches, the far end stays", () => {
        const boxes = placed(jRecipes());
        const [line, arc] = boxes;
        const positions = rotatePositions(
            starts([line!, arc!]),
            { x: 0, y: 0 },
            37,
        );
        const sim = similarityOfDrop([line!, arc!], positions)!;
        const edits = shapesTransformed(
            [line!, arc!],
            sim,
            liveLinks(boxes, 0),
            ctx,
        )!;
        expect(ids(edits.map((e) => e.box))).toEqual([1, 2, 3]);
        const arcAfter = edits[1]!.params as LineParams;
        const tailAfter = edits[2]!.params as LineParams;
        expect(
            near(endPoint(tailAfter, "start"), endPoint(arcAfter, "end"), 1e-9),
        ).toBe(true);
        expect(endPoint(tailAfter, "end")).toEqual({ x: -40, y: 100 });
        expect(tailAfter.attach).toEqual({ start: { recipe: 2, end: "end" } });
    });
});

describe("membership after a hand edit", () => {
    const figure = placed(jRecipes());
    const arc = figure[1]!;
    const moved = (
        positions: readonly { id: number; x: number; y: number }[],
    ) => new Map(positions.map((p) => [p.id, { x: p.x, y: p.y }] as const));

    it("keeps a shape turned or scaled evenly, every member with it", () => {
        const turned = rotatePositions(starts([arc]), { x: 3, y: 4 }, 37);
        const change = membershipAfter(arc, moved(turned));
        expect(change.type).toBe("transform");
        const out = transformedBox(
            arc,
            (change as { sim: Similarity }).sim,
            ctx,
        );
        expect(out).not.toBeNull();
        expect(out!.spots).toBe(4);
        expect((out!.params as LineParams).attach).toEqual({
            start: { recipe: 1, end: "end" },
        });
    });

    it("still lets members leave when they're scaled unevenly or bent out of form", () => {
        const uneven = scalePositions(starts(figure), {
            anchor: { x: 0, y: 0 },
            x: 1.5,
            y: 1,
        });
        expect(similarityOfDrop(figure, uneven)).toBeNull();
        expect(membershipAfter(arc, moved(uneven)).type).toBe("leave");
        const bent = starts([arc]).map((p, i) =>
            i === 1 ? { ...p, x: p.x + 3 } : p,
        );
        expect(membershipAfter(arc, moved(bent))).toEqual({
            type: "leave",
            left: [22],
        });
    });

    it("lets one of a two-marcher shape's marchers leave when it's dragged alone", () => {
        const tail = figure[2]!;
        const [, b] = tail.recipe.members;
        expect(
            membershipAfter(tail, moved([{ id: b!.marcherId, x: 30, y: 40 }])),
        ).toEqual({ type: "leave", left: [b!.marcherId] });
        // Both turned, it still goes with them (about one of two, a turn reads as that one dragged)
        const turned = rotatePositions(starts([tail]), { x: 0, y: 0 }, 37);
        expect(membershipAfter(tail, moved(turned)).type).toBe("transform");
    });

    it("keeps a move a move", () => {
        const by = starts([arc]).map((p) => ({ ...p, x: p.x + 5 }));
        expect(membershipAfter(arc, moved(by))).toEqual({
            type: "move",
            delta: { x: 5, y: 0 },
        });
        expect(similarityOfDrop([arc], by)).toBeNull();
    });
});

describe("other kinds", () => {
    const env: ToolEnv = {
        stepPx: 12,
        snap: true,
        constrain: false,
        gridSnap: (p) => p,
        hitRadius: 3,
    };
    const params = drawBox({ x: 0, y: 0 }, { x: 24, y: 24 }, 4, env)!;
    const slots = boxShape.generate(params, 4, ctx);
    const box: PlacedBox = {
        recipe: {
            id: 9,
            timelineId: 5,
            kind: boxShape.id,
            kindVersion: boxShape.version,
            params: { ...params, spots: 4 },
            orderMode: "nearest",
            reverse: false,
            members: slots.map((s, i) => ({
                marcherId: 90 + i,
                slot: i,
                x: s.x,
                y: s.y,
            })),
        },
        kind: boxTool,
        params,
        spots: 4,
        endBeat: 0,
    };

    it("turns a box through its frame", () => {
        const turned = rotatePositions(starts([box]), { x: 5, y: 5 }, 37);
        const sim = similarityOfDrop([box], turned)!;
        const out = transformedBox(box, sim, ctx);
        expect(out).not.toBeNull();
        out!.members.forEach((m, i) => expect(near(m, turned[i]!)).toBe(true));
    });

    it("leaves a scaled box to its members, as before: only a Line, Curve or Arc scales", () => {
        const scaled = scalePositions(starts([box]), {
            anchor: { x: 0, y: 0 },
            x: 1.5,
            y: 1.5,
        });
        const sim = similarityOfDrop([box], scaled)!;
        expect(sim).not.toBeNull();
        expect(transformedParams(box, sim, ctx)).toBeNull();
    });
});

describe("a shape linked to two shapes moved together", () => {
    // A U: two posts, a bar linked to the end of each
    const u = () =>
        placed([
            recipe(
                1,
                lineShape,
                straight({ x: 0, y: 0 }, { x: 0, y: 60 }),
                LINE,
            ),
            recipe(
                2,
                lineShape,
                {
                    ...straight({ x: 0, y: 60 }, { x: 60, y: 60 }),
                    attach: {
                        start: { recipe: 1, end: "end" },
                        end: { recipe: 3, end: "end" },
                    },
                },
                ARC,
            ),
            recipe(
                3,
                lineShape,
                straight({ x: 60, y: 0 }, { x: 60, y: 60 }),
                TAIL,
            ),
        ]);

    it("follows both: each end to its joint, both links kept", () => {
        const boxes = u();
        const [post1, , post3] = boxes;
        const by = { x: 12, y: 0 };
        const edits = shapesMoved(
            [post1!, post3!],
            {
                ...(post1!.params as LineParams),
                points: (post1!.params as LineParams).points.map((q) => ({
                    ...q,
                    x: q.x + by.x,
                })),
            },
            liveLinks(boxes, 0),
        );
        const bar = edits.find((e) => e.box.recipe.id === 2)!
            .params as LineParams;
        expect(endPoint(bar, "start")).toEqual({ x: 12, y: 60 });
        expect(endPoint(bar, "end")).toEqual({ x: 72, y: 60 });
        expect(bar.attach).toEqual({
            start: { recipe: 1, end: "end" },
            end: { recipe: 3, end: "end" },
        });
    });

    it("follows both when the two are dragged together", () => {
        const boxes = u();
        const [post1, , post3] = boxes;
        const dragged = starts([post1!, post3!]).map((p) => ({
            ...p,
            x: p.x + 12,
        }));
        // A drag is only a move: a turn's path takes it when asked (a drag of shapes linked out)
        expect(similarityOfDrop([post1!, post3!], dragged)).toBeNull();
        const sim = similarityOfDrop([post1!, post3!], dragged, true)!;
        const edits = shapesTransformed(
            [post1!, post3!],
            sim,
            liveLinks(boxes, 0),
            ctx,
        )!;
        const bar = edits.find((e) => e.box.recipe.id === 2)!
            .params as LineParams;
        expect(near(endPoint(bar, "start"), { x: 12, y: 60 }, 1e-9)).toBe(true);
        expect(near(endPoint(bar, "end"), { x: 72, y: 60 }, 1e-9)).toBe(true);
        expect(bar.attach).toEqual({
            start: { recipe: 1, end: "end" },
            end: { recipe: 3, end: "end" },
        });
    });

    it("follows both when the two are turned together", () => {
        const boxes = u();
        const [post1, , post3] = boxes;
        const positions = rotatePositions(
            starts([post1!, post3!]),
            { x: 30, y: 0 },
            20,
        );
        const sim = similarityOfDrop([post1!, post3!], positions)!;
        const edits = shapesTransformed(
            [post1!, post3!],
            sim,
            liveLinks(boxes, 0),
            ctx,
        )!;
        const after = new Map(
            edits.map((e) => [e.box.recipe.id, e.params as LineParams]),
        );
        const bar = after.get(2)!;
        expect(
            near(endPoint(bar, "start"), endPoint(after.get(1)!, "end"), 1e-9),
        ).toBe(true);
        expect(
            near(endPoint(bar, "end"), endPoint(after.get(3)!, "end"), 1e-9),
        ).toBe(true);
    });
});
