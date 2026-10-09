import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { describeDbTests } from "@/test/base";
import { timelineFixtureMode } from "@/test/timelineMode";
import { harnessQueryClient, setUpFeature } from "@/test/featureHarness";
import tolgee from "@/global/singletons/Tolgee";
import { stopTimelineResolver } from "@/timeline/timelineStore";
import { toggleKeepOnNextPage } from "@/timeline/timelineKeepCommands";
import RegisteredActionsHandler, {
    RegisteredActionsEnum,
    RegisteredActionsObjects,
} from "../RegisteredActionsHandler";

/**
 * **K** (UI-18 keep later pages): in timeline mode, keeps the selected marchers on the page after
 * the current one, or lets them follow again there (`toggleKeepOnNextPage`, tested on a database
 * in `timelineKeepCommands.test.ts`). Page mode has no K; typing in a field never presses it.
 */

const app = vi.hoisted(() => ({ client: (): unknown => null }));
vi.mock("@/App", () => ({
    get queryClient() {
        return app.client();
    },
}));
app.client = harnessQueryClient;

vi.mock("@/timeline/timelineKeepCommands", () => ({
    toggleKeepOnNextPage: vi.fn(() => Promise.resolve(null)),
    keepOnPage: vi.fn(),
    followAgainOn: vi.fn(),
}));

beforeAll(async () => {
    await tolgee.run();
});

afterEach(() => {
    cleanup();
    stopTimelineResolver();
    vi.mocked(toggleKeepOnNextPage).mockClear();
});

const press = (target: EventTarget = window) =>
    act(() => {
        target.dispatchEvent(
            new KeyboardEvent("keydown", {
                code: "KeyK",
                key: "k",
                bubbles: true,
            }),
        );
    });

describe("the K shortcut", () => {
    it("is K alone, and no other action uses it", () => {
        const shortcut =
            RegisteredActionsObjects[RegisteredActionsEnum.toggleKeepOnNextPage]
                .keyboardShortcut!;
        expect(shortcut.toString()).toBe("K");
        const others = Object.values(RegisteredActionsObjects).filter(
            (a) =>
                a.enumString !== RegisteredActionsEnum.toggleKeepOnNextPage &&
                a.keyboardShortcut?.toString() === "K",
        );
        expect(others).toEqual([]);
    });
});

describeDbTests("K keeps on the next page (timeline mode only)", (it) => {
    it("toggles keep for the selection on the page after the current one, never from a field", async ({
        db: _,
        marchersAndPages,
    }) => {
        const ids = marchersAndPages.expectedMarchers
            .slice(0, 2)
            .map((m) => m.id);
        const { page } = await setUpFeature(
            <RegisteredActionsHandler />,
            2,
            ids,
        );
        press();
        if (timelineFixtureMode()) {
            await waitFor(() =>
                expect(toggleKeepOnNextPage).toHaveBeenCalledTimes(1),
            );
            expect(vi.mocked(toggleKeepOnNextPage).mock.calls[0]![0]).toEqual(
                expect.objectContaining({
                    currentPageId: page.id,
                    marcherIds: ids,
                }),
            );
        } else {
            await new Promise((r) => setTimeout(r, 100));
            expect(toggleKeepOnNextPage).not.toHaveBeenCalled();
        }
        vi.mocked(toggleKeepOnNextPage).mockClear();
        // Typing a K in a field is typing
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();
        press(input);
        await new Promise((r) => setTimeout(r, 100));
        expect(toggleKeepOnNextPage).not.toHaveBeenCalled();
        input.remove();
    });
});
