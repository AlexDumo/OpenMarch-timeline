import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import { toast } from "sonner";
import { describeDbTests } from "@/test/base";
import { timelineFixtureMode } from "@/test/timelineMode";
import {
    harnessQueryClient,
    probed,
    setUpFeature,
    timelineSelection,
} from "@/test/featureHarness";
import tolgee from "@/global/singletons/Tolgee";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import { useAddPageFlag } from "@/hooks/queries/usePageFlags";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { useEditorModeStore } from "@/stores/EditorModeStore";
import { selectAddedPage } from "@/components/timeline/TimelineModePanel";
import { conToastError } from "@/utilities/utils";
import {
    stopTimelineResolver,
    timelineResolverSettled,
    useTimelineResolverStore,
} from "../timelineStore";
import { pageFlags } from "../timelinePlayhead";

/**
 * Basic's **+** on or past the last flag (docs/timeline/research/basic-mode, "Basic's panel"), on
 * a converted `marchersAndPages` show (pages 1 to 6 of 8 counts, the last flag at beat 49 of 97,
 * no `defaultNewPageCounts`, so 16): it adds a page of the default length from the last flag,
 * however far past it the playhead is, and says so; Expert's page ends at the playhead. Runs
 * under `test:timeline`.
 */

const app = vi.hoisted(() => ({ client: (): unknown => null }));
vi.mock("@/App", () => ({
    get queryClient() {
        return app.client();
    },
}));
app.client = harnessQueryClient;

vi.mock("@/utilities/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/utilities/utils")>()),
    conToastError: vi.fn(),
}));

beforeAll(async () => {
    await tolgee.run();
});
beforeEach(() => {
    vi.mocked(conToastError).mockReset();
    vi.spyOn(toast, "success").mockImplementation(() => "toast");
});
afterEach(() => {
    cleanup();
    stopTimelineResolver();
    vi.restoreAllMocks();
    useEditorModeStore.setState({ mode: null, loaded: false });
});

/** The panel's real **+** wiring, without the timeline's layout */
const panel: {
    plus: (() => void) | null;
    canPlus: boolean;
    beatCount: number;
} = { plus: null, canPlus: false, beatCount: 0 };

function PanelCommands() {
    const { beats, pages } = useTimingObjects();
    const playheadBeat = useTimelineSelectionStore((s) => s.playheadBeat);
    const plus = useAddPageFlag({
        pages,
        beatCount: beats.length,
        playheadBeat,
        isPlaying: false,
        onAdded: selectAddedPage,
    });
    panel.plus = plus.add;
    panel.canPlus = plus.insertion !== null;
    panel.beatCount = beats.length;
    return null;
}

const lastFlag = () => pageFlags(probed().pages).at(-1)!.range!.end;

const seek = (beat: number) =>
    act(() => {
        useTimelineSelectionStore.getState().seek(beat);
    });

/** Clicks **+** and waits for the new page to be selected */
const plusSelects = async (range: { start: number; end: number }) => {
    await waitFor(() => expect(panel.canPlus).toBe(true));
    act(() => panel.plus!());
    await waitFor(() =>
        expect(timelineSelection().selection).toEqual({
            kind: "range",
            ...range,
        }),
    );
};

const added = () =>
    vi
        .mocked(toast.success)
        .mock.calls.map(([message]) => message)
        .filter((m) => String(m).startsWith("Added Page"));

describeDbTests("Basic's + on or past the last flag", (it) => {
    it("Basic: a page of the default length from the last flag, back to back, lengthening the show where the music ends", async ({
        // Fixtures load only when asked for: the database too, not just the show
        db: _db,
        marchersAndPages: _,
    }) => {
        if (!timelineFixtureMode()) return;
        act(() => {
            useEditorModeStore.setState({ mode: "basic", loaded: true });
        });
        await setUpFeature(<PanelCommands />, 2, []);
        expect(lastFlag()).toBe(49);
        expect(panel.beatCount).toBe(97);

        // Three counts past the flag: the page is 16 counts, not 3
        seek(52);
        await plusSelects({ start: 49, end: 65 });
        expect(added()).toEqual(["Added Page 7 · 16 counts"]);
        await waitFor(() => expect(lastFlag()).toBe(65));

        // The playhead is on the new flag: + is still there, and adds the next page
        await plusSelects({ start: 65, end: 81 });
        await plusSelects({ start: 81, end: 97 });
        // The music ends on the last flag now: + lengthens the show by 4 measures of 4/4
        expect(panel.beatCount).toBe(97);
        await plusSelects({ start: 97, end: 113 });
        expect(added().at(-1)).toBe(
            "Added Page 10 · 16 counts, and 4 measures at the end of the show",
        );
        await waitFor(() => expect(panel.beatCount).toBe(113));
        await waitFor(() => expect(lastFlag()).toBe(113));
        // The resolver plays on into the new beats, holding where the show ended
        await timelineResolverSettled();
        const resolver = useTimelineResolverStore.getState().resolver!;
        for (const id of resolver.marcherIds())
            expect(resolver.positionAt(id, 110)).toEqual(
                resolver.positionAt(id, 97),
            );
        expect(conToastError).not.toHaveBeenCalled();
    });

    it("Expert: the page ends at the playhead, + isn't on the last flag, and nothing is said", async ({
        // Fixtures load only when asked for: the database too, not just the show
        db: _db,
        marchersAndPages: _,
    }) => {
        if (!timelineFixtureMode()) return;
        act(() => {
            useEditorModeStore.setState({ mode: "expert", loaded: true });
        });
        await setUpFeature(<PanelCommands />, 2, []);
        seek(52);
        await plusSelects({ start: 49, end: 52 });
        await waitFor(() => expect(lastFlag()).toBe(52));
        expect(panel.canPlus).toBe(false);
        expect(added()).toEqual([]);
        expect(panel.beatCount).toBe(97);
    });
});
