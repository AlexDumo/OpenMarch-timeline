import { useEffect } from "react";
import {
    useCurrentPage,
    usePageNavigation,
} from "@/context/SelectedPageContext";
import { useSelectedAudioFile } from "@/context/SelectedAudioFileContext";
import AudioFile from "@/global/classes/AudioFile";
import { useTimingObjects } from "@/hooks";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { coordinateDataQueryOptions } from "@/hooks/queries/useCoordinateData";
import { useSelectionStore } from "@/stores/SelectionStore";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import {
    marcherAppearancesQueryOptions,
    updateShapePagesMutationOptions,
} from "@/hooks/queries";
import {
    MarcherShape,
    marcherShapeToShapePageArgs,
} from "@/global/classes/canvasObjects/MarcherShape";
import { useTimelineMode } from "@/hooks/queries/useWorkspaceSettings";

/**
 * A component that initializes the state of the application.
 * @returns <> </>
 */
function StateInitializer() {
    const queryClient = useQueryClient();
    const { pages } = useTimingObjects();
    // Timeline mode: the page at the playhead (UI-9 No selected page)
    const currentPage = useCurrentPage();
    const { goToPage } = usePageNavigation();
    const selectedAudioFileContext = useSelectedAudioFile();
    const selectedAudioFile =
        selectedAudioFileContext?.selectedAudioFile ?? null;
    const setSelectedAudioFile =
        selectedAudioFileContext?.setSelectedAudioFile ?? (() => {});
    const selectionStore = useSelectionStore();
    const setSelectedShapePageIds =
        selectionStore?.setSelectedShapePageIds ?? (() => {});
    const { mutate: updateMarcherShape } = useMutation(
        updateShapePagesMutationOptions(queryClient),
    );
    // Timeline mode plays and draws from the resolver, so it prefetches no page-mode keyframes
    // (P7.13). Appearances are still read per page in both modes.
    const timelineMode = useTimelineMode();
    const prefetchCoordinates = (
        page: Parameters<typeof coordinateDataQueryOptions>[0],
    ) => {
        if (!timelineMode)
            void queryClient.prefetchQuery(
                coordinateDataQueryOptions(page, queryClient),
            );
    };

    if (currentPage) {
        prefetchCoordinates(currentPage);
        void queryClient.prefetchQuery(
            marcherAppearancesQueryOptions(currentPage.id, queryClient),
        );
        if (currentPage.nextPageId != null) {
            const nextPage = pages.find(
                (page) => page.id === currentPage.nextPageId,
            );
            if (nextPage) {
                prefetchCoordinates(nextPage);
                void queryClient.prefetchQuery(
                    marcherAppearancesQueryOptions(nextPage.id, queryClient),
                );
            }
        }
        if (currentPage.previousPageId != null) {
            const previousPage = pages.find(
                (page) => page.id === currentPage.previousPageId,
            );
            if (previousPage) {
                prefetchCoordinates(previousPage);
                void queryClient.prefetchQuery(
                    marcherAppearancesQueryOptions(
                        previousPage.id,
                        queryClient,
                    ),
                );
            }
        }
    }

    /*******************************************************************/

    // Select page 0 (first page in show order) when none are selected (e.g. app load / refresh).
    // Timeline mode always has a page at the playhead once pages load, and opens on home below.
    useEffect(() => {
        if (currentPage == null && pages.length > 0) {
            goToPage(pages[0]);
        }
    }, [pages, currentPage, goToPage]);

    // Timeline mode (UI-9): opening a show selects home, with the playhead at beat 0
    useEffect(() => {
        useTimelineSelectionStore.getState().selectHome();
    }, []);

    // Select the currently selected audio file
    useEffect(() => {
        if (!selectedAudioFile) {
            AudioFile.getSelectedAudioFile().then((audioFile) => {
                setSelectedAudioFile({ ...audioFile, data: undefined });
            });
        }
    }, [selectedAudioFile, setSelectedAudioFile]);

    // Clear the selected marcher shapes when the page changes
    useEffect(() => {
        setSelectedShapePageIds([]);
    }, [currentPage, setSelectedShapePageIds]);

    useEffect(() => {
        MarcherShape.updateMarcherShapeFn = async (
            marcherShape: MarcherShape,
        ) => updateMarcherShape([marcherShapeToShapePageArgs(marcherShape)]);
    }, [updateMarcherShape]);

    return <></>; // Empty fragment
}

export default StateInitializer;
