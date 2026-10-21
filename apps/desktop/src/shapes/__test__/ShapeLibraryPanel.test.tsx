import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { rowTool } from "./fakeRowKind";
import { ShapeLibraryContents } from "../library/ShapeLibraryPanel";
import {
    basicShapeRows,
    MAX_STARS,
    type ShapeLibraryRow,
} from "../library/shapeLibrary";
import {
    SHAPE_STARS_STORAGE_KEY,
    useShapeStarsStore,
} from "../library/shapeStars";
import { SHAPE_TOOLS } from "../tool/shapeTools";

const saved = (id: string): ShapeLibraryRow => ({
    id,
    group: "saved",
    label: `Saved ${id}`,
    note: "Row · 2 apart",
    icon: rowTool.shape.icon,
    kind: rowTool,
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    useShapeStarsStore.setState({ stars: [], asking: null });
});

const star = (id: string) => screen.getByTestId(`shape-library-star-${id}`);

describe("the shape library", () => {
    it("lists the basic kinds, each with a star, a name and a note", () => {
        render(<ShapeLibraryContents />);
        const box = screen.getByTestId("shape-library-row-block");
        expect(box).toHaveTextContent("Box");
        expect(box).toHaveTextContent("2 apart");
        expect(star("block")).toHaveAttribute("aria-pressed", "false");
        expect(screen.queryByTestId("shape-library-saved")).toBeNull();
    });

    it("stars a shape for this user, kept where the app keeps per-user settings", async () => {
        render(<ShapeLibraryContents />);
        await userEvent.click(star("block"));
        expect(star("block")).toHaveAttribute("aria-pressed", "true");
        expect(useShapeStarsStore.getState().stars).toEqual(["block"]);
        expect(
            JSON.parse(localStorage.getItem(SHAPE_STARS_STORAGE_KEY)!),
        ).toEqual(["block"]);
        await userEvent.click(star("block"));
        expect(star("block")).toHaveAttribute("aria-pressed", "false");
        expect(useShapeStarsStore.getState().stars).toEqual([]);
    });

    it(`asks to unstar one first when starring a shape past ${MAX_STARS}, and stars it once one is unstarred`, async () => {
        const many = Array.from({ length: MAX_STARS }, (_, i) =>
            saved(String(i)),
        );
        const rows = [...basicShapeRows(SHAPE_TOOLS), ...many];
        useShapeStarsStore.setState({ stars: many.map((r) => r.id) });
        render(<ShapeLibraryContents rows={rows} />);
        expect(screen.getByTestId("shape-library-saved")).toBeVisible();

        await userEvent.click(star("block"));
        expect(star("block")).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByRole("alert")).toHaveTextContent(
            `${MAX_STARS} shapes are starred, as many as the ring holds. Unstar one first to star Box.`,
        );
        expect(useShapeStarsStore.getState().stars).toHaveLength(MAX_STARS);

        // Unstarring one clears the question, and then Box can be starred
        await userEvent.click(star("0"));
        expect(screen.queryByRole("alert")).toBeNull();
        await userEvent.click(star("block"));
        expect(star("block")).toHaveAttribute("aria-pressed", "true");
    });
});
