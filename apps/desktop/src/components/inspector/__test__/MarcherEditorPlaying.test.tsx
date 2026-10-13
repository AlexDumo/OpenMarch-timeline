import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, vi } from "vitest";
import { describeDbTests, type DbConnection, schema } from "@/test/base";
import { keepFixturesInPageMode } from "@/test/timelineMode";
import {
    harnessQueryClient,
    mountFeature,
    probed,
    selectPageAndMarchers,
} from "@/test/featureHarness";
import tolgee from "@/global/singletons/Tolgee";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { marcherPageKeys } from "@/hooks/queries/useMarcherPages";
import { convertPagesToTimeline } from "@/timeline/convert/writePageConversion";
import { stopTimelineResolver } from "@/timeline/timelineStore";
import MarcherEditor from "../MarcherEditor";

// These tests convert the show and set the flag themselves
keepFixturesInPageMode(
    "its tests convert the show and set the flag themselves",
);

/**
 * The marcher section while timeline playback runs (UI-19 review): it keeps its place and its
 * collapsed state, and shows a note instead of the selected marchers' values and controls, reading
 * no marcher pages meanwhile. The selected page stays where playback started, so its values would
 * be stale and its edits would land there.
 */

const app = vi.hoisted(() => ({ client: (): unknown => null }));
vi.mock("@/App", () => ({
    get queryClient() {
        return app.client();
    },
}));
app.client = harnessQueryClient;
// Rotation needs the field canvas, which this test doesn't mount
vi.mock("../marcher/MarcherRotationInput", () => ({ default: () => null }));

beforeAll(async () => {
    await tolgee.run();
});

afterEach(() => {
    cleanup();
    stopTimelineResolver();
});

const toTimelineMode = async (db: DbConnection) => {
    await db.delete(schema.workspace_settings);
    await db.insert(schema.workspace_settings).values({
        id: 1,
        json_data: JSON.stringify({ timelineMode: true }),
    });
    await convertPagesToTimeline(db);
};

const playing: { set: ((on: boolean) => void) | null } = { set: null };
function PlayingProbe() {
    playing.set = useIsPlaying()!.setIsPlaying;
    return null;
}
const setPlaying = (on: boolean) =>
    act(() => {
        playing.set!(on);
    });

describeDbTests("the marcher section while timeline playback runs", (it) => {
    const mount = async (db: DbConnection, marcherIds: number[]) => {
        await toTimelineMode(db);
        const { qc, result } = mountFeature(
            <>
                <MarcherEditor />
                <PlayingProbe />
            </>,
        );
        await waitFor(() => {
            expect(probed().timelineMode).toBe(true);
            expect(probed().pages.length).toBeGreaterThan(5);
            expect(probed().marchers?.length).toBeGreaterThan(0);
        });
        await selectPageAndMarchers(probed().pages[3]!, marcherIds);
        return { qc, result };
    };
    const trigger = (result: { container: HTMLElement }) =>
        result.container.querySelector<HTMLElement>(
            "[data-state] > button, button[aria-expanded]",
        )!;

    it("shows a note in place of the values and controls, and reads no marcher pages", async ({
        db,
        marchersAndPages,
    }) => {
        const ids = marchersAndPages.expectedMarchers
            .slice(0, 2)
            .map((m) => m.id);
        const { qc, result } = await mount(db, ids);
        await waitFor(() => expect(result.getByText(/^Swap/)).toBeTruthy());

        setPlaying(true);
        expect(
            result.getByTestId("inspector-marcher-playing").textContent,
        ).toBe("Playing. Pause to see and edit the selected marchers.");
        expect(result.queryByText(/^Swap/)).toBeNull();
        expect(result.container.querySelectorAll("input")).toHaveLength(0);
        expect(result.container.querySelectorAll("button")).toHaveLength(1);

        // A page selected meanwhile (as undo's page jump can) loads nothing for this section:
        // its previous page is read only by the marcher section
        const later = probed().pages[5]!;
        const previousKey = marcherPageKeys.byPage(later.previousPageId!);
        act(() => {
            probed().setSelectedPage(later);
        });
        await waitFor(() => expect(probed().selectedPage?.id).toBe(later.id));
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(qc.getQueryState(previousKey)?.dataUpdateCount ?? 0).toBe(0);
        expect(qc.getQueryState(previousKey)?.fetchStatus ?? "idle").toBe(
            "idle",
        );

        setPlaying(false);
        await waitFor(() =>
            expect(
                result.queryByTestId("inspector-marcher-playing"),
            ).toBeNull(),
        );
        await waitFor(() => expect(result.getByText(/^Swap/)).toBeTruthy());
    });

    it("keeps the section collapsed through a play and stop, and a page change", async ({
        db,
        marchersAndPages,
    }) => {
        const id = marchersAndPages.expectedMarchers[0]!.id;
        const { result } = await mount(db, [id]);
        await waitFor(() =>
            expect(
                result.container.querySelectorAll('input[type="number"]')
                    .length,
            ).toBeGreaterThan(0),
        );
        const button = trigger(result);
        expect(button.getAttribute("aria-expanded")).toBe("true");
        fireEvent.click(button);
        expect(trigger(result).getAttribute("aria-expanded")).toBe("false");

        setPlaying(true);
        expect(trigger(result).getAttribute("aria-expanded")).toBe("false");
        setPlaying(false);
        await waitFor(() =>
            expect(
                result.queryByTestId("inspector-marcher-playing"),
            ).toBeNull(),
        );
        expect(trigger(result).getAttribute("aria-expanded")).toBe("false");

        // A page whose rows aren't loaded yet keeps the last page's content meanwhile, so the
        // section doesn't unmount to "Loading marcher" and reopen
        act(() => {
            probed().setSelectedPage(probed().pages[6]!);
        });
        expect(result.queryByText("Loading marcher")).toBeNull();
        await waitFor(() => expect(probed().loaded).toBe(true));
        expect(trigger(result).getAttribute("aria-expanded")).toBe("false");
    });
});
