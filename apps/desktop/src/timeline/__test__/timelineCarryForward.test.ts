import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { transactionWithHistory } from "@/db-functions/history";
import {
    moveMarchersInTarget,
    type TimelineMarcherMove,
} from "@/db-functions/timelineMoves";
import { deleteTimelinesInTransaction } from "@/db-functions/timelines";
import type Page from "@/global/classes/Page";
import {
    useTimelineSelectionStore,
    type PageBox,
} from "@/stores/TimelineSelectionStore";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import {
    convertPagesToTimeline,
    readShowTiming,
} from "../convert/writePageConversion";
import {
    carryForwardMessage,
    editCarryForward,
    marcherCarry,
    summarizeCarryForward,
    type CarrySpan,
} from "../timelineCarryForward";
import { neighborPageTarget } from "../timelineCoordinateWrites";
import {
    timelineEditMessage,
    toastTimelineEdit,
    type PassThroughTranslate,
} from "../timelinePassThrough";
import { pageFlags } from "../timelinePlayhead";
import {
    startTimelineResolver,
    stopTimelineResolver,
    timelineResolverSettled,
    useTimelineResolverStore,
} from "../timelineStore";

/**
 * The carry-forward toast (docs/timeline/ui.md UI-15, defined-coordinates 07c §6–7): an edit
 * that moves marchers who hold through later pages says which pages it also moved, and where it
 * stops when every carried marcher stops at the same page, in the one post-edit toast.
 */

/** Fills `{name}` placeholders in the English default, as Tolgee does without a translation. */
const english: PassThroughTranslate = (_key, defaultMessage, params = {}) =>
    defaultMessage.replace(/\{(\w+)\}/g, (_, name: string) => params[name]!);

const hold = (start: number, end: number): CarrySpan => ({
    start,
    end,
    kind: "hold",
});
const own = (start: number, end: number): CarrySpan => ({
    start,
    end,
    kind: "founding",
});

// Page 1 is home; each box is named after the page whose flag ends it
const BOXES: PageBox[] = [
    { start: 0, end: 8, name: "2" },
    { start: 8, end: 16, name: "3" },
    { start: 16, end: 24, name: "4" },
    { start: 24, end: 32, name: "5" },
    { start: 32, end: 40, name: "6" },
];
const FLAGS = BOXES.map((b) => b.end);

describe("one marcher's carry-forward", () => {
    it("runs over every later flag it holds through, to the show's end", () => {
        expect(
            marcherCarry(
                [hold(-Infinity, 0), own(0, 8), hold(8, Infinity)],
                8,
                FLAGS,
            ),
        ).toEqual({ flags: [16, 24, 32, 40], stop: null });
    });

    it("stops at the flag where its next own move ends, which it doesn't change", () => {
        const spans = [
            hold(-Infinity, 0),
            own(0, 8),
            hold(8, 24),
            own(24, 32),
            hold(32, Infinity),
        ];
        expect(marcherCarry(spans, 8, FLAGS)).toEqual({
            flags: [16, 24],
            stop: 32,
        });
    });

    it("carries nowhere when its next own move ends on the next flag", () => {
        const spans = [own(0, 8), own(8, 16), hold(16, Infinity)];
        expect(marcherCarry(spans, 8, FLAGS)).toEqual({ flags: [], stop: 16 });
    });

    it("changes a flag a later long move passes, and stops after it", () => {
        // The next move starts on Page 4's flag and passes Page 5's: both are moved
        const spans = [own(0, 8), hold(8, 16), own(16, 40)];
        expect(marcherCarry(spans, 8, FLAGS)).toEqual({
            flags: [16, 24, 32],
            stop: 40,
        });
    });

    it("stops at the first flag after a next move that ends between flags", () => {
        const spans = [own(0, 8), hold(8, 20), own(20, 28), hold(28, Infinity)];
        expect(marcherCarry(spans, 8, FLAGS)).toEqual({
            flags: [16, 24],
            stop: 32,
        });
    });

    it("from home, runs to its first own move", () => {
        const spans = [hold(-Infinity, 16), own(16, 24), hold(24, Infinity)];
        expect(marcherCarry(spans, 0, FLAGS)).toEqual({
            flags: [8, 16],
            stop: 24,
        });
    });
});

describe("the carry-forward summary and message", () => {
    it("names one page, or a range, and where they all stop", () => {
        expect(
            summarizeCarryForward([{ flags: [16], stop: 24 }], BOXES),
        ).toEqual({ first: "3", last: "3", stop: "4" });
        const summary = summarizeCarryForward(
            [
                { flags: [16, 24], stop: 32 },
                { flags: [16, 24], stop: 32 },
            ],
            BOXES,
        )!;
        expect(carryForwardMessage(summary, english)).toBe(
            "Also moves Pages 3–4 · stops at Page 5",
        );
        expect(carryForwardMessage({ first: "3", last: "3" }, english)).toBe(
            "Also moves Page 3",
        );
    });

    it("leaves out the stop when the marchers stop at different pages, or one runs to the end", () => {
        const varied = summarizeCarryForward(
            [
                { flags: [16], stop: 24 },
                { flags: [16, 24, 32], stop: 40 },
            ],
            BOXES,
        )!;
        expect(carryForwardMessage(varied, english)).toBe(
            "Also moves Pages 3–5",
        );
        expect(
            summarizeCarryForward(
                [
                    { flags: [16], stop: 24 },
                    { flags: [16, 24, 32, 40], stop: null },
                ],
                BOXES,
            ),
        ).toEqual({ first: "3", last: "6" });
    });

    it("ignores marchers that carry nowhere, and says nothing when none carry", () => {
        expect(
            summarizeCarryForward(
                [
                    { flags: [], stop: 16 },
                    { flags: [16], stop: 24 },
                ],
                BOXES,
            ),
        ).toEqual({ first: "3", last: "3", stop: "4" });
        expect(summarizeCarryForward([{ flags: [], stop: 16 }], BOXES)).toBe(
            null,
        );
        expect(summarizeCarryForward([], BOXES)).toBeNull();
    });

    it("is one message with the pass-through's, and nothing when neither applies", () => {
        const pass = {
            range: { start: 0, end: 16 },
            marcherIds: [1],
            labels: ["T1"],
            overridden: [],
            caughtUp: [],
            flags: [8],
        };
        expect(
            timelineEditMessage(
                pass,
                { first: "4", last: "5" },
                BOXES,
                english,
            ),
        ).toBe("T1 now moves straight through Page 2. Also moves Pages 4–5");
        expect(timelineEditMessage(undefined, null, BOXES, english)).toBeNull();
    });
});

// The tests below write their own timeline rows and start the resolver themselves
keepFixturesInPageMode("its tests write timeline rows themselves");

afterEach(() => {
    stopTimelineResolver();
    useTimelineSelectionStore.getState().reset();
    vi.restoreAllMocks();
});

const HOMES: TimelineMarcherMove[] = [
    { marcherId: 1, x: 100, y: 100 },
    { marcherId: 2, x: 150, y: 100 },
    { marcherId: 3, x: 200, y: 100 },
];

/**
 * The `marchersAndPages` show with no timeline rows, so marchers hold on their homes through
 * every page (as a show built with the **+** flag does); the page boxes are in the selection
 * store, as the timeline panel keeps them. Returns pages in show order and their boxes.
 */
const setUp = async (db: DbConnection) => {
    await convertPagesToTimeline(db);
    await transactionWithHistory(db, "clearTimelines", async (tx) => {
        const ids = (
            await tx
                .select({ id: schema.timelines.id })
                .from(schema.timelines)
                .all()
        ).map((r) => r.id);
        await deleteTimelinesInTransaction({ tx, timelineIds: new Set(ids) });
    });
    await moveMarchersInTarget({ db, target: { kind: "home" }, moves: HOMES });
    await startTimelineResolver(db);
    const { pages } = await readShowTiming(db);
    const sorted = [...pages].sort((a, b) => a.order - b.order);
    const boxes = pageFlags(sorted).flatMap((f) =>
        f.range ? [{ ...f.range, name: f.page.name }] : [],
    );
    useTimelineSelectionStore.getState().setPageBoxes(boxes);
    return { pages: sorted, boxes };
};

const box = (page: Page) => {
    const target = neighborPageTarget(page);
    if (target.kind !== "range") throw new Error("not a page box");
    return target;
};

/** A range edit, then what it carried forward, as the toast words it. */
const edit = async (
    db: DbConnection,
    boxes: readonly PageBox[],
    range: { start: number; end: number },
    moves: TimelineMarcherMove[],
) => {
    const target = { kind: "range" as const, ...range };
    const result = await moveMarchersInTarget({ db, target, moves });
    await timelineResolverSettled();
    const summary = editCarryForward(
        useTimelineResolverStore.getState().resolver!,
        target,
        result,
        boxes,
    );
    return {
        result,
        target,
        message: summary && carryForwardMessage(summary, english),
    };
};

describeDbTests("the carry-forward toast, from the resolver", (it) => {
    it("owner scenario: editing page 2 with pages 3–4 inherited also moves pages 3–4, up to page 5's own move", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { pages, boxes } = await setUp(db);
        await edit(db, boxes, box(pages[5]!), [{ marcherId: 1, x: 50, y: 50 }]);
        const { message } = await edit(db, boxes, box(pages[2]!), [
            { marcherId: 1, x: 300, y: 300 },
        ]);
        expect(message).toBe(
            `Also moves Pages ${pages[3]!.name}–${pages[4]!.name} · stops at Page ${pages[5]!.name}`,
        );
    });

    it("with no later move of its own, runs to the show's end and names no stop", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { pages, boxes } = await setUp(db);
        expect(boxes.at(-1)!.end).toBe(box(pages.at(-1)!).end);
        const { message } = await edit(db, boxes, box(pages[2]!), [
            { marcherId: 1, x: 300, y: 300 },
        ]);
        expect(message).toBe(
            `Also moves Pages ${pages[3]!.name}–${pages.at(-1)!.name}`,
        );
    });

    it("names where it stops when every carried marcher stops at the same page", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { pages, boxes } = await setUp(db);
        await edit(db, boxes, box(pages[4]!), [
            { marcherId: 1, x: 50, y: 50 },
            { marcherId: 2, x: 60, y: 60 },
        ]);
        const { message } = await edit(db, boxes, box(pages[2]!), [
            { marcherId: 1, x: 300, y: 300 },
            { marcherId: 2, x: 310, y: 300 },
        ]);
        expect(message).toBe(
            `Also moves Page ${pages[3]!.name} · stops at Page ${pages[4]!.name}`,
        );
    });

    it("leaves the stop out when the marchers stop at different pages", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { pages, boxes } = await setUp(db);
        // Marcher 1 has its own page 4, marcher 2 its own page 5
        await edit(db, boxes, box(pages[4]!), [{ marcherId: 1, x: 50, y: 50 }]);
        await edit(db, boxes, box(pages[5]!), [{ marcherId: 2, x: 60, y: 60 }]);
        const { message } = await edit(db, boxes, box(pages[2]!), [
            { marcherId: 1, x: 300, y: 300 },
            { marcherId: 2, x: 310, y: 300 },
        ]);
        expect(message).toBe(
            `Also moves Pages ${pages[3]!.name}–${pages[4]!.name}`,
        );
    });

    it("counts only the marchers the edit moved (a partial selection)", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { pages, boxes } = await setUp(db);
        // Marcher 1 owns page 3, so it carries nowhere; marcher 3 isn't moved at all
        await edit(db, boxes, box(pages[3]!), [{ marcherId: 1, x: 50, y: 50 }]);
        await edit(db, boxes, box(pages[4]!), [{ marcherId: 2, x: 70, y: 70 }]);
        const { message } = await edit(db, boxes, box(pages[2]!), [
            { marcherId: 1, x: 300, y: 300 },
            { marcherId: 2, x: 310, y: 300 },
            // Already there: written nowhere, so not counted
            { marcherId: 3, x: 200, y: 100 },
        ]);
        // Only marcher 2 carries: page 3, stopping at its own page 4
        expect(message).toBe(
            `Also moves Page ${pages[3]!.name} · stops at Page ${pages[4]!.name}`,
        );
        // Every marcher owning the next page: nothing to say
        const none = await edit(db, boxes, box(pages[2]!), [
            { marcherId: 1, x: 320, y: 320 },
        ]);
        expect(none.message).toBeNull();
    });

    it("an edit on the last page carries nowhere", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { pages, boxes } = await setUp(db);
        const { message } = await edit(db, boxes, box(pages.at(-1)!), [
            { marcherId: 1, x: 300, y: 300 },
        ]);
        expect(message).toBeNull();
    });

    it("a window passing a flag shows one toast: what it passed, what it also moved, and Start from", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { pages, boxes } = await setUp(db);
        await edit(db, boxes, box(pages[5]!), [{ marcherId: 1, x: 50, y: 50 }]);
        const info = vi.spyOn(toast, "info").mockImplementation(() => 0);
        const page2 = box(pages[2]!);
        const page3 = box(pages[3]!);
        const window = { start: page2.start, end: page3.end };
        const target = { kind: "range" as const, ...window };
        const result = await moveMarchersInTarget({
            db,
            target,
            moves: [{ marcherId: 1, x: 300, y: 300 }],
        });
        expect(result.passThrough).toBeDefined();
        await toastTimelineEdit(target, result);
        expect(info).toHaveBeenCalledTimes(1);
        const [message, options] = info.mock.calls[0]!;
        expect(message).toMatch(
            new RegExp(
                `now moves straight through Page ${pages[2]!.name}\\. Also moves Page ${pages[4]!.name} · stops at Page ${pages[5]!.name}$`,
            ),
        );
        expect(options).toMatchObject({
            id: "timeline-edit",
            action: { label: `Start from Page ${pages[3]!.name}` },
        });
    });

    it("a carry-forward alone shows one toast with no action", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { pages } = await setUp(db);
        const info = vi.spyOn(toast, "info").mockImplementation(() => 0);
        const target = { kind: "range" as const, ...box(pages[2]!) };
        const result = await moveMarchersInTarget({
            db,
            target,
            moves: [{ marcherId: 1, x: 300, y: 300 }],
        });
        await toastTimelineEdit(target, result);
        expect(info).toHaveBeenCalledTimes(1);
        expect(info.mock.calls[0]![0]).toBe(
            `Also moves Pages ${pages[3]!.name}–${pages.at(-1)!.name}`,
        );
        expect(info.mock.calls[0]![1]).toMatchObject({ action: undefined });
    });

    it("an edit of homes carries to the marcher's first own move", async ({
        db,
        marchersAndPages: _,
    }) => {
        const { pages, boxes } = await setUp(db);
        await edit(db, boxes, box(pages[3]!), [{ marcherId: 1, x: 50, y: 50 }]);
        const target = { kind: "home" as const };
        const result = await moveMarchersInTarget({
            db,
            target,
            moves: [{ marcherId: 1, x: 10, y: 10 }],
        });
        await timelineResolverSettled();
        const summary = editCarryForward(
            useTimelineResolverStore.getState().resolver!,
            target,
            result,
            boxes,
        )!;
        expect(carryForwardMessage(summary, english)).toBe(
            `Also moves Pages ${pages[1]!.name}–${pages[2]!.name} · stops at Page ${pages[3]!.name}`,
        );
    });
});
