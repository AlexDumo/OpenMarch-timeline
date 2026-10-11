import React, { useEffect, useMemo, useRef, useState } from "react";
import { T, useTranslate } from "@tolgee/react";
import { useSelectedPage } from "../../context/SelectedPageContext";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { updatePagesMutationOptions } from "../../hooks/queries";
import { NotesRichTextEditor } from "../notes/NotesRichTextEditor";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useTimingObjects } from "@/hooks";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";

/** Whether notes HTML from the editor has any text in it */
const hasText = (html: string) =>
    new DOMParser().parseFromString(html, "text/html").body.textContent?.trim()
        .length;

export function PageNotesSection() {
    const { selectedPage } = useSelectedPage()!;
    const { isPlaying } = useIsPlaying()!;
    const { pages } = useTimingObjects()!;
    const { t } = useTranslate();
    const { uiSettings, setUiSettings } = useUiSettingsStore();
    const collapsed = uiSettings.pageNotesCollapsed;
    const queryClient = useQueryClient();
    const updatePagesMutation = useMutation(
        updatePagesMutationOptions(queryClient),
    );

    // During playback, selectedPage is the departure page — show the next page's notes instead
    const displayPage = useMemo(() => {
        if (!isPlaying || !selectedPage?.nextPageId) return selectedPage;
        return (
            pages.find((p) => p.id === selectedPage.nextPageId) ?? selectedPage
        );
    }, [isPlaying, selectedPage, pages]);

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
                <button
                    type="button"
                    aria-expanded={!collapsed}
                    onClick={() =>
                        setUiSettings({
                            ...uiSettings,
                            pageNotesCollapsed: !collapsed,
                        })
                    }
                    className="focus-visible:text-accent text-text flex w-full items-center justify-between outline-hidden"
                >
                    <h3 className="text-h5 flex items-center gap-6">
                        <T keyName="inspector.page.notes" />
                        {/* Collapsed, a dot says this page has notes */}
                        {collapsed && hasText(notes) ? (
                            <span
                                aria-hidden
                                className="bg-accent size-6 rounded-full"
                            />
                        ) : null}
                    </h3>
                    {collapsed ? (
                        <CaretUpIcon size={18} />
                    ) : (
                        <CaretDownIcon size={18} />
                    )}
                </button>
                {collapsed ? null : (
                    <div className="input-group mt-8">
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
                )}
            </div>
        </section>
    );
}
