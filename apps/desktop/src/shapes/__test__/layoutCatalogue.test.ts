import { describe, expect, it } from "vitest";
import {
    familyHint,
    layoutCatalogue,
    missingLine,
    nearestVersion,
    resolveLayout,
    type LayoutVersion,
} from "../distribute/layouts";
import { distribute } from "../distribute/distribute";
import { rectRegion } from "../distribute/region";
import type { FilesLayout } from "../distribute/distribution";

/**
 * The box's layout catalogue (#387, spec #385): every layout is a full block minus a pattern, its
 * versions run wide to deep, and a shape two layouts can make lists under the more specific one.
 */

const labelsOf = (n: number, family: string) =>
    layoutCatalogue(n)
        .find((r) => r.family === family)!
        .versions.map((v) => v.label);

const versionsOf = (n: number) => layoutCatalogue(n).flatMap((r) => r.versions);

/** The spots a version lays out, at one interval both ways */
const spotsOf = (v: LayoutVersion, n: number) =>
    distribute({
        region: rectRegion(0, 0),
        n,
        distribution: { mode: "files", layout: v.layout, stagger: [0, 1] },
        across: 1,
        deep: 1,
    });

describe("the layout catalogue", () => {
    it("lists the rows in the fixed order Full · Stagger · Rounded · Short back · Notched", () => {
        expect(layoutCatalogue(24).map((r) => r.label)).toEqual([
            "Full",
            "Stagger",
            "Rounded",
            "Short back",
            "Notched",
        ]);
    });

    it("for 23: Stagger offers 8 × 3 and 5 × 5 plus their turned versions; Full is hidden", () => {
        expect(labelsOf(23, "stagger")).toEqual([
            "8 × 3",
            "5 × 5",
            "5 × 5",
            "3 × 8",
        ]);
        const stagger = layoutCatalogue(23).find(
            (r) => r.family === "stagger",
        )!;
        expect(stagger.versions[1]!.lines).toEqual([5, 4, 5, 4, 5]);
        expect(stagger.versions.map((v) => v.layout.byFile)).toEqual([
            false,
            false,
            true,
            true,
        ]);
        const full = layoutCatalogue(23).find((r) => r.family === "full")!;
        expect(full.versions).toEqual([]);
        expect(full.hint).toEqual({ more: 1, fewer: 2 });
        expect(missingLine(23, layoutCatalogue(23))).toBe(
            "Not for 23: Full (add 1 or remove 2)",
        );
    });

    it("for 24: Full offers 8 × 3, 6 × 4, 4 × 6 and 3 × 8, first", () => {
        const rows = layoutCatalogue(24);
        expect(rows[0]!.family).toBe("full");
        expect(rows[0]!.versions.map((v) => v.label)).toEqual([
            "8 × 3",
            "6 × 4",
            "4 × 6",
            "3 × 8",
        ]);
    });

    it("labels Short back with how many short, Rounded and Notched with staggered or straight", () => {
        expect(labelsOf(23, "shortBack")).toEqual([
            "8 × 3, 1 short",
            "6 × 4, 1 short",
            "5 × 5, 2 short",
            "4 × 6, 1 short",
            "3 × 8, 1 short",
        ]);
        expect(labelsOf(23, "rounded")).toEqual([
            "5 × 5 staggered",
            "5 × 5 staggered",
        ]);
        expect(labelsOf(23, "notched")).toEqual([
            "5 × 5 straight",
            "5 × 5 straight",
        ]);
        expect(labelsOf(24, "notched")).toEqual([
            "5 × 5 staggered",
            "5 × 5 staggered",
        ]);
    });

    it("never says files, ranks, by file or ends in a label; the counts go in the tooltip", () => {
        for (let n = 1; n <= 60; n++)
            for (const v of versionsOf(n)) {
                expect(v.label).not.toMatch(/file|rank|ends|turn/i);
                // Front to back (the lines run back first), or left to right turned
                const counts = v.layout.byFile
                    ? v.lines
                    : [...v.lines].reverse();
                expect(v.tooltip).toContain(counts.join(" / "));
            }
        const turned = layoutCatalogue(23)
            .find((r) => r.family === "stagger")!
            .versions.find((v) => v.layout.byFile)!;
        expect(turned.tooltip).toMatch(/left to right/);
    });

    it("hides a row the count can't make and says how many would unlock it", () => {
        const rows = layoutCatalogue(26);
        // 27 would be 9 × 3, which is 3:1, not within it
        expect(rows.find((r) => r.family === "full")!.hint).toEqual({
            more: 2,
            fewer: 1,
        });
        expect(missingLine(26, rows)).toBe(
            "Not for 26: Full (add 2 or remove 1) · Stagger (add 1 or remove 1)",
        );
        expect(missingLine(24, layoutCatalogue(24))).toBeNull();
    });

    it("places exactly n for every version from 1 to 120 marchers, with no short rank under 2", () => {
        for (let n = 1; n <= 120; n++)
            for (const v of versionsOf(n)) {
                expect(v.lines.reduce((a, b) => a + b, 0)).toBe(n);
                expect(spotsOf(v, n)).toHaveLength(n);
                const width = Math.max(...v.lines);
                for (const line of v.lines)
                    if (line < width) expect(line).toBeGreaterThanOrEqual(2);
            }
    });

    it("keeps every version within 3:1 of square, wide to deep", () => {
        for (let n = 1; n <= 120; n++)
            for (const row of layoutCatalogue(n)) {
                for (const v of row.versions)
                    expect(Math.max(v.across, v.deep)).toBeLessThan(
                        3 * Math.min(v.across, v.deep),
                    );
                const aspects = row.versions.map((v) => v.across / v.deep);
                expect([...aspects].sort((a, b) => b - a)).toEqual(aspects);
            }
    });

    it("cuts every version from a full block: each line centered, only the family's pattern removed", () => {
        for (let n = 1; n <= 120; n++)
            for (const row of layoutCatalogue(n))
                for (const v of row.versions) {
                    const width = Math.max(...v.lines);
                    const short = v.lines.map((l) => width - l);
                    const R = v.lines.length;
                    const mid = (R - 1) / 2;
                    switch (row.family) {
                        case "full":
                            expect(short.every((s) => s === 0)).toBe(true);
                            break;
                        case "stagger":
                            expect(R % 2).toBe(1);
                            short.forEach((s, i) =>
                                expect(s).toBe(
                                    (i % 2 === 0) === (short[0] === 0) ? 0 : 1,
                                ),
                            );
                            break;
                        case "rounded":
                            expect(short[0]).toBe(short[R - 1]);
                            expect([1, 2]).toContain(short[0]);
                            short
                                .slice(1, -1)
                                .forEach((s) => expect(s).toBe(0));
                            break;
                        case "notched":
                            expect(R % 2).toBe(1);
                            expect([1, 2]).toContain(short[mid]);
                            short.forEach(
                                (s, i) => i !== mid && expect(s).toBe(0),
                            );
                            break;
                        case "shortBack":
                            // the back line (first) short, the rest full
                            expect(short[0]).toBeGreaterThan(0);
                            short.slice(1).forEach((s) => expect(s).toBe(0));
                            break;
                    }
                }
    });

    it("lists a shape two layouts can make under the more specific one, and never twice", () => {
        for (let n = 1; n <= 120; n++) {
            const keys = versionsOf(n).map((v) =>
                JSON.stringify(
                    spotsOf(v, n)
                        .map((s) => [s.x, s.y])
                        .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!),
                ),
            );
            expect(new Set(keys).size).toBe(keys.length);
        }
        // A block with its corners off is the same shape by rank or by file: listed once
        const rounded = layoutCatalogue(24).find(
            (r) => r.family === "rounded",
        )!;
        expect(rounded.versions.map((v) => v.label)).toEqual([
            "7 × 4 straight",
            "4 × 7 straight",
        ]);
    });

    it("turns Stagger, Rounded and Notched only", () => {
        for (let n = 1; n <= 120; n++)
            for (const row of layoutCatalogue(n))
                if (row.family === "full" || row.family === "shortBack")
                    expect(row.versions.every((v) => !v.layout.byFile)).toBe(
                        true,
                    );
    });
});

describe("resolving a layout for a count", () => {
    const stagger55: FilesLayout = {
        family: "stagger",
        files: 5,
        byFile: false,
    };

    it("keeps a version that makes the count", () => {
        const r = resolveLayout(stagger55, 23);
        expect(r.layout).toEqual(stagger55);
        expect(r.lines).toEqual([5, 4, 5, 4, 5]);
        expect(r.fellBack).toBeNull();
    });

    it("moves to the family's version nearest in proportion when the count changes", () => {
        // 22 as a stagger: 4 / 5 / 4 / 5 / 4, the same 5 × 5 block
        const r = resolveLayout(stagger55, 22);
        expect(r.layout.family).toBe("stagger");
        expect(r.lines).toEqual([4, 5, 4, 5, 4]);
        expect(r.fellBack).toBeNull();
    });

    it("falls back to Short back, as wide, when the family can't make the count", () => {
        const full64: FilesLayout = { family: "full", files: 6, byFile: false };
        const r = resolveLayout(full64, 23);
        expect(r.layout).toEqual({
            family: "shortBack",
            files: 6,
            byFile: false,
        });
        expect(r.lines).toEqual([5, 6, 6, 6]);
        expect(r.fellBack).toBe("full");
        expect(familyHint("full", 23)).toEqual({ more: 1, fewer: 2 });
    });

    it("finds the version nearest a drawn proportion", () => {
        expect(nearestVersion("full", 24, 1)!.label).toBe("6 × 4");
        expect(nearestVersion("full", 24, 3)!.label).toBe("8 × 3");
        expect(nearestVersion("full", 23, 1)).toBeNull();
    });
});
