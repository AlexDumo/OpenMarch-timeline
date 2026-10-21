// PROTOTYPE (fork #357 spike): throwaway, do not build on this.
//
// Builds the CommandCtx handed to run(). Stores and modules are read directly; the pieces that
// only exist as React state or hooks are pushed in by <CommandsProtoBridge/> (bridge.tsx) while
// a show is open. Each `FROM REACT` marks a FINDINGS.md section 1 entry.

import { db } from "@/global/database/db";
import { queryClient } from "@/App";
import type Marcher from "@/global/classes/Marcher";
import { allMarcherRowsQueryOptions } from "@/hooks/queries/useMarchers";
import { useEditorModeStore } from "@/stores/EditorModeStore";
import { useWorkspaceViewStore } from "@/stores/WorkspaceViewStore";
import { usePreviewModeStore } from "@/stores/PreviewModeStore";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import { useAppDialogStore, type ExportTab } from "@/stores/AppDialogStore";
import { useFieldViewStore } from "@/field/three/fieldView";
import { setView } from "@/field/three/fieldNavigation";
import { isWebBuild } from "@/utilities/webBuild";
import type { CommandCtx } from "./contract";

/** What only React has. Null while no show is open (the providers aren't mounted). */
export interface ReactSlot {
    // FROM REACT: SelectedMarchersContext is useState (context/SelectedMarchersContext.tsx:47)
    selectedMarchers: () => Marcher[];
    setSelectedMarchers: (m: Marcher[]) => void;
    // FROM REACT: IsPlayingContext is useState (context/IsPlayingContext.tsx:14)
    isPlaying: () => boolean;
    // FROM REACT: SelectedPageContext is useState (context/SelectedPageContext.tsx:35)
    setSelectedPage: (page: { id: number }) => boolean;
    // FROM REACT: undo needs usePerformHistoryAction (hooks/queries/useHistory.ts:107), which
    // reads selection + page contexts to restore focus
    undo: () => Promise<unknown>;
    redo: () => Promise<unknown>;
}

let slot: ReactSlot | null = null;
const selectionWaiters = new Set<() => void>();

export function setReactSlot(next: ReactSlot | null) {
    slot = next;
}

/** The bridge calls this on every render where the selection changed */
export function notifySelectionCommitted() {
    selectionWaiters.forEach((w) => w());
    selectionWaiters.clear();
}

export function hasReactSlot() {
    return slot !== null;
}

export function buildCtx(): CommandCtx {
    const s = slot;
    const preview = usePreviewModeStore.getState().isPreview;
    const mode = useEditorModeStore.getState().mode ?? "expert";
    const visuals =
        useWorkspaceViewStore.getState().view === "visuals" && mode !== "basic";
    const tl = useTimelineSelectionStore.getState();
    return {
        db,
        // GLOBAL: exported from App.tsx:72 on main, importing App drags the whole app into this module
        queryClient,
        fileOpen: s !== null,
        mode,
        workspace: preview ? "preview" : visuals ? "visuals" : "editor",
        resolverStatus: useTimelineResolverStore.getState().status,
        playheadBeat: tl.playheadBeat,
        isPlaying: s?.isPlaying() ?? false,
        selection: {
            ids: () => (s?.selectedMarchers() ?? []).map((m) => m.id),
            set: async (ids) => {
                if (!s) throw new Error("no show open");
                const rows = await queryClient.fetchQuery(
                    allMarcherRowsQueryOptions(),
                );
                const want = new Set(ids);
                // A setter that takes rows, not ids: rows of marchers created a moment ago are
                // only in the cache once the marcher queries fetched again
                const picked = rows.filter((m) => want.has(m.id));
                const committed = new Promise<void>((resolve) => {
                    selectionWaiters.add(resolve);
                    setTimeout(resolve, 500);
                });
                s.setSelectedMarchers(picked);
                // useState: the value is only readable after React commits
                await committed;
            },
        },
        marchers: () => queryClient.fetchQuery(allMarcherRowsQueryOptions()),
        view: {
            focusField: (rect) => {
                const { width, height } = useFieldViewStore.getState();
                if (width <= 0 || height <= 0) return false;
                const pad = 60;
                const w = rect.maxX - rect.minX + pad * 2;
                const h = rect.maxY - rect.minY + pad * 2;
                const zoom = Math.min(width / w, height / h, 4);
                const cx = (rect.minX + rect.maxX) / 2;
                const cy = (rect.minY + rect.maxY) / 2;
                setView({
                    width,
                    height,
                    zoom,
                    panX: width / 2 - cx * zoom,
                    panY: height / 2 - cy * zoom,
                });
                return true;
            },
        },
        dialogs: {
            openExport: (tab) =>
                useAppDialogStore.getState().openExport(tab as ExportTab),
        },
        pages: {
            select: (id) => {
                if (!s) throw new Error("no show open");
                s.setSelectedPage({ id });
            },
        },
        history: {
            undo: () => {
                if (!s) throw new Error("no show open");
                return s.undo();
            },
            redo: () => {
                if (!s) throw new Error("no show open");
                return s.redo();
            },
        },
        isWebBuild,
    };
}
