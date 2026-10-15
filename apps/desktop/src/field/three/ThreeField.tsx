import {
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    type RefObject,
} from "react";
import clsx from "clsx";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { OrthographicCamera } from "three";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_FIELD_THEME, type FieldProperties } from "@openmarch/core";
import { useSelectedPage } from "@/context/SelectedPageContext";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useFullscreenStore } from "@/stores/FullscreenStore";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import {
    allMarchersQueryOptions,
    fieldPropertiesQueryOptions,
} from "@/hooks/queries";
import { useDatabaseReady } from "@/hooks/useDatabaseReady";
import { useTimingObjects } from "@/hooks";
import { useMarcherAppearanceSteps } from "@/hooks/useMarcherAppearanceSteps";
import type { AppearanceStepsByMarcherId } from "@/services/appearance/appearanceSteps";
import { getLivePlaybackPosition } from "@/components/timeline/audio/AudioPlayer";
import TimelineIsolationBar, {
    TimelineFromStartBadge,
} from "@/components/timeline/TimelineIsolationBar";
import {
    displayedBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import { useIsolationPlanStore } from "@/timeline/timelineIsolationPlan";
import { playbackBeat } from "@/timeline/positionBuffer";
import type { BeatTiming } from "@/timeline/timeMap";
import { installFieldTestApi } from "@/field/fieldTestApi";
import { FieldMarchers } from "./fieldMarchers";
import { cameraBounds, useFieldViewStore } from "./fieldView";
import {
    attachFieldNavigation,
    fitFullscreen,
    resetView,
} from "./fieldNavigation";
import { GlyphAtlas } from "./sdfText";
import { createThreeFieldTestApi } from "./threeFieldTestApi";
import FieldLayer from "./layers/FieldLayer";
import MarchersLayer from "./layers/MarchersLayer";
import LabelsLayer from "./layers/LabelsLayer";

/** fabric's fonts: the marcher and checkpoint labels' monospace, and its default for yard numbers. */
const LABEL_FONT = 'bold "Courier New", monospace';
const NUMBER_FONT = '"Times New Roman", serif';

/**
 * The three.js field (ADR 0005), behind the dev switch in `fieldRenderer.ts`.
 * #192, the tracer bullet: it draws the field, and every marcher and its label
 * at the playhead, and installs the field test API. #199: each marcher in its
 * appearance at the playhead (the last flag crossed, `appearanceSteps`).
 *
 * Guard rails (ADR 0005 D-2): it draws only on demand (`frameloop="demand"`;
 * playback and changes invalidate), there's one component per layer, and
 * positions reach the GPU through {@link FieldMarchers} in frame hooks, never
 * through React state.
 */
export default function ThreeField() {
    const databaseReady = useDatabaseReady();
    const { data: fieldProperties } = useQuery(
        fieldPropertiesQueryOptions(databaseReady),
    );
    const { data: marcherRows } = useQuery(allMarchersQueryOptions());
    const { selectedPage } = useSelectedPage()!;
    const { isPlaying } = useIsPlaying()!;
    const { beats } = useTimingObjects()!;
    const isFullscreen = useFullscreenStore((s) => s.isFullscreen);
    const appearanceSteps = useMarcherAppearanceSteps(true);

    const marchers = useMemo(() => new FieldMarchers(), []);
    const labels = useMemo(
        () =>
            new Map(
                (marcherRows ?? []).map((marcher) => [
                    marcher.id,
                    marcher.drill_number,
                ]),
            ),
        [marcherRows],
    );
    const atlases = useMemo(
        () => ({
            label: new GlyphAtlas(LABEL_FONT),
            number: new GlyphAtlas(NUMBER_FONT),
        }),
        [],
    );
    useEffect(
        () => () => {
            atlases.label.dispose();
            atlases.number.dispose();
        },
        [atlases],
    );

    // The field test API reads the latest of these, not the render they came from
    const element = useRef<HTMLElement | null>(null);
    const latest = useRef({
        labels,
        pageId: selectedPage?.id ?? null,
        theme: fieldProperties?.theme,
    });
    latest.current = {
        labels,
        pageId: selectedPage?.id ?? null,
        theme: fieldProperties?.theme,
    };
    useEffect(() => {
        installFieldTestApi(
            createThreeFieldTestApi({
                marchers,
                labels: () => latest.current.labels,
                view: () => useFieldViewStore.getState(),
                element: () => element.current,
                pageId: () => latest.current.pageId,
                theme: () => latest.current.theme ?? DEFAULT_FIELD_THEME,
            }),
        );
        return () => installFieldTestApi(undefined);
    }, [marchers]);

    // Navigation (#194): wheel, pan drags and touch anywhere on the field
    const root = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!root.current) return;
        return attachFieldNavigation(
            root.current,
            () => element.current,
            () => useUiSettingsStore.getState().uiSettings.mouseSettings,
        );
    }, []);
    // The view opens as Fabric's canvas, which it creates once the field and a
    // page are loaded
    const ready = !!fieldProperties && !!selectedPage;
    useFullscreenFit(root, isFullscreen, ready);

    return (
        <div
            ref={root}
            // As the Fabric field: fullscreen leaves room above the field, and
            // the field takes no input there
            className={clsx(
                "rounded-6 relative h-full w-full touch-none overflow-hidden",
                isFullscreen && "pointer-events-none pt-128",
            )}
            data-testid="threeField"
        >
            <TimelineIsolationBar />
            <TimelineFromStartBadge />
            {fieldProperties && (
                <Canvas
                    // As the Fabric field's canvas, for the scenarios
                    data-testid="fieldCanvas"
                    frameloop="demand"
                    orthographic
                    // Bounds given here make the camera manual: `FieldCamera` sets them
                    camera={{
                        left: 0,
                        right: 1,
                        top: 0,
                        bottom: 1,
                        near: 0.1,
                        far: 100,
                        position: [0, 0, 10],
                    }}
                    dpr={[1, 2]}
                    // Colors are drawn as the theme gives them, with no tone mapping
                    flat
                    linear
                    gl={{
                        powerPreference: "high-performance",
                        antialias: false,
                    }}
                    onCreated={({ gl }) => {
                        element.current = gl.domElement;
                    }}
                >
                    <FieldCamera
                        fieldProperties={fieldProperties}
                        root={root}
                        ready={ready}
                    />
                    <PlayheadDriver
                        marchers={marchers}
                        isPlaying={isPlaying}
                        beats={beats}
                        appearanceSteps={appearanceSteps}
                    />
                    <FieldLayer
                        fieldProperties={fieldProperties}
                        numberAtlas={atlases.number}
                        labelAtlas={atlases.label}
                    />
                    <MarchersLayer
                        marchers={marchers}
                        theme={fieldProperties.theme}
                    />
                    <LabelsLayer
                        marchers={marchers}
                        labels={labels}
                        theme={fieldProperties.theme}
                        atlas={atlases.label}
                    />
                </Canvas>
            )}
        </div>
    );
}

/** How long the Fabric field waited for the fullscreen layout to settle. */
const FULLSCREEN_SETTLE_MS = 250;

/**
 * As the Fabric field: entering fullscreen fits the whole field and clears the
 * selection, and leaving it centers the field at the base zoom again, once the
 * layout has settled. The field also centers again that long after it's
 * `ready`, as the app's panels finish laying out around it.
 */
function useFullscreenFit(
    root: RefObject<HTMLDivElement | null>,
    isFullscreen: boolean,
    ready: boolean,
) {
    const { setSelectedMarchers } = useSelectedMarchers()!;
    useEffect(() => {
        if (!ready) return;
        let frame = 0;
        const timeout = setTimeout(() => {
            frame = requestAnimationFrame(() => {
                if (!isFullscreen) return resetView();
                if (root.current)
                    fitFullscreen({
                        width: root.current.clientWidth,
                        height: root.current.clientHeight,
                    });
                setSelectedMarchers([]);
            });
        }, FULLSCREEN_SETTLE_MS);
        return () => {
            clearTimeout(timeout);
            cancelAnimationFrame(frame);
        };
    }, [isFullscreen, ready, root, setSelectedMarchers]);
}

/**
 * Keeps the view store's size and field in step with the canvas, opens the
 * show centered at the base zoom once it's `ready`, and points the camera at
 * the store's view. A resize keeps the zoom and where the field sits from the
 * top-left, as the Fabric field did; in fullscreen it fits the field again.
 */
function FieldCamera({
    fieldProperties,
    root,
    ready,
}: {
    fieldProperties: FieldProperties;
    root: RefObject<HTMLDivElement | null>;
    ready: boolean;
}) {
    const width = useThree((s) => s.size.width);
    const height = useThree((s) => s.size.height);
    const camera = useThree((s) => s.camera) as OrthographicCamera;
    const invalidate = useThree((s) => s.invalidate);
    const opened = useRef(false);

    useLayoutEffect(() => {
        const field = {
            width: fieldProperties.width,
            height: fieldProperties.height,
        };
        useFieldViewStore.setState({ width, height, field });
        if (width <= 0 || height <= 0 || !ready) return;
        if (!opened.current) {
            opened.current = true;
            resetView();
        } else if (useFullscreenStore.getState().isFullscreen && root.current) {
            fitFullscreen({
                width: root.current.clientWidth,
                height: root.current.clientHeight,
            });
        }
    }, [width, height, fieldProperties, root, ready]);

    useLayoutEffect(() => {
        const apply = () => {
            const view = useFieldViewStore.getState();
            if (view.width <= 0 || view.height <= 0) return;
            Object.assign(camera, cameraBounds(view));
            camera.updateProjectionMatrix();
            invalidate();
        };
        apply();
        return useFieldViewStore.subscribe(apply);
    }, [camera, invalidate]);

    return null;
}

/**
 * Moves the marchers to the playhead, and gives them their appearance steps
 * (`FieldMarchers` samples them with the positions). Paused, it follows the beat the timeline
 * shows (the playhead, or a held preview frame) through a store subscription,
 * so a scrub draws each beat without re-rendering React. Playing, it samples
 * the live playback time in a frame hook and asks for the next frame.
 */
function PlayheadDriver({
    marchers,
    isPlaying,
    beats,
    appearanceSteps,
}: {
    marchers: FieldMarchers;
    isPlaying: boolean;
    beats: readonly BeatTiming[];
    appearanceSteps: AppearanceStepsByMarcherId | undefined;
}) {
    const invalidate = useThree((s) => s.invalidate);

    useEffect(() => {
        marchers.setAppearanceSteps(appearanceSteps);
        invalidate();
    }, [marchers, appearanceSteps, invalidate]);
    // A new version means new answers from the resolver
    const version = useTimelineResolverStore((s) => s.version);
    const isolationPlan = useIsolationPlanStore((s) => s.current);

    useEffect(() => {
        if (isPlaying) {
            invalidate();
            return;
        }
        const draw = (beat: number) => {
            if (marchers.fill(beat, isolationPlan)) invalidate();
        };
        let drawn = displayedBeat(useTimelineSelectionStore.getState());
        draw(drawn);
        return useTimelineSelectionStore.subscribe((state) => {
            const at = displayedBeat(state);
            if (at === drawn) return;
            drawn = at;
            // Called inside the store's write: a failed draw mustn't stop its other listeners
            try {
                draw(at);
            } catch (error) {
                console.error(
                    "Error drawing the marchers at the playhead",
                    error,
                );
            }
        });
    }, [isPlaying, version, isolationPlan, marchers, invalidate]);

    // Before the layers' frame hooks (priority 0), so they draw this frame's positions
    useFrame(() => {
        if (!isPlaying) return;
        marchers.fill(playbackBeat(beats, getLivePlaybackPosition() * 1000));
        invalidate();
    }, -1);

    return null;
}
