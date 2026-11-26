import { describe, expect, it } from "vitest";
import {
    covered,
    menuPlacement,
    menuRect,
    menuSideProps,
    shapeSamples,
    spotRect,
    type MenuPlacementInput,
} from "../menuPlacement";

// A 1000 × 600 field; the editor 300 × 80 with its Rows button 100 px in
const field = { left: 0, top: 0, width: 1000, height: 600 };
const at = (left: number, top: number) => ({
    editor: { left, top, width: 300, height: 80 },
    trigger: { left: left + 100, top: top + 50, width: 60, height: 24 },
});
const menu = { width: 340, height: 300 };
const input = (
    over: Partial<MenuPlacementInput> & Pick<MenuPlacementInput, "editor">,
): MenuPlacementInput => ({
    ...menu,
    trigger: over.trigger ?? {
        left: over.editor.left + 100,
        top: over.editor.top + 50,
        width: 60,
        height: 24,
    },
    field,
    shape: [],
    ...over,
});

describe("menuPlacement", () => {
    it("opens under the editor when that's clear, as the menus always did", () => {
        // Shape above the editor, room below
        expect(
            menuPlacement(
                input({
                    ...at(300, 150),
                    shape: [
                        [
                            { x: 350, y: 60 },
                            { x: 600, y: 60 },
                        ],
                    ],
                }),
            ).where,
        ).toBe("below");
    });

    it("opens above the editor when below runs off the field", () => {
        // The editor near the bottom, the shape well above the menu's reach
        expect(
            menuPlacement(
                input({
                    ...at(300, 480),
                    shape: [[{ x: 50, y: 20 }]],
                }),
            ).where,
        ).toBe("above");
    });

    it("goes beside the editor rather than over the shape (the owner's screenshot)", () => {
        // Editor near the bottom, the shape's rows running from top left into where above would go
        const shape = [
            [
                { x: 140, y: 90 },
                { x: 345, y: 190 },
            ],
            [
                { x: 140, y: 110 },
                { x: 345, y: 210 },
            ],
        ];
        const spot = menuPlacement(input({ ...at(150, 400), shape }));
        expect(spot).toEqual({ where: "right", away: 0 });
        const r = spotRect(input({ ...at(150, 400), shape }), spot);
        expect(covered(r, shapeSamples(shape))).toBe(0);
    });

    it("tests the stretch between two far points, not just the points", () => {
        // A long straight line whose ends both sit outside the box above the editor
        const shape = [
            { x: 0, y: 300 },
            { x: 1000, y: 300 },
        ];
        expect(
            covered(menuRect(input({ ...at(300, 400) }), "above"), shape),
        ).toBe(0);
        expect(
            covered(
                menuRect(input({ ...at(300, 400) }), "above"),
                shapeSamples([shape]),
            ),
        ).toBeGreaterThan(0);
    });

    it("slides out past a shape wider than the editor rather than cover it", () => {
        // A long line just above the editor near the bottom: above the editor covers it, above
        // the line is clear
        const shape = [
            [
                { x: 100, y: 450 },
                { x: 900, y: 450 },
            ],
        ];
        const spot = menuPlacement(input({ ...at(300, 480), shape }));
        expect(spot).toEqual({ where: "above", away: 34 });
        const r = spotRect(input({ ...at(300, 480), shape }), spot);
        expect(r.top + r.height).toBe(440);
        expect(covered(r, shapeSamples(shape))).toBe(0);
    });

    it("keeps where it is while that's still clear", () => {
        // Both below and above are clear: it stays above rather than hopping back down
        expect(
            menuPlacement(input({ ...at(300, 150), current: "above" })).where,
        ).toBe("below");
        expect(
            menuPlacement(
                input({
                    editor: { left: 300, top: 320, width: 300, height: 80 },
                    current: "above",
                    height: 200,
                }),
            ).where,
        ).toBe("above");
    });

    it("with nowhere clear, takes the spot inside the field covering least", () => {
        // The shape fills the field
        const shape: { x: number; y: number }[] = [];
        for (let x = 0; x <= 1000; x += 20)
            for (let y = 0; y <= 600; y += 20)
                if (x < 500 || y < 300) shape.push({ x, y });
        expect(
            menuPlacement(
                input({ ...at(330, 260), shape: shape.map((p) => [p]) }),
            ).where,
        ).toBe("right");
    });

    it("slides along the editor's edge to stay inside the field", () => {
        const r = menuRect(input({ ...at(800, 100) }), "below");
        expect(r.left + r.width).toBe(1000);
        const side = menuRect(input({ ...at(100, 20) }), "right");
        expect(side.top).toBe(0);
    });
});

describe("menuSideProps", () => {
    const { editor, trigger } = at(300, 200);

    it("reaches past the button to the editor's edge", () => {
        // Button bottom at 274, editor bottom at 280: 6 to the edge, 6 more for the gap
        expect(
            menuSideProps({ where: "below", away: 0 }, trigger, editor),
        ).toEqual({
            side: "bottom",
            align: "start",
            sideOffset: 12,
        });
        expect(
            menuSideProps({ where: "above", away: 0 }, trigger, editor)
                .sideOffset,
        ).toBe(56);
        expect(
            menuSideProps({ where: "right", away: 0 }, trigger, editor)
                .sideOffset,
        ).toBe(146);
        expect(
            menuSideProps({ where: "left", away: 0 }, trigger, editor)
                .sideOffset,
        ).toBe(106);
        // Slid out: that much further
        expect(
            menuSideProps({ where: "above", away: 34 }, trigger, editor)
                .sideOffset,
        ).toBe(90);
    });
});
