import { act, render } from "@testing-library/react";
import {
    createContext,
    useCallback,
    useContext,
    useState,
    type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { pageAtPlayhead } from "../timelinePlayhead";
import { useTimelinePageBridge } from "../useTimelinePageBridge";

/**
 * The bridge's writes for a page the selected-page provider doesn't list yet (its page list a
 * commit behind the bridge's), which the provider keeps pending. A stand-in provider holds them
 * until `land` is called, or forever.
 */
const fake = vi.hoisted(() => {
    const beats = (from: number, count: number) =>
        Array.from({ length: count }, (_, i) => ({ index: from + i }));
    // Flags: page 1 at 0, page 2 at 4, page 3 at 8, page 4 at 12, page 5 at 16
    const pages = [
        { id: 1, beats: [] as { index: number }[] },
        { id: 2, beats: beats(0, 4) },
        { id: 3, beats: beats(4, 4) },
        { id: 4, beats: beats(8, 4) },
        { id: 5, beats: beats(12, 4) },
    ];
    return {
        pages,
        context: null as unknown as React.Context<{
            selectedPage: { id: number } | null;
            setSelectedPage: (page: { id: number }) => boolean;
        } | null>,
        notListed: new Set<number>(),
    };
});
vi.mock("@/hooks/useTimingObjects", () => ({
    useTimingObjects: () => ({ pages: fake.pages }),
}));
vi.mock("@/context/IsPlayingContext", () => ({
    useIsPlaying: () => ({ isPlaying: false }),
}));
vi.mock("@/context/SelectedPageContext", () => ({
    useSelectedPage: () => useContext(fake.context),
}));

fake.context = createContext<{
    selectedPage: { id: number } | null;
    setSelectedPage: (page: { id: number }) => boolean;
} | null>(null);

const provider = {
    select: (_page: { id: number }): boolean => false,
    land: () => {},
    selectedId: (): number | null => null,
};

function Provider({ children }: { children: ReactNode }) {
    const [selected, setSelected] = useState<{ id: number } | null>(
        fake.pages[2]!,
    );
    const [pending, setPending] = useState<number | null>(null);
    const setSelectedPage = useCallback((page: { id: number }) => {
        if (fake.notListed.has(page.id)) {
            setPending(page.id);
            return false;
        }
        setSelected(fake.pages.find((p) => p.id === page.id)!);
        setPending(null);
        return true;
    }, []);
    provider.select = setSelectedPage;
    provider.land = () => {
        if (pending === null) return;
        setSelected(fake.pages.find((p) => p.id === pending)!);
        setPending(null);
    };
    provider.selectedId = () => selected?.id ?? null;
    return (
        <fake.context.Provider
            value={{ selectedPage: selected, setSelectedPage }}
        >
            {children}
        </fake.context.Provider>
    );
}

function Bridge() {
    useTimelinePageBridge(true);
    return null;
}

const store = () => useTimelineSelectionStore.getState();
const playheadPage = () => pageAtPlayhead(fake.pages, store().playheadBeat)?.id;

beforeEach(() => {
    store().reset();
    fake.notListed.clear();
});

describe("timeline page bridge, writes waiting for their page", () => {
    async function renderOnPage3() {
        act(() => {
            store().seek(6);
        });
        render(
            <Provider>
                <Bridge />
            </Provider>,
        );
        await act(async () => {});
        expect(provider.selectedId()).toBe(3);
    }

    it("one landing after another selection leaves the playhead on the selected page", async () => {
        await renderOnPage3();
        // Undo selects page 4 as the playhead moves into page 2, which waits for its page
        fake.notListed.add(2);
        act(() => {
            store().seek(2);
            provider.select({ id: 4 });
        });
        await act(async () => {});
        expect(playheadPage()).toBe(4);
        // The provider's page list catches up
        fake.notListed.clear();
        act(() => provider.land());
        await act(async () => {});
        expect(provider.selectedId()).toBe(2);
        expect(playheadPage()).toBe(2);
    });

    it("one that never lands doesn't hide a later selection of that page", async () => {
        await renderOnPage3();
        fake.notListed.add(2);
        act(() => {
            store().seek(2);
            provider.select({ id: 4 });
        });
        await act(async () => {});
        expect(playheadPage()).toBe(4);
        // Page 2 is listed now and selected elsewhere: the playhead goes to it
        fake.notListed.clear();
        act(() => {
            provider.select({ id: 2 });
        });
        await act(async () => {});
        expect(provider.selectedId()).toBe(2);
        expect(playheadPage()).toBe(2);
    });
});
