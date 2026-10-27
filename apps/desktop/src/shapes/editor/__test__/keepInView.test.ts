import { describe, expect, it } from "vitest";
import type { FieldView } from "@/field/editor/view";
import { editorPlacement } from "../editorPlacement";
import {
    holdEditorPan,
    keepInViewPan,
    VIEW_MARGIN_PX,
    viewFollowFor,
    type KeepInViewInput,
} from "../keepInView";

/** Keeping the shape and its editor in view after an edit (#441) */

/** 10 px per field unit, field (0, 0) at the element's top-left: field units × 10 = px */
const VIEW: FieldView = {
    width: 1000,
    height: 600,
    zoom: 10,
    panX: 0,
    panY: 0,
};

/** A box `w` × `h` field units centered at (cx, cy) */
const box = (cx: number, cy: number, w = 10, h = 6) => [
    { x: cx - w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy + h / 2 },
    { x: cx - w / 2, y: cy + h / 2 },
];

const input = (over: Partial<KeepInViewInput> = {}): KeepInViewInput => ({
    view: VIEW,
    outline: box(50, 20),
    width: 300,
    height: 40,
    ...over,
});

/** The shape's and editor's px box with the view panned */
const shown = (i: KeepInViewInput, dx: number, dy: number) => {
    const view = { ...i.view, panX: i.view.panX + dx, panY: i.view.panY + dy };
    const outline = i.outline.map((p) => ({
        x: view.panX + p.x * view.zoom,
        y: view.panY + p.y * view.zoom,
    }));
    const editor = editorPlacement({
        outline,
        width: i.width,
        height: i.height,
        fieldWidth: view.width,
        fieldHeight: view.height,
    });
    const xs = outline.map((p) => p.x);
    const ys = outline.map((p) => p.y);
    return {
        left: Math.min(...xs, editor.left),
        right: Math.max(...xs, editor.left + i.width),
        top: Math.min(...ys, editor.top),
        bottom: Math.max(...ys, editor.top + i.height),
        editor,
    };
};

describe("keep in view", () => {
    it("doesn't pan when the shape and editor are in view", () => {
        expect(keepInViewPan(input())).toEqual({ dx: 0, dy: 0 });
    });

    it("pans just far enough to bring a corner off the right back", () => {
        const i = input({ outline: box(98, 20) });
        const { dx, dy } = keepInViewPan(i);
        expect(dy).toBe(0);
        // The box's right edge (103 units = 1030 px) ends a margin inside the element
        expect(dx).toBeCloseTo(1000 - VIEW_MARGIN_PX - 1030);
    });

    it("pans down when the shape goes off the top", () => {
        const i = input({ outline: box(50, 1) });
        const { dx, dy } = keepInViewPan(i);
        expect(dx).toBe(0);
        expect(dy).toBeCloseTo(VIEW_MARGIN_PX - -20);
    });

    it("keeps the editor in view too", () => {
        // The shape fits low in the view, and the editor flips above it: both end inside
        const i = input({ outline: box(50, 57) });
        const { dx, dy } = keepInViewPan(i);
        const after = shown(i, dx, dy);
        expect(after.top).toBeGreaterThanOrEqual(VIEW_MARGIN_PX - 0.5);
        expect(after.bottom).toBeLessThanOrEqual(600 - VIEW_MARGIN_PX + 0.5);
    });

    it("centers a shape bigger than the view", () => {
        const i = input({ outline: box(80, 20, 150, 6) });
        const { dx } = keepInViewPan(i);
        expect(800 + dx).toBeCloseTo(500);
    });

    it("never zooms", () => {
        const i = input({ outline: box(120, 70) });
        const pan = keepInViewPan(i);
        expect(Object.keys(pan).sort()).toEqual(["dx", "dy"]);
    });
});

describe("hold the editor still", () => {
    it("pans so the editor lands where it was", () => {
        const before = shown(input(), 0, 0).editor;
        // The box grew down and moved right: its editor would move
        const i = input({ outline: box(56, 24, 12, 10) });
        const { dx, dy } = holdEditorPan(i, before);
        const after = shown(i, dx, dy).editor;
        expect(after.left).toBeCloseTo(before.left);
        expect(after.top).toBeCloseTo(before.top);
    });

    it("doesn't pan when the editor stays put", () => {
        const before = shown(input(), 0, 0).editor;
        expect(holdEditorPan(input(), before)).toEqual({ dx: 0, dy: 0 });
    });
});

describe("the lab version", () => {
    it("is Keep in view without one", () => {
        expect(viewFollowFor(null)).toBe("keep");
        expect(viewFollowFor("keep-in-view")).toBe("keep");
        expect(viewFollowFor("hold-editor")).toBe("hold");
    });
});
