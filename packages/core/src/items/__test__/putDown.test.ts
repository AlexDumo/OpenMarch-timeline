import { describe, expect, it } from "vitest";
import type { Resolver, SpanInfo, XY } from "../../timeline/types";
import type { Holder, PlacementChange } from "../placement";
import {
    putDownAnchors,
    putDownDrifts,
    withPutDowns,
    type PutDownItem,
} from "../putDown";

let nextId = 1;
const held = (beat: number, holders: Holder[]): PlacementChange => ({
    id: nextId++,
    beat,
    state: "held",
    holders,
    crew: [],
    groupId: null,
});
const placed = (beat: number): PlacementChange => ({
    id: nextId++,
    beat,
    state: "placed",
    holders: [],
    crew: [],
    groupId: null,
});
const offField = (beat: number): PlacementChange => ({
    id: nextId++,
    beat,
    state: "off_field",
    holders: [],
    crew: [],
    groupId: null,
});

const T1 = 1;
const ITEM = 100;

/** A move from `from` at `start` to `to` at `end`, then a hold. */
interface Move {
    start: number;
    end: number;
    from: XY;
    to: XY;
}

/** A fake resolver: each marcher stands still at `home` but for its linear moves. */
function fakeResolver(
    homes: Record<number, XY>,
    moves: Record<number, Move[]> = {},
): Resolver {
    const positionAt = (id: number, beat: number): XY => {
        let at = homes[id]!;
        for (const m of moves[id] ?? []) {
            if (beat <= m.start) break;
            if (beat >= m.end) {
                at = m.to;
                continue;
            }
            const t = (beat - m.start) / (m.end - m.start);
            return [
                m.from[0] + (m.to[0] - m.from[0]) * t,
                m.from[1] + (m.to[1] - m.from[1]) * t,
            ];
        }
        return at;
    };
    const ids = Object.keys(homes)
        .map(Number)
        .sort((a, b) => a - b);
    const spanInfos = (id: number): SpanInfo[] =>
        (moves[id] ?? []).map((m) => ({
            marcherId: id,
            start: m.start,
            end: m.end,
            kind: "founding",
            assignmentId: null,
            transitionId: null,
            slot: null,
        }));
    return {
        positionAt,
        positionsAt: (beat, out) =>
            ids.forEach((id, i) => {
                const [x, y] = positionAt(id, beat);
                out[2 * i] = x;
                out[2 * i + 1] = y;
            }),
        marcherIds: () => ids,
        spanInfos,
        explain: () => {
            throw new Error("unused");
        },
        ftlEntry: () => {
            throw new Error("unused");
        },
        notify: () => ({
            marchersRebuilt: [],
            originsDirtied: 0,
            ftlEntriesDirtied: 0,
            localRecomputed: { destinations: [], ftlGeometry: [] },
        }),
        warmAll: () => {},
        counters: () => {
            throw new Error("unused");
        },
        resetCounters: () => {},
        diagnostics: () => [],
        checkCacheClosure: () => true,
    };
}

// T1 walks from (0,0) to (100,0) over beats 0..10; the item starts at (500,500)
const T1_WALK: Move = { start: 0, end: 10, from: [0, 0], to: [100, 0] };

describe("put-down, derived", () => {
    it("puts the item down at its holder on release, and keeps it there", () => {
        const base = fakeResolver(
            { [T1]: [0, 0], [ITEM]: [500, 500] },
            { [T1]: [T1_WALK] },
        );
        const item: PutDownItem = {
            marcherId: ITEM,
            changes: [held(2, [{ marcherId: T1, hand: "right" }]), placed(6)],
        };
        const r = withPutDowns(base, [item]);
        expect(r.positionAt(ITEM, 1)).toEqual([500, 500]);
        expect(r.positionAt(ITEM, 6)).toEqual([60, 0]);
        expect(r.positionAt(ITEM, 30)).toEqual([60, 0]);
        // positionsAt agrees
        const out = new Float64Array(4);
        r.positionsAt(30, out);
        expect([...out]).toEqual([100, 0, 60, 0]);
    });

    it("follows the holder's drill: no drift is stored", () => {
        const item: PutDownItem = {
            marcherId: ITEM,
            changes: [held(2, [{ marcherId: T1, hand: "right" }]), placed(6)],
        };
        const moved = fakeResolver(
            { [T1]: [0, 0], [ITEM]: [500, 500] },
            { [T1]: [{ ...T1_WALK, to: [200, 0] }] },
        );
        expect(withPutDowns(moved, [item]).positionAt(ITEM, 20)).toEqual([
            120, 0,
        ]);
    });

    it("can't outlive the release: delete the hold, put it Off field, or put it down earlier", () => {
        const base = fakeResolver(
            { [T1]: [0, 0], [ITEM]: [500, 500] },
            { [T1]: [T1_WALK] },
        );
        const r = withPutDowns(base);
        // No held change: placed all along, where its own drill is
        r.setPutDownItems([{ marcherId: ITEM, changes: [placed(6)] }]);
        expect(r.positionAt(ITEM, 20)).toEqual([500, 500]);
        // Off field, then placed: not a put-down
        r.setPutDownItems([
            { marcherId: ITEM, changes: [offField(2), placed(6)] },
        ]);
        expect(r.positionAt(ITEM, 20)).toEqual([500, 500]);
        // A placed change inside the hold: put down there, and the later placed change is no put-down
        r.setPutDownItems([
            {
                marcherId: ITEM,
                changes: [
                    held(2, [{ marcherId: T1, hand: "right" }]),
                    placed(4),
                    placed(8),
                ],
            },
        ]);
        expect(r.positionAt(ITEM, 20)).toEqual([40, 0]);
    });

    it("blends into the item's own next move, which ends where the designer put it", () => {
        const base = fakeResolver(
            { [T1]: [0, 0], [ITEM]: [500, 500] },
            {
                [T1]: [T1_WALK],
                [ITEM]: [
                    { start: 12, end: 16, from: [500, 500], to: [0, 100] },
                ],
            },
        );
        const item: PutDownItem = {
            marcherId: ITEM,
            changes: [held(2, [{ marcherId: T1, hand: "right" }]), placed(6)],
        };
        const r = withPutDowns(base, [item]);
        expect(r.positionAt(ITEM, 11)).toEqual([60, 0]);
        expect(r.positionAt(ITEM, 12)).toEqual([60, 0]);
        expect(r.positionAt(ITEM, 14)).toEqual([30, 50]);
        expect(r.positionAt(ITEM, 16)).toEqual([0, 100]);
        expect(r.positionAt(ITEM, 30)).toEqual([0, 100]);
    });
});

describe("put-down, the item's own move ends on it", () => {
    const item: PutDownItem = {
        marcherId: ITEM,
        changes: [held(2, [{ marcherId: T1, hand: "right" }]), placed(6)],
    };
    const base = fakeResolver(
        { [T1]: [0, 0], [ITEM]: [500, 500] },
        {
            [T1]: [T1_WALK],
            [ITEM]: [{ start: 4, end: 6, from: [500, 500], to: [70, 0] }],
        },
    );

    it("derives nothing: the designer's move wins", () => {
        expect(withPutDowns(base, [item]).positionAt(ITEM, 20)).toEqual([
            70, 0,
        ]);
        expect(putDownAnchors(base, item)).toMatchObject([
            {
                kind: "own_move",
                beat: 6,
                spot: [60, 0],
                move: { start: 4, end: 6 },
            },
        ]);
    });

    it("is a drift the notes name, with the move Snap to holder rewrites", () => {
        const drifts = putDownDrifts(base, ITEM, putDownAnchors(base, item));
        expect(drifts).toMatchObject([
            {
                beat: 6,
                spot: [60, 0],
                at: [70, 0],
                distance: 10,
                move: { start: 4, end: 6 },
            },
        ]);
    });

    it("never drifts when derived", () => {
        const free = fakeResolver(
            { [T1]: [0, 0], [ITEM]: [500, 500] },
            { [T1]: [T1_WALK] },
        );
        expect(putDownDrifts(free, ITEM, putDownAnchors(free, item))).toEqual(
            [],
        );
    });
});

describe("put-down, the resolver wrapper", () => {
    it("works the put-downs out again after a batch", () => {
        const homes: Record<number, XY> = { [T1]: [0, 0], [ITEM]: [500, 500] };
        const base = fakeResolver(homes);
        const r = withPutDowns(base, [
            {
                marcherId: ITEM,
                changes: [
                    held(2, [{ marcherId: T1, hand: "right" }]),
                    placed(6),
                ],
            },
        ]);
        expect(r.positionAt(ITEM, 10)).toEqual([0, 0]);
        homes[T1] = [30, 40];
        r.notify({ changes: [] });
        expect(r.positionAt(ITEM, 10)).toEqual([30, 40]);
    });

    it("ignores items and holders the resolver doesn't have", () => {
        const base = fakeResolver({ [T1]: [0, 0] });
        const r = withPutDowns(base, [
            {
                marcherId: ITEM,
                changes: [held(2, [{ marcherId: 7, hand: "both" }]), placed(6)],
            },
        ]);
        expect(r.putDownAnchors(ITEM)).toEqual([]);
        expect(r.positionAt(T1, 3)).toEqual([0, 0]);
    });
});
