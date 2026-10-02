import {
    ReactNode,
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import Marcher from "@/global/classes/Marcher";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { allMarchersQueryOptions } from "@/hooks/queries/useMarchers";
import { useCurrentPage } from "./SelectedPageContext";
import { marcherAppearancesQueryOptions } from "@/hooks/queries/useMarcherAppearances";
import { appearanceIsHidden } from "@/entity-components/appearance";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import { useTimelineMode } from "@/hooks/queries/useWorkspaceSettings";
import { useMarcherAppearanceTimelines } from "@/hooks/useMarcherAppearanceTimelines";
import { hiddenMarcherIdsAt } from "@/services/appearance/get-appearance-at-time";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { timeAtBeat } from "@/timeline/timeMap";

// Define the type for the context value
type SelectedMarcherContextProps = {
    selectedMarchers: Marcher[];
    setSelectedMarchers: (marchers: Marcher[]) => void;
};

const setsAreEqual = (set1: Set<number>, set2: Set<number>) => {
    return (
        set1.size === set2.size &&
        Array.from(set1).every((value) => set2.has(value))
    );
};

const SelectedMarcherContext = createContext<
    SelectedMarcherContextProps | undefined
>(undefined);

export function SelectedMarchersProvider({
    children,
}: {
    children: ReactNode;
}) {
    const { data: marchers } = useQuery(allMarchersQueryOptions());
    const [selectedMarchers, setSelectedMarchers] = useState<Marcher[]>([]);
    // Hidden marchers can't be selected. Page mode reads the selected page's appearances; timeline
    // mode samples the appearance timeline at the playhead, as the canvas draws it (UI-9 No
    // selected page, `useAppearanceAnimation`)
    const timelineMode = useTimelineMode();
    const currentPage = useCurrentPage();
    const queryClient = useQueryClient();
    const { data: marcherAppearances } = useQuery({
        ...marcherAppearancesQueryOptions(currentPage?.id, queryClient),
        enabled: currentPage !== null && !timelineMode,
    });
    const appearanceTimelines = useMarcherAppearanceTimelines(timelineMode);
    const { beats } = useTimingObjects();
    const playheadBeat = useTimelineSelectionStore((s) => s.playheadBeat);
    const hiddenMarcherIds: Set<number> = useMemo(() => {
        if (timelineMode)
            return appearanceTimelines
                ? hiddenMarcherIdsAt(
                      appearanceTimelines,
                      timeAtBeat(beats, playheadBeat) * 1000,
                  )
                : new Set();
        if (marcherAppearances == null) return new Set();
        const hiddenMarcherIds = new Set(
            Object.entries(marcherAppearances)
                .filter((marcherAppearance) =>
                    appearanceIsHidden(marcherAppearance[1]),
                )
                .map((marcherAppearance) => parseInt(marcherAppearance[0])),
        );
        return hiddenMarcherIds;
    }, [
        timelineMode,
        appearanceTimelines,
        beats,
        playheadBeat,
        marcherAppearances,
    ]);

    // Update the selected marcher if the marchers list changes. This refreshes the information of the selected marcher
    useEffect(() => {
        if (selectedMarchers && marchers) {
            const newSelectedMarchers = selectedMarchers.filter((marcher) =>
                marchers.some((m) => m.id === marcher.id),
            );

            setSelectedMarchers(newSelectedMarchers);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [marchers]);

    // Ensure that hidden marchers cannot be selected
    useEffect(() => {
        const currentSelectedMarcherIds = new Set(
            selectedMarchers.map((marcher) => marcher.id),
        );
        const newSelectedMarchers = selectedMarchers.filter(
            (marcher) => !hiddenMarcherIds.has(marcher.id),
        );
        const newSelectedMarcherIds = new Set(
            newSelectedMarchers.map((marcher) => marcher.id),
        );
        if (!setsAreEqual(currentSelectedMarcherIds, newSelectedMarcherIds)) {
            setSelectedMarchers(Array.from(newSelectedMarchers));
        }
    }, [hiddenMarcherIds, selectedMarchers]);

    // Create the context value object
    const contextValue: SelectedMarcherContextProps = {
        selectedMarchers,
        setSelectedMarchers,
    };

    return (
        <SelectedMarcherContext.Provider value={contextValue}>
            {children}
        </SelectedMarcherContext.Provider>
    );
}

export function useSelectedMarchers() {
    return useContext(SelectedMarcherContext);
}
