import { useMemo } from "react";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import {
    unsetFollowingLabel,
    unsetHere,
    unsetHereAndFollowing,
    useUnsetFollowingPages,
    useUnsetTargets,
} from "@/timeline/timelineUnset";
import { useActionHandler } from "../useActionHandler";

/** Set vs Following (#304, #305): **Unset here** and **Unset here and on Pages N–M** */
export function useUnsetActionHandlers() {
    const selected = useSelectedMarchers()?.selectedMarchers;
    const marcherIds = useMemo(
        () => (selected ?? []).map((m) => m.id),
        [selected],
    );
    const targets = useUnsetTargets(marcherIds);
    const following = useUnsetFollowingPages(marcherIds);
    const isPlaying = useIsPlaying()?.isPlaying ?? false;

    // Only the selected marchers Set on the count shown; off when none is
    useActionHandler("timelineUnsetHere", () => void unsetHere(marcherIds), {
        enabled: !isPlaying && targets.length > 0,
    });
    // Only when some later pages follow their spot, and the label names them
    useActionHandler(
        "timelineUnsetHereAndFollowing",
        () => void unsetHereAndFollowing(marcherIds),
        {
            enabled: !isPlaying && following !== null,
            label: following ? unsetFollowingLabel(following) : undefined,
        },
    );
}
