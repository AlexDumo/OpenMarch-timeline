import { describe, expect, it } from "vitest";
import { clickOnMarcher } from "../placed/boxClick";

/** A box of marchers 1–4 (recipe 7) */
const box = { id: 7, members: [1, 2, 3, 4] };

describe("clicking a marcher with boxes on the field", () => {
    it("a click on a box member selects the whole box", () => {
        expect(
            clickOnMarcher({
                marcherId: 2,
                shift: false,
                selected: new Set(),
                box,
                inside: null,
            }),
        ).toMatchObject({ select: [1, 2, 3, 4], inside: null });
    });

    it("a click on a box that's already selected leaves the press to the canvas, to drag it", () => {
        expect(
            clickOnMarcher({
                marcherId: 2,
                shift: false,
                selected: new Set([1, 2, 3, 4]),
                box,
                inside: null,
            }),
        ).toMatchObject({ select: null, inside: null });
    });

    it("a press on a marcher that's already selected leaves it to the canvas, to drag what's selected", () => {
        // Picked by a marquee: dragging it moves just it
        expect(
            clickOnMarcher({
                marcherId: 2,
                shift: false,
                selected: new Set([2]),
                box,
                inside: null,
            }),
        ).toMatchObject({ select: null, inside: null });
    });

    it("inside a box, a press is the canvas's (a click picks one marcher, Shift adds one), and Shift takes a selected one out", () => {
        for (const shift of [false, true]) {
            expect(
                clickOnMarcher({
                    marcherId: 3,
                    shift,
                    selected: new Set([2]),
                    box,
                    inside: 7,
                }),
            ).toMatchObject({ select: null, inside: 7 });
        }
        expect(
            clickOnMarcher({
                marcherId: 2,
                shift: true,
                selected: new Set([2, 3]),
                box,
                inside: 7,
            }),
        ).toMatchObject({ select: [3], inside: 7 });
    });

    it("Shift-click from outside adds or removes the whole box", () => {
        expect(
            clickOnMarcher({
                marcherId: 2,
                shift: true,
                selected: new Set([9]),
                box,
                inside: null,
            }),
        ).toMatchObject({ select: [9, 1, 2, 3, 4], inside: null });
        expect(
            clickOnMarcher({
                marcherId: 2,
                shift: true,
                selected: new Set([9, 1, 2, 3, 4]),
                box,
                inside: null,
            }),
        ).toMatchObject({ select: [9], inside: null });
    });

    it("a marcher in no box is the canvas's, and leaves any box you were inside", () => {
        expect(
            clickOnMarcher({
                marcherId: 9,
                shift: false,
                selected: new Set([2]),
                box: null,
                inside: 7,
            }),
        ).toMatchObject({ select: null, inside: null });
    });

    it("a click on another box's member leaves the box you were inside", () => {
        expect(
            clickOnMarcher({
                marcherId: 2,
                shift: false,
                selected: new Set([12]),
                box,
                inside: 8,
            }),
        ).toMatchObject({ select: [1, 2, 3, 4], inside: null });
    });

    it("reaching inside ($mod) enters the box, and the press is then a press inside it", () => {
        for (const shift of [false, true]) {
            expect(
                clickOnMarcher({
                    marcherId: 2,
                    shift,
                    reachInside: true,
                    selected: new Set(shift ? [9] : [1, 2, 3, 4]),
                    box,
                    inside: null,
                }),
            ).toMatchObject({ select: null, inside: 7 });
        }
        // Shift+$mod on a selected member takes it out, as Shift does inside the box
        expect(
            clickOnMarcher({
                marcherId: 2,
                shift: true,
                reachInside: true,
                selected: new Set([1, 2, 3, 4]),
                box,
                inside: null,
            }),
        ).toMatchObject({ select: [1, 3, 4], inside: 7 });
        // From inside another box
        expect(
            clickOnMarcher({
                marcherId: 3,
                shift: false,
                reachInside: true,
                selected: new Set([8]),
                box,
                inside: 9,
            }),
        ).toMatchObject({ select: null, inside: 7 });
    });

    it("reaching inside on a marcher in no box is the canvas's, as a click is", () => {
        expect(
            clickOnMarcher({
                marcherId: 9,
                shift: false,
                reachInside: true,
                selected: new Set(),
                box: null,
                inside: 7,
            }),
        ).toMatchObject({ select: null, inside: null });
    });
});

describe("clicking a marcher of a linked figure (#1236)", () => {
    // Box 7 (1–4) is linked to box 8 (5–6): one figure
    const figure = [1, 2, 3, 4, 5, 6];
    const click = (
        selected: number[],
        more: Partial<Parameters<typeof clickOnMarcher>[0]> = {},
    ) =>
        clickOnMarcher({
            marcherId: 2,
            shift: false,
            selected: new Set(selected),
            box,
            inside: null,
            figure,
            ...more,
        });

    it("a click on any of its shapes selects the whole figure", () => {
        expect(click([], { click: "single" })).toEqual({
            select: figure,
            inside: null,
            inFigure: false,
        });
        // From another shape picked inside it, too, once you've left the figure
        expect(click([5])).toMatchObject({ select: figure });
    });

    it("a click on the figure selected whole goes into it, selecting the shape clicked", () => {
        expect(click(figure, { click: "single" })).toEqual({
            select: [1, 2, 3, 4],
            inside: null,
            inFigure: true,
        });
    });

    it("a drag, or a double-click's second click, on the figure selected whole keeps it, to move it", () => {
        expect(click(figure)).toEqual({
            select: null,
            inside: null,
            inFigure: false,
        });
        expect(click(figure, { click: "double" })).toMatchObject({
            select: null,
            inFigure: false,
        });
    });

    it("inside the figure, a click picks one shape: another of it, or this one again", () => {
        expect(click([5, 6], { click: "single", inFigure: true })).toEqual({
            select: [1, 2, 3, 4],
            inside: null,
            inFigure: true,
        });
        // Inside a shape of it, the same
        expect(
            click([5], { click: "single", inFigure: true, inside: 8 }),
        ).toMatchObject({ select: [1, 2, 3, 4], inFigure: true });
    });

    it("Shift adds or removes the whole figure from outside it, one shape inside it", () => {
        expect(click([9], { shift: true })).toMatchObject({
            select: [9, ...figure],
            inFigure: false,
        });
        expect(click([9, ...figure], { shift: true })).toMatchObject({
            select: [9],
        });
        expect(click([5, 6], { shift: true, inFigure: true })).toMatchObject({
            select: [5, 6, 1, 2, 3, 4],
            inFigure: true,
        });
    });

    it("reaching inside ($mod) picks the marcher, inside the figure", () => {
        expect(click([], { reachInside: true })).toEqual({
            select: null,
            inside: 7,
            inFigure: true,
        });
    });
});
