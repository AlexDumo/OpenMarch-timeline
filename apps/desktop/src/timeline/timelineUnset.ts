import { useMemo } from "react";
import type { Resolver } from "@openmarch/core";
import { db } from "@/global/database/db";
import tolgee from "@/global/singletons/Tolgee";
import type { DbConnection } from "@/db-functions/types";
import {
    unsetMarchersAt,
    type UnsetResult,
} from "@/db-functions/timelineUnset";
import { isBasicMode } from "@/stores/EditorModeStore";
import {
    displayedBeat,
    useTimelineSelectionStore,
    type PageBox,
} from "@/stores/TimelineSelectionStore";
import { lockedOnBox, useBasicLocksStore } from "./basicLocks";
import { toastBasicLock } from "./basicLockToast";
import { toastTimelineError } from "./timelineErrorMessages";
import {
    followingPages,
    pageKeepStates,
    type KeepTranslate,
} from "./timelineKeepLater";
import { keepPagesOfBoxes } from "./timelineOnlyThisPage";
import { isSetAt, marcherSetBeats } from "./timelineSetFollowing";
import { resolverSpans, useTimelineResolverStore } from "./timelineStore";
import { applyKeptChange, useKeptAssignmentsStore } from "./useKeepLaterPages";

/**
 * **Unset here** as the UI runs it (Set vs Following, #300 and #304): the selected marchers that
 * are Set on the playhead's count lose that coordinate and follow from earlier, while later pages
 * keep their spots (`unsetMarchersAt`). **Unset here and on Pages N–M** (#305) lets the later
 * pages that followed the spot follow back instead, and is offered only when some do
 * (`unsetFollowingPages`). Each is one undo step; a refusal is a toast, never thrown.
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

/**
 * The pages that follow the spot `marcherIds` have at `beat`, in page order: for the ones Set
 * there (`unsetTargets`), the page boxes after the one holding `beat`, in a row, that some of them
 * follow into without a move of their own (`followingPages`, as the keep chains and **Only Page
 * N** read it). What **Unset here and on Pages N–M** lets follow back; null when none follow.
 */
export function unsetFollowingPages({
    resolver,
    kept,
    marcherIds,
    beat,
    boxes,
}: {
    resolver: Resolver | null;
    kept: ReadonlySet<number>;
    marcherIds: readonly number[];
    beat: number;
    boxes: readonly PageBox[];
}): string[] | null {
    const targets = unsetTargets({ resolver, kept, marcherIds, beat });
    if (!resolver || targets.length === 0) return null;
    const pages = keepPagesOfBoxes(boxes);
    const holding = pages.find(
        (p) => p.range && p.range.start < beat && beat <= p.flag,
    );
    if (!holding) return null;
    // Later pages follow the spot only if nothing of the marcher's own ends after it in this page
    const flag = holding.flag;
    const lastInPage = targets.filter(
        (id) =>
            !resolverSpans(resolver, id).some(
                (s) => s.kind !== "hold" && s.end > beat && s.end <= flag,
            ),
    );
    if (lastInPage.length === 0) return null;
    const states = pageKeepStates({
        pages,
        marcherIds: lastInPage,
        spansOf: (id) => resolverSpans(resolver, id),
        kept,
    });
    return followingPages(states, holding.id)?.names ?? null;
}

/** **Unset here and on Pages N–M**'s label for the pages that follow (`unsetFollowingPages`). */
export function unsetFollowingLabel(
    pages: readonly string[],
    translate: KeepTranslate = (key, defaultValue, params) =>
        tolgee.t(key, defaultValue, params),
): string {
    const first = pages[0] ?? "";
    const last = pages[pages.length - 1] ?? first;
    return first === last
        ? translate(
              "actions.timeline.unsetHereAndPage",
              "Remove keyframe, Page {page} follows back",
              { page: first },
          )
        : translate(
              "actions.timeline.unsetHereAndPages",
              "Remove keyframe, Pages {first}–{last} follow back",
              { first, last },
          );
}

/** `unsetFollowingPages` for `marcherIds` at the count shown, kept current. */
export function useUnsetFollowingPages(
    marcherIds: readonly number[],
): string[] | null {
    const resolver = useTimelineResolverStore((s) => s.resolver);
    const version = useTimelineResolverStore((s) => s.version);
    const kept = useKeptAssignmentsStore((s) => s.ids);
    const beat = useTimelineSelectionStore(displayedBeat);
    const boxes = useTimelineSelectionStore((s) => s.pageBoxes);
    return useMemo(() => {
        void version; // a new version means new spans
        return unsetFollowingPages({
            resolver,
            kept,
            marcherIds,
            beat,
            boxes,
        });
    }, [resolver, version, kept, marcherIds, beat, boxes]);
}

/**
 * A keyframe diamond's menu at `beat` (#306), as the inspector offers the Unset actions at the count
 * shown: **Unset here** where some of `marcherIds` are Set at `beat`, and the second entry's label
 * where pages follow (`unsetFollowingPages`). Neither while playing.
 */
export function unsetMenuStateAt({
    isPlaying,
    ...at
}: Parameters<typeof unsetFollowingPages>[0] & { isPlaying: boolean }): {
    canUnset: boolean;
    followingLabel: string | null;
} {
    if (isPlaying) return { canUnset: false, followingLabel: null };
    const following = unsetFollowingPages(at);
    return {
        canUnset: unsetTargets(at).length > 0,
        followingLabel: following ? unsetFollowingLabel(following) : null,
    };
}

/**
 * A keyframe diamond's menu for `marcherIds` (#306), by spec beat: `unsetMenuStateAt` read when
 * it opens, and the Unset actions at the diamond's count, leaving the playhead where it is.
 */
export function useKeyframeUnsetMenu(
    marcherIds: readonly number[],
    isPlaying: boolean,
) {
    return useMemo(
        () => ({
            stateFor: (beat: number) =>
                unsetMenuStateAt({
                    resolver: useTimelineResolverStore.getState().resolver,
                    kept: useKeptAssignmentsStore.getState().ids,
                    boxes: useTimelineSelectionStore.getState().pageBoxes,
                    marcherIds,
                    beat,
                    isPlaying,
                }),
            onUnset: (beat: number) => void unsetHere(marcherIds, { beat }),
            onUnsetAndFollowing: (beat: number) =>
                void unsetHereAndFollowing(marcherIds, { beat }),
        }),
        [marcherIds, isPlaying],
    );
}

/** The page box holding `beat` (`start < beat ≤ end`), from the Basic locks' boxes. */
const boxHolding = (beat: number) =>
    useBasicLocksStore
        .getState()
        .boxes.find((b) => b.start < beat && beat <= b.end);

/** Where an Unset acts: the count shown unless `beat` names another (a keyframe diamond's, #306) */
export interface UnsetOptions {
    readonly beat?: number;
    readonly database?: DbConnection;
}

/**
 * **Unset here** for `marcherIds` at the count shown, or at `beat` without moving the playhead. In
 * Basic, marchers locked on the page (their moves there need Expert) are left alone with the lock
 * toast, and a shared move's slot is taken out rather than left vacant.
 */
export function unsetHere(
    marcherIds: readonly number[],
    options: UnsetOptions = {},
): Promise<UnsetResult> {
    return unsetSetMarchers(marcherIds, true, options);
}

/**
 * **Unset here and on Pages N–M** for `marcherIds` at the count shown (or `beat`): as
 * `unsetHere`, but the later pages that followed the spot follow back to the earlier one.
 */
export function unsetHereAndFollowing(
    marcherIds: readonly number[],
    options: UnsetOptions = {},
): Promise<UnsetResult> {
    return unsetSetMarchers(marcherIds, false, options);
}

async function unsetSetMarchers(
    marcherIds: readonly number[],
    keepLaterPages: boolean,
    {
        beat = displayedBeat(useTimelineSelectionStore.getState()),
        database = db,
    }: UnsetOptions,
): Promise<UnsetResult> {
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
            keepLaterPages,
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
