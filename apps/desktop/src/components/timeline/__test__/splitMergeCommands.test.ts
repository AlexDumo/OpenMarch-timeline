import { describe, expect, it, vi } from "vitest";
import type { DbConnection } from "@/db-functions/types";
import {
    mergeMoves,
    splitMarchersIntoNewMove,
} from "@/db-functions/timelineSplitMoves";
import {
    createSplitMergeCommands,
    type SplitMergeContext,
} from "../splitMergeMoves";

vi.mock("@/db-functions/timelineSplitMoves", () => ({
    splitMarchersIntoNewMove: vi.fn(),
    mergeMoves: vi.fn(),
    mergeRangeBlocker: vi.fn(),
    splitMembershipBlocker: vi.fn(),
}));
vi.mock("@/timeline/timelineErrorMessages", () => ({
    toastTimelineError: vi.fn(),
}));

/** The split and merge commands' guard (docs/timeline/ui.md UI-25). */

const context = (): SplitMergeContext => ({
    storedTimelines: [],
    pageBoxes: [],
    selectedMarcherIds: new Set(),
    isPlaying: false,
});

const commands = () =>
    createSplitMergeCommands({
        database: {} as DbConnection,
        undo: () => {},
        context,
    });

describe("split and merge commands", () => {
    it("run one edit at a time across every caller (the panel, the Move card, the palette)", async () => {
        let finish = () => {};
        vi.mocked(splitMarchersIntoNewMove).mockReturnValueOnce(
            new Promise((_, reject) => {
                finish = () => reject(new Error("done"));
            }),
        );
        const panel = commands();
        const card = commands();
        panel.split(3, [1]);
        card.split(3, [2]);
        card.merge(7, 3);
        expect(splitMarchersIntoNewMove).toHaveBeenCalledTimes(1);
        expect(mergeMoves).not.toHaveBeenCalled();

        // Once the first edit settles, the next one runs
        finish();
        await vi.waitFor(() => {
            vi.mocked(mergeMoves).mockRejectedValueOnce(new Error("refused"));
            card.merge(7, 3);
            expect(mergeMoves).toHaveBeenCalledTimes(1);
        });
    });
});
