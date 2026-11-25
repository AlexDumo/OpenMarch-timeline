// @vitest-environment node
import { describe, expect, it } from "vitest";
import { laneRevealPlan } from "../laneReveal";

/** The timeline's view shows 400–600 on screen; the pane is 250 px and may grow to 400 */
const view = { viewTop: 400, viewBottom: 600, maxPaneHeight: 400 };

describe("a lane showing itself (#1315)", () => {
    it("leaves a lane in view alone", () => {
        expect(
            laneRevealPlan({
                ...view,
                laneTop: 450,
                laneBottom: 560,
                paneHeight: 250,
            }),
        ).toEqual({ paneHeight: null, scrollBy: 0 });
    });

    it("opens a pane dragged short far enough to show the lane below the fold", () => {
        expect(
            laneRevealPlan({
                ...view,
                laneTop: 580,
                laneBottom: 680,
                paneHeight: 250,
            }),
        ).toEqual({ paneHeight: 330, scrollBy: 0 });
    });

    it("scrolls the rest of the way when the pane can't open enough", () => {
        expect(
            laneRevealPlan({
                ...view,
                laneTop: 700,
                laneBottom: 900,
                paneHeight: 250,
            }),
        ).toEqual({ paneHeight: 400, scrollBy: 150 });
    });

    it("only scrolls a pane fitted to its tracks", () => {
        expect(
            laneRevealPlan({
                ...view,
                laneTop: 580,
                laneBottom: 680,
                paneHeight: null,
            }),
        ).toEqual({ paneHeight: null, scrollBy: 80 });
    });

    it("shows a lane taller than the view from its top", () => {
        expect(
            laneRevealPlan({
                ...view,
                laneTop: 650,
                laneBottom: 1200,
                paneHeight: null,
            }),
        ).toEqual({ paneHeight: null, scrollBy: 250 });
    });

    it("scrolls back up to a lane scrolled past", () => {
        expect(
            laneRevealPlan({
                ...view,
                laneTop: 300,
                laneBottom: 380,
                paneHeight: 250,
            }),
        ).toEqual({ paneHeight: null, scrollBy: -100 });
    });
});
