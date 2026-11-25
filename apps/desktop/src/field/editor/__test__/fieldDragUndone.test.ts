import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    FieldEditor,
    type DropResult,
    type FieldPointer,
} from "../fieldEditor";
import type { MarcherPosition } from "../moveGesture";
import {
    resetFieldInputTraceForTests,
    setFieldDragUndoneReporter,
    type FieldDragUndone,
} from "@/field/fieldInputTrace";

/** Marchers 1 and 2, 100 field units apart, at zoom 2; the field draws `drawn` */
function setup() {
    const drawn = [100, 100, 200, 100];
    const drops: {
        positions: readonly MarcherPosition[];
        answer: (result: DropResult) => void;
    }[] = [];
    let selected: readonly number[] = [];
    const editor = new FieldEditor({
        selection: {
            get: () => selected,
            set: (ids) => {
                selected = ids;
            },
        },
        marchers: () => ({
            ids: [1, 2],
            positions: Float64Array.from(drawn),
        }),
        zoom: () => 2,
        canSelect: () => true,
        showPositions: () => {},
        drop: (positions) =>
            new Promise<DropResult>((answer) => {
                drops.push({ positions, answer });
            }),
    });
    return { editor, drops, drawn, selected: () => selected };
}

const at = (x: number, y: number): FieldPointer => ({
    field: { x, y },
    screen: { x: x * 2, y: y * 2 },
    button: 0,
    kind: "mouse",
    shift: false,
    alt: false,
    ctrl: false,
    meta: false,
});

/** Presses on marcher 1 and drags it to (150, 140), not released */
const dragging = (editor: FieldEditor) => {
    editor.pointerDown(at(100, 100));
    editor.pointerMove(at(130, 110));
    editor.pointerMove(at(150, 140));
};

describe("field drags reported undone (fieldInputTrace)", () => {
    let undone: FieldDragUndone[];
    beforeEach(() => {
        resetFieldInputTraceForTests();
        undone = [];
        setFieldDragUndoneReporter((u) => undone.push(u));
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        resetFieldInputTraceForTests();
    });

    it("reports a drag the pointer's loss cancels, with the trace", () => {
        const { editor } = setup();
        dragging(editor);
        editor.pointerCancel("the canvas lost the pointer before its release");
        expect(undone.map((u) => u.reason)).toEqual([
            "move cancelled: the canvas lost the pointer before its release",
        ]);
        expect(undone[0].trace).toContain("drag started: move");
        expect(console.warn).toHaveBeenCalledOnce();
    });

    it("reports a marquee cancelled the same way", () => {
        const { editor } = setup();
        editor.pointerDown(at(250, 300));
        editor.pointerMove(at(300, 350));
        editor.pointerCancel("the browser cancelled the pointer");
        expect(undone.map((u) => u.reason)).toEqual([
            "marquee cancelled: the browser cancelled the pointer",
        ]);
    });

    it("says nothing of a cancel that's expected, or of the lost capture after a release", () => {
        const { editor } = setup();
        dragging(editor);
        // A second finger landing, Preview turning on: no reason given
        editor.pointerCancel();
        dragging(editor);
        editor.pointerUp(at(150, 140));
        editor.pointerCancel("the canvas lost the pointer before its release");
        expect(undone).toEqual([]);
    });

    it("reports a press that comes while a drag is still under way", () => {
        const { editor } = setup();
        dragging(editor);
        editor.pointerDown(at(200, 100));
        expect(undone.map((u) => u.reason)).toEqual([
            "move cancelled: a new press came while it was still under way (its release never arrived)",
        ]);
    });

    it("reports a refused drop", async () => {
        const { editor, drops } = setup();
        dragging(editor);
        editor.pointerUp(at(150, 140));
        drops[0].answer("refused");
        await Promise.resolve();
        await Promise.resolve();
        expect(undone.map((u) => u.reason)).toEqual(["the drop was refused"]);
    });

    it("reports a saved drop the field draws back where it started", async () => {
        vi.useFakeTimers();
        const { editor, drops } = setup();
        dragging(editor);
        editor.pointerUp(at(150, 140));
        drops[0].answer("saved");
        await vi.advanceTimersByTimeAsync(1000);
        expect(undone.map((u) => u.reason)).toEqual([
            "the saved drop is drawn back where it started",
        ]);
    });

    it("says nothing of a saved drop drawn where it was dropped", async () => {
        vi.useFakeTimers();
        const { editor, drops, drawn } = setup();
        dragging(editor);
        editor.pointerUp(at(150, 140));
        drawn[0] = 150;
        drawn[1] = 140;
        drops[0].answer("saved");
        await vi.advanceTimersByTimeAsync(1000);
        expect(undone).toEqual([]);
    });
});
