import { runAction } from "@/shortcuts/registry";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { useFieldViewStore, type FieldView } from "@/field/three/fieldView";
import type { BenchmarkKind } from "./frameStats";
import {
    SCENARIO_MS,
    ScenarioSkipped,
    type BenchmarkScenario,
} from "./runFieldBenchmark";

const nextFrame = () =>
    new Promise<number>((resolve) => requestAnimationFrame(resolve));

const timeline = () => useTimelineSelectionStore.getState();

/** Playback from the top of the show; ends early if the show does. */
function playScenario(isPlaying: () => boolean): BenchmarkScenario {
    let playhead = 0;
    return {
        kind: "play",
        start() {
            playhead = timeline().playheadBeat;
            // From the top, so runs on one show compare
            timeline().seek(0);
            if (!isPlaying() && !runAction("playPause"))
                throw new ScenarioSkipped("Play isn't available here");
        },
        // Playback takes a moment to start
        step: (elapsed) => elapsed < 500 || isPlaying(),
        async stop() {
            if (isPlaying()) runAction("playPause");
            // Pausing puts the playhead where playback stopped, once it has
            for (let frame = 0; isPlaying() && frame < 120; frame++)
                await nextFrame();
            await nextFrame();
            timeline().seek(playhead);
        },
    };
}

/** The playhead to the end of the show and back, like a fast scrub. */
function scrubScenario(ms: number): BenchmarkScenario {
    let playhead = 0;
    return {
        kind: "scrub",
        start() {
            playhead = timeline().playheadBeat;
            if (!timeline().showEndBeat)
                throw new ScenarioSkipped("The show has no beats");
            timeline().beginScrub();
        },
        step(elapsed) {
            const phase = (elapsed / ms) * 2;
            const along = phase <= 1 ? phase : 2 - phase;
            timeline().seek(Math.round(along * (timeline().showEndBeat ?? 0)));
        },
        stop() {
            timeline().endScrub();
            timeline().seek(playhead);
        },
    };
}

/** A scenario that moves the field's view each frame, then puts it back. */
function viewScenario(
    kind: BenchmarkKind,
    move: (now: FieldView, start: FieldView, elapsed: number) => void,
): BenchmarkScenario {
    let start: FieldView | null = null;
    return {
        kind,
        start() {
            start = { ...useFieldViewStore.getState() };
        },
        step(elapsed) {
            move(useFieldViewStore.getState(), start!, elapsed);
        },
        stop() {
            if (start) useFieldViewStore.setState(start);
        },
    };
}

/** In to 8× and back out at the center, every 3 s. */
const zoomScenario = () =>
    viewScenario("zoom", (now, start, elapsed) => {
        const zoom =
            start.zoom *
            Math.pow(8, (1 - Math.cos((elapsed / 1500) * Math.PI)) / 2);
        const cx = now.width / 2;
        const cy = now.height / 2;
        useFieldViewStore.setState({
            zoom,
            panX: cx - ((cx - now.panX) * zoom) / now.zoom,
            panY: cy - ((cy - now.panY) * zoom) / now.zoom,
        });
    });

/** Round and round, a few pixels a frame. */
const panScenario = () =>
    viewScenario("pan", (now, _start, elapsed) => {
        useFieldViewStore.setState({
            panX: now.panX + Math.cos(elapsed / 400) * 12,
            panY: now.panY + Math.sin(elapsed / 400) * 6,
        });
    });

/**
 * The benchmark's scenarios on the open show, as the prototype's: playback,
 * a scrub back and forth across the whole show, a zoom in and out at the
 * center, and a circular pan. Each puts back what it changed.
 *
 * They drive the app the way a user's input does: Play is the Play action, a
 * scrub moves the timeline's playhead, and zoom and pan write the field's view
 * store (#194 adds navigation input; these keep writing the store). Dragging
 * marchers comes with #196.
 */
export function fieldBenchmarkScenarios({
    isPlaying,
    ms = SCENARIO_MS,
}: {
    /** Whether the app is playing now. */
    isPlaying: () => boolean;
    ms?: number;
}): Record<BenchmarkKind, BenchmarkScenario> {
    return {
        play: playScenario(isPlaying),
        scrub: scrubScenario(ms),
        zoom: zoomScenario(),
        pan: panScenario(),
        drag: {
            kind: "drag",
            // TODO(#196): select all and drag them in a circle through the editor's move
            // gesture, as the prototype's `bench("drag")`, then undo
            unavailable: "needs dragging marchers on the new field (#196)",
            start() {},
            step: () => false,
            stop() {},
        },
    };
}
