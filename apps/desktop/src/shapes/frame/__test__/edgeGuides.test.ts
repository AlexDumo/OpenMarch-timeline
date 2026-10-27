import { describe, expect, it } from "vitest";
import { edgeGuides } from "../edgeGuides";

/** The guides along the field's lines a shape's edges are on (#425) */
describe("edgeGuides", () => {
    const field = { width: 300, height: 200 };
    const lines = { x: [0, 80, 160], y: [0, -100] };
    // A box from x 80 to 160 and y -40 to -10: its left and right edges on yard lines
    const outline = [
        { x: 80, y: -40 },
        { x: 160, y: -40 },
        { x: 160, y: -10 },
        { x: 80, y: -10 },
    ];
    const spots = [
        { x: 80, y: -40 },
        { x: 120, y: -40 },
        { x: 160, y: -40 },
        { x: 80, y: -10 },
        { x: 120, y: -10 },
        { x: 160, y: -10 },
    ];

    it("draws a guide across the field along each line an edge is on, and tints its spots", () => {
        const { guides, edges, on } = edgeGuides(outline, spots, lines, field);
        expect(guides).toEqual([
            { axis: "x", at: 80, from: { x: 80, y: 0 }, to: { x: 80, y: 200 } },
            {
                axis: "x",
                at: 160,
                from: { x: 160, y: 0 },
                to: { x: 160, y: 200 },
            },
        ]);
        expect(edges).toEqual([
            { from: { x: 160, y: -40 }, to: { x: 160, y: -10 } },
            { from: { x: 80, y: -10 }, to: { x: 80, y: -40 } },
        ]);
        expect(on).toEqual([
            { x: 80, y: -40 },
            { x: 160, y: -40 },
            { x: 80, y: -10 },
            { x: 160, y: -10 },
        ]);
    });

    it("draws none for edges between lines, a turned outline or no lines", () => {
        const off = outline.map((p) => ({ x: p.x + 2, y: p.y }));
        expect(edgeGuides(off, spots, lines, field).guides).toEqual([]);
        expect(edgeGuides(off, spots, lines, field).edges).toEqual([]);
        const turned = [
            { x: 80, y: -40 },
            { x: 120, y: 0 },
            { x: 80, y: 40 },
            { x: 40, y: 0 },
        ];
        expect(edgeGuides(turned, spots, lines, field).guides).toEqual([]);
        expect(edgeGuides(outline, spots, undefined, field).guides).toEqual([]);
    });

    it("draws a front-to-back line's guide side to side", () => {
        const back = [
            { x: 10, y: -100 },
            { x: 50, y: -100 },
            { x: 50, y: -60 },
            { x: 10, y: -60 },
        ];
        expect(edgeGuides(back, [], lines, field).guides).toEqual([
            {
                axis: "y",
                at: -100,
                from: { x: 0, y: -100 },
                to: { x: 300, y: -100 },
            },
        ]);
    });

    it("draws a guide along a line a moved shape's center is on, but not a turned one's", () => {
        // Centered on the 80 front to back, its sides between lines
        const centered = [
            { x: 60, y: -40 },
            { x: 100, y: -40 },
            { x: 100, y: -10 },
            { x: 60, y: -10 },
        ];
        const center = { x: 80, y: -25 };
        const { guides, edges } = edgeGuides(
            centered,
            [],
            lines,
            field,
            center,
        );
        expect(guides).toEqual([
            { axis: "x", at: 80, from: { x: 80, y: 0 }, to: { x: 80, y: 200 } },
        ]);
        expect(edges).toEqual([]);
        const turned = [
            { x: 80, y: -45 },
            { x: 100, y: -25 },
            { x: 80, y: -5 },
            { x: 60, y: -25 },
        ];
        expect(edgeGuides(turned, [], lines, field, center).guides).toEqual([]);
        expect(edgeGuides(centered, [], lines, field).guides).toEqual([]);
    });
});
