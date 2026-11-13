/**
 * Linked Adjust, pathways step 26 (spec v0.10 J.1 `timeline_route_adjusts`, R-14′ items 6 and 7,
 * T-10, J.7): a profile shared by a sub-group of a route's lanes, added before each spot's own.
 * Resolver, oracle and the independent `docs/timeline/ref` oracle agree bit for bit (QA-RT-L13).
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
// @ts-expect-error: the spec's reference implementation is plain JavaScript
import { makeOracle } from "../../../../../docs/timeline/ref/oracle.mjs";
import {
    createResolver,
    createTimelineOracleForTesting,
    walkedPath,
    walkedPathPointAt,
    type AdjustKey,
    type AdjustProfile,
    type LaneRow,
    type RouteGeometry,
    type TimelineSnapshot,
    type XY,
} from "../index";

const ROUTE: RouteGeometry = {
    v: 1,
    from: [0, 0],
    to: [200, 0],
    points: [
        { id: "p", at: [50, 0] },
        { id: "q", at: [150, 0] },
    ],
};
const key = (a: string, b: string, f: number, d: XY): AdjustKey => ({
    a,
    b,
    f,
    d,
});
const profile = (...keys: AdjustKey[]): AdjustProfile => ({ v: 1, keys });
const BULGE = profile(
    key("p", "q", 0.25, [0, 0]),
    key("p", "q", 0.5, [0, 20]),
    key("p", "q", 0.75, [0, 0]),
);

/**
 * Three members 16 counts along ROUTE, 10 apart. Lanes 1 and 2 share linked Adjust 7 (`shared`);
 * lane 2 may carry its own on top; lane 3 is plain.
 */
function show({
    shared = BULGE as AdjustProfile | null,
    own = null as AdjustProfile | null,
    geometry = ROUTE,
    sharedRoute = 1,
} = {}): TimelineSnapshot {
    const ys = [-10, 0, 10];
    return {
        marchers: ys.map((y, i) => ({ id: i + 1, home: [0, y] as XY })),
        shapes: {},
        transitions: {
            1: {
                id: 1,
                start: 0,
                end: 16,
                dest: null,
                points: ys.map((y) => [200, y] as XY),
                slots: 3,
                style: "direct",
                order: "slot",
                params: null,
            },
        },
        assignments: ys.map((_, i) => ({
            id: i + 1,
            marcher: i + 1,
            transition: 1,
            slot: i,
            start: 0,
            end: 16,
            layer: 0,
        })),
        routes: { 1: { geometry } },
        lanes: {
            1: {
                transition: 1,
                slot: 0,
                route: 1,
                offset: [0, -10],
                groupAdjust: shared ? 7 : null,
            },
            2: {
                transition: 1,
                slot: 1,
                route: 1,
                offset: [0, 0],
                groupAdjust: shared ? 7 : null,
                adjust: own,
            },
            3: { transition: 1, slot: 2, route: 1, offset: [0, 10] },
        },
        routeAdjusts: shared
            ? { 7: { route: sharedRoute, profile: shared } }
            : {},
    };
}

type Ref = { positionAt(m: number, b: number): XY };
const expectAgree = (host: TimelineSnapshot) => {
    const r = createResolver(host);
    const o = createTimelineOracleForTesting(host);
    const ref = makeOracle(host) as Ref;
    for (let b = 0; b <= 16; b += 0.0625)
        for (const m of [1, 2, 3]) {
            const p = r.positionAt(m, b);
            expect(p, `M${m}@${b} oracle`).toEqual(o.positionAt(m, b));
            expect(p, `M${m}@${b} ref`).toEqual(ref.positionAt(m, b));
        }
    return r;
};

describe("R-14′ item 7: a linked Adjust, then the spot's own (QA-RT-L13)", () => {
    it("moves every lane that shares it, and only those", () => {
        const r = expectAgree(show());
        // 200 long over 16 counts: x = 12.5 per count; the shared key at x = 100 is count 8
        expect(r.positionAt(1, 8)).toEqual([100, 10]);
        expect(r.positionAt(2, 8)).toEqual([100, 20]);
        expect(r.positionAt(3, 8)).toEqual([100, 10]); // plain lane
        expect(r.positionAt(1, 7)).toEqual([87.5, 0]); // halfway up the ramp
        expect(r.positionAt(1, 4)).toEqual([50, -10]); // on its lane at the kept point
    });

    it("S-09: the spot's own Adjust adds on top of the shared one", () => {
        const own = profile(
            key("p", "q", 0.5, [0, 7]),
            key("p", "q", 0.75, [0, 0]),
        );
        const r = expectAgree(show({ own }));
        expect(r.positionAt(2, 8)).toEqual([100, 27]);
        expect(r.positionAt(1, 8)).toEqual([100, 10]); // the other member keeps only the shared one
        // the own profile is constant (7) before its first key, so it shows at count 6 too
        expect(r.positionAt(2, 6)).toEqual([75, 7]);
    });

    it("adds the linked displacement first, as separate float additions (06 m3)", () => {
        // 0.1 + 0.2 + 0.3 differs from 0.1 + (0.2 + 0.3) in float64
        const flat = (d: number) => profile(key("p", "q", 0.5, [d, 0]));
        const host = show({ shared: flat(0.2), own: flat(0.3) });
        host.lanes![2]!.offset = [0.1, 0];
        host.marchers[1]!.home = [0.1, 0];
        const r = expectAgree(host);
        const at = r.positionAt(2, 8)[0];
        expect(at).toBe(100 + 0.1 + 0.2 + 0.3);
    });

    it("random shared and own profiles agree with the oracle and the ref/ oracle", () => {
        const curve: RouteGeometry = {
            v: 1,
            from: [0, 0],
            to: [200, 30],
            points: [
                { id: "p", at: [50, 20], tension: 1 },
                { id: "m", at: [100, -20], tension: 0.5 },
                { id: "q", at: [150, 10] },
            ],
        };
        const ids = ["from", "p", "m", "q", "to", "gone"];
        const keys = fc.array(
            fc.record({
                a: fc.constantFrom(...ids),
                b: fc.constantFrom(...ids),
                f: fc.double({ min: 0, max: 1, noNaN: true }),
                dx: fc.double({ min: -40, max: 40, noNaN: true }),
                dy: fc.double({ min: -40, max: 40, noNaN: true }),
            }),
            { minLength: 1, maxLength: 5 },
        );
        const toProfile = (
            raw: { a: string; b: string; f: number; dx: number; dy: number }[],
        ) => profile(...raw.map((k) => key(k.a, k.b, k.f, [k.dx, k.dy])));
        fc.assert(
            fc.property(keys, keys, fc.boolean(), (shared, own, withOwn) => {
                expectAgree(
                    show({
                        shared: toProfile(shared),
                        own: withOwn ? toProfile(own) : null,
                        geometry: curve,
                    }),
                );
            }),
            { numRuns: 40 },
        );
    });

    it("T-10: a linked Adjust of another route is ignored", () => {
        const r = expectAgree(show({ sharedRoute: 2 }));
        expect(r.positionAt(1, 8)).toEqual([100, -10]);
    });

    it("no linked Adjust: bit-identical to a show without the field", () => {
        const plain = show({ shared: null });
        const without = structuredClone(plain);
        for (const l of Object.values(without.lanes!)) delete l.groupAdjust;
        delete without.routeAdjusts;
        const a = createResolver(plain);
        const b = createResolver(without);
        for (let t = 0; t <= 16; t += 0.0625)
            for (const m of [1, 2, 3])
                expect(
                    Object.is(a.positionAt(m, t)[0], b.positionAt(m, t)[0]),
                ).toBe(true);
    });

    it("diagnostics name the linked Adjust (T-4 on a shared profile)", () => {
        const tie = profile(
            key("p", "q", 0.5, [0, 10]),
            key("p", "q", 0.5, [0, 20]),
        );
        const host = show({ shared: tie });
        const diags = createResolver(host).diagnostics();
        const ties = diags.filter((d) => d.code === "D-ADJUST-TIE");
        expect(ties.map((d) => d.slot)).toEqual([0, 1]);
        expect(ties[0]!.message).toContain("linked Adjust");
        expect(createTimelineOracleForTesting(host).diagnostics()).toEqual(
            expect.arrayContaining(ties),
        );
    });

    it("the drawable walked path carries both (R-20)", () => {
        const own = profile(
            key("p", "q", 0.5, [0, 7]),
            key("p", "q", 0.75, [0, 0]),
        );
        const host = show({ own });
        const r = createResolver(host);
        const path = walkedPath(host, r, 2, 0, 16);
        for (let b = 0; b <= 16; b += 0.25) {
            const p = walkedPathPointAt(path, b)!;
            const q = r.positionAt(2, b);
            expect(Math.hypot(p[0] - q[0], p[1] - q[1]), `@${b}`).toBeLessThan(
                1e-6,
            );
        }
    });
});

describe("J.7: invalidation of linked Adjusts", () => {
    const lane = (host: TimelineSnapshot, id: number) => host.lanes![id]!;

    it("an edited profile moves every lane sharing it", () => {
        const host = show();
        const r = createResolver(host);
        expect(r.positionAt(1, 8)).toEqual([100, 10]);
        const before = { id: 7, ...host.routeAdjusts![7]! };
        host.routeAdjusts![7] = {
            route: 1,
            profile: profile(key("p", "q", 0.5, [0, 40])),
        };
        r.notify({
            changes: [
                {
                    table: "route_adjusts",
                    rowId: 7,
                    before,
                    after: { id: 7, ...host.routeAdjusts![7]! },
                },
            ],
        });
        expect(r.positionAt(1, 8)).toEqual([100, 30]);
        expect(r.positionAt(2, 8)).toEqual([100, 40]);
        expect(r.positionAt(3, 8)).toEqual([100, 10]);
        expect(r.checkCacheClosure()).toBe(true);
    });

    it("a lane leaving the sub-group and a deleted linked Adjust (reset)", () => {
        const host = show();
        const r = createResolver(host);
        r.positionAt(1, 8);
        const changes: Parameters<typeof r.notify>[0]["changes"] = [];
        for (const id of [1, 2]) {
            const was: LaneRow = { ...lane(host, id) };
            host.lanes![id] = { ...was, groupAdjust: null };
            changes.push({
                table: "lanes",
                rowId: id,
                before: { id, ...was },
                after: { id, ...host.lanes![id]! },
            });
        }
        const gone = host.routeAdjusts![7]!;
        delete host.routeAdjusts![7];
        changes.push({
            table: "route_adjusts",
            rowId: 7,
            before: { id: 7, ...gone },
            after: null,
        });
        r.notify({ changes });
        expect(r.positionAt(1, 8)).toEqual([100, -10]);
        expect(r.positionAt(2, 8)).toEqual([100, 0]);
        expect(r.checkCacheClosure()).toBe(true);
        expect(r.positionAt(1, 8)).toEqual(
            createTimelineOracleForTesting(host).positionAt(1, 8),
        );
    });

    it("a reshaped route re-resolves the linked keys on it", () => {
        const host = show();
        const r = createResolver(host);
        r.positionAt(1, 8);
        const before = { id: 1, ...host.routes![1]! };
        host.routes![1] = {
            geometry: {
                ...ROUTE,
                points: [
                    { id: "p", at: [50, 0] },
                    { id: "q", at: [250, 0] },
                ],
                to: [300, 0],
            },
        };
        r.notify({
            changes: [
                {
                    table: "routes",
                    rowId: 1,
                    before,
                    after: { id: 1, ...host.routes![1]! },
                },
            ],
        });
        const o = createTimelineOracleForTesting(host);
        for (let b = 0; b <= 16; b += 0.5)
            for (const m of [1, 2, 3])
                expect(r.positionAt(m, b)).toEqual(o.positionAt(m, b));
        expect(r.checkCacheClosure()).toBe(true);
    });
});
