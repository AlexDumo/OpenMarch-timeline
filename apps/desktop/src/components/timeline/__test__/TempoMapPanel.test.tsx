import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveTempoMap, type TempoMapMark } from "@/timeline/tempo";
import { workspaceSettingsQueryOptions } from "@/hooks/queries/useWorkspaceSettings";
import { defaultWorkspaceSettings } from "@/settings/workspaceSettings";
import { TempoMapPanel, mapOwnsKey } from "../TempoMapPanel";

afterEach(cleanup);

const retime = vi.hoisted(() => vi.fn(async () => {}));

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
    [
        0,
        {
            meter: { top: 4, bottom: 4, groups: null },
            unit: "q",
            bpm: 176,
            source: "typed",
        },
    ],
    [1, { unit: "q", bpm: 176, source: "typed" }],
]);

vi.mock("../useTempoMapState", () => ({
    useTempoMapState: () => ({
        beatIds: durations.map((_, i) => i),
        measureStartBeatIds: [1, 5],
        syncedBeatIds: [1, 5],
        state: {
            durations,
            measures,
            marks,
            rows: deriveTempoMap({ durations, measures, marks }),
        },
    }),
}));
vi.mock("@/hooks/queries/useTempo", () => ({
    useRetimeBeats: () => ({ mutateAsync: retime }),
}));

const renderPanel = () => {
    const client = new QueryClient();
    client.setQueryData(workspaceSettingsQueryOptions().queryKey, {
        ...defaultWorkspaceSettings,
        audioOffsetSeconds: -0.5,
    });
    return render(
        <QueryClientProvider client={client}>
            <TempoMapPanel open onOpenChange={vi.fn()} />
        </QueryClientProvider>,
    );
};

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

describe("tempo map undo (DE-4)", () => {
    const type = async (text: string) => {
        const grid = screen.getByTestId("tempo-map-grid");
        fireEvent.keyDown(grid, { key: "Enter" });
        const editor = screen.getByTestId("tempo-map-editor");
        fireEvent.change(editor, { target: { value: text } });
        await act(async () => {
            fireEvent.keyDown(editor, { key: "Enter" });
        });
    };

    it("writes nothing, so takes no undo step, for an edit that changes nothing", async () => {
        retime.mockClear();
        renderPanel();
        await type("176");
        expect(retime).not.toHaveBeenCalled();
        expect(screen.getByTestId("tempo-map-message")).toHaveTextContent(
            "m1 A: ♩=176 (already so: nothing changed)",
        );
        await type("♩=176");
        expect(retime).not.toHaveBeenCalled();
        await type("180");
        expect(retime).toHaveBeenCalledTimes(1);
    });

    it("lets Ctrl/⌘+Z reach the app's undo after an edit", async () => {
        renderPanel();
        await type("180");
        const app = vi.fn();
        window.addEventListener("keydown", app);
        const grid = screen.getByTestId("tempo-map-grid");
        fireEvent.keyDown(grid, { key: "z", ctrlKey: true });
        fireEvent.keyDown(grid, { key: "z", metaKey: true });
        fireEvent.keyDown(grid, { key: "z", ctrlKey: true, shiftKey: true });
        window.removeEventListener("keydown", app);
        expect(app).toHaveBeenCalledTimes(3);
    });
});

describe("the map's legend and count 1 (DE-6, D7)", () => {
    it("says what ● means", () => {
        renderPanel();
        expect(screen.getByTestId("tempo-map-legend")).toHaveTextContent(
            "● a tempo or meter typed here or read from the score",
        );
        expect(screen.getAllByTestId("tempo-map-typed")[0]).toHaveAttribute(
            "title",
            expect.stringContaining("● typed here or read from the score"),
        );
    });

    it("types where count 1 is in the music, as one write that moves the whole show", async () => {
        retime.mockClear();
        renderPanel();
        const field = screen.getByTestId("tempo-map-count-one");
        // An offset of −0.5 is count 1 at 0.5 s into the music
        expect(field).toHaveValue("0.500");
        fireEvent.change(field, { target: { value: "1.84" } });
        await act(async () => {
            fireEvent.submit(field.closest("form")!);
        });
        expect(retime).toHaveBeenCalledTimes(1);
        const args = (retime.mock.calls[0] as unknown[])[0] as {
            originShift: number;
            newDurationsByBeatId: Map<number, number>;
        };
        // newOffset = −0.5 − 1.34 = −1.84
        expect(args.originShift).toBeCloseTo(1.34, 9);
        expect(args.newDurationsByBeatId.size).toBe(0);
        expect(screen.getByTestId("tempo-map-message")).toHaveTextContent(
            "Count 1 is at 1.840 s in the music",
        );
        // The same place again writes nothing
        fireEvent.change(field, { target: { value: "0.5" } });
        await act(async () => {
            fireEvent.submit(field.closest("form")!);
        });
        expect(retime).toHaveBeenCalledTimes(1);
    });
});
