import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { OrthographicCamera, WebGLRenderer } from "three";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_FIELD_THEME, type FieldProperties } from "@openmarch/core";
import { useSelectedPage } from "@/context/SelectedPageContext";
import { useIsPlaying } from "@/context/IsPlayingContext";
import {
    allMarchersQueryOptions,
    fieldPropertiesQueryOptions,
} from "@/hooks/queries";
import { useDatabaseReady } from "@/hooks/useDatabaseReady";
import { useTimingObjects } from "@/hooks";
import { useFieldImage } from "@/view3d/window/useFieldImage";
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
import {
    probeWebGL,
    reprobeWebGL,
    useFieldQualityStore,
} from "@/field/fieldQuality";
import { planFieldImage } from "@/field/fieldPlan";
import { FieldMarchers } from "./fieldMarchers";
import { cameraBounds, fitView, useFieldViewStore } from "./fieldView";
import { GlyphAtlas } from "./sdfText";
import { createThreeFieldTestApi } from "./threeFieldTestApi";
import FieldLayer from "./layers/FieldLayer";
import BackgroundImageLayer from "./layers/BackgroundImageLayer";
import MarchersLayer from "./layers/MarchersLayer";
import LabelsLayer from "./layers/LabelsLayer";
import {
    currentFieldQuality,
    useFieldQuality,
    useGpuCrashWatch,
} from "./useFieldQuality";
import { FieldUnavailable, useFieldQualityNotice } from "./FieldQualityNotice";
import { CanvasErrorBoundary, ContextLossGuard } from "./fieldRecovery";
import FieldBenchmark from "@/field/benchmark/FieldBenchmark";

/** fabric's fonts: the marcher labels'. */
const LABEL_FONT = 'bold "Courier New", monospace';
/**
 * The field's fonts, named as fabric names them (`createFieldGrid`): its
 * default for yard numbers, and "mono" for checkpoint labels, a family that
 * doesn't exist, so the platform's fallback draws them in both fields.
 */
const NUMBER_FONT = '"Times New Roman"';
const CHECKPOINT_FONT = '"mono"';

/**
 * The three.js field, or an explanation in its place when its canvas can't get
 * a WebGL context (#205), instead of the app's error boundary.
 */
export default function ThreeField() {
    const [attempt, setAttempt] = useState(0);
    return (
        <CanvasErrorBoundary
            key={attempt}
            fallback={
                <FieldUnavailable
                    onRetry={() => {
                        reprobeWebGL();
                        setAttempt((n) => n + 1);
                    }}
                />
            }
            onError={(error) => {
                console.warn("The field couldn't start WebGL", error);
                useFieldQualityStore.setState({
                    gl: { kind: "none", renderer: null },
                });
            }}
        >
            <ThreeFieldView />
        </CanvasErrorBoundary>
    );
}

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
function ThreeFieldView() {
    const databaseReady = useDatabaseReady();
    const { data: fieldProperties } = useQuery(
        fieldPropertiesQueryOptions(databaseReady),
    );
    const { data: marcherRows } = useQuery(allMarchersQueryOptions());
    const { selectedPage } = useSelectedPage()!;
    const { isPlaying } = useIsPlaying()!;
    const { beats } = useTimingObjects()!;
    const { image: fieldImage } = useFieldImage();
    // Planned once, for the layer that draws it and the field test API
    const fieldImagePlan = useMemo(
        () =>
            fieldProperties
                ? planFieldImage(
                      fieldProperties,
                      fieldImage && {
                          width: fieldImage.width,
                          height: fieldImage.height,
                      },
                  )
                : null,
        [fieldProperties, fieldImage],
    );
    const appearanceSteps = useMarcherAppearanceSteps(true);

    // Weak machines (#205): what draws WebGL here, known before the canvas mounts
    const [probed] = useState(
        () => useFieldQualityStore.getState().gl ?? probeWebGL(),
    );
    useLayoutEffect(() => {
        if (!useFieldQualityStore.getState().gl)
            useFieldQualityStore.setState({ gl: probed });
    }, [probed]);
    useGpuCrashWatch();
    const quality = useFieldQuality();
    useFieldQualityNotice(quality.reason);
    // A new key starts the field over on a new canvas, with a new context
    const [canvasKey, setCanvasKey] = useState(0);
    const startOver = useCallback(() => setCanvasKey((key) => key + 1), []);

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
            checkpoint: new GlyphAtlas(CHECKPOINT_FONT),
        }),
        [],
    );
    useEffect(
        () => () => {
            atlases.label.dispose();
            atlases.number.dispose();
            atlases.checkpoint.dispose();
        },
        [atlases],
    );

    // The field test API reads the latest of these, not the render they came from
    const element = useRef<HTMLElement | null>(null);
    const renderer = useRef<WebGLRenderer | null>(null);
    const benchRenderer = useCallback(() => renderer.current, []);
    const benchMarchers = useCallback(() => marchers.ids.length, [marchers]);
    const latest = useRef({
        labels,
        pageId: selectedPage?.id ?? null,
        fieldImage: fieldImagePlan,
        theme: fieldProperties?.theme,
    });
    latest.current = {
        labels,
        pageId: selectedPage?.id ?? null,
        fieldImage: fieldImagePlan,
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
                quality: currentFieldQuality,
                contextLost: () => useFieldQualityStore.getState().contextLost,
                fieldImage: () => latest.current.fieldImage,
                theme: () => latest.current.theme ?? DEFAULT_FIELD_THEME,
            }),
        );
        return () => installFieldTestApi(undefined);
    }, [marchers]);

    return (
        <div
            className="rounded-6 relative h-full w-full overflow-hidden"
            data-testid="threeField"
        >
            <TimelineIsolationBar />
            <TimelineFromStartBadge />
            <FieldBenchmark
                renderer={benchRenderer}
                marcherCount={benchMarchers}
            />
            {quality.reason === "noWebGL" && (
                <FieldUnavailable
                    onRetry={() => {
                        reprobeWebGL();
                        startOver();
                    }}
                />
            )}
            {fieldProperties && quality.reason !== "noWebGL" && (
                <Canvas
                    key={canvasKey}
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
                    dpr={quality.settings.dpr}
                    // Colors are drawn as the theme gives them, with no tone mapping
                    flat
                    linear
                    gl={{
                        powerPreference: "high-performance",
                        antialias: false,
                    }}
                    onCreated={({ gl }) => {
                        element.current = gl.domElement;
                        renderer.current = gl;
                    }}
                >
                    <ContextLossGuard onGiveUp={startOver} />
                    <FieldCamera fieldProperties={fieldProperties} />
                    <PlayheadDriver
                        marchers={marchers}
                        isPlaying={isPlaying}
                        beats={beats}
                        appearanceSteps={appearanceSteps}
                    />
                    <FieldLayer
                        fieldProperties={fieldProperties}
                        numberAtlas={atlases.number}
                        labelAtlas={atlases.checkpoint}
                    />
                    <BackgroundImageLayer
                        image={fieldImage}
                        placement={fieldImagePlan}
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

/**
 * Fits the field to the canvas whenever its size changes (navigation is
 * #194), and points the camera at the view store's view.
 */
function FieldCamera({
    fieldProperties,
}: {
    fieldProperties: FieldProperties;
}) {
    const width = useThree((s) => s.size.width);
    const height = useThree((s) => s.size.height);
    const camera = useThree((s) => s.camera) as OrthographicCamera;
    const invalidate = useThree((s) => s.invalidate);

    useLayoutEffect(() => {
        useFieldViewStore.setState(fitView(width, height, fieldProperties));
    }, [width, height, fieldProperties]);

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
