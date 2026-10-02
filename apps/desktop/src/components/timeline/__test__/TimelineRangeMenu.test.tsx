import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type Beat from "@/global/classes/Beat";
import type Page from "@/global/classes/Page";
import { describeDbTests, schema, type DbConnection } from "@/test/base";
import {
    keepFixturesInPageMode,
    setTimelineModeFlag,
} from "@/test/timelineMode";
import { TimelineWriteError } from "@/db-functions/timelineErrors";
import {
    convertPagesToTimeline,
    readShowTiming,
} from "@/timeline/convert/writePageConversion";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import { Timeline, type TimelineInput } from "../Timeline";
import type { TimelineSelection } from "../TimelineViewModel";
import type { TimelineAddMarchersMenu } from "../TimelineRangeMenu";
import {
    addSelectedMarchersBlocker,
    useTimelineCommands,
} from "../useTimelineCommands";

/**
 * The timeline's right-click menu (P8.14, ui.md UI-9 Adding marchers): **Add selected marchers**
 * on a page box, a clip or a dragged range sends that range in spec beats, and opening it never
 * changes the timeline selection.
 */

// Only the toast is replaced; the add runs on a real test database (docs/conventions/testing.md)
vi.mock("@/timeline/timelineErrorMessages", () => ({
    toastTimelineError: vi.fn(),
}));

keepFixturesInPageMode("the end-to-end tests convert the show themselves");

afterEach(cleanup);
beforeEach(() => {
    vi.mocked(toastTimelineError).mockReset();
});

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

/** Page 0 on beat 0, then pages 1 and 2 of eight beats each */
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

const clip: TimelineInput = {
    id: "clip",
    linkId: 7,
    targetId: "clip",
    targetType: "marcher",
    label: "A1",
    color: "#2fc4b2",
    startBeatIndex: 3,
    endBeatIndex: 7,
    legs: [{ id: "leg", startBeatIndex: 3, endBeatIndex: 7, texture: "move" }],
    activitySpans: [{ startBeatIndex: 3, endBeatIndex: 7, active: true }],
};

const show = ({
    menu,
    selection = null,
    onSelectionChange = vi.fn(),
}: {
    menu: TimelineAddMarchersMenu;
    selection?: TimelineSelection;
    onSelectionChange?: (selection: TimelineSelection) => void;
}) =>
    render(
        <Timeline
            mode="expanded"
            beats={BEATS}
            pages={PAGES}
            measures={[]}
            timelines={[clip]}
            showTransport={false}
            selection={selection}
            onSelectionChange={onSelectionChange}
            addSelectedMarchers={menu}
        />,
    );

const menuItem = () => screen.queryByRole("menuitem");

describe("the timeline's right-click menu (UI-9)", () => {
    it("adds to a page box's range, in spec beats, without changing the selection", () => {
        const onAdd = vi.fn();
        const onSelectionChange = vi.fn();
        show({ menu: { onAdd }, onSelectionChange });
        fireEvent.contextMenu(screen.getByRole("button", { name: "Page 2" }));
        const item = menuItem();
        expect(item?.textContent).toContain("Add selected marchers");
        fireEvent.click(item!);
        // Page 2 is beats 9 to 16: from page 1's flag to its own
        expect(onAdd).toHaveBeenCalledWith({
            startBeatIndex: 9,
            endBeatIndex: 17,
        });
        expect(onSelectionChange).not.toHaveBeenCalled();
    });

    it("adds to a clip's timeline range", () => {
        const onAdd = vi.fn();
        show({ menu: { onAdd } });
        fireEvent.contextMenu(
            screen.getByRole("button", { name: /A1 timeline/ }),
        );
        fireEvent.click(menuItem()!);
        expect(onAdd).toHaveBeenCalledWith({
            startBeatIndex: 3,
            endBeatIndex: 7,
        });
    });

    it("a clip from spec beat 0 sends its stored range, not [1, N) from the view axis", () => {
        // A converted show's one timeline runs over [0, 17); the view axis folds beats 0 and 1
        const onAdd = vi.fn();
        render(
            <Timeline
                mode="expanded"
                beats={BEATS}
                pages={PAGES}
                measures={[]}
                timelines={[
                    {
                        ...clip,
                        startBeatIndex: 0,
                        endBeatIndex: 17,
                        legs: [
                            {
                                id: "leg",
                                startBeatIndex: 0,
                                endBeatIndex: 17,
                                texture: "move",
                            },
                        ],
                        activitySpans: [
                            {
                                startBeatIndex: 0,
                                endBeatIndex: 17,
                                active: true,
                            },
                        ],
                    },
                ]}
                showTransport={false}
                addSelectedMarchers={{ onAdd }}
            />,
        );
        fireEvent.contextMenu(
            screen.getByRole("button", { name: /A1 timeline/ }),
        );
        fireEvent.click(menuItem()!);
        expect(onAdd).toHaveBeenCalledWith({
            startBeatIndex: 0,
            endBeatIndex: 17,
        });
    });

    it("adds to a dragged range when right-clicked inside it, and offers nothing elsewhere", () => {
        const onAdd = vi.fn();
        // View beats [10, 14) are spec beats [11, 15)
        show({
            menu: { onAdd },
            selection: {
                kind: "range",
                range: { startBeatIndex: 10, endBeatIndex: 14 },
            },
        });
        const surface = screen.getByTestId("timeline-pointer-surface");
        // jsdom lays nothing out: the surface's left edge is 0, so clientX is px from beat 0
        fireEvent.contextMenu(surface, { clientX: 16 * 12 });
        fireEvent.click(menuItem()!);
        expect(onAdd).toHaveBeenCalledWith({
            startBeatIndex: 11,
            endBeatIndex: 15,
        });

        cleanup();
        show({ menu: { onAdd } });
        fireEvent.contextMenu(screen.getByTestId("timeline-pointer-surface"), {
            clientX: 16 * 12,
        });
        expect(menuItem()).toBeNull();
    });

    it("is disabled, with the reason, when no marchers are selected", () => {
        const onAdd = vi.fn();
        show({
            menu: {
                onAdd,
                disabledReason: addSelectedMarchersBlocker(new Set()),
            },
        });
        fireEvent.contextMenu(screen.getByRole("button", { name: "Page 1" }));
        const item = menuItem()!;
        expect(item.getAttribute("aria-disabled")).toBe("true");
        expect(
            screen.getByTestId("timeline-range-menu-reason").textContent,
        ).toMatch(/Select marchers first/);
        fireEvent.click(item);
        expect(onAdd).not.toHaveBeenCalled();
    });
});

/** The panel's wiring (`useTimelineCommands`) around the real `Timeline`, on a real database. */
function Panel({
    db,
    beats,
    pages,
    timelines,
    selectedMarcherIds,
}: {
    db: DbConnection;
    beats: Beat[];
    pages: Page[];
    timelines: TimelineInput[];
    selectedMarcherIds: ReadonlySet<number>;
}) {
    const commands = useTimelineCommands({
        database: db,
        timelines,
        selectedMarcherIds,
    });
    return (
        <Timeline
            mode="expanded"
            beats={beats}
            pages={pages}
            measures={[]}
            timelines={timelines}
            showTransport={false}
            addSelectedMarchers={commands.addSelectedMarchers}
        />
    );
}

describeDbTests("the right-click menu on a converted show", (it) => {
    it("adds to a page box's timeline, and the show-wide clip (from beat 0) finds its own timeline", async ({
        db,
        marchersAndPages,
    }) => {
        await convertPagesToTimeline(db);
        await setTimelineModeFlag(db, true);
        const { beats, pages } = await readShowTiming(db);
        const ordered = [...pages].sort((a, b) => a.order - b.order);
        const [show] = await db.select().from(schema.timelines).all();
        expect(show!.start_beat).toBe(0);
        const showClip: TimelineInput = {
            ...clip,
            id: "show",
            linkId: show!.id,
            startBeatIndex: show!.start_beat,
            endBeatIndex: show!.end_beat,
            legs: [
                {
                    id: "leg",
                    startBeatIndex: show!.start_beat,
                    endBeatIndex: show!.end_beat,
                    texture: "move",
                },
            ],
            activitySpans: [
                {
                    startBeatIndex: show!.start_beat,
                    endBeatIndex: show!.end_beat,
                    active: true,
                },
            ],
        };
        const a = marchersAndPages.expectedMarchers[0]!.id;
        render(
            <Panel
                db={db}
                beats={beats}
                pages={ordered}
                timelines={[showClip]}
                selectedMarcherIds={new Set([a])}
            />,
        );

        // A page box: its timeline is created, with the marcher's own move
        fireEvent.contextMenu(
            screen.getByRole("button", { name: `Page ${ordered[2]!.name}` }),
        );
        fireEvent.click(menuItem()!);
        await waitFor(async () =>
            expect(await db.select().from(schema.timelines).all()).toHaveLength(
                2,
            ),
        );
        const added = await db
            .select()
            .from(schema.timelines)
            .where(
                eq(
                    schema.timelines.start_beat,
                    ordered[1]!.beats.at(-1)!.index + 1,
                ),
            )
            .all();
        expect(added.map((t) => t.end_beat)).toEqual([
            ordered[2]!.beats.at(-1)!.index + 1,
        ]);

        // The show-wide clip: the marcher is already in it, so it's refused and nothing is written
        const before = await db
            .select()
            .from(schema.timeline_assignments)
            .all();
        fireEvent.contextMenu(
            screen.getByRole("button", { name: /A1 timeline/ }),
        );
        fireEvent.click(menuItem()!);
        await waitFor(() => expect(toastTimelineError).toHaveBeenCalled());
        const refusal = vi.mocked(toastTimelineError).mock.calls[0]![0];
        expect(refusal).toBeInstanceOf(TimelineWriteError);
        expect((refusal as Error).message).toMatch(/already in this timeline/);
        expect(await db.select().from(schema.timelines).all()).toHaveLength(2);
        expect(
            await db.select().from(schema.timeline_assignments).all(),
        ).toEqual(before);
    });
});
