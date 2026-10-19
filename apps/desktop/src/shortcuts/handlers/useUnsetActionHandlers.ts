import { useMemo } from "react";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { unsetHere, useUnsetTargets } from "@/timeline/timelineUnset";
import { useActionHandler } from "../useActionHandler";

/** Set vs Following (#304): **Unset here** */
export function useUnsetActionHandlers() {
    const selected = useSelectedMarchers()?.selectedMarchers;
    const marcherIds = useMemo(
        () => (selected ?? []).map((m) => m.id),
        [selected],
    );
    const targets = useUnsetTargets(marcherIds);
    const isPlaying = useIsPlaying()?.isPlaying ?? false;

    // Only the selected marchers Set on the count shown; off when none is
    useActionHandler("timelineUnsetHere", () => void unsetHere(marcherIds), {
        enabled: !isPlaying && targets.length > 0,
    });
}
