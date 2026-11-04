import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import { PathEditor } from "../PathEditor";
import { closePath, openPath, startDrawing } from "../pathPenStore";
import type { PathTarget } from "../pathTarget";

/**
 * The path's floating editor (owner lab feedback on fork #674): the shape editor's bar, opaque,
 * with icons rather than emoji, no outline round every button, one text size, and only what a
 * path needs. No "Path" word and no drill number in it: Big steps when it applies, Remove last
 * corner, Cancel and Finish while drawing, Remove path once stored.
 */

const fieldProperties =
    FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;
const STEP = fieldProperties.pixelsPerStep;

/** Characters a platform may draw as a color emoji */
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

const target = (routeId: number | null, steps = 8): PathTarget => ({
    timelineId: 1,
    transitionId: 7,
    marcherId: 3,
    start: 0,
    end: 8,
    from: { x: 0, y: 0 },
    to: { x: steps * STEP, y: 0 },
    routeId,
    points:
        routeId === null
            ? []
            : [{ id: "c1", at: [(steps / 2) * STEP, 4 * STEP] }],
});

afterEach(() => {
    act(() => closePath());
    cleanup();
});

const bar = () => screen.getByTestId("path-editor");

describe("the path's floating editor", () => {
    it("while drawing: Remove last corner, Cancel and Finish, as icons and one word, opaque, no emoji, no name", () => {
        act(() => startDrawing(target(null), "T4"));
        render(<PathEditor fieldProperties={fieldProperties} />);
        const el = bar();
        expect(el.dataset.phase).toBe("drawing");
        expect(el.className).toContain("bg-bg-1");
        expect(el.className).toContain("text-sub");
        expect(el.textContent).not.toMatch(PICTOGRAPHIC);
        // Words: only Finish
        expect(el.textContent?.trim()).toBe("Finish");
        expect(el.textContent).not.toContain("T4");
        expect(
            screen.getByTestId("path-remove-last").querySelector("svg"),
        ).not.toBeNull();
        expect(
            screen.getByTestId("path-remove-last").getAttribute("aria-label"),
        ).toBe("Remove last corner");
        expect(
            screen
                .getByTestId("path-remove-last")
                .getAttribute("aria-disabled"),
        ).toBe("true");
        expect(
            screen.getByTestId("path-cancel").getAttribute("aria-label"),
        ).toBe("Cancel");
        // No outline round each button: the shape bar's buttons have none
        for (const b of el.querySelectorAll("button"))
            expect(b.className).not.toMatch(/\bborder\b/);
        // The hint over the field says whose path it is
        expect(screen.getByTestId("path-pen-banner").textContent).toContain(
            "T4",
        );
        expect(screen.getByTestId("path-pen-banner").textContent).not.toMatch(
            PICTOGRAPHIC,
        );
    });

    it("open: only Remove path, and Big steps when the path is too long, in the bar's one text size", () => {
        // 64 steps of path in 8 counts: big steps
        act(() => openPath(target(5, 32), "T4"));
        render(<PathEditor fieldProperties={fieldProperties} />);
        const el = bar();
        expect(el.dataset.phase).toBe("open");
        expect(
            screen.getByTestId("path-remove").getAttribute("aria-label"),
        ).toBe("Remove path");
        expect(screen.queryByTestId("path-finish")).toBeNull();
        const big = screen.getByTestId("path-big-steps");
        expect(big.textContent).toMatch(/^Big steps · /);
        // No size of its own: it reads the bar's
        expect(big.className).not.toMatch(/text-\[|text-(sub|body|xs|sm)\b/);
        expect(el.textContent).not.toMatch(PICTOGRAPHIC);
        expect(el.textContent).not.toContain("Path");
        expect(el.textContent).not.toContain("T4");
    });

    it("open with an easy path: no Big steps", () => {
        act(() => openPath(target(5), "T4"));
        render(<PathEditor fieldProperties={fieldProperties} />);
        expect(screen.queryByTestId("path-big-steps")).toBeNull();
        expect(screen.getByTestId("path-remove")).toBeTruthy();
    });
});
