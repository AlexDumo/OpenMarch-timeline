import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, vi } from "vitest";
import { describeDbTests, type DbConnection } from "@/test/base";
import {
    harnessQueryClient,
    mountFeature,
    probed,
    selectPageAndMarchers,
} from "@/test/featureHarness";
import tolgee from "@/global/singletons/Tolgee";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { stopTimelineResolver } from "@/timeline/timelineStore";
import { useAlignmentActionHandlers } from "@/shortcuts/handlers/useAlignmentActionHandlers";
import {
    toggleRatioLock,
    useShapeEditorStore,
} from "@/shapes/frame/shapeEditorStore";
import { ArrangeSection } from "../ArrangeSection";

/**
 * The ratio lock in the inspector's Arrange section (#586): a plain selection has no floating
 * editor, so its lock lives with the other commands for two or more marchers. It runs the
 * toggleRatioLock action and shows the one lock the box editor's chain button shows too.
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
    act(() => {
        useShapeEditorStore.setState({ ratioLocked: false });
    });
});

const playing: { set: ((on: boolean) => void) | null } = { set: null };
function Probe() {
    playing.set = useIsPlaying()!.setIsPlaying;
    useAlignmentActionHandlers();
    return null;
}

describeDbTests("the ratio lock in the Arrange section", (it) => {
    // The database fixture is set up for the test that asks for it (`db`)
    const mount = async (_db: DbConnection, marcherIds: number[]) => {
        const { result } = mountFeature(
            <>
                <ArrangeSection />
                <Probe />
            </>,
        );
        await waitFor(() => {
            expect(probed().pages.length).toBeGreaterThan(5);
            expect(probed().marchers?.length).toBeGreaterThan(0);
        });
        await selectPageAndMarchers(probed().pages[3]!, marcherIds);
        return result;
    };
    const lockButton = (result: { queryByTestId: (id: string) => unknown }) =>
        result.queryByTestId("arrange-ratio-lock") as HTMLButtonElement | null;

    it("flips the shared lock, and shows it however it was flipped", async ({
        db,
        marchersAndPages,
    }) => {
        const ids = marchersAndPages.expectedMarchers
            .slice(0, 2)
            .map((m) => m.id);
        const result = await mount(db, ids);
        await waitFor(() => expect(lockButton(result)).not.toBeNull());
        const button = lockButton(result)!;
        expect(button.textContent).toBe("Keep ratio");
        expect(button.getAttribute("aria-pressed")).toBe("false");
        expect(button.getAttribute("aria-label")).toBeNull();

        fireEvent.click(button);
        expect(useShapeEditorStore.getState().ratioLocked).toBe(true);
        expect(lockButton(result)!.getAttribute("aria-pressed")).toBe("true");

        // The box editor's chain button flips the same lock
        act(() => {
            toggleRatioLock();
        });
        expect(lockButton(result)!.getAttribute("aria-pressed")).toBe("false");
        act(() => {
            toggleRatioLock();
        });
        expect(lockButton(result)!.getAttribute("aria-pressed")).toBe("true");

        fireEvent.click(lockButton(result)!);
        expect(useShapeEditorStore.getState().ratioLocked).toBe(false);
    });

    it("hides with the rest of Arrange: one marcher, or while playing", async ({
        db,
        marchersAndPages,
    }) => {
        const [first, second] = marchersAndPages.expectedMarchers;
        const result = await mount(db, [first!.id]);
        await waitFor(() => expect(probed().loaded).toBe(true));
        expect(lockButton(result)).toBeNull();

        await selectPageAndMarchers(probed().pages[3]!, [
            first!.id,
            second!.id,
        ]);
        await waitFor(() => expect(lockButton(result)).not.toBeNull());
        act(() => {
            playing.set!(true);
        });
        expect(lockButton(result)).toBeNull();
    });
});
