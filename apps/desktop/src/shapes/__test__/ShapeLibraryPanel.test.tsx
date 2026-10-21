import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render as renderDom, screen } from "@testing-library/react";
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
import { boxTool } from "../box/boxTool";
import {
    SAVED_SHAPES_STORAGE_KEY,
    useSavedShapeLibrary,
} from "../library/savedShapeLibrary";
import type { SavedShape } from "../library/savedShapes";
import { showSavedShapeKeys } from "@/hooks/queries/useShowSavedShapes";

// The show's copies live in the database; here they are only the query's data
const showWrites = vi.hoisted(() => ({ deleted: [] as string[] }));
vi.mock("@/hooks/queries/useShowSavedShapes", async (importOriginal) => {
    const actual =
        await importOriginal<
            typeof import("@/hooks/queries/useShowSavedShapes")
        >();
    return {
        ...actual,
        deleteSavedShapeFromShow: async (id: string) => {
            showWrites.deleted.push(id);
        },
    };
});

/** Renders with a query client whose show has `show` saved shapes, without the database */
function render(ui: ReactElement, show: SavedShape[] = []) {
    const client = new QueryClient();
    client.setQueryData(showSavedShapeKeys.all(), show);
    return renderDom(
        <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
    );
}

const wide: SavedShape = {
    id: "wide",
    name: "Wide box",
    kind: boxTool.shape.id,
    kindVersion: 1,
    intervals: { across: 3, deep: 2 },
};

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
    useSavedShapeLibrary.setState({ shapes: [] });
});

const star = (id: string) => screen.getByTestId(`shape-library-star-${id}`);

describe("the shape library", () => {
    it("lists the basic kinds, each with a star, a name and a note", () => {
        render(<ShapeLibraryContents />);
        const box = screen.getByTestId("shape-library-row-block");
        expect(box).toHaveTextContent("Box");
        expect(box).toHaveTextContent("2 apart");
        expect(star("block")).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByTestId("shape-library-saved-empty")).toBeVisible();
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

    it("lists the user's saved shapes in the Saved group, with their spacing", () => {
        useSavedShapeLibrary.getState().put(wide);
        render(<ShapeLibraryContents />);
        const row = screen.getByTestId("shape-library-row-wide");
        expect(row).toHaveTextContent("Wide box");
        expect(row).toHaveTextContent("3 × 2 apart");
        expect(
            JSON.parse(localStorage.getItem(SAVED_SHAPES_STORAGE_KEY)!),
        ).toEqual([wide]);
    });

    it("lists a saved shape only the open show has, which can join my library", async () => {
        render(<ShapeLibraryContents />, [wide]);
        const row = screen.getByTestId("shape-library-row-wide");
        expect(row).toHaveTextContent("this show only");
        await userEvent.click(screen.getByTestId("shape-library-add-wide"));
        expect(useSavedShapeLibrary.getState().shapes).toEqual([wide]);
        expect(
            screen.getByTestId("shape-library-row-wide"),
        ).not.toHaveTextContent("this show only");
        expect(screen.queryByTestId("shape-library-add-wide")).toBeNull();
    });

    it("greys out picking a shape with nobody selected", () => {
        render(<ShapeLibraryContents />);
        expect(screen.getByTestId("shape-library-pick-block")).toBeDisabled();
        expect(screen.getByTestId("shape-library-pick-block")).toHaveAttribute(
            "title",
            "Select marchers first",
        );
    });

    it("deletes a saved shape from my library and the show, and its star", async () => {
        useSavedShapeLibrary.getState().put(wide);
        useShapeStarsStore.setState({ stars: ["wide"] });
        render(<ShapeLibraryContents />);
        await userEvent.click(screen.getByTestId("shape-library-delete-wide"));
        expect(screen.queryByTestId("shape-library-row-wide")).toBeNull();
        expect(useSavedShapeLibrary.getState().shapes).toEqual([]);
        expect(useShapeStarsStore.getState().stars).toEqual([]);
        expect(showWrites.deleted).toEqual(["wide"]);
        expect(screen.queryByTestId("shape-library-delete-block")).toBeNull();
    });
});
