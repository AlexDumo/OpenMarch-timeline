import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { OrderForm } from "@/db-functions/rememberedOrder";
import {
    shownOrderOf,
    shownTrailOrder,
    type ShownTrail,
} from "../marcherOrderStore";
import { drawLine, LaneInk, LaneMarks, orderInk } from "../MarcherOrderOverlay";
import { laneHalfWidth } from "../orderLane";
import type { XY } from "../orderSweep";

/**
 * A selected trail's band keeps its direction the whole move (owner, 2026-11-17, lab #1083: a box
 * snaking out showed a uniform pale band mid-move, no dark end and no tip). The trail's order is
 * remembered only from its move's end, so mid-move the selection's order was a guess, which isn't
 * drawn at rest: only the pale walked way showed. While the trail is shown, its own order is the
 * one drawn at every beat of its move.
 */

afterEach(cleanup);

/** Five marchers mid-move, strung along an L: the tail at the left, the leader (5) up the corner */
const AT = new Map<number, XY>([
    [1, { x: 0, y: 100 }],
    [2, { x: 30, y: 100 }],
    [3, { x: 60, y: 100 }],
    [4, { x: 60, y: 70 }],
    [5, { x: 60, y: 40 }],
]);
const IDS = [1, 2, 3, 4, 5];
/** The trail of [9, 17), leader first */
const TRAIL: ShownTrail = { start: 9, end: 17, order: [5, 4, 3, 2, 1] };
/** Before the move they stood in a box (a shape with no line order), then the trail's own form */
const FORMS: OrderForm[] = [
    { endBeat: 9, kind: "clear", marcherIds: IDS },
    { endBeat: 17, kind: "trail", order: [5, 4, 3, 2, 1] },
];

const DOT = 4;
const REACH = 9;

/** The band as the overlay draws it at rest for `order`, on screen */
function band(order: readonly number[]) {
    const points = order.map((id) => AT.get(id)!);
    return drawLine({
        points,
        marchers: points.length,
        guessed: false,
        numbered: false,
        halfWidth: laneHalfWidth(DOT, REACH, true),
        dotRadius: DOT,
        busy: [],
        dots: points,
        floorAt: () => 1,
    });
}

/** An `rgb(r,g,b)` stop color's brightness, 0 to 255 */
const brightness = (color: string | null) => {
    const [r, g, b] = (color ?? "").match(/\d+/g)!.map(Number);
    return (r! + g! + b!) / 3;
};

describe("a selected trail's band keeps its direction (owner, 2026-11-17)", () => {
    it("mid-move, the shown trail's order is drawn; without it the order is only a guess, which isn't drawn at rest", () => {
        const guess = shownOrderOf(FORMS, IDS, 13, AT);
        expect(guess === null || guess.guessed).toBe(true);
        expect(shownOrderOf(FORMS, IDS, 13, AT, TRAIL)).toEqual({
            order: [5, 4, 3, 2, 1],
            guessed: false,
        });
        // At the start flag too, standing in the line-up
        expect(shownOrderOf(FORMS, IDS, 9, AT, TRAIL)?.guessed).toBe(false);
        // From the move's end the remembered order speaks, as before
        expect(shownTrailOrder(TRAIL, IDS, 17)).toBeNull();
        expect(shownOrderOf(FORMS, IDS, 17, AT, TRAIL)).toEqual({
            order: [5, 4, 3, 2, 1],
            guessed: false,
        });
    });

    it("only for exactly the trail's marchers, and only inside its move", () => {
        expect(shownTrailOrder(TRAIL, [1, 2, 3, 4], 13)).toBeNull();
        expect(shownTrailOrder(TRAIL, [1, 2, 3, 4, 6], 13)).toBeNull();
        expect(shownTrailOrder(TRAIL, IDS, 8)).toBeNull();
        expect(shownTrailOrder(null, IDS, 13)).toBeNull();
    });

    it("the band through a dragged-out trail's marchers has its dark end at the leader and its tip past the leader", () => {
        const order = shownOrderOf(FORMS, IDS, 13, AT, TRAIL)!.order;
        const line = band(order);
        expect(line.kind).toBe("lane");
        expect(line.tip).not.toBeNull();
        render(
            <svg>
                <LaneInk id="t" line={line} holes={[]} />
                <LaneMarks line={line} ink={orderInk(false)} />
            </svg>,
        );
        // The head arrow: past the leader (5), away from the one behind it (4)
        const tip = screen.getByTestId("marcherOrderTip");
        const corners = tip
            .getAttribute("points")!
            .split(" ")
            .map((p) => p.split(",").map(Number) as [number, number]);
        const mid = corners.reduce(
            (s, [x, y]) => ({
                x: s.x + x / corners.length,
                y: s.y + y / corners.length,
            }),
            { x: 0, y: 0 },
        );
        const leader = AT.get(5)!;
        const behind = AT.get(4)!;
        expect(mid.y).toBeLessThan(leader.y);
        expect(Math.hypot(mid.x - behind.x, mid.y - behind.y)).toBeGreaterThan(
            Math.hypot(leader.x - behind.x, leader.y - behind.y),
        );
        // The fade: darkest at the leader, palest at the tail
        const fade = screen.getByTestId("marcherOrderFade");
        expect(fade.getAttribute("data-kind")).toBe("lane");
        const stops = [...fade.querySelectorAll("stop")].map((s) =>
            s.getAttribute("stop-color"),
        );
        expect(brightness(stops[0]!)).toBeLessThan(
            brightness(stops.at(-1)!) - 60,
        );
    });
});
