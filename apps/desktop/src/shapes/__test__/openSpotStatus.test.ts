// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
    openSpotLabel,
    openSpotStatus,
    type StatusSpan,
} from "../placed/openSpotStatus";
import type { XY } from "../types";

/**
 * Why a placed shape's spot is open (ADR 0006 revision of 2026-11-22, §9.1), from one member's
 * spans and where it stands. The shape is marked at count 16; its member's spot is (100, 0); it
 * comes from (0, 0).
 */

const MARK = 16;
const SPOT = { x: 100, y: 0, taken: false };
const FROM: XY = { x: 0, y: 0 };
const ELSEWHERE: XY = { x: 0, y: 50 };

const hold = (start: number, end: number): StatusSpan => ({
    start,
    end,
    kind: "hold",
    assignmentEnd: null,
});
const move = (
    start: number,
    end: number,
    assignmentEnd: number = end,
): StatusSpan => ({ start, end, kind: "founding", assignmentEnd });

/** Where the member stands at a beat: piecewise, the last point at or before it */
const path =
    (points: readonly (readonly [number, XY])[]) =>
    (beat: number): XY =>
        [...points].reverse().find(([b]) => b <= beat)?.[1] ?? points[0]![1];

const status = (
    beat: number,
    spans: readonly StatusSpan[],
    positionAt: (beat: number) => XY | undefined,
    spot: { x: number; y: number; taken: boolean } = SPOT,
) => openSpotStatus({ spot, markBeat: MARK, beat, spans, positionAt });

describe("openSpotStatus", () => {
    it("is empty when a later shape took the marcher, whatever its moves", () => {
        expect(status(20, [], () => FROM, { ...SPOT, taken: true })).toEqual({
            kind: "empty",
        });
    });

    it("is late at the shape's own count when its move arrives after it", () => {
        // Walks 8 to 24, getting to its spot 8 counts after the shape's count
        const spans = [hold(-Infinity, 8), move(8, 24), hold(24, Infinity)];
        const at = path([
            [0, FROM],
            [24, SPOT],
        ]);
        expect(status(MARK, spans, at)).toEqual({ kind: "late", at: 24 });
    });

    it("is on the way at a carried count before it arrives", () => {
        const spans = [hold(-Infinity, 8), move(8, 24), hold(24, Infinity)];
        const at = path([
            [0, FROM],
            [24, SPOT],
        ]);
        expect(status(20, spans, at)).toEqual({ kind: "onTheWay", at: 24 });
    });

    it("is taken over when a higher layer cuts into its move to the spot before it arrives", () => {
        // Its row runs 8 to 16 for the shape, cut at 12 by a higher layer that takes it elsewhere
        const spans = [
            hold(-Infinity, 8),
            move(8, 12, MARK),
            move(12, 20),
            hold(20, Infinity),
        ];
        const at = path([
            [0, FROM],
            [12, { x: 50, y: 0 }],
            [20, ELSEWHERE],
        ]);
        expect(status(MARK, spans, at)).toEqual({ kind: "takenOver", at: 12 });
        // Still so at a later count the shape is carried onto
        expect(status(28, spans, at)).toEqual({ kind: "takenOver", at: 12 });
    });

    it("is not taken over by a cut after the shape's count: it left instead", () => {
        // Arrives at 16; a later row of its own, cut short at 24 by a higher layer
        const spans = [
            hold(-Infinity, 8),
            move(8, MARK),
            hold(MARK, 20),
            move(20, 24, 28),
            move(24, 28),
            hold(28, Infinity),
        ];
        const at = path([
            [0, FROM],
            [MARK, SPOT],
            [21, ELSEWHERE],
        ]);
        expect(status(30, spans, at)).toEqual({ kind: "left", at: 20 });
    });

    it("is left at a carried count after it moved off its spot", () => {
        const spans = [
            hold(-Infinity, 8),
            move(8, MARK),
            hold(MARK, 24),
            move(24, 32),
            hold(32, Infinity),
        ];
        const at = path([
            [0, FROM],
            [MARK, SPOT],
            [25, ELSEWHERE],
        ]);
        expect(status(40, spans, at)).toEqual({ kind: "left", at: 24 });
    });

    it("is away when nothing it does explains it: it never stood on the spot", () => {
        const spans = [hold(-Infinity, 8), move(8, 12), hold(12, Infinity)];
        expect(status(MARK, spans, () => ELSEWHERE)).toEqual({ kind: "away" });
    });
});

describe("openSpotLabel", () => {
    const t = (key: string, params: Record<string, string>) =>
        `${key}(${Object.entries(params)
            .map(([k, v]) => `${k}=${v}`)
            .join(",")})`;
    const where = (beat: number) => `@${beat}`;

    it("names the marcher, and the count where one applies", () => {
        expect(openSpotLabel({ kind: "late", at: 24 }, "B12", where, t)).toBe(
            "shapes.placed.open.late(name=B12,where=@24)",
        );
        expect(
            openSpotLabel({ kind: "takenOver", at: 12 }, "B12", where, t),
        ).toBe("shapes.placed.open.takenOver(name=B12,where=@12)");
        expect(openSpotLabel({ kind: "left", at: 20 }, "B12", where, t)).toBe(
            "shapes.placed.open.left(name=B12,where=@20)",
        );
        expect(
            openSpotLabel({ kind: "onTheWay", at: 24 }, "B12", where, t),
        ).toBe("shapes.placed.open.onTheWay(name=B12)");
        expect(openSpotLabel({ kind: "empty" }, "B12", where, t)).toBe(
            "shapes.placed.open.empty(name=B12)",
        );
        expect(openSpotLabel({ kind: "away" }, "B12", where, t)).toBe(
            "shapes.placed.open.away(name=B12)",
        );
    });
});
