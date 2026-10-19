import { describe, expect, it } from "vitest";
import {
    dotRadius,
    evenDotCenters,
    formatOmFill,
    gridDotCenters,
    omDotCenters,
    parseOmFill,
    type Point,
} from "../omFills";
import { countDots } from "../dotCount";

const rect = (w: number, h: number, x = 0, y = 0): Point[][] => [
    [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
    ],
];

const ellipse = (w: number, h: number, n = 256): Point[][] => [
    Array.from({ length: n }, (_, i) => {
        const a = (2 * Math.PI * i) / n;
        return [
            w / 2 + (w / 2) * Math.cos(a),
            h / 2 + (h / 2) * Math.sin(a),
        ] as Point;
    }),
];

const STEP = 11.25; // 22.5 inch steps at 0.5 px per inch

describe("fill style strings", () => {
    it("round-trips every kind with its parameters", () => {
        for (const style of [
            "om-dots:22.5:m",
            "om-staggered:45:s",
            "om-even:24:l",
        ]) {
            expect(formatOmFill(parseOmFill(style)!)).toBe(style);
        }
    });

    it("ignores Excalidraw's own fills and unknown om- names", () => {
        expect(parseOmFill("hachure")).toBeNull();
        expect(parseOmFill("solid")).toBeNull();
        expect(parseOmFill("om-zigzag:3")).toBeNull();
    });

    it("falls back to defaults for missing or broken parameters", () => {
        expect(parseOmFill("om-dots")).toEqual({
            kind: "dots",
            spacing: undefined,
            size: "m",
        });
        expect(parseOmFill("om-even:-3")).toEqual({
            kind: "even",
            count: 24,
            size: "m",
        });
    });
});

describe("dots on a rectangle", () => {
    // 16 × 8 steps; dots must fit whole inside the outline
    const box = rect(16 * STEP, 8 * STEP);

    it.each([
        // interval in steps, then the expected count: columns × rows
        [1, 16 * 8],
        [2, 8 * 4],
        [4, 4 * 2],
    ])("on a %d-step interval", (interval, expected) => {
        expect(gridDotCenters(box, "dots", interval * STEP)).toHaveLength(
            expected,
        );
    });

    it("centers the grid in the shape", () => {
        const pts = gridDotCenters(box, "dots", 2 * STEP);
        const xs = pts.map(([x]) => x);
        const left = Math.min(...xs);
        const right = 16 * STEP - Math.max(...xs);
        expect(left).toBeCloseTo(right, 6);
    });

    it("keeps every dot whole inside the outline", () => {
        const spacing = 2 * STEP;
        const r = dotRadius(spacing);
        for (const [x, y] of gridDotCenters(box, "dots", spacing)) {
            expect(x - r).toBeGreaterThanOrEqual(-1e-6);
            expect(x + r).toBeLessThanOrEqual(16 * STEP + 1e-6);
            expect(y - r).toBeGreaterThanOrEqual(-1e-6);
            expect(y + r).toBeLessThanOrEqual(8 * STEP + 1e-6);
        }
    });

    it("packs staggered rows closer, with every other row shifted half an interval", () => {
        const spacing = 2 * STEP;
        const pts = gridDotCenters(box, "staggered", spacing);
        const rows = [...new Set(pts.map(([, y]) => y.toFixed(6)))]
            .map(Number)
            .sort((a, b) => a - b);
        expect(rows[1]! - rows[0]!).toBeCloseTo(
            (spacing * Math.sqrt(3)) / 2,
            5,
        );
        const firstX = (y: number) =>
            Math.min(
                ...pts
                    .filter(([, py]) => Math.abs(py - y) < 1e-6)
                    .map(([x]) => x),
            );
        expect(Math.abs(firstX(rows[1]!) - firstX(rows[0]!))).toBeCloseTo(
            spacing / 2,
            6,
        );
        // 5 rows: 8 dots in the outer rows, 7 in the shifted ones
        expect(pts).toHaveLength(3 * 8 + 2 * 7);
    });
});

/** Grid points of a centered lattice whose whole dot fits in a circle, counted analytically */
function latticeInCircle(diameter: number, spacing: number): number {
    const r = dotRadius(spacing);
    const R = diameter / 2;
    const n = Math.floor((diameter - 2 * r) / spacing + 1e-9);
    const start = (diameter - n * spacing) / 2;
    let count = 0;
    for (let i = 0; i <= n; i++)
        for (let j = 0; j <= n; j++) {
            const x = start + i * spacing - R;
            const y = start + j * spacing - R;
            if (Math.hypot(x, y) + r <= R + 1e-9) count++;
        }
    return count;
}

describe("dots on an ellipse", () => {
    const circle = ellipse(16 * STEP, 16 * STEP, 1024);
    it.each([1, 2, 4])(
        "on a %d-step interval matches the circle's lattice count",
        (interval) => {
            const expected = latticeInCircle(16 * STEP, interval * STEP);
            const got = gridDotCenters(circle, "dots", interval * STEP).length;
            // The outline is a polygon, so a dot touching the edge may go either way
            expect(Math.abs(got - expected)).toBeLessThanOrEqual(
                Math.ceil(expected * 0.03),
            );
            expect(got).toBeGreaterThan(0);
        },
    );

    it("fits fewer dots at wider intervals", () => {
        const counts = [1, 2, 4].map(
            (i) => gridDotCenters(circle, "dots", i * STEP).length,
        );
        expect(counts[0]).toBeGreaterThan(counts[1]!);
        expect(counts[1]).toBeGreaterThan(counts[2]!);
    });

    it("draws fewer dots than the bounding rectangle", () => {
        const square = gridDotCenters(
            rect(16 * STEP, 16 * STEP),
            "dots",
            2 * STEP,
        ).length;
        expect(gridDotCenters(circle, "dots", 2 * STEP).length).toBeLessThan(
            square,
        );
    });
});

describe("evenly distributed dots", () => {
    it.each([1, 7, 24, 48, 100])(
        "places exactly %d dots in a rectangle",
        (n) => {
            expect(evenDotCenters(rect(16 * STEP, 8 * STEP), n)).toHaveLength(
                n,
            );
        },
    );

    it.each([5, 24, 60])("places exactly %d dots in an ellipse", (n) => {
        const pts = evenDotCenters(ellipse(20 * STEP, 12 * STEP), n);
        expect(pts).toHaveLength(n);
        for (const [x, y] of pts) {
            const dx = (x - 10 * STEP) / (10 * STEP);
            const dy = (y - 6 * STEP) / (6 * STEP);
            expect(dx * dx + dy * dy).toBeLessThanOrEqual(1);
        }
    });
});

describe("counting what Excalidraw draws", () => {
    const element = (overrides: Record<string, unknown>) =>
        ({
            type: "rectangle",
            width: 16 * STEP,
            height: 8 * STEP,
            roughness: 0,
            roundness: null,
            seed: 1234,
            strokeWidth: 2,
            strokeStyle: "solid",
            strokeColor: "#1e1e1e",
            backgroundColor: "#1e1e1e",
            fillStyle: "om-dots:22.5:m",
            ...overrides,
        }) as unknown as Parameters<typeof countDots>[0];

    it("counts the dots rough.js generates through the patched filler", () => {
        expect(countDots(element({}))).toBe(32);
        expect(countDots(element({ roughness: 1 }))).toBe(32);
    });

    it("matches the fill geometry on a clean ellipse", () => {
        const el = element({
            type: "ellipse",
            width: 16 * STEP,
            height: 16 * STEP,
        });
        const fromGeometry = omDotCenters(
            ellipse(16 * STEP, 16 * STEP, 512),
            parseOmFill("om-dots:22.5:m")!,
        ).centers.length;
        expect(Math.abs(countDots(el)! - fromGeometry)).toBeLessThanOrEqual(2);
    });

    it("counts an even fill exactly", () => {
        expect(
            countDots(element({ fillStyle: "om-even:24:m", roughness: 1 })),
        ).toBe(24);
    });

    it("has no count without a dot fill or a fill color", () => {
        expect(countDots(element({ fillStyle: "hachure" }))).toBeNull();
        expect(
            countDots(element({ backgroundColor: "transparent" })),
        ).toBeNull();
    });
});
