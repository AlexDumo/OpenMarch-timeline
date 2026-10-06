import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveTempoMap, type TempoMapMark } from "@/timeline/tempo";
import { TempoMapPanel, mapOwnsKey } from "../TempoMapPanel";

afterEach(cleanup);

const measures = [
    { number: 1, rehearsalMark: "A", firstCount: 1, counts: 4 },
    { number: 2, rehearsalMark: null, firstCount: 5, counts: 4 },
];
const durations = [
    0,
    ...Array<number>(4).fill(60 / 176),
    ...Array<number>(4).fill(60 / 185.035),
];
const marks = new Map<number, TempoMapMark>([
    [0, { unit: "q", bpm: 176, source: "typed" }],
    [1, { unit: "q", bpm: 176, source: "typed" }],
]);

vi.mock("../useTempoMapState", () => ({
    useTempoMapState: () => ({
        beatIds: durations.map((_, i) => i),
        measureStartBeatIds: [1, 5],
        syncedBeatIds: [],
        state: {
            durations,
            measures,
            marks,
            rows: deriveTempoMap({ durations, measures, marks }),
        },
    }),
}));
vi.mock("@/hooks/queries/useTempo", () => ({
    useRetimeBeats: () => ({ mutateAsync: vi.fn() }),
}));

const renderPanel = () =>
    render(
        <QueryClientProvider client={new QueryClient()}>
            <TempoMapPanel open onOpenChange={vi.fn()} />
        </QueryClientProvider>,
    );

describe("the tempo map panel (FX-1)", () => {
    it("opens with the focus in the grid, on the first row's tempo cell", () => {
        renderPanel();
        const grid = screen.getByTestId("tempo-map-grid");
        expect(grid).toHaveFocus();
        expect(grid).toHaveAttribute("aria-activedescendant", "tempo-map-0-2");
        expect(document.getElementById("tempo-map-0-2")).toHaveAttribute(
            "data-column",
            "tempo",
        );
    });

    it("keeps single keys from the app's shortcuts while it has the focus", () => {
        renderPanel();
        const app = vi.fn();
        window.addEventListener("keydown", app);
        const grid = screen.getByTestId("tempo-map-grid");
        // Space neither plays nor starts an edit
        fireEvent.keyDown(grid, { key: " " });
        expect(screen.queryByTestId("tempo-map-editor")).toBeNull();
        for (const key of [" ", "r", "w", "a", "s", "d", "ArrowRight"])
            fireEvent.keyDown(grid, { key });
        fireEvent.keyDown(screen.getByLabelText("Close the tempo map"), {
            key: " ",
        });
        expect(app).not.toHaveBeenCalled();

        // Undo still reaches the app
        fireEvent.keyDown(grid, { key: "z", ctrlKey: true });
        expect(app).toHaveBeenCalledTimes(1);
        window.removeEventListener("keydown", app);
        expect(
            mapOwnsKey({ key: "Escape", ctrlKey: false, metaKey: false }),
        ).toBe(false);
    });

    it("shows = only for a tempo that still plays as typed (FX-4)", () => {
        renderPanel();
        expect(document.getElementById("tempo-map-0-2")).toHaveTextContent(
            "♩=176",
        );
        // m2 was typed 176, then a drag made it 185.035
        expect(document.getElementById("tempo-map-1-2")).toHaveTextContent(
            "♩≈185",
        );
        const dots = screen.getAllByTestId("tempo-map-typed");
        expect(dots.map((d) => d.textContent)).toEqual(["●", "○"]);
        expect(dots[1]).toHaveAttribute(
            "title",
            "Typed ♩=176; changed since (now ♩≈185)",
        );
    });
});
