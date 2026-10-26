import { afterEach, expect } from "vitest";
import type { ReactElement, ReactNode } from "react";
import {
    cleanup,
    render as renderDom,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describeDbTests, type DbConnection } from "@/test/base";
import {
    createSavedShapeInTransaction,
    getSavedShapes,
} from "@/db-functions/savedShapes";
import { rowTool } from "../../__test__/fakeRowKind";
import { ShapeLibraryContents } from "../ShapeLibraryPanel";
import {
    basicShapeRows,
    MAX_STARS,
    type ShapeLibraryRow,
} from "../shapeLibrary";
import { SHAPE_STARS_STORAGE_KEY, useShapeStarsStore } from "../shapeStars";
import { SHAPE_TOOLS } from "../../tool/shapeTools";
import { boxTool } from "../../box/boxTool";
import {
    SAVED_SHAPES_STORAGE_KEY,
    useSavedShapeLibrary,
} from "../savedShapeLibrary";
import type { SavedShape } from "../savedShapes";

type Wrapper = (props: { children: ReactNode }) => ReactElement;

/** Renders inside the test show: the library reads its saved shapes from the database */
const render = (ui: ReactElement, wrapper: unknown) =>
    renderDom(ui, { wrapper: wrapper as Wrapper });

/** Gives the test show its own copy of `shape`, as a show from another computer has */
const copyIntoShow = (db: DbConnection, shape: SavedShape) =>
    db.transaction((tx) => createSavedShapeInTransaction({ tx, shape }));

const wide: SavedShape = {
    id: "wide",
    name: "Wide box",
    kind: boxTool.shape.id,
    kindVersion: 1,
    intervals: { across: 3, deep: 2 },
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
};

const described: SavedShape = {
    ...wide,
    id: "described",
    name: "Opener block",
    description:
        "Company front at the 40 for the opener, then the drill moves into the arc",
    distribution: {
        mode: "files",
        layout: { family: "shortBack", byFile: false },
        stagger: [1, 2],
    },
    updatedAt: "2026-10-03T12:00:00.000Z",
};

const saved = (id: string): ShapeLibraryRow => ({
    id,
    group: "saved",
    label: `Saved ${id}`,
    note: "Row · 2 apart",
    kind: rowTool,
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    useShapeStarsStore.setState({ stars: [], asking: null });
    useSavedShapeLibrary.setState({ shapes: [] });
});

const star = (id: string) => screen.getByTestId(`shape-library-star-${id}`);

describeDbTests("the shape library", (it) => {
    it("lists the basic kinds, each with a star, a name and a note", ({
        wrapper,
    }) => {
        render(<ShapeLibraryContents />, wrapper);
        const box = screen.getByTestId("shape-library-row-block");
        expect(box).toHaveTextContent("Box");
        expect(box).toHaveTextContent("2 apart");
        // Drawn from the box's own spots (#378)
        expect(within(box).getByTestId("shape-preview")).toHaveAttribute(
            "data-spots",
            "9",
        );
        expect(star("block")).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByTestId("shape-library-saved-empty")).toBeVisible();
    });

    it("stars a shape for this user, kept where the app keeps per-user settings", async ({
        wrapper,
    }) => {
        render(<ShapeLibraryContents />, wrapper);
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

    it(`asks to unstar one first when starring a shape past ${MAX_STARS}, and stars it once one is unstarred`, async ({
        wrapper,
    }) => {
        const many = Array.from({ length: MAX_STARS }, (_, i) =>
            saved(String(i)),
        );
        const rows = [...basicShapeRows(SHAPE_TOOLS), ...many];
        useShapeStarsStore.setState({ stars: many.map((r) => r.id) });
        render(<ShapeLibraryContents rows={rows} />, wrapper);
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

    it("lists the user's saved shapes in the Saved group, with their kind and spacing", ({
        wrapper,
    }) => {
        useSavedShapeLibrary.getState().put(wide);
        render(<ShapeLibraryContents />, wrapper);
        const row = screen.getByTestId("shape-library-row-wide");
        expect(row).toHaveTextContent("Wide box");
        expect(row).toHaveTextContent("Box · 3 × 2 apart");
        expect(
            JSON.parse(localStorage.getItem(SAVED_SHAPES_STORAGE_KEY)!),
        ).toEqual([wide]);
    });

    it("lists a saved shape only the open show has, which can join my library", async ({
        db,
        wrapper,
    }) => {
        await copyIntoShow(db, wide);
        render(<ShapeLibraryContents />, wrapper);
        const row = await screen.findByTestId("shape-library-row-wide");
        expect(row).toHaveTextContent("this show only");
        await userEvent.click(screen.getByTestId("shape-library-add-wide"));
        expect(useSavedShapeLibrary.getState().shapes).toEqual([wide]);
        expect(
            screen.getByTestId("shape-library-row-wide"),
        ).not.toHaveTextContent("this show only");
        expect(screen.queryByTestId("shape-library-add-wide")).toBeNull();
    });

    it("shows a saved shape's description on one line, the whole of it in a tooltip, and its stagger in the note", async ({
        wrapper,
    }) => {
        useSavedShapeLibrary.getState().put(described);
        render(<ShapeLibraryContents />, wrapper);
        const row = screen.getByTestId("shape-library-row-described");
        expect(row).toHaveTextContent("Box · 3 × 2 apart, stagger ½");
        const description = screen.getByTestId(
            "shape-library-description-described",
        );
        expect(description).toHaveTextContent(described.description!);
        expect(description).toHaveClass("truncate");
        await userEvent.hover(description);
        expect((await screen.findByRole("tooltip")).textContent).toContain(
            described.description,
        );
        expect(
            screen.queryByTestId("shape-library-description-wide"),
        ).toBeNull();
    });

    it("a show's copy brings its description, distribution and dates into my library", async ({
        db,
        wrapper,
    }) => {
        await copyIntoShow(db, described);
        render(<ShapeLibraryContents />, wrapper);
        await userEvent.click(
            await screen.findByTestId("shape-library-add-described"),
        );
        expect(useSavedShapeLibrary.getState().shapes).toEqual([described]);
        expect(
            JSON.parse(localStorage.getItem(SAVED_SHAPES_STORAGE_KEY)!),
        ).toEqual([described]);
    });

    it("greys out picking a shape with nobody selected", async ({
        wrapper,
    }) => {
        render(<ShapeLibraryContents />, wrapper);
        const pick = screen.getByTestId("shape-library-pick-block");
        expect(pick).toHaveAttribute("aria-disabled", "true");
        await userEvent.hover(pick);
        expect((await screen.findByRole("tooltip")).textContent).toBe(
            "Select marchers first",
        );
    });

    it("deletes a saved shape from my library and the show, and its star", async ({
        db,
        wrapper,
    }) => {
        await copyIntoShow(db, wide);
        useSavedShapeLibrary.getState().put(wide);
        useShapeStarsStore.setState({ stars: ["wide"] });
        render(<ShapeLibraryContents />, wrapper);
        await userEvent.click(screen.getByTestId("shape-library-delete-wide"));
        expect(screen.queryByTestId("shape-library-row-wide")).toBeNull();
        expect(useSavedShapeLibrary.getState().shapes).toEqual([]);
        expect(useShapeStarsStore.getState().stars).toEqual([]);
        await waitFor(async () =>
            expect(await getSavedShapes({ db })).toEqual([]),
        );
        expect(screen.queryByTestId("shape-library-delete-block")).toBeNull();
    });
});
