import { describe, expect, it } from "vitest";
import { lineTool } from "../../line/lineTool";
import { drawLine, type LineParams } from "../../line/lineGeometry";
import type { ToolEnv } from "../../tool/toolKind";
import type { XY } from "../../types";
import { GROUP_COLORS, groupColor, groupDrawing } from "../groupDrawing";

/**
 * What the field draws of a Line's interval groups while the editor's group menu is open (owner
 * feedback on #526): each spot ringed in its group's color, and with a group lit, its gaps
 * labeled. A drawing only.
 */

const STEP = 10;
const half = STEP / 2;
const env: ToolEnv = {
    stepPx: STEP,
    snap: true,
    constrain: false,
    gridSnap: (p) => ({
        x: Math.round(p.x / half) * half,
        y: Math.round(p.y / half) * half,
    }),
    hitRadius: 3,
};
const interval = lineTool.params.find((p) => p.key === "interval")!;

const lineWith = (n: number, list: string, to: XY = { x: 150, y: 100 }) =>
    interval.type(
        drawLine({ x: 100, y: 100 }, to, env)!,
        n,
        list,
        env,
    ) as LineParams;

/** Spots in order along the line, as the kind lays them out */
const spotsOf = (p: LineParams, n: number) =>
    lineTool.shape.generate(p, n, { stepPx: STEP } as never);

describe("the groups' colors", () => {
    it("gives each group its own color, round again past the palette", () => {
        const first = GROUP_COLORS.map((_, i) => groupColor(i));
        expect(new Set(first).size).toBe(GROUP_COLORS.length);
        expect(groupColor(GROUP_COLORS.length)).toBe(groupColor(0));
        expect(groupColor(GROUP_COLORS.length + 2)).toBe(groupColor(2));
    });

    it("keeps clear of the shape's purple and the next path's green", () => {
        const hex = (c: string) =>
            [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
        const far = (a: number[], b: number[]) =>
            Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!) > 80;
        for (const c of GROUP_COLORS) {
            expect(far(hex(c), [126, 34, 206])).toBe(true);
            expect(far(hex(c), [0, 175, 13])).toBe(true);
        }
    });
});

describe("a line's groups on the field", () => {
    const p = lineWith(8, "2*3+3*2+4");
    const spots = spotsOf(p, 8);

    it("draws nothing with the menu closed", () => {
        expect(groupDrawing(lineTool, p, 8, spots, null, STEP)).toEqual({});
    });

    it("draws nothing for one interval", () => {
        const plain = lineWith(8, "2");
        expect(
            groupDrawing(
                lineTool,
                plain,
                8,
                spotsOf(plain, 8),
                { lit: null },
                STEP,
            ),
        ).toEqual({});
    });

    it("rings every spot faintly in its group's color while the menu is open", () => {
        const { groupMarks, groupLabels } = groupDrawing(
            lineTool,
            p,
            8,
            spots,
            { lit: null },
            STEP,
        );
        expect(groupMarks!.map((m) => m.group)).toEqual([
            0, 0, 1, 1, 1, 2, 2, 2,
        ]);
        expect(groupMarks!.every((m) => m.shade === "faint")).toBe(true);
        expect(groupMarks!.map((m) => m.color)).toEqual(
            [0, 0, 1, 1, 1, 2, 2, 2].map(groupColor),
        );
        expect(groupMarks!.map((m) => m.at)).toEqual(spots.map((s) => s));
        expect(groupLabels).toEqual([]);
    });

    it("lights the group pointed at, dims the rest and labels its gaps at their middles", () => {
        const { groupMarks, groupLabels } = groupDrawing(
            lineTool,
            p,
            8,
            spots,
            { lit: 1 },
            STEP,
        );
        expect(groupMarks!.map((m) => m.shade)).toEqual([
            "dim",
            "dim",
            "lit",
            "lit",
            "lit",
            "dim",
            "dim",
            "dim",
        ]);
        expect(groupLabels!.map((l) => l.text)).toEqual(["2", "2"]);
        expect(groupLabels![0]!.at.x).toBeCloseTo(
            (spots[2]!.x + spots[3]!.x) / 2,
        );
        expect(groupLabels![1]!.at.x).toBeCloseTo(
            (spots[3]!.x + spots[4]!.x) / 2,
        );
        expect(groupLabels!.every((l) => l.color === groupColor(1))).toBe(true);
    });

    it("labels a Measured line's gaps with its axis", () => {
        const measured = { ...p, measured: "x" } as LineParams;
        const { groupLabels } = groupDrawing(
            lineTool,
            measured,
            8,
            spotsOf(measured, 8),
            { lit: 0 },
            STEP,
        );
        expect(groupLabels!.map((l) => l.text)).toEqual(["↔ 3"]);
    });
});
