import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { boxTool } from "../../box/boxTool";
import { drawBox, type BoxParams } from "../../box/boxGeometry";
import type { Fraction } from "../../distribute/distribution";
import {
    layoutRowsOf,
    staggerOf,
    withLayout,
    withMode,
    withStagger,
} from "../../distribute/modes";
import type { ToolEnv } from "../../tool/toolKind";
import { StaggerSlider } from "../StaggerSlider";

/** The inspector's stagger (#388): the switch, the slider's rests and its readout */

afterEach(cleanup);
beforeEach(() => {
    // jsdom lacks ResizeObserver, which the Radix slider needs
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    );
});

const env: ToolEnv = {
    stepPx: 10,
    snap: true,
    shift: false,
    gridSnap: (p) => p,
    hitRadius: 3,
};

/** 24 marchers drawn wide: Short back 6 × 4 with no short rank */
const box = (stagger: Fraction = [0, 1]) =>
    withStagger(
        boxTool,
        drawBox({ x: 0, y: 0 }, { x: 100, y: 60 }, 24, env)!,
        24,
        stagger,
        env,
    ) as BoxParams;

const shown = (params: unknown, apply = vi.fn()) =>
    render(
        <StaggerSlider
            target={{
                kind: boxTool,
                params,
                spots: 24,
                apply,
                begin: vi.fn(),
                preview: vi.fn(),
                end: vi.fn(),
            }}
            envFor={() => env}
        />,
    );

const appliedStagger = (apply: ReturnType<typeof vi.fn>) =>
    staggerOf(boxTool, apply.mock.calls.at(-1)![0], 24);

describe("the stagger slider", () => {
    it("starts switched off with no slider for a straight box", () => {
        shown(box());
        expect(screen.getByTestId("shape-stagger-switch")).toHaveAttribute(
            "data-state",
            "unchecked",
        );
        expect(screen.queryByTestId("shape-stagger-slider")).toBeNull();
    });

    it("switches on at ½, as one change", () => {
        const apply = vi.fn();
        shown(box(), apply);
        fireEvent.click(screen.getByTestId("shape-stagger-switch"));
        expect(apply).toHaveBeenCalledTimes(1);
        expect(appliedStagger(apply)).toEqual([1, 2]);
    });

    it("shows the slider and the readout for a staggered box, and switches off to straight", () => {
        const apply = vi.fn();
        shown(box([-1, 3]), apply);
        expect(screen.getByTestId("shape-stagger-readout")).toHaveTextContent(
            "⅓ left · lines up every 3 ranks",
        );
        expect(screen.getByRole("slider")).toHaveAttribute(
            "aria-valuenow",
            String(-1 / 3),
        );
        fireEvent.click(screen.getByTestId("shape-stagger-switch"));
        expect(appliedStagger(apply)).toEqual([0, 1]);
    });

    it("steps to the next rest with the arrow keys", () => {
        const apply = vi.fn();
        shown(box([1, 4]), apply);
        fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
        expect(appliedStagger(apply)).toEqual([1, 3]);
        fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowLeft" });
        expect(appliedStagger(apply)).toEqual([1, 6]);
    });

    it("is hidden for layouts that fix or center their ranks, and outside Files", () => {
        for (const family of ["stagger", "rounded", "notched"] as const) {
            const row = layoutRowsOf(boxTool, 24).find(
                (r) => r.family === family,
            )!;
            const p = withLayout(
                boxTool,
                box(),
                24,
                row.versions[0]!.layout,
                env,
            );
            expect(shown(p).container).toBeEmptyDOMElement();
            cleanup();
        }
        const outline = withMode(boxTool, box(), 24, "outline", env);
        expect(shown(outline).container).toBeEmptyDOMElement();
    });
});
