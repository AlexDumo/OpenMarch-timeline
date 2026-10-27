import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { boxTool } from "../../box/boxTool";
import { drawBox } from "../../box/boxGeometry";
import {
    distributionOf,
    parseSeed,
    reshuffle,
    withMode,
    withSeed,
} from "../../distribute/modes";
import type { ToolEnv } from "../../tool/toolKind";
import { ReshuffleButton } from "../ReshuffleButton";

/** Reshuffle in the editor (#391): only in Spread, the next seed in one change; its seed menu (#437) */

afterEach(cleanup);

const env: ToolEnv = {
    stepPx: 10,
    snap: true,
    shift: false,
    gridSnap: (p) => p,
    hitRadius: 3,
};
const N = 12;
const files = drawBox({ x: 0, y: 0 }, { x: 40, y: 20 }, N, env)!;
const spread = withMode(boxTool, files, N, "spread", env);

const shown = (params: unknown, apply = vi.fn()) =>
    render(
        <ReshuffleButton
            target={{ kind: boxTool, params, spots: N, apply }}
            envFor={() => env}
            testId="reshuffle"
        />,
    );

describe("the Reshuffle button", () => {
    it("shows only for a spread", () => {
        const { container } = shown(files);
        expect(container).toBeEmptyDOMElement();
        cleanup();
        shown(spread);
        expect(screen.getByRole("button", { name: "Reshuffle" })).toBeVisible();
    });

    it("applies the next seed as one change", () => {
        const apply = vi.fn();
        shown(spread, apply);
        fireEvent.click(screen.getByTestId("reshuffle"));
        expect(apply).toHaveBeenCalledTimes(1);
        expect(
            distributionOf(boxTool, apply.mock.calls[0]![0], N),
        ).toMatchObject({ mode: "spread", seed: 2, count: N });
    });

    it("shows the seed in its menu, and a typed seed lays out the same spots as that seed's spread, as one change", () => {
        const second = reshuffle(boxTool, spread, N, env);
        const apply = vi.fn();
        shown(second, apply);
        fireEvent.click(screen.getByTestId("reshuffle-seed"));
        const input = screen.getByTestId("reshuffle-seed-input");
        expect(input).toHaveValue("2");
        expect(screen.getByText("Same seed, same spread")).toBeVisible();
        fireEvent.change(input, { target: { value: "1" } });
        fireEvent.keyDown(input, { key: "Enter" });
        expect(apply).toHaveBeenCalledTimes(1);
        const typed = apply.mock.calls[0]![0];
        expect(distributionOf(boxTool, typed, N)).toMatchObject({
            mode: "spread",
            seed: 1,
        });
        const ctx = { stepPx: env.stepPx, snapPoint: env.gridSnap };
        expect(boxTool.shape.generate(typed, N, ctx)).toEqual(
            boxTool.shape.generate(spread, N, ctx),
        );
    });

    it("leaves the shape alone for a typed seed that isn't a whole number from 1", () => {
        const apply = vi.fn();
        shown(spread, apply);
        fireEvent.click(screen.getByTestId("reshuffle-seed"));
        const input = screen.getByTestId("reshuffle-seed-input");
        for (const text of ["0", "-3", "2.5", "abc", ""]) {
            fireEvent.change(input, { target: { value: text } });
            fireEvent.keyDown(input, { key: "Enter" });
        }
        expect(apply).not.toHaveBeenCalled();
        expect(input).toHaveAttribute("aria-invalid", "true");
    });

    it("parses and applies seeds only for a spread", () => {
        expect(parseSeed(" 42 ")).toBe(42);
        expect(parseSeed("0")).toBeNull();
        expect(withSeed(boxTool, files, N, 3, env)).toBeNull();
        expect(
            distributionOf(boxTool, withSeed(boxTool, spread, N, 3, env), N),
        ).toMatchObject({ mode: "spread", seed: 3, count: N });
    });
});
