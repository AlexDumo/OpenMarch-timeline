import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import type { FieldPointer } from "@/field/editor/fieldEditor";
import { setShapeField } from "@/shapes/field/shapeField";
import type { ToolEnv } from "@/shapes/tool/toolKind";
import type { XY } from "@/shapes/types";
import { SMOOTH } from "@/shapes/line/lineGeometry";
import { PenDrawing } from "../penDrawing";
import {
    DRAW_KIND_STORAGE_KEY,
    setDrawKind,
    useDrawKindStore,
} from "../penKind";
import type { PenSubject } from "../penSubject";

/**
 * The shared pen's gestures (plan step 1) through `PenSubject`, on a Line-shaped fake: points keyed
 * by index carrying a Line's own data (who holds the point, a bend), a Line that closes when its
 * first point is clicked with three or more placed, and no fixed end. It keeps the interface from
 * being only pathways'.
 */

const fieldProperties =
    FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;
const S = fieldProperties.pixelsPerStep;
const ZOOM = 2;

const at = (
    x: number,
    y: number,
    keys: Partial<Pick<FieldPointer, "alt" | "shift">> = {},
): FieldPointer => ({
    field: { x: x * S, y: y * S },
    screen: { x: x * S * ZOOM, y: y * S * ZOOM },
    button: 0,
    shift: keys.shift ?? false,
    alt: keys.alt ?? false,
    ctrl: false,
    meta: false,
    kind: "mouse",
});

/** A Line's point: the pen's part, and the Line's own (who holds it, its bend) */
interface LinePoint {
    at: XY;
    tension?: number;
    marcher: number | null;
    bend: number;
}

/** The fake Line: what the pen asked of it, in order */
function lineSubject(key: unknown = "line", perFrame = false) {
    const line = {
        points: [] as LinePoint[],
        pointer: null as XY | null,
        shaping: null as number | null,
        closed: false,
        finished: 0,
        cancelled: 0,
        calls: [] as string[],
    };
    const land = (p: XY, env: ToolEnv): XY => {
        const q = env.snap ? env.stepPx / 2 : 0;
        return q > 0
            ? { x: Math.round(p.x / q) * q, y: Math.round(p.y / q) * q }
            : p;
    };
    const near = (a: XY, b: XY, env: ToolEnv) =>
        Math.hypot(a.x - b.x, a.y - b.y) <= env.hitRadius;
    const subject: PenSubject = {
        key,
        perFrame,
        count: () => line.points.length,
        last: () => line.points.at(-1) ?? null,
        finishesAt(p, env) {
            const first = line.points[0];
            const last = line.points.at(-1);
            return (
                (!!first &&
                    line.points.length >= 3 &&
                    near(first.at, p, env)) ||
                (!!last && near(last.at, p, env))
            );
        },
        click(p, smooth, env) {
            const landed = land(p, env);
            const last = line.points.at(-1)?.at;
            if (last && last.x === landed.x && last.y === landed.y)
                return "finish";
            line.points.push({
                at: landed,
                ...(smooth ? { tension: SMOOTH } : {}),
                marcher: null,
                bend: 0,
            });
            line.calls.push(`click ${smooth ? "smooth" : "corner"}`);
            return "placed";
        },
        shapeLast(to) {
            const i = line.points.length - 1;
            const q = line.points[i]!.at;
            line.points[i] = {
                ...line.points[i]!,
                tension: Math.hypot(to.x - q.x, to.y - q.y) / S,
            };
            line.shaping = i;
        },
        endShape: () => {
            line.shaping = null;
            line.calls.push("endShape");
        },
        loseShape: () => {
            line.points.pop();
            line.shaping = null;
            line.calls.push("loseShape");
        },
        preview(p, env) {
            line.pointer = p && env ? land(p, env) : null;
        },
        dropsDoubleClickPoint: () => true,
        removeLast: () => line.points.pop() !== undefined,
        canRemoveLast: () => line.points.length > 0,
        finish(p, env) {
            const first = line.points[0];
            line.closed =
                !!p &&
                !!env &&
                !!first &&
                line.points.length >= 3 &&
                near(first.at, p, env);
            line.finished++;
        },
        cancel: () => void line.cancelled++,
        undo: () => void line.points.pop(),
    };
    return { line, subject };
}

let current: PenSubject | null = null;
const pen = new PenDrawing(() => current);
const click = (p: FieldPointer, double = false) => {
    pen.press(p, false);
    pen.release(p, { double });
};

beforeEach(() => {
    vi.useFakeTimers();
    localStorage.removeItem(DRAW_KIND_STORAGE_KEY);
    useDrawKindStore.setState({ kind: "straight", otherHeld: false });
    setShapeField({
        fieldProperties: () => fieldProperties,
        zoom: () => ZOOM,
        marchers: () => [],
        drawn: () => new Map(),
    });
});

afterEach(() => {
    pen.cancel();
    current = null;
    setShapeField(null);
    vi.useRealTimers();
});

describe("the pen's clicks", () => {
    it("places a corner where a click lands, on half steps; Curve places a smooth point; Alt the other kind", () => {
        const { line, subject } = lineSubject();
        current = subject;
        click(at(2.2, 0.1));
        expect(line.points[0]).toEqual({
            at: { x: 2 * S, y: 0 },
            marcher: null,
            bend: 0,
        });
        click(at(4, 0, { alt: true }));
        setDrawKind("curve");
        click(at(6, 2));
        click(at(8, 2, { alt: true }));
        expect(line.calls).toEqual([
            "click corner",
            "click smooth",
            "click smooth",
            "click corner",
        ]);
        // The caller's own point data survives
        expect(line.points.every((p) => p.bend === 0)).toBe(true);
        // The leg follows the click's point
        expect(line.pointer).toEqual({ x: 8 * S, y: 2 * S });
    });

    it("a click on the last point finishes; on the first with three placed, the Line closes", () => {
        const { line, subject } = lineSubject();
        current = subject;
        click(at(0, 0));
        click(at(4, 0));
        click(at(4, 4));
        click(at(4, 4));
        expect(line.finished).toBe(1);
        expect(line.closed).toBe(false);
        click(at(0, 0));
        expect(line.finished).toBe(2);
        expect(line.closed).toBe(true);
        expect(line.points).toHaveLength(3);
    });

    it("a double-click finishes, and takes back the point its first click placed when the subject drops it", () => {
        const { line, subject } = lineSubject();
        current = subject;
        click(at(0, 0));
        click(at(4, 0));
        // The double-click's first click places its point; its second finishes
        click(at(4, 4));
        click(at(4, 4), true);
        expect(line.finished).toBe(1);
        expect(line.points).toHaveLength(2);
        // A subject that keeps it (a trail ending at its own last point)
        const kept = lineSubject();
        current = { ...kept.subject, dropsDoubleClickPoint: () => false };
        click(at(0, 0));
        click(at(4, 0));
        click(at(4, 0), true);
        expect(kept.line.points).toHaveLength(2);
        expect(kept.line.finished).toBe(1);
    });
});

describe("the pen's press-and-drag", () => {
    it("places a point where it was pressed and shapes it smooth by the drag, in either mode", () => {
        for (const kind of ["straight", "curve"] as const) {
            setDrawKind(kind);
            const { line, subject } = lineSubject();
            current = subject;
            click(at(0, 0));
            pen.press(at(4, 0), false);
            pen.move(at(4, 3));
            expect(line.shaping).toBe(1);
            expect(line.points[1]!.at).toEqual({ x: 4 * S, y: 0 });
            pen.release(at(4, 3), null);
            // The press places a corner whatever the switch says; the drag makes it smooth
            expect(line.calls).toEqual([
                kind === "curve" ? "click smooth" : "click corner",
                "click corner",
                "endShape",
            ]);
            expect(line.points[1]!.tension).toBeCloseTo(3);
        }
    });

    it("a drag pressed on the last point still finishes on release, placing nothing", () => {
        const { line, subject } = lineSubject();
        current = subject;
        click(at(0, 0));
        click(at(4, 0));
        pen.press(at(4, 0), false);
        pen.move(at(6, 1));
        pen.release(at(6, 1), null);
        expect(line.finished).toBe(1);
        expect(line.points).toHaveLength(2);
    });

    it("a lost press-and-drag gives its point back to the subject", () => {
        const { line, subject } = lineSubject();
        current = subject;
        click(at(0, 0));
        pen.press(at(4, 0), false);
        pen.move(at(4, 3));
        pen.cancel();
        expect(line.calls.at(-1)).toBe("loseShape");
        expect(line.points).toHaveLength(1);
    });
});

describe("the pen's leg to the pointer", () => {
    it("follows the pointer with the button up; once a frame for a subject that plans on it", () => {
        const { line, subject } = lineSubject("trail", true);
        current = subject;
        click(at(0, 0));
        pen.move(at(3, 3));
        pen.move(at(5, 3));
        // Waits for its frame, then the latest move only
        expect(line.pointer).toEqual({ x: 0, y: 0 });
        vi.advanceTimersToNextFrame();
        expect(line.pointer).toEqual({ x: 5 * S, y: 3 * S });
    });

    it("a frame landing after the drawing changed to another does nothing", () => {
        const first = lineSubject("trail", true);
        current = first.subject;
        pen.move(at(3, 3));
        const second = lineSubject("another", true);
        current = second.subject;
        vi.advanceTimersToNextFrame();
        expect(first.line.pointer).toBeNull();
        expect(second.line.pointer).toBeNull();
    });

    it("leaving the field takes the leg away", () => {
        const { line, subject } = lineSubject();
        current = subject;
        pen.move(at(3, 3));
        expect(line.pointer).not.toBeNull();
        pen.leave();
        expect(line.pointer).toBeNull();
        expect(useDrawKindStore.getState().otherHeld).toBe(false);
    });
});
