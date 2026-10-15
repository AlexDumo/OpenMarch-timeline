import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { advance, createRoot, useThree } from "@react-three/fiber";
import type { OrthographicCamera } from "three";
import { createStore, type StoreApi } from "zustand";
import type { FieldProperties } from "@openmarch/core";
import { NoWebGLError, QUALITY_SETTINGS } from "@/field/fieldQuality";
import { planFieldImage } from "@/field/fieldPlan";
import type { PositionSource } from "@/timeline/positionBuffer";
import type { AppearanceStepsByMarcherId } from "@/services/appearance/appearanceSteps";
import { FieldDimming } from "./fieldDimming";
import { FieldDrawContext, type FieldDraw } from "./fieldDrawContext";
import { FieldMarchers } from "./fieldMarchers";
import { cameraBounds, type FieldView } from "./fieldView";
import { GlyphAtlas } from "./sdfText";
import FieldLayer from "./layers/FieldLayer";
import BackgroundImageLayer from "./layers/BackgroundImageLayer";
import MarchersLayer from "./layers/MarchersLayer";
import LabelsLayer from "./layers/LabelsLayer";

/** The on-screen field's fonts (`ThreeField.tsx`). */
const LABEL_FONT = 'bold "Courier New", monospace';
const NUMBER_FONT = '"Times New Roman"';
const CHECKPOINT_FONT = '"mono"';

export interface OffscreenFieldArgs {
    fieldProperties: FieldProperties;
    /** Where the marchers are at a beat: the export's own resolver. */
    source: PositionSource;
    /** Each marcher's appearance over the show, as the field draws it (the last flag crossed). */
    appearanceSteps: AppearanceStepsByMarcherId | undefined;
    /** Each marcher's drill number, by id. */
    labels: ReadonlyMap<number, string>;
    /** The decoded field image, or null when the show has none. */
    image: ImageBitmap | null;
    width: number;
    height: number;
}

/**
 * The new field drawn off screen, one frame at a time (#207): the video
 * export's frames and its preview. It mounts the on-screen field's layers
 * (field, image, marchers, labels) in their own React Three Fiber root, on a
 * canvas that's never in the page, with its own view and always at full
 * quality: an export looks the same on a software-GL machine as on a GPU.
 *
 * Frames are drawn only when asked (`frameloop: "never"`). `draw(beat)`
 * samples the marchers, runs the layers' frame hooks and renders, all
 * synchronously, so the canvas holds that beat's frame when it returns. It's
 * kept until the next draw (`preserveDrawingBuffer`), for the caller to copy.
 */
export interface OffscreenField {
    /** The drawn frame, `width` × `height` pixels, transparent outside the field. */
    readonly canvas: HTMLCanvasElement;
    /** Which field units the frame shows; its size becomes the canvas's. */
    setView(view: FieldView): void;
    /** Draws the marchers at `beat`. */
    draw(beat: number): void;
    dispose(): void;
}

export async function createOffscreenField(
    args: OffscreenFieldArgs,
): Promise<OffscreenField> {
    const canvas = document.createElement("canvas");
    canvas.width = args.width;
    canvas.height = args.height;
    const root = createRoot(canvas);
    try {
        await root.configure({
            frameloop: "never",
            size: { width: args.width, height: args.height, top: 0, left: 0 },
            dpr: 1,
            orthographic: true,
            // Bounds given here make the camera manual: `ViewCamera` sets them
            camera: {
                left: 0,
                right: 1,
                top: 0,
                bottom: 1,
                near: 0.1,
                far: 100,
                position: [0, 0, 10],
            },
            flat: true,
            linear: true,
            gl: {
                antialias: false,
                alpha: true,
                preserveDrawingBuffer: true,
                powerPreference: "high-performance",
            },
        });
    } catch (error) {
        root.unmount();
        throw new NoWebGLError(error);
    }

    const view = createStore<FieldView>(() => ({
        width: args.width,
        height: args.height,
        zoom: 1,
        panX: 0,
        panY: 0,
    }));
    const draw: FieldDraw = { view, quality: () => QUALITY_SETTINGS.full };
    const marchers = new FieldMarchers(args.source);
    marchers.setAppearanceSteps(args.appearanceSteps);
    const atlases = {
        label: new GlyphAtlas(LABEL_FONT),
        number: new GlyphAtlas(NUMBER_FONT),
        checkpoint: new GlyphAtlas(CHECKPOINT_FONT),
    };
    const placement = planFieldImage(
        args.fieldProperties,
        args.image && { width: args.image.width, height: args.image.height },
    );

    let mounted!: () => void;
    const ready = new Promise<void>((resolve) => (mounted = resolve));
    const store = root.render(
        <FieldDrawContext.Provider value={draw}>
            <Mounted onMounted={mounted}>
                <ViewCamera view={view} />
                <FieldLayer
                    fieldProperties={args.fieldProperties}
                    numberAtlas={atlases.number}
                    labelAtlas={atlases.checkpoint}
                />
                <BackgroundImageLayer
                    image={args.image}
                    placement={placement}
                />
                <MarchersLayer
                    marchers={marchers}
                    dimming={NO_DIMMING}
                    theme={args.fieldProperties.theme}
                />
                <LabelsLayer
                    marchers={marchers}
                    dimming={NO_DIMMING}
                    labels={args.labels}
                    theme={args.fieldProperties.theme}
                    atlas={atlases.label}
                />
            </Mounted>
        </FieldDrawContext.Provider>,
    );
    await ready;
    const state = store.getState();
    state.gl.setClearColor(0x000000, 0);

    let disposed = false;
    return {
        canvas,
        setView(next) {
            const { size } = store.getState();
            if (size.width !== next.width || size.height !== next.height)
                store.getState().setSize(next.width, next.height, 0, 0);
            view.setState(next);
        },
        draw(beat) {
            marchers.fill(beat);
            // This root only: the on-screen field draws on its own
            advance(performance.now() / 1000, false, store.getState());
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            const { gl } = store.getState();
            root.unmount();
            atlases.label.dispose();
            atlases.number.dispose();
            atlases.checkpoint.dispose();
            gl.dispose();
            // Frees the context now, not when it's collected: exports and previews make many
            gl.forceContextLoss();
        },
    };
}

/** Nobody is dimmed in an export. */
const NO_DIMMING = new FieldDimming();

/** Resolves once everything under it has mounted: a parent's effects run after its children's. */
function Mounted({
    onMounted,
    children,
}: {
    onMounted: () => void;
    children: ReactNode;
}) {
    useEffect(() => onMounted(), [onMounted]);
    return <>{children}</>;
}

/** Points the camera at the view, as `ThreeField`'s `FieldCamera` does on screen. */
function ViewCamera({ view }: { view: StoreApi<FieldView> }) {
    const camera = useThree((s) => s.camera) as OrthographicCamera;
    useLayoutEffect(() => {
        const apply = () => {
            Object.assign(camera, cameraBounds(view.getState()));
            camera.updateProjectionMatrix();
        };
        apply();
        return view.subscribe(apply);
    }, [camera, view]);
    return null;
}
