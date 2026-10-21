// PROTOTYPE (fork #357 spike): throwaway, do not build on this.
//
// Mounted inside the show's providers (App.tsx). Pushes the React-only state commands need into
// the ctx slot (ctx.ts). Its existence is itself a finding: without it no command can select,
// undo, read "playing" or change page.

import { useEffect, useLayoutEffect, useRef } from "react";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useSelectedPage } from "@/context/SelectedPageContext";
import { usePerformHistoryAction } from "@/hooks/queries/useHistory";
import { notifySelectionCommitted, setReactSlot } from "./ctx";

export default function CommandsProtoBridge() {
    const selected = useSelectedMarchers();
    const playing = useIsPlaying();
    const page = useSelectedPage();
    const { mutateAsync: performHistoryAction } = usePerformHistoryAction();
    const latest = useRef({ selected, playing, page, performHistoryAction });
    useLayoutEffect(() => {
        latest.current = { selected, playing, page, performHistoryAction };
    });

    useEffect(() => {
        setReactSlot({
            selectedMarchers: () =>
                latest.current.selected?.selectedMarchers ?? [],
            setSelectedMarchers: (m) =>
                latest.current.selected?.setSelectedMarchers(m),
            isPlaying: () => latest.current.playing?.isPlaying ?? false,
            setSelectedPage: (p) =>
                latest.current.page?.setSelectedPage(p) ?? false,
            undo: () => latest.current.performHistoryAction("undo"),
            redo: () => latest.current.performHistoryAction("redo"),
        });
        return () => setReactSlot(null);
    }, []);

    // The selection is useState: a command that sets it can only read it back after this commit
    useLayoutEffect(() => {
        notifySelectionCommitted();
    }, [selected?.selectedMarchers]);

    return null;
}
