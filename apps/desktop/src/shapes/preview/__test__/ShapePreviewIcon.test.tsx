import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { boxTool } from "../../box/boxTool";
import { rowTool } from "../../__test__/fakeRowKind";
import { savedShapeItems } from "../../command/useShapePaletteSource";
import { savedShapeRows } from "../../library/savedShapes";
import { SHAPE_TOOLS } from "../../tool/shapeTools";
import ShapePreviewIcon from "../ShapePreviewIcon";
import { PREVIEW_SPOTS } from "../shapePreview";

afterEach(cleanup);

const svgOf = (ui: React.ReactElement) =>
    render(ui).container.querySelector("svg")!;

describe("a shape's picture (#378)", () => {
    it("draws the box's spots and its outline", () => {
        const svg = svgOf(<ShapePreviewIcon kind={boxTool} />);
        expect(svg.querySelectorAll("circle")).toHaveLength(PREVIEW_SPOTS);
        expect(svg.querySelector("polygon")).not.toBeNull();
        expect(svg).toHaveAttribute("aria-hidden");
    });

    it("draws a test kind that has no icon from its spots alone", () => {
        const svg = svgOf(<ShapePreviewIcon kind={rowTool} />);
        expect(svg.querySelectorAll("circle")).toHaveLength(PREVIEW_SPOTS);
        expect(svg.querySelector("polygon")).toBeNull();
    });

    it("is the same picture in the command bar as anywhere else, for a saved shape too", () => {
        const [row] = savedShapeRows(
            [
                {
                    id: "wide",
                    name: "Wide box",
                    kind: "block",
                    kindVersion: 1,
                    intervals: { across: 4, deep: 1 },
                },
            ],
            [],
            SHAPE_TOOLS,
        );
        const [item] = savedShapeItems(
            [row],
            true,
            [{ id: 1 }],
            (key) => key,
            async () => {},
        );
        const inBar = svgOf(<>{item.icon}</>).outerHTML;
        cleanup();
        const own = svgOf(
            <ShapePreviewIcon kind={row.kind} size={18} />,
        ).outerHTML;
        expect(inBar).toBe(own);
        // ...and not the plain box's picture: the saved spacing shows
        cleanup();
        expect(
            svgOf(<ShapePreviewIcon kind={boxTool} size={18} />).outerHTML,
        ).not.toBe(own);
    });
});
