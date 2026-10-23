import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { boxTool } from "../../box/boxTool";
import { drawBox } from "../../box/boxGeometry";
import { distributionOf, withMode } from "../../distribute/modes";
import type { ToolEnv } from "../../tool/toolKind";
import { ReshuffleButton } from "../ReshuffleButton";

/** Reshuffle in the chip and the inspector (#391): only in Spread, the next seed in one change */

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
});
