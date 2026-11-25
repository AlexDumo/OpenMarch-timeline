import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
    parsePerformerFiguresWrite,
    readPerformerFigures,
    writePerformerFigures,
} from "../performerFigures";

const fp = (c: string) => c.repeat(64);
const row = (c: string, byte = 1) => ({
    fingerprint: fp(c),
    image: new Uint8Array([byte, 2, 3]),
    layout: JSON.stringify({ w: 10, h: 12, pxPerMeter: 250, cx: 5, cy: 6 }),
});

describe("performer figures (ADR 0019)", () => {
    it("reads none from a file without the table, and makes the table on the first write", () => {
        const db = new DatabaseSync(":memory:");
        expect(readPerformerFigures(db)).toEqual([]);
        writePerformerFigures(db, { put: [row("a")], keep: null });
        expect(readPerformerFigures(db)).toEqual([row("a")]);
    });

    it("replaces a figure and drops the ones no look uses", () => {
        const db = new DatabaseSync(":memory:");
        writePerformerFigures(db, {
            put: [row("a"), row("b"), row("c")],
            keep: null,
        });
        writePerformerFigures(db, { put: [row("b", 9)], keep: [fp("a")] });
        expect(readPerformerFigures(db)).toEqual([row("a"), row("b", 9)]);
    });

    it("reads only the figures named", () => {
        const db = new DatabaseSync(":memory:");
        writePerformerFigures(db, { put: [row("a"), row("b")], keep: null });
        expect(readPerformerFigures(db, [fp("b"), fp("c")])).toEqual([
            row("b"),
        ]);
    });

    it("writes nothing when a row breaks the table's checks", () => {
        const db = new DatabaseSync(":memory:");
        writePerformerFigures(db, { put: [row("a")], keep: null });
        expect(() =>
            writePerformerFigures(db, {
                put: [row("b"), { ...row("c"), layout: "[1]" }],
                keep: [],
            }),
        ).toThrow();
        expect(readPerformerFigures(db)).toEqual([row("a")]);
    });

    it("refuses a write with a bad fingerprint, image or keep list", () => {
        expect(() =>
            parsePerformerFiguresWrite({
                put: [{ ...row("a"), fingerprint: "x" }],
                keep: null,
            }),
        ).toThrow(/fingerprint/);
        expect(() =>
            parsePerformerFiguresWrite({
                put: [{ ...row("a"), image: "x" }],
                keep: null,
            }),
        ).toThrow(/image/);
        expect(() =>
            parsePerformerFiguresWrite({ put: [], keep: ["A".repeat(64)] }),
        ).toThrow(/keep/);
        expect(
            parsePerformerFiguresWrite({ put: [row("a")], keep: [fp("b")] }),
        ).toEqual({
            put: [row("a")],
            keep: [fp("b")],
        });
    });
});
