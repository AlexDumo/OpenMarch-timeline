import {
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type RefObject,
} from "react";
import clsx from "clsx";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { OrthographicCamera } from "three";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_FIELD_THEME, type FieldProperties } from "@openmarch/core";
import { useSelectedPage } from "@/context/SelectedPageContext";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { useFullscreenStore } from "@/stores/FullscreenStore";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
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
    isMarcherDimmed,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import { useIsolationPlanStore } from "@/timeline/timelineIsolationPlan";
import { playbackBeat } from "@/timeline/positionBuffer";
import type { BeatTiming } from "@/timeline/timeMap";
import { installFieldTestApi } from "@/field/fieldTestApi";
import { FieldEditor } from "@/field/editor/fieldEditor";
import { setActiveFieldEditor } from "@/field/editor/activeFieldEditor";
import { isMacPlatform } from "@/shortcuts/platform";
import { planFieldImage } from "@/field/fieldPlan";
import { FieldMarchers } from "./fieldMarchers";
import FieldOverlay from "./FieldOverlay";
import { attachFieldPointerInput } from "./fieldPointerInput";
import { cameraBounds, useFieldViewStore } from "./fieldView";
import {
    attachFieldNavigation,
    fitFullscreen,
    resetView,
    settleView,
} from "./fieldNavigation";
import { GlyphAtlas } from "./sdfText";
import { createThreeFieldTestApi } from "./threeFieldTestApi";
import FieldLayer from "./layers/FieldLayer";
import BackgroundImageLayer from "./layers/BackgroundImageLayer";
import MarchersLayer from "./layers/MarchersLayer";
import LabelsLayer from "./layers/LabelsLayer";

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
 * The three.js field (ADR 0005), behind the dev switch in `fieldRenderer.ts`.
 * #192, the tracer bullet: it draws the field, and every marcher and its label
 * at the playhead, and installs the field test API. #199: each marcher in its
 * appearance at the playhead (the last flag crossed, `appearanceSteps`). #193: the
 * editor selects marchers by clicking them, with rings on the selected
 * marchers and a box around a multi-selection in the SVG overlay.
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
    const { selectedMarchers, setSelectedMarchers } = useSelectedMarchers()!;
    const { isPlaying } = useIsPlaying()!;
    const { beats } = useTimingObjects()!;
    const isFullscreen = useFullscreenStore((s) => s.isFullscreen);
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

    const selectedIds = useMemo(
        () => selectedMarchers.map((marcher) => marcher.id),
        [selectedMarchers],
    );
    // The editor reads the selection it last wrote until React renders it, so
    // a second click before then builds on the first
    const selection = useRef<readonly number[]>(selectedIds);
    useLayoutEffect(() => {
        selection.current = selectedIds;
    }, [selectedIds]);

    // The field test API and the editor read the latest of these, not the render they came from
    const element = useRef<HTMLElement | null>(null);
    const latest = useRef({
        labels,
        pageId: selectedPage?.id ?? null,
        marcherRows,
        setSelectedMarchers,
        fieldImage: fieldImagePlan,
        theme: fieldProperties?.theme,
    });
    latest.current = {
        labels,
        pageId: selectedPage?.id ?? null,
        fieldImage: fieldImagePlan,
        theme: fieldProperties?.theme,
        marcherRows,
        setSelectedMarchers,
    };

    const editor = useMemo(
        () =>
            new FieldEditor(
                {
                    selection: {
                        get: () => selection.current,
                        set(ids) {
                            const byId = new Map(
                                (latest.current.marcherRows ?? []).map(
                                    (marcher) => [marcher.id, marcher],
                                ),
                            );
                            // Only marchers the app knows, as the context will hold them
                            const selected = ids.flatMap(
                                (id) => byId.get(id) ?? [],
                            );
                            selection.current = selected.map((m) => m.id);
                            latest.current.setSelectedMarchers(selected);
                        },
                    },
                    marchers: () => marchers,
                    zoom: () => useFieldViewStore.getState().zoom,
                    // UI-9: marchers dimmed outside the isolated move can't be selected or hit
                    canSelect: (id) =>
                        !isMarcherDimmed(
                            useTimelineSelectionStore.getState(),
                            id,
                        ),
                },
                { isMac: isMacPlatform() },
            ),
        [marchers],
    );
    useEffect(() => {
        setActiveFieldEditor(editor);
        return () => setActiveFieldEditor(null);
    }, [editor]);

    useEffect(() => {
        installFieldTestApi(
            createThreeFieldTestApi({
                marchers,
                labels: () => latest.current.labels,
                view: () => useFieldViewStore.getState(),
                element: () => element.current,
                pageId: () => latest.current.pageId,
                selection: () => selection.current,
                activeGesture: () => editor.activeGesture(),
                fieldImage: () => latest.current.fieldImage,
                theme: () => latest.current.theme ?? DEFAULT_FIELD_THEME,
            }),
        );
        return () => installFieldTestApi(undefined);
    }, [marchers, editor]);

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
    // page are loaded. Latched: a page briefly unselected mustn't reset the view
    const [ready, setReady] = useState(false);
    if (!ready && fieldProperties && selectedPage) setReady(true);
    // Until the layout settles, the view is still the opening view
    const settled = useRef(false);
    useFullscreenFit(root, isFullscreen, ready, settled);

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
                        settled={settled}
                    />
                    <EditorInput
                        editor={editor}
                        marchers={marchers}
                        selectedIds={selectedIds}
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
            {fieldProperties && <FieldOverlay marchers={marchers} />}
        </div>
    );
}

/** How long the Fabric field waited for the fullscreen layout to settle. */
const FULLSCREEN_SETTLE_MS = 250;

/**
 * As the Fabric field: entering fullscreen fits the whole field and clears the
 * selection, and leaving it centers the field at the base zoom again, once the
 * layout has settled. The field also centers again that long after it's
 * `ready`, as the app's panels finish laying out around it, and marks the
 * view `settled`.
 */
function useFullscreenFit(
    root: RefObject<HTMLDivElement | null>,
    isFullscreen: boolean,
    ready: boolean,
    settled: RefObject<boolean>,
) {
    const { setSelectedMarchers } = useSelectedMarchers()!;
    // Read when it runs: the effect follows fullscreen and readiness only
    const clearSelection = useRef(() => setSelectedMarchers([]));
    clearSelection.current = () => setSelectedMarchers([]);
    const opening = useRef(true);
    useEffect(() => {
        if (!ready) return;
        // Until it has run once, it's the show opening; then fullscreen changes
        const first = opening.current;
        let frame = 0;
        const timeout = setTimeout(() => {
            frame = requestAnimationFrame(() => {
                opening.current = false;
                settled.current = true;
                if (!isFullscreen) {
                    if (first) settleView();
                    else resetView();
                    return;
                }
                if (root.current)
                    fitFullscreen({
                        width: root.current.clientWidth,
                        height: root.current.clientHeight,
                    });
                clearSelection.current();
            });
        }, FULLSCREEN_SETTLE_MS);
        return () => {
            clearTimeout(timeout);
            cancelAnimationFrame(frame);
        };
    }, [isFullscreen, ready, root, settled]);
}

/**
 * Keeps the view store's size and field in step with the canvas, opens the
 * show centered at the base zoom once it's `ready`, and points the camera at
 * the store's view. Until the view has `settled`, a resize centers it again.
 * After that a resize keeps the zoom and where the field sits from the
 * top-left, as the Fabric field did; in fullscreen it fits the field again.
 */
function FieldCamera({
    fieldProperties,
    root,
    ready,
    settled,
}: {
    fieldProperties: FieldProperties;
    root: RefObject<HTMLDivElement | null>;
    ready: boolean;
    settled: RefObject<boolean>;
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
        } else if (!settled.current) {
            settleView();
        }
    }, [width, height, fieldProperties, root, ready, settled]);

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
 * Sends the pointer on the canvas to the editor, and marks the app's
 * selection on the marchers for their rings and the overlay's box.
 */
function EditorInput({
    editor,
    marchers,
    selectedIds,
}: {
    editor: FieldEditor;
    marchers: FieldMarchers;
    selectedIds: readonly number[];
}) {
    const canvas = useThree((s) => s.gl.domElement);
    const invalidate = useThree((s) => s.invalidate);

    useEffect(() => attachFieldPointerInput(canvas, editor), [canvas, editor]);

    useEffect(() => {
        marchers.setSelection(selectedIds);
        invalidate();
    }, [marchers, selectedIds, invalidate]);

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
