import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import { describeDbTests } from "@/test/base";
import { timelineFixtureMode } from "@/test/timelineMode";
import {
    harnessQueryClient,
    mountFeature,
    probed,
    selectTimeline,
    setUpFeature,
    timelineSelection,
} from "@/test/featureHarness";
import tolgee from "@/global/singletons/Tolgee";
import {
    SELECTED_PAGE_IN_TIMELINE_MODE_WARNING,
    useSelectedPage,
} from "@/context/SelectedPageContext";
import { useRegisteredActionsStore } from "@/stores/RegisteredActionsStore";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { stopTimelineResolver } from "@/timeline/timelineStore";
import RegisteredActionsHandler, {
    RegisteredActionsEnum,
} from "@/utilities/RegisteredActionsHandler";
import MarcherEditor from "@/components/inspector/MarcherEditor";
import PageEditor from "@/components/inspector/PageEditor";
import { PageNotesSection } from "@/components/inspector/PageNotesSection";
import ShapeEditor from "@/components/inspector/ShapeEditor";
import { CollisionsTab } from "@/components/toolbar/tabs/CollisionsTab";
import { TimelineInspectorSection } from "@/components/inspector/TimelineInspectorSection";
import Toolbar from "@/components/toolbar/Toolbar";
import { AudioClock } from "@/components/timeline/Clock";
import PageTimeline from "@/components/timeline/PageTimeline";
import StateInitializer from "@/components/singletons/StateInitializer";
import { useAnimation } from "@/hooks/useAnimation";
import { useMovementListeners } from "@/components/canvas/hooks/canvasListeners.movement";
import { useSelectionListeners } from "@/components/canvas/hooks/canvasListeners.selection";
import { useUpdateSelectedMarchersOnSelectedPage } from "@/hooks/queries/useMarcherPages";
import { usePerformHistoryAction } from "@/hooks/queries/useHistory";
import { pageFlags } from "../timelinePlayhead";

/**
 * No selected page in timeline mode (docs/timeline/ui.md UI-9 No selected page, Deprecating page
 * selection; P8.12). The features that used to read `useSelectedPage` are mounted together on the
 * `base.tsx` fixtures and driven through navigation, page-relative tools and undo. Under
 * `test:timeline` (a converted show with the flag on) none of them may read it: its development
 * warning must never fire. A canary that does read it shows the warning works under the harness.
 * The default run checks the same features in page mode, where the selected page is theirs.
 */

const app = vi.hoisted(() => ({ client: (): unknown => null }));
vi.mock("@/App", () => ({
    get queryClient() {
        return app.client();
    },
}));
app.client = harnessQueryClient;

beforeAll(async () => {
    await tolgee.run();
    // jsdom has neither; the toolbar measures itself and StateInitializer loads the audio file
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    );
    window.electron = {
        ...window.electron,
        getSelectedAudioFile: async () => null,
    } as typeof window.electron;
});

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    warn = vi.spyOn(console, "warn");
});

afterEach(() => {
    warn.mockRestore();
    cleanup();
    stopTimelineResolver();
});

const selectedPageWarnings = () =>
    warn.mock.calls.filter(
        ([message]) => message === SELECTED_PAGE_IN_TIMELINE_MODE_WARNING,
    ).length;

/** The hooks that read the page without a component of their own, with no canvas. */
function PageHooks() {
    useAnimation({ canvas: null });
    useMovementListeners({ canvas: null });
    useSelectionListeners({ canvas: null });
    useUpdateSelectedMarchersOnSelectedPage();
    usePerformHistoryAction();
    return null;
}

/**
 * The features P8.12 moved off the selected page that render without a canvas or audio: the
 * inspector's parts (the whole inspector needs a canvas), the toolbar, the clock, the page timeline
 * shown while editing beats, and the canvas and playback hooks.
 */
const features = (
    <>
        <StateInitializer />
        <RegisteredActionsHandler />
        <MarcherEditor />
        <PageEditor />
        <PageNotesSection />
        <ShapeEditor />
        <CollisionsTab />
        <TimelineInspectorSection />
        <Toolbar />
        <AudioClock />
        <PageTimeline />
        <PageHooks />
    </>
);

/** Runs a registered action the way a toolbar button does. */
const trigger = async (action: RegisteredActionsEnum) => {
    const button = document.createElement("button");
    const ref = { current: button };
    act(() => {
        useRegisteredActionsStore.getState().linkRegisteredAction(action, ref);
    });
    try {
        await waitFor(() => expect(button.onclick).toBeTypeOf("function"));
        act(() => button.click());
    } finally {
        act(() => {
            useRegisteredActionsStore
                .getState()
                .removeRegisteredAction(action, ref);
        });
    }
};

function Canary() {
    useSelectedPage();
    return null;
}

describeDbTests("no selected page in timeline mode", (it) => {
    it("the features never read the selected page while navigating, setting marchers to a neighbor page and undoing", async ({
        db,
        marchersAndPages,
    }) => {
        void db;
        const ids = marchersAndPages.expectedMarchers
            .slice(0, 1)
            .map((m) => m.id);
        await setUpFeature(features, 2, ids);
        const pages = probed().pages;

        await trigger(RegisteredActionsEnum.nextPage);
        await waitFor(() =>
            expect(probed().currentPage?.id).toBe(pages[3]!.id),
        );
        await trigger(RegisteredActionsEnum.setSelectedMarchersToPreviousPage);
        await trigger(RegisteredActionsEnum.previousPage);
        await waitFor(() =>
            expect(probed().currentPage?.id).toBe(pages[2]!.id),
        );
        await trigger(RegisteredActionsEnum.performUndo);
        await trigger(RegisteredActionsEnum.firstPage);
        await waitFor(() =>
            expect(probed().currentPage?.id).toBe(pages[0]!.id),
        );

        if (timelineFixtureMode()) {
            expect(timelineSelection().selection).toEqual({ kind: "home" });
            // Between flags the page data is the page whose box holds the playhead
            const flags = pageFlags(pages);
            await selectTimeline(pages[2]!);
            act(() => {
                useTimelineSelectionStore.getState().seek(flags[2]!.flag - 1);
            });
            await waitFor(() =>
                expect(probed().currentPage?.id).toBe(pages[2]!.id),
            );
        }
        expect(selectedPageWarnings()).toBe(0);
    });

    it("the development warning fires for a component that still reads the selected page", async ({
        db,
        marchersAndPages,
    }) => {
        void db;
        void marchersAndPages;
        mountFeature(<Canary />);
        await waitFor(() => expect(probed().pages.length).toBeGreaterThan(0));
        if (timelineFixtureMode())
            await waitFor(() => expect(selectedPageWarnings()).toBe(1));
        else expect(selectedPageWarnings()).toBe(0);
    });
});
