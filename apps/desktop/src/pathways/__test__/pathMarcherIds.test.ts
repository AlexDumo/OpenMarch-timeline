import { describe, expect, it } from "vitest";
import { pathMarcherIds, type PathSession } from "../pathPenStore";

const session = (phase: PathSession["phase"]): PathSession =>
    ({
        phase,
        target: { marcherId: 7 },
        drill: "T7",
        points: [],
        pointer: null,
        selected: null,
        dragging: null,
    }) as unknown as PathSession;

/**
 * The marchers whose start flag positions give way to the pen's line: only while the field
 * actually draws that line (owner on #683: a placed box selected hid every member's path)
 */
describe("pathMarcherIds", () => {
    it("names the pen's marcher while its path is drawn", () => {
        expect(pathMarcherIds(session("closed"), false, false)).toEqual([7]);
        expect(pathMarcherIds(session("open"), false, false)).toEqual([7]);
    });

    it("names no one while a closed path is hidden or under an open shape", () => {
        expect(pathMarcherIds(session("closed"), true, false)).toEqual([]);
        expect(pathMarcherIds(session("closed"), false, true)).toEqual([]);
        expect(pathMarcherIds(null, false, false)).toEqual([]);
    });

    it("an open or drawn path takes the field over a shape", () => {
        expect(pathMarcherIds(session("open"), false, true)).toEqual([7]);
        expect(pathMarcherIds(session("drawing"), false, true)).toEqual([7]);
    });
});
