import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { boxTool } from "../../box/boxTool";
import { drawBox } from "../../box/boxGeometry";
import { padTool, type PadParams } from "../../__test__/fakeRowKind";
import type { AnyToolKind, ToolEnv } from "../../tool/toolKind";
import { ModeSwitch } from "../ModeSwitch";
import { DEFAULT_ODD_GAP } from "../../distribute/distribution";

/** The editor's mode switch (#386, #435): only the kind's modes, hidden with one */

afterEach(cleanup);

const env: ToolEnv = {
    stepPx: 10,
    snap: true,
    shift: false,
    gridSnap: (p) => p,
    hitRadius: 3,
};
const pad: PadParams = { center: { x: 0, y: 0 }, gap: 20, rotation: 0 };

const shown = (kind: AnyToolKind, params: unknown, apply = vi.fn()) =>
    render(
        <ModeSwitch
            target={{ kind, params, spots: 5, apply }}
            envFor={() => env}
        />,
    );

describe("the mode switch", () => {
    it("shows the kind's own modes, the current one on", () => {
        shown(padTool, pad);
        const group = screen.getByRole("group", { name: "Fill" });
        expect(
            [...group.querySelectorAll("button")].map((b) => b.textContent),
        ).toEqual(["Grid", "Outline"]);
        expect(screen.getByTestId("shape-mode-files")).toHaveAttribute(
            "data-state",
            "on",
        );
    });

    it("fills the shape in the mode picked", () => {
        const apply = vi.fn();
        shown(padTool, pad, apply);
        fireEvent.click(screen.getByTestId("shape-mode-outline"));
        expect(apply).toHaveBeenCalledTimes(1);
        expect(apply.mock.calls[0]![0]).toEqual({
            ...pad,
            distribution: { mode: "outline", oddGap: DEFAULT_ODD_GAP },
        });
    });

    it("offers the box Grid, Outline and Spread", () => {
        const box = drawBox({ x: 0, y: 0 }, { x: 40, y: 20 }, 6, env);
        shown(boxTool, box);
        const group = screen.getByRole("group", { name: "Fill" });
        expect(
            [...group.querySelectorAll("button")].map((b) => b.textContent),
        ).toEqual(["Grid", "Outline", "Spread"]);
    });

    it("is hidden while the kind has one mode", () => {
        const filesOnly: AnyToolKind = {
            ...padTool,
            closed: { ...padTool.closed!, modes: ["files"] },
        };
        const { container } = shown(filesOnly, pad);
        expect(container).toBeEmptyDOMElement();
    });
});
