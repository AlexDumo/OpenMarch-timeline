import {
    ReactNode,
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import Marcher from "@/global/classes/Marcher";
import { useQuery } from "@tanstack/react-query";
import { allMarcherRowsQueryOptions } from "@/hooks/queries/useMarchers";
import { useMarcherAppearanceSteps } from "@/hooks/useMarcherAppearanceSteps";
import {
    appearanceChangeBeats,
    changeIndexAtBeat,
    hiddenMarcherIdsAtBeat,
} from "@/services/appearance/appearanceSteps";
import {
    displayedBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";

// Define the type for the context value
type SelectedMarcherContextProps = {
    selectedMarchers: Marcher[];
    setSelectedMarchers: (marchers: Marcher[]) => void;
};

const SelectedMarcherContext = createContext<
    SelectedMarcherContextProps | undefined
>(undefined);

export function SelectedMarchersProvider({
    children,
}: {
    children: ReactNode;
}) {
    // Items too: a prop selected on the field stays selected
    const { data: marchers } = useQuery(allMarcherRowsQueryOptions());
    const [selectedMarchers, setSelectedMarchers] = useState<Marcher[]>([]);
    // Hidden marchers can't be selected: the appearance steps sampled at the beat the paused
    // field shows, as the field draws them (UI-9)
    const appearanceSteps = useMarcherAppearanceSteps(true);
    const changeBeats = useMemo(
        () => (appearanceSteps ? appearanceChangeBeats(appearanceSteps) : []),
        [appearanceSteps],
    );
    // Re-render only when the displayed beat crosses an appearance change, not on every beat
    const changeIndex = useTimelineSelectionStore((s) =>
        changeIndexAtBeat(changeBeats, displayedBeat(s)),
    );
    const hiddenMarcherIds: Set<number> = useMemo(
        () =>
            appearanceSteps
                ? hiddenMarcherIdsAtBeat(
                      appearanceSteps,
                      changeIndex > 0 ? changeBeats[changeIndex - 1]! : 0,
                  )
                : new Set(),
        [appearanceSteps, changeBeats, changeIndex],
    );

    // A marcher deleted from the show leaves the selection. Filtered from the selection as it is
    // when the update runs, not as this render saw it: a click or a marquee that lands between
    // the render and this effect would otherwise be overwritten by the older selection
    useEffect(() => {
        if (!marchers) return;
        const ids = new Set(marchers.map((m) => m.id));
        setSelectedMarchers((current) =>
            current.filter((marcher) => ids.has(marcher.id)),
        );
    }, [marchers]);

    // Ensure that hidden marchers cannot be selected (from the selection as it is then, as above)
    useEffect(() => {
        setSelectedMarchers((current) => {
            const visible = current.filter(
                (marcher) => !hiddenMarcherIds.has(marcher.id),
            );
            return visible.length === current.length ? current : visible;
        });
    }, [hiddenMarcherIds, selectedMarchers]);

    // Memoised so a provider render (a page change re-renders it) doesn't re-render every consumer
    const contextValue: SelectedMarcherContextProps = useMemo(
        () => ({ selectedMarchers, setSelectedMarchers }),
        [selectedMarchers],
    );

    return (
        <SelectedMarcherContext.Provider value={contextValue}>
            {children}
        </SelectedMarcherContext.Provider>
    );
}

export function useSelectedMarchers() {
    return useContext(SelectedMarcherContext);
}
