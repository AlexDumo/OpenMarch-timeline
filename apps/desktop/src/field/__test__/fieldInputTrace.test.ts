import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    MAX_TRACE_NOTES,
    MAX_UNDONE_REPORTS,
    fieldDragUndone,
    fieldInputTrace,
    noteFieldInput,
    resetFieldInputTraceForTests,
    setFieldDragUndoneReporter,
} from "../fieldInputTrace";

describe("fieldInputTrace", () => {
    let clock = 0;
    beforeEach(() => {
        clock = 0;
        resetFieldInputTraceForTests(() => clock);
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
        vi.restoreAllMocks();
        resetFieldInputTraceForTests();
    });

    it("keeps the last notes, timed before the newest", () => {
        for (let i = 0; i < MAX_TRACE_NOTES + 5; i++) {
            clock = i * 10;
            noteFieldInput(`note ${i}`);
        }
        const lines = fieldInputTrace().split("\n");
        expect(lines).toHaveLength(MAX_TRACE_NOTES);
        expect(lines[0]).toContain("note 5");
        expect(lines.at(-1)).toBe(`  0.000s note ${MAX_TRACE_NOTES + 4}`);
    });

    it("sends an undone drag to the console and the reporter, a few times per load", () => {
        const report = vi.fn();
        setFieldDragUndoneReporter(report);
        noteFieldInput("pointerdown button=0");
        for (let i = 0; i < MAX_UNDONE_REPORTS + 3; i++) fieldDragUndone("x");
        expect(report).toHaveBeenCalledTimes(MAX_UNDONE_REPORTS);
        expect(console.warn).toHaveBeenCalledTimes(MAX_UNDONE_REPORTS);
        expect(report.mock.calls[0][0].trace).toContain("pointerdown button=0");
        expect(report.mock.calls[0][0].trace).toContain("UNDONE: x");
    });

    it("never throws, even when the reporter does", () => {
        setFieldDragUndoneReporter(() => {
            throw new Error("analytics down");
        });
        expect(() => fieldDragUndone("x")).not.toThrow();
    });
});
