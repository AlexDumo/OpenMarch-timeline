import React, { useEffect, useMemo, useRef, useState } from "react";
import { T, useTranslate } from "@tolgee/react";
import { useCurrentPage } from "../../context/SelectedPageContext";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { updatePagesMutationOptions } from "../../hooks/queries";
import { NotesRichTextEditor } from "../notes/NotesRichTextEditor";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useTimingObjects } from "@/hooks";
import { useTimelineMode } from "@/hooks/queries/useWorkspaceSettings";
import { getLivePlaybackPosition } from "@/components/timeline/audio/AudioPlayer";
import { beatAtTime } from "@/timeline/timeMap";
import { pageAtPlayhead } from "@/timeline/timelinePlayhead";
import type Page from "@/global/classes/Page";

/**
 * Timeline mode (UI-9 No selected page): while playing, the page whose box holds the live playback
 * position, checked each frame and updated only when it changes. `null` while paused, or in page
 * mode.
 */
function useLivePlaybackPage(enabled: boolean): Page | null {
    const { pages, beats } = useTimingObjects()!;
    const [page, setPage] = useState<Page | null>(null);
    useEffect(() => {
        if (!enabled) {
            setPage(null);
            return;
        }
        let frame = 0;
        const step = () => {
            const beat = beatAtTime(beats, getLivePlaybackPosition());
            const live = Number.isNaN(beat)
                ? null
                : pageAtPlayhead(pages, beat);
            setPage((current) => (current?.id === live?.id ? current : live));
            frame = requestAnimationFrame(step);
        };
        step();
        return () => cancelAnimationFrame(frame);
    }, [enabled, pages, beats]);
    return page;
}

export function PageNotesSection() {
    const currentPage = useCurrentPage();
    const { isPlaying } = useIsPlaying()!;
    const { pages } = useTimingObjects()!;
    const timelineMode = useTimelineMode();
    const livePage = useLivePlaybackPage(timelineMode && isPlaying);
    const { t } = useTranslate();
    const queryClient = useQueryClient();
    const updatePagesMutation = useMutation(
        updatePagesMutationOptions(queryClient),
    );

    // During playback, page mode's currentPage is the departure page — show the next page's notes
    // instead. Timeline mode's playhead doesn't move while playing, so it shows the notes of the
    // page being played (whose box holds the live position), which follows a loop back too.
    const displayPage = useMemo(() => {
        if (timelineMode) return (isPlaying && livePage) || currentPage;
        if (!isPlaying || !currentPage?.nextPageId) return currentPage;
        return (
            pages.find((p) => p.id === currentPage.nextPageId) ?? currentPage
        );
    }, [timelineMode, isPlaying, livePage, currentPage, pages]);

    const [notes, setNotes] = useState(displayPage?.notes || "");
    const editingPageIdRef = useRef<number | null>(null);

    useEffect(() => {
        if (displayPage && (isPlaying || editingPageIdRef.current === null)) {
            setNotes(displayPage.notes || "");
        }
    }, [displayPage, isPlaying]);

    const handleNotesBlur = (nextNotesHtml: string) => {
        if (!displayPage) return;

        // Guard: only save if we're still on the page where editing began
        const pageIdWhereEditingBegan = editingPageIdRef.current;
        if (
            pageIdWhereEditingBegan === null ||
            pageIdWhereEditingBegan !== displayPage.id
        ) {
            editingPageIdRef.current = null;
            if (pageIdWhereEditingBegan !== null) {
                console.warn("Page changed during editing, skipping save");
                setNotes(displayPage.notes || "");
            }
            return;
        }

        const currentNotes = nextNotesHtml || "";
        const originalNotes = displayPage.notes || "";

        if (currentNotes === originalNotes) {
            editingPageIdRef.current = null;
            return;
        }

        setNotes(currentNotes);
        updatePagesMutation.mutate(
            {
                modifiedPagesArgs: [
                    {
                        id: pageIdWhereEditingBegan,
                        notes: currentNotes || null,
                    },
                ],
            },
            {
                onSettled: () => {
                    editingPageIdRef.current = null;
                },
            },
        );
    };

    if (!displayPage) return null;

    return (
        <section aria-label={t("inspector.page.notes")}>
            <div className="border-stroke border-t pt-12">
                <h3 className="text-h5 text-text mb-8">
                    <T keyName="inspector.page.notes" />
                </h3>
                <div className="input-group">
                    <NotesRichTextEditor
                        value={notes}
                        editable={!isPlaying}
                        onChange={setNotes}
                        onBlur={handleNotesBlur}
                        onEditorFocus={() => {
                            if (displayPage) {
                                editingPageIdRef.current = displayPage.id;
                            }
                        }}
                    />
                </div>
            </div>
        </section>
    );
}
