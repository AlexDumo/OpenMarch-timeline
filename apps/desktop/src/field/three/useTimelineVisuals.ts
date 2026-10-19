import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import type { FieldProperties } from "@openmarch/core";
import type Page from "@/global/classes/Page";
import { db } from "@/global/database/db";
import { useCollisionStore } from "@/stores/CollisionStore";
import {
    displayedBeat,
    isolatedTimeline,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import {
    resolverSpans,
    useTimelineResolverStore,
} from "@/timeline/timelineStore";
import { followingAt, marcherSetBeats } from "@/timeline/timelineSetFollowing";
import { useKeptAssignmentsStore } from "@/timeline/useKeepLaterPages";
import { useTimelineFocusScene } from "@/timeline/useTimelineFocusScene";
import { ghostColorFor } from "@/timeline/useTimelineFocusScene";
import { useTimelinePathSamples } from "@/timeline/useTimelinePathSamples";
import {
    planCollisionOverlay,
    planFocusOverlay,
    planPathOverlay,
    type OverlayPlan,
} from "@/field/timelineOverlays";
import { FieldDimming } from "./fieldDimming";
import { FieldFollowing } from "./fieldFollowing";

/**
 * Everything the timeline draws on the field (fork #201): the selected page's
 * pathways, midpoints, endpoints and step-size warnings
 * (`useTimelinePathSamples`), an isolated move's focus scene
 * (`useTimelineFocusScene`, which also publishes the isolation plan the
 * playhead driver draws members at), collision markers (`useCollisionStore`),
 * who's dimmed, and who's Following (#300). Plans change on page changes,
 * edits and setting changes, never per frame; dimming and the Following look
 * go to the layers through {@link FieldDimming} and {@link FieldFollowing},
 * outside React.
 */
// eslint-disable-next-line max-lines-per-function
export function useTimelineVisuals({
    isPlaying,
    selectedPage,
    pages,
    marcherIds,
    fieldProperties,
}: {
    isPlaying: boolean;
    selectedPage: Page | null;
    pages: readonly Page[];
    marcherIds: readonly number[] | undefined;
    fieldProperties: FieldProperties | undefined;
}): {
    paths: OverlayPlan | null;
    focus: OverlayPlan | null;
    collisions: OverlayPlan | null;
    dimming: FieldDimming;
    following: FieldFollowing;
    /** Whether the resolver is ready: the timeline draws nothing before. */
    ready: boolean;
} {
    // Drawn from the resolver only once it's ready
    const ready = useTimelineResolverStore((s) => s.status === "ready");
    const settings = useUiSettingsStore(
        useShallow((s) => ({
            previousPaths: s.uiSettings.previousPaths,
            nextPaths: s.uiSettings.nextPaths,
            stepSizeWarnings: s.uiSettings.stepSizeWarnings,
            showCollisions: s.uiSettings.showCollisions,
        })),
    );
    // Isolation's own paths and ghosts replace the page's paths
    const isolating = useTimelineSelectionStore((s) => s.isolation !== null);
    const previousPathsEnabled = settings.previousPaths && !isolating;
    const nextPathsEnabled = settings.nextPaths && !isolating;
    const stepSizeWarningsEnabled = settings.stepSizeWarnings && !isolating;

    const { previousPaths, nextPaths } = useTimelinePathSamples({
        enabled: ready,
        isPlaying,
        selectedPage,
        pages,
        marcherIds,
        previousPathsEnabled,
        nextPathsEnabled,
        stepSizeWarningsEnabled,
    });
    const paths = useMemo(
        () =>
            ready && marcherIds && fieldProperties
                ? planPathOverlay({
                      marcherIds,
                      previousPaths,
                      nextPaths,
                      previousPathsEnabled,
                      nextPathsEnabled,
                      stepSizeWarningsEnabled,
                      fieldProperties,
                  })
                : null,
        [
            ready,
            marcherIds,
            previousPaths,
            nextPaths,
            previousPathsEnabled,
            nextPathsEnabled,
            stepSizeWarningsEnabled,
            fieldProperties,
        ],
    );

    const { scene, emphasis } = useTimelineFocusScene({
        database: db,
        enabled: ready,
    });
    const theme = fieldProperties?.theme;
    const focus = useMemo(
        () =>
            scene && theme
                ? planFocusOverlay(scene, ghostColorFor(theme), emphasis)
                : null,
        [scene, theme, emphasis],
    );

    // The selected page's collisions
    const { currentCollisions, setCurrentCollision } = useCollisionStore();
    useEffect(() => {
        setCurrentCollision(selectedPage);
    }, [selectedPage, setCurrentCollision]);
    const collisions = useMemo(
        () =>
            !isPlaying && settings.showCollisions && currentCollisions.length
                ? planCollisionOverlay(currentCollisions)
                : null,
        [isPlaying, settings.showCollisions, currentCollisions],
    );

    const dimming = useFieldDimming(ready);
    const following = useFieldFollowing(ready, isPlaying);
    return { paths, focus, collisions, dimming, following, ready };
}

/**
 * UI-9: while a move is isolated, the marchers outside it are dimmed, once the
 * resolver is ready. Follows the timeline selection store outside React;
 * `FieldDimming` ignores updates that keep the same members, such as the
 * window moving inside the move.
 */
function useFieldDimming(enabled: boolean): FieldDimming {
    const dimming = useMemo(() => new FieldDimming(), []);
    useEffect(() => {
        const update = () => {
            const isolated = enabled
                ? isolatedTimeline(useTimelineSelectionStore.getState())
                : null;
            dimming.set(isolated?.marcherIds ?? null);
        };
        update();
        return useTimelineSelectionStore.subscribe((state, previous) => {
            if (
                state.isolation !== previous.isolation ||
                state.storedTimelines !== previous.storedTimelines
            )
                update();
        });
    }, [dimming, enabled]);
    return dimming;
}

/**
 * #300: while paused or scrubbing, the marchers with no coordinate of their
 * own on the count shown are Following, drawn with a dashed edge; playing, nobody is. Each
 * marcher's Set beats are worked out once per resolver version and kept
 * markers, so a playhead move only looks them up, and `FieldFollowing`
 * redraws only when who's Following changes. Stopping eases the dashes in
 * (#302), unless the system asks for reduced motion.
 */
function useFieldFollowing(ready: boolean, isPlaying: boolean): FieldFollowing {
    const following = useMemo(() => new FieldFollowing(), []);
    const played = useRef(false);
    const enabled = ready && !isPlaying;
    useEffect(() => {
        if (!enabled) {
            if (isPlaying) played.current = true;
            following.set(null);
            return;
        }
        // Only the first look after playback eases in; later ones are instant
        let ease = played.current && !prefersReducedMotion();
        played.current = false;
        let setBeats: Map<number, readonly number[]> | null = null;
        const update = () => {
            const { resolver } = useTimelineResolverStore.getState();
            if (!resolver) {
                following.set(null);
                return;
            }
            if (!setBeats) {
                const kept = useKeptAssignmentsStore.getState().ids;
                setBeats = new Map(
                    resolver
                        .marcherIds()
                        .map((id) => [
                            id,
                            marcherSetBeats(
                                resolverSpans(resolver, id),
                                (beat) => resolver.positionAt(id, beat),
                                kept,
                            ),
                        ]),
                );
            }
            following.set(
                followingAt(
                    setBeats,
                    displayedBeat(useTimelineSelectionStore.getState()),
                ),
                { ease },
            );
            ease = false;
        };
        // Called inside the stores' writes: a failed update mustn't stop their other listeners
        const safely = (fresh: boolean) => {
            if (fresh) setBeats = null;
            try {
                update();
            } catch (error) {
                console.error("Error finding the Following marchers", error);
            }
        };
        safely(true);
        const unsubscribes = [
            useTimelineResolverStore.subscribe((state, previous) => {
                if (
                    state.version !== previous.version ||
                    state.resolver !== previous.resolver
                )
                    safely(true);
            }),
            useKeptAssignmentsStore.subscribe((state, previous) => {
                if (state.ids !== previous.ids) safely(true);
            }),
            useTimelineSelectionStore.subscribe((state, previous) => {
                if (displayedBeat(state) !== displayedBeat(previous))
                    safely(false);
            }),
        ];
        return () => {
            for (const unsubscribe of unsubscribes) unsubscribe();
        };
    }, [following, enabled, isPlaying]);
    return following;
}

const prefersReducedMotion = () =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
