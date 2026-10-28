import { afterEach, describe, expect, it, vi } from "vitest";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import * as platform from "@/shortcuts/platform";
import type { FieldPointer } from "@/field/editor/fieldEditor";
import { keysOf } from "../../field/fieldModeBase";
import type { ShapeField } from "../../field/shapeField";
import { boxTool } from "../../box/boxTool";
import type { BoxParams } from "../../box/boxGeometry";
import { dragShape, startShapeGesture } from "../../frame/gestures";
import { pivotOf } from "../../frame/pivot";
import { pivotPoint } from "../../frame/frame";
import { toolEnvFor } from "../toolEnv";
import { openTool, press } from "../toolMachine";

/**
 * The keys a shape drag reads (owner on #453): Alt is fine control (off the half-step ladder,
 * still pulled onto the field's lines), Cmd on a Mac or Ctrl elsewhere snaps nothing
 */

const fieldProperties =
    FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;
const field = {
    fieldProperties,
    zoom: () => 1,
    marchers: () => [],
    drawn: () => new Map(),
} as unknown as ShapeField;

describe("toolEnvFor", () => {
    it("with no keys, snaps to the ladder and pulls", () => {
        const env = toolEnvFor(field, { shift: false, alt: false });
        expect([env.snap, env.pull, env.fine, env.mod]).toEqual([
            true,
            true,
            false,
            false,
        ]);
    });

    it("with Alt, leaves the ladder but still pulls", () => {
        const env = toolEnvFor(field, { shift: false, alt: true });
        expect([env.snap, env.pull, env.fine]).toEqual([false, true, true]);
    });

    it("with Cmd/Ctrl, neither snaps nor pulls", () => {
        const env = toolEnvFor(field, { shift: false, alt: false, mod: true });
        expect([env.snap, env.pull, env.fine, env.mod]).toEqual([
            false,
            false,
            false,
            true,
        ]);
    });

    it("keeps gridSnap snapping with Cmd/Ctrl, for the pivot, and leaves it free with Alt", () => {
        const at = { x: 3.3, y: 7.7 };
        const mod = toolEnvFor(field, { shift: false, alt: false, mod: true });
        expect(mod.gridSnap(at)).not.toEqual(at);
        const alt = toolEnvFor(field, { shift: false, alt: true });
        expect(alt.gridSnap(at)).toEqual(at);
    });
});

describe("keysOf", () => {
    afterEach(() => vi.restoreAllMocks());
    const pointer = (meta: boolean, ctrl: boolean) =>
        ({ shift: false, alt: false, meta, ctrl }) as unknown as FieldPointer;

    it("takes Cmd as the modifier on a Mac, not Ctrl", () => {
        vi.spyOn(platform, "isMacPlatform").mockReturnValue(true);
        expect(keysOf(pointer(true, false)).mod).toBe(true);
        expect(keysOf(pointer(false, true)).mod).toBe(false);
    });

    it("takes Ctrl as the modifier elsewhere, not the Windows or Super key", () => {
        vi.spyOn(platform, "isMacPlatform").mockReturnValue(false);
        expect(keysOf(pointer(false, true)).mod).toBe(true);
        expect(keysOf(pointer(true, false)).mod).toBe(false);
    });
});

describe("the pivot pulled out with Cmd/Ctrl", () => {
    const box: BoxParams = {
        center: { x: 100, y: -100 },
        rotation: 0,
        files: 4,
        across: 80,
        deep: 80,
    };
    // 4 by 3, big enough that no handle reaches the center dot
    const N = 12;
    /** The pivot's spot after a Cmd/Ctrl press on the center dot and a drag to `to` */
    const pivotAfter = (to: { x: number; y: number }, alt: boolean) => {
        const env = toolEnvFor(field, { shift: false, alt, mod: true });
        const center = boxTool.frameOf(box, N).center;
        const gesture = startShapeGesture(boxTool, box, N, center, env)!;
        expect(gesture.type).toBe("pivot");
        const out = dragShape(boxTool, N, gesture, to, env) as BoxParams;
        return pivotPoint(boxTool.frameOf(out, N), pivotOf(out));
    };

    it("still snaps with Cmd/Ctrl held, and only Alt frees it", () => {
        const to = { x: 141.3, y: -63.7 };
        expect(pivotAfter(to, false)).not.toEqual(to);
        const free = pivotAfter(to, true);
        expect(free.x).toBeCloseTo(to.x, 9);
        expect(free.y).toBeCloseTo(to.y, 9);
    });
});

describe("a draw's first corner", () => {
    const at = { x: 103.3, y: -77.7 };
    const fromWith = (keys: { alt: boolean; mod?: boolean }) => {
        const env = toolEnvFor(field, { shift: false, ...keys });
        const g = press(openTool(boxTool, []), at, env).gesture;
        return g?.type === "draw" ? g.from : null;
    };

    it("snaps to the grid with no keys, and stays where the press is with Alt or Cmd/Ctrl (review of #453)", () => {
        expect(fromWith({ alt: false })).not.toEqual(at);
        expect(fromWith({ alt: true })).toEqual(at);
        expect(fromWith({ alt: false, mod: true })).toEqual(at);
    });
});
