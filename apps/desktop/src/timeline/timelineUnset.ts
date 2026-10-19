import { useMemo } from "react";
import type { Resolver } from "@openmarch/core";
import { db } from "@/global/database/db";
import type { DbConnection } from "@/db-functions/types";
import {
    unsetMarchersAt,
    type UnsetResult,
} from "@/db-functions/timelineUnset";
import { isBasicMode } from "@/stores/EditorModeStore";
import {
    displayedBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { lockedOnBox, useBasicLocksStore } from "./basicLocks";
import { toastBasicLock } from "./basicLockToast";
import { toastTimelineError } from "./timelineErrorMessages";
import { isSetAt, marcherSetBeats } from "./timelineSetFollowing";
import { resolverSpans, useTimelineResolverStore } from "./timelineStore";
import { applyKeptChange, useKeptAssignmentsStore } from "./useKeepLaterPages";

/**
 * **Unset here** as the UI runs it (Set vs Following, #300 and #304): the selected marchers that
 * are Set on the playhead's count lose that coordinate and follow from earlier, while later pages
 * keep their spots (`unsetMarchersAt`). One undo step; a refusal is a toast, never thrown.
 */

const NOTHING: UnsetResult = { unset: [], markers: { added: [], removed: [] } };

/**
 * Of `marcherIds`, the ones Set at `beat` (`timelineSetFollowing`), ascending: what Unset acts on.
 * None on the first page (beat 0), where everyone is Set but nobody has a move to take back.
 */
export function unsetTargets({
    resolver,
    kept,
    marcherIds,
    beat,
}: {
    resolver: Resolver | null;
    kept: ReadonlySet<number>;
    marcherIds: readonly number[];
    beat: number;
}): number[] {
    if (!resolver || beat <= 0) return [];
    return marcherIds
        .filter((id) =>
            isSetAt(
                marcherSetBeats(
                    resolverSpans(resolver, id),
                    (b) => resolver.positionAt(id, b),
                    kept,
                ),
                beat,
            ),
        )
        .sort((a, b) => a - b);
}

/** `unsetTargets` for `marcherIds` at the count shown, kept current. */
export function useUnsetTargets(marcherIds: readonly number[]): number[] {
    const resolver = useTimelineResolverStore((s) => s.resolver);
    const version = useTimelineResolverStore((s) => s.version);
    const kept = useKeptAssignmentsStore((s) => s.ids);
    const beat = useTimelineSelectionStore(displayedBeat);
    return useMemo(() => {
        void version; // a new version means new spans
        return unsetTargets({ resolver, kept, marcherIds, beat });
    }, [resolver, version, kept, marcherIds, beat]);
}

/** The page box holding `beat` (`start < beat ≤ end`), from the Basic locks' boxes. */
const boxHolding = (beat: number) =>
    useBasicLocksStore
        .getState()
        .boxes.find((b) => b.start < beat && beat <= b.end);

/**
 * **Unset here** for `marcherIds` at the count shown. In Basic, marchers locked on the page (their
 * moves there need Expert) are left alone with the lock toast, and a shared move's slot is taken
 * out rather than left vacant.
 */
export async function unsetHere(
    marcherIds: readonly number[],
    database: DbConnection = db,
): Promise<UnsetResult> {
    const beat = displayedBeat(useTimelineSelectionStore.getState());
    let targets = unsetTargets({
        resolver: useTimelineResolverStore.getState().resolver,
        kept: useKeptAssignmentsStore.getState().ids,
        marcherIds,
        beat,
    });
    const basic = isBasicMode();
    if (basic) {
        const box = boxHolding(beat);
        const locked = box ? lockedOnBox(box) : new Map<number, unknown>();
        const skipped = targets.filter((id) => locked.has(id));
        if (skipped.length > 0) {
            targets = targets.filter((id) => !locked.has(id));
            toastLockedUnset(skipped.length, targets.length > 0);
        }
    }
    if (targets.length === 0) return NOTHING;
    try {
        const result = await unsetMarchersAt({
            db: database,
            beat,
            marcherIds: targets,
            tidyShared: basic,
        });
        applyKeptChange(result.markers);
        return result;
    } catch (error) {
        toastTimelineError(error, "Error unsetting the marchers");
        return NOTHING;
    }
}

/** Basic's lock toast for marchers Unset left alone (as `toastLockedMarchers`). */
function toastLockedUnset(count: number, wrote: boolean): void {
    const who = count === 1 ? "One marcher uses" : `${count} marchers use`;
    toastBasicLock(
        `${who} Expert moves on this page${wrote ? `, so ${count === 1 ? "it wasn't" : "they weren't"} unset` : ""}. Switch to Expert to edit ${count === 1 ? "it" : "them"}.`,
    );
}
