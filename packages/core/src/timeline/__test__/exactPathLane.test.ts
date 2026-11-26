/**
 * Stored exact paths (ADR 0018 step 3, spec Appendix M): a route with an exact path, walked
 * through its own lane. The resolver, the oracle and R-20 play it as `exactPointAt` says at every
 * tick (EP-R), and its ends follow their spots with the keys unchanged (EP-F, QA-EP-5).
 */
import { describe, expect, it } from "vitest";
import {
    exactPointAt,
    followExactEnds,
    TICKS_PER_BEAT,
    type ExactPath,
} from "../exactPath";
import { createOracle } from "../oracle";
import { createCachedResolver } from "../resolver";
import type { TimelineSnapshot, XY } from "../types";
import {
    WALKED_SAMPLE_TOLERANCE,
    walkedPath,
    walkedPathPointAt,
} from "../walkedPath";

const clone = <T>(x: T): T => structuredClone(x);

/** A corner, an arc and a cubic; on the joint at counts 2, 4 and 6, at its end on count 8. */
const PATH: ExactPath = {
    v: 1,
    from: [0, 0],
    shapes: [
        { kind: "points", points: [[12, 0]] },
        { kind: "arc", to: [24, 0], bend: 0.3 },
        { kind: "cubic", c1: [30, 0], c2: [32, 8], to: [24, 12] },
    ],
    keys: [
        { tick: 0, u: 0 },
        { tick: 960, u: 1 },
        { tick: 1440, u: 1 }, // a one-count hold on the corner
        { tick: 2880, u: 2 },
        { tick: 3840, u: 3 },
    ],
};
const END: XY = [24, 12];

/** Marcher 1 walks `PATH` over counts 0 to 8, then straight to (30, 30) over 8 to 12. */
function show(path: ExactPath = PATH): TimelineSnapshot {
    const move = (id: number, start: number, end: number, to: XY) => ({
        id,
        start,
        end,
        dest: null,
        points: [to],
        slots: 1,
        style: "direct" as const,
        order: "inherit" as const,
        params: null,
    });
    return {
        marchers: [{ id: 1, home: path.from }],
        shapes: {},
        transitions: { 1: move(1, 0, 8, END), 2: move(2, 8, 12, [30, 30]) },
        assignments: [
            {
                id: 1,
                marcher: 1,
                transition: 1,
                slot: 0,
                start: 0,
                end: 8,
                layer: 0,
            },
            {
                id: 2,
                marcher: 1,
                transition: 2,
                slot: 0,
                start: 8,
                end: 12,
                layer: 0,
            },
        ],
        // the path's ends in `geometry`, no points: a plain own path to a reader without exact paths
        routes: {
            1: {
                geometry: { v: 1, from: path.from, to: END, points: [] },
                exact: clone(path),
            },
        },
        lanes: { 1: { transition: 1, slot: 0, route: 1, offset: null } },
    };
}

const near = (a: XY, b: XY, tol: number) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;

describe("stored exact paths (ADR 0018 step 3)", () => {
    it("play as exactPointAt says, at every tick, in the resolver, the oracle and R-20", () => {
        const host = show();
        const resolver = createCachedResolver(clone(host));
        const oracle = createOracle(clone(host));
        const walked = walkedPath(
            host,
            createCachedResolver(clone(host)),
            1,
            0,
            8,
        );
        for (let tick = 0; tick <= 3840; tick++) {
            const want = exactPointAt(PATH, tick);
            const beat = tick / TICKS_PER_BEAT;
            const got = resolver.positionAt(1, beat);
            expect(
                near(got, want, 1e-9),
                `resolver at tick ${tick}: ${got} ≠ ${want}`,
            ).toBe(true);
            const ref = oracle.positionAt(1, beat);
            expect(
                near(ref, want, 1e-9),
                `oracle at tick ${tick}: ${ref} ≠ ${want}`,
            ).toBe(true);
            const drawn = walkedPathPointAt(walked, beat);
            if (drawn)
                expect(
                    near(drawn, want, WALKED_SAMPLE_TOLERANCE),
                    `R-20 at tick ${tick}: ${drawn} ≠ ${want}`,
                ).toBe(true);
        }
        // between ticks too: a reader plays between them (EP-R step 2)
        for (const tick of [0.5, 959.25, 2000.75, 3839.5])
            expect(
                near(
                    resolver.positionAt(1, tick / TICKS_PER_BEAT),
                    exactPointAt(PATH, tick),
                    1e-9,
                ),
            ).toBe(true);
        // the next move starts where the path ends
        expect(resolver.positionAt(1, 8)).toEqual(END);
        expect(near(resolver.positionAt(1, 10), [27, 21], 1e-9)).toBe(true);
        expect(resolver.cacheClosureViolation()).toBeNull();
    });

    it("draws its lines and arcs exactly, its cubic as points, and nothing for the hold (R-20)", () => {
        const host = show();
        const { segments } = walkedPath(
            host,
            createCachedResolver(clone(host)),
            1,
            0,
            8,
        );
        // the arc turns 4·atan(0.6) ≈ 124°, so it draws as two arcs of at most a quarter turn
        expect(segments.map((s) => s.kind)).toEqual([
            "line",
            "arc",
            "arc",
            "polyline",
        ]);
        expect(segments[0]).toMatchObject({
            start: 0,
            end: 2,
            from: [0, 0],
            to: [12, 0],
        });
        expect(segments[1]).toMatchObject({ start: 3, end: 4.5 });
        expect(segments[2]).toMatchObject({ start: 4.5, end: 6, to: [24, 0] });
        expect(segments[3]).toMatchObject({ start: 6, to: [24, 12] });
        expect(segments[3]!.end).toBe(8);
    });

    it("QA-EP-5: when the end spot moves, the path's end follows and the keys stay", () => {
        const host = show();
        const resolver = createCachedResolver(host);
        const moved: XY = [24, 18];
        host.transitions[1]!.points = [moved];
        resolver.notify({
            changes: [
                { table: "slot_destinations", rowId: 1, before: {}, after: {} },
            ],
        });
        const followed = followExactEnds(PATH, { to: moved });
        for (let tick = 0; tick <= 3840; tick += 7)
            expect(
                near(
                    resolver.positionAt(1, tick / TICKS_PER_BEAT),
                    exactPointAt(followed, tick),
                    1e-9,
                ),
            ).toBe(true);
        // still on the corner on count 2 and at the arc's end on count 6; at the new spot on 8
        expect(near(resolver.positionAt(1, 2), [12, 0], 1e-12)).toBe(true);
        expect(near(resolver.positionAt(1, 6), [24, 0], 1e-9)).toBe(true);
        expect(resolver.positionAt(1, 8)).toEqual(moved);
        // only the cubic's end and its nearer control moved
        expect(followed.shapes[2]).toEqual({
            kind: "cubic",
            c1: [30, 0],
            c2: [32, 14],
            to: moved,
        });
        // the stored path is untouched: same keys, same shapes
        expect(host.routes![1]!.exact).toEqual(PATH);
        expect(followed.keys).toEqual(PATH.keys);
        expect(resolver.cacheClosureViolation()).toBeNull();
    });

    it("QA-EP-5: when the start spot moves, the path's start follows and the keys stay", () => {
        const host = show();
        const resolver = createCachedResolver(host);
        const moved: XY = [-6, 0];
        host.marchers[0] = { id: 1, home: moved };
        resolver.notify({
            changes: [
                {
                    table: "marchers",
                    rowId: 1,
                    before: { id: 1 },
                    after: { id: 1 },
                },
            ],
        });
        const followed = followExactEnds(PATH, { from: moved });
        expect(followed.from).toEqual(moved);
        for (let tick = 0; tick <= 3840; tick += 7)
            expect(
                near(
                    resolver.positionAt(1, tick / TICKS_PER_BEAT),
                    exactPointAt(followed, tick),
                    1e-9,
                ),
            ).toBe(true);
        expect(resolver.positionAt(1, 0)).toEqual(moved);
        expect(near(resolver.positionAt(1, 2), [12, 0], 1e-12)).toBe(true);
        expect(host.routes![1]!.exact).toEqual(PATH);
        const oracle = createOracle(clone(host));
        for (let b = 0; b <= 12; b += 0.25)
            expect(
                near(oracle.positionAt(1, b), resolver.positionAt(1, b), 1e-9),
            ).toBe(true);
    });

    it("an arc at the moved end keeps its bend", () => {
        const arcEnd: ExactPath = {
            v: 1,
            from: [0, 0],
            shapes: [{ kind: "arc", to: [10, 0], bend: 0.25 }],
            keys: [
                { tick: 0, u: 0 },
                { tick: 3840, u: 1 },
            ],
        };
        const host = show(arcEnd);
        host.transitions[1]!.points = [[20, 0]];
        const resolver = createCachedResolver(host);
        const followed = followExactEnds(arcEnd, { to: [20, 0] });
        expect(followed.shapes[0]).toEqual({
            kind: "arc",
            to: [20, 0],
            bend: 0.25,
        });
        for (let tick = 0; tick <= 3840; tick += 11)
            expect(
                near(
                    resolver.positionAt(1, tick / TICKS_PER_BEAT),
                    exactPointAt(followed, tick),
                    1e-9,
                ),
            ).toBe(true);
    });

    it("a resized move plays the path stretched to fit", () => {
        const host = show();
        host.transitions[1] = { ...host.transitions[1]!, end: 16 };
        host.transitions[2] = { ...host.transitions[2]!, start: 16, end: 20 };
        host.assignments[0] = { ...host.assignments[0]!, end: 16 };
        host.assignments[1] = { ...host.assignments[1]!, start: 16, end: 20 };
        const resolver = createCachedResolver(host);
        for (let tick = 0; tick <= 3840; tick += 5)
            expect(
                near(
                    resolver.positionAt(1, (2 * tick) / TICKS_PER_BEAT),
                    exactPointAt(PATH, tick),
                    1e-9,
                ),
            ).toBe(true);
    });

    it("a path whose followed end breaks a rule walks straight", () => {
        // the arc's end follows onto its start: chord 0 (EP-3)
        const arcOnly: ExactPath = {
            v: 1,
            from: [0, 0],
            shapes: [{ kind: "arc", to: [10, 0], bend: 0.25 }],
            keys: [
                { tick: 0, u: 0 },
                { tick: 3840, u: 1 },
            ],
        };
        const host = show(arcOnly);
        host.transitions[1]!.points = [[0, 0]];
        const resolver = createCachedResolver(host);
        for (let b = 0; b <= 8; b += 0.5)
            expect(resolver.positionAt(1, b)).toEqual([0, 0]);
    });

    it("re-plays when the stored path is replaced, and on undo", () => {
        const host = show();
        const resolver = createCachedResolver(host);
        const before = resolver.positionAt(1, 3);
        const straight: ExactPath = {
            v: 1,
            from: [0, 0],
            shapes: [{ kind: "points", points: [END] }],
            keys: [
                { tick: 0, u: 0 },
                { tick: 3840, u: 1 },
            ],
        };
        const old = host.routes![1]!;
        host.routes![1] = { ...old, exact: straight };
        resolver.notify({
            changes: [{ table: "routes", rowId: 1, before: {}, after: {} }],
        });
        expect(near(resolver.positionAt(1, 3), [9, 4.5], 1e-12)).toBe(true);
        expect(resolver.cacheClosureViolation()).toBeNull();
        host.routes![1] = old;
        resolver.notify({
            changes: [{ table: "routes", rowId: 1, before: {}, after: {} }],
        });
        expect(resolver.positionAt(1, 3)).toEqual(before);
        expect(resolver.cacheClosureViolation()).toBeNull();
    });
});
