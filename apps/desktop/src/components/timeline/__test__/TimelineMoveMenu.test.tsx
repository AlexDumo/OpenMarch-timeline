import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Beat from "@/global/classes/Beat";
import type Page from "@/global/classes/Page";
import { Timeline, type TimelineInput } from "../Timeline";
import type { TimelineSelection } from "../TimelineViewModel";
import type { TimelineMoveCommands } from "../TimelineRangeMenu";

/**
 * UI-14: a clip is a move. Its right-click menu, the selected clip's ⋯ button and the focused
 * clip's keys edit, rename and delete it, by its stored timeline's id; page boxes keep **Delete
 * page flag** only, and the rename field's keys stay its own.
 */

afterEach(cleanup);

/** The zero-length beat 0, then `count` timed beats */
const appBeats = (count: number): Beat[] =>
    Array.from({ length: count + 1 }, (_, index) => ({
        id: index + 1,
        position: index,
        duration: index === 0 ? 0 : 0.5,
        includeInMeasure: true,
        notes: null,
        index,
        timestamp: index === 0 ? 0 : (index - 1) * 0.5,
    }));

const BEATS = appBeats(16);

const page = (id: number, name: string, beats: Beat[]): Page =>
    ({
        id,
        name,
        counts: id === 1 ? 0 : beats.length,
        notes: null,
        order: id - 1,
        nextPageId: id < 3 ? id + 1 : null,
        previousPageId: id === 1 ? null : id - 1,
        isSubset: false,
        duration: beats.length * 0.5,
        beats,
        measures: null,
        measureBeatToStartOn: null,
        measureBeatToEndOn: null,
        timestamp: beats[0]!.timestamp,
    }) as unknown as Page;
const PAGES = [
    page(1, "0", [BEATS[0]!]),
    page(2, "1", BEATS.slice(1, 9)),
    page(3, "2", BEATS.slice(9, 17)),
];

/** A mid-page move over spec beats [3, 7), stored as timeline 7 */
const clip: TimelineInput = {
    id: "timeline-7",
    linkId: 7,
    targetId: 7,
    targetType: "timeline",
    label: "Company front",
    color: "#2fc4b2",
    startBeatIndex: 3,
    endBeatIndex: 7,
    legs: [{ id: "leg", startBeatIndex: 3, endBeatIndex: 7, texture: "move" }],
    activitySpans: [{ startBeatIndex: 3, endBeatIndex: 7, active: true }],
};

const commands = (
    overrides: Partial<TimelineMoveCommands> = {},
): TimelineMoveCommands => ({
    onEdit: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    disabledReason: null,
    ...overrides,
});

const show = ({
    moves = commands(),
    selection = null,
    onDeletePageFlag,
    mode = "expanded",
}: {
    moves?: TimelineMoveCommands;
    selection?: TimelineSelection;
    onDeletePageFlag?: (pageId: number) => void;
    mode?: "expanded" | "collapsed";
} = {}) => {
    render(
        <Timeline
            mode={mode}
            beats={BEATS}
            pages={PAGES}
            measures={[]}
            timelines={[clip]}
            showTransport={false}
            pixelsPerBeat={16}
            selection={selection}
            onSelectionChange={vi.fn()}
            moveCommands={moves}
            onDeletePageFlag={onDeletePageFlag}
        />,
    );
    return moves;
};

/** The clip selected: its range is the window */
const SELECTED: TimelineSelection = {
    kind: "range",
    range: { startBeatIndex: 3, endBeatIndex: 7 },
};

const clipButton = () =>
    screen.getByRole("button", { name: /Company front timeline/ });
const items = () =>
    screen.getAllByRole("menuitem").map((item) => item.textContent);

/** Records the keys pressed that reach the window, where the app's shortcuts listen */
const windowKeys = () => {
    const keys: string[] = [];
    const listener = (event: KeyboardEvent) => keys.push(event.key);
    beforeEach(() => {
        keys.length = 0;
        window.addEventListener("keydown", listener);
    });
    afterEach(() => window.removeEventListener("keydown", listener));
    return keys;
};

describe("the clip's menu (UI-14)", () => {
    it("offers Edit move, Rename move… and Delete move, red and last, by stored timeline id", () => {
        const moves = show();
        fireEvent.contextMenu(clipButton());
        expect(items()).toEqual(["Edit move", "Rename move…", "Delete move"]);
        const remove = screen.getByTestId("timeline-move-menu-delete");
        expect(remove.className).toContain("text-red");
        fireEvent.click(remove);
        expect(moves.onDelete).toHaveBeenCalledWith(7);

        fireEvent.contextMenu(clipButton());
        fireEvent.click(screen.getByTestId("timeline-move-menu-edit"));
        expect(moves.onEdit).toHaveBeenCalledWith(7);
    });

    it("keeps Delete page flag alone on a page box, and nothing on a dragged range", () => {
        show({
            onDeletePageFlag: vi.fn(),
            selection: {
                kind: "range",
                range: { startBeatIndex: 11, endBeatIndex: 15 },
            },
        });
        fireEvent.contextMenu(screen.getByRole("button", { name: "Page 2" }));
        expect(items()).toEqual(["Delete page flag"]);
        cleanup();
        show({
            selection: {
                kind: "range",
                range: { startBeatIndex: 11, endBeatIndex: 15 },
            },
        });
        fireEvent.contextMenu(screen.getByTestId("timeline-pointer-surface"), {
            clientX: 16 * 12,
        });
        expect(screen.queryByRole("menuitem")).toBeNull();
    });

    it("disables Edit and Delete while playing, with the reason; Rename stays", () => {
        const moves = show({
            moves: commands({
                disabledReason: "Pause to edit or delete a move.",
            }),
        });
        fireEvent.contextMenu(clipButton());
        expect(
            screen
                .getByTestId("timeline-move-menu-edit")
                .getAttribute("aria-disabled"),
        ).toBe("true");
        expect(
            screen
                .getByTestId("timeline-move-menu-delete")
                .getAttribute("aria-disabled"),
        ).toBe("true");
        expect(
            screen
                .getByTestId("timeline-move-menu-rename")
                .getAttribute("aria-disabled"),
        ).toBeNull();
        expect(
            screen.getByTestId("timeline-move-menu-reason").textContent,
        ).toMatch(/Pause/);
        fireEvent.click(screen.getByTestId("timeline-move-menu-delete"));
        expect(moves.onDelete).not.toHaveBeenCalled();
    });
});

describe("the ⋯ button (UI-14)", () => {
    it("shows on the selected clip only, and opens the same menu", async () => {
        show();
        expect(screen.queryByTestId("timeline-clip-menu-button")).toBeNull();
        cleanup();
        const moves = show({ selection: SELECTED });
        const button = screen.getByTestId("timeline-clip-menu-button");
        fireEvent.keyDown(button, { key: "Enter" });
        await waitFor(() =>
            expect(items()).toEqual([
                "Edit move",
                "Rename move…",
                "Delete move",
            ]),
        );
        fireEvent.click(screen.getByTestId("timeline-move-menu-edit"));
        expect(moves.onEdit).toHaveBeenCalledWith(7);
    });

    it("a press in its menu stays in the menu: it doesn't scrub the timeline under it", async () => {
        const onSeek = vi.fn();
        render(
            <Timeline
                mode="expanded"
                beats={BEATS}
                pages={PAGES}
                measures={[]}
                timelines={[clip]}
                showTransport={false}
                pixelsPerBeat={16}
                selection={SELECTED}
                onSelectionChange={vi.fn()}
                playback={{ positionBeat: 7, isPlaying: false, onSeek }}
                moveCommands={commands()}
            />,
        );
        fireEvent.keyDown(screen.getByTestId("timeline-clip-menu-button"), {
            key: "Enter",
        });
        const rename = await screen.findByTestId("timeline-move-menu-rename");
        fireEvent.pointerDown(rename, { button: 0, clientX: 40 });
        fireEvent.pointerUp(rename, { button: 0, clientX: 40 });
        expect(onSeek).not.toHaveBeenCalled();
    });

    it("sits just past the end of a clip too narrow for it, never hidden", () => {
        // 4 beats at 4px a beat is 16px: no room for the label and the button
        render(
            <Timeline
                mode="expanded"
                beats={BEATS}
                pages={PAGES}
                measures={[]}
                timelines={[clip]}
                showTransport={false}
                pixelsPerBeat={4}
                selection={SELECTED}
                onSelectionChange={vi.fn()}
                moveCommands={commands()}
            />,
        );
        const button = screen.getByTestId("timeline-clip-menu-button");
        const clipEl = clipButton();
        const clipEnd =
            parseFloat(clipEl.style.left) + parseFloat(clipEl.style.width);
        expect(parseFloat(button.style.left)).toBeGreaterThanOrEqual(clipEnd);
        expect(screen.queryByTestId("timeline-clip-label")).toBeNull();
    });

    it("shows in compact too", () => {
        show({ selection: SELECTED, mode: "collapsed" });
        expect(screen.getByTestId("timeline-clip-menu-button")).toBeTruthy();
    });
});

describe("the focused clip's keys (UI-14)", () => {
    const reached = windowKeys();

    it("Delete and Backspace delete the move and never reach the app's shortcuts", () => {
        const moves = show();
        fireEvent.keyDown(clipButton(), { key: "Delete" });
        fireEvent.keyDown(clipButton(), { key: "Backspace" });
        expect(moves.onDelete).toHaveBeenCalledTimes(2);
        expect(moves.onDelete).toHaveBeenCalledWith(7);
        expect(reached).toEqual([]);
    });

    it("while playing, Delete does nothing, and still doesn't reach them", () => {
        const moves = show({ moves: commands({ disabledReason: "Pause" }) });
        fireEvent.keyDown(clipButton(), { key: "Delete" });
        expect(moves.onDelete).not.toHaveBeenCalled();
        expect(reached).toEqual([]);
    });

    it("the ContextMenu key and Shift+F10 open the move's menu", async () => {
        show();
        fireEvent.keyDown(clipButton(), { key: "ContextMenu" });
        await waitFor(() => expect(items()).toContain("Delete move"));
        cleanup();
        show();
        fireEvent.keyDown(clipButton(), { key: "F10", shiftKey: true });
        await waitFor(() => expect(items()).toContain("Delete move"));
    });

    it("other keys pass through", () => {
        show();
        fireEvent.keyDown(clipButton(), { key: "g" });
        expect(reached).toEqual(["g"]);
    });
});

describe("renaming on the clip (UI-14)", () => {
    const reached = windowKeys();

    const startRename = async (moves = commands()) => {
        show({ moves });
        fireEvent.contextMenu(clipButton());
        fireEvent.click(screen.getByTestId("timeline-move-menu-rename"));
        const field = screen.getByTestId(
            "timeline-move-name-field",
        ) as HTMLInputElement;
        await waitFor(() => expect(document.activeElement).toBe(field));
        return { moves, field };
    };

    it("opens on the label, selected, and Enter commits what was typed", async () => {
        const { moves, field } = await startRename();
        expect(field.value).toBe("Company front");
        expect(field.selectionStart).toBe(0);
        expect(field.selectionEnd).toBe("Company front".length);
        expect(field.maxLength).toBe(80);
        fireEvent.change(field, { target: { value: "Opener hit" } });
        fireEvent.keyDown(field, { key: "Enter" });
        expect(moves.onRename).toHaveBeenCalledWith(7, "Opener hit");
        expect(screen.queryByTestId("timeline-move-name-field")).toBeNull();
    });

    it("Esc cancels", async () => {
        const { moves, field } = await startRename();
        fireEvent.change(field, { target: { value: "Opener hit" } });
        fireEvent.keyDown(field, { key: "Escape" });
        expect(moves.onRename).not.toHaveBeenCalled();
        expect(screen.queryByTestId("timeline-move-name-field")).toBeNull();
    });

    it("leaving the field commits; empty is sent, to clear the name", async () => {
        const { moves, field } = await startRename();
        fireEvent.change(field, { target: { value: "" } });
        fireEvent.blur(field);
        expect(moves.onRename).toHaveBeenCalledWith(7, "");
    });

    it("an unchanged name sends nothing", async () => {
        const { moves, field } = await startRename();
        fireEvent.change(field, { target: { value: " Company front " } });
        fireEvent.keyDown(field, { key: "Enter" });
        expect(moves.onRename).not.toHaveBeenCalled();
    });

    it("its keys stay its own: G, Space, Delete and Shift+Z reach no shortcut", async () => {
        const { moves, field } = await startRename();
        for (const key of ["g", " ", "Delete", "Backspace", "Z"])
            fireEvent.keyDown(field, { key, shiftKey: key === "Z" });
        expect(reached).toEqual([]);
        expect(moves.onDelete).not.toHaveBeenCalled();
    });
});
