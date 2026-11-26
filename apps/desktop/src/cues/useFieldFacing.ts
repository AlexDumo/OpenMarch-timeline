import { useMemo } from "react";
import { facingAt } from "@openmarch/core";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { isPerformer } from "@/global/classes/Marcher";
import { cueClockAtBeat, writeFacingDirections } from "./fieldFacing";
import type { EditorCues } from "./useShowCues";

/** Which way each performer faces at a beat, for the 2D field's facing carets (fork #1316). */
export interface FieldFacing {
    /**
     * Each of `ids`' facing direction at spec beat `beat` (fractional while playing), x, y per id
     * in field units, 0, 0 for one with no caret. Worked out once per `ids` and beat: the carets
     * and the labels layers share it each frame. Read it before the next call; don't keep it.
     */
    directions(ids: readonly number[], beat: number): Float32Array;
    /**
     * Which way `id` faces at `beat`, in unwrapped degrees, or null for a prop or equipment, which
     * never face. A hidden performer's caret isn't drawn either; the field test API reads null.
     */
    degreesAt(id: number, beat: number): number | null;
}

/**
 * The facing the 2D field draws carets for while the field display bar's Show facing is on, or
 * null while it's off. Every performer gets one: a performer with no Facing cue faces front.
 * Props and equipment don't face. `show` is the field's one compile (`useShowCues`), which the
 * equipment icons read too.
 */
export function useFieldFacing(show: EditorCues | null): FieldFacing | null {
    const beats = useTimingObjects()?.beats;
    const on = useUiSettingsStore((s) => s.uiSettings.facingArrows === true);
    return useMemo(() => {
        if (!show || !beats || !on) return null;
        const performers = new Set(
            show.marchers.filter(isPerformer).map((m) => m.id),
        );
        const include = (id: number) => performers.has(id);
        const clockAt = (beat: number) =>
            cueClockAtBeat(beats, show.countOfBeat, beat);
        let last = {
            ids: null as readonly number[] | null,
            beat: NaN,
            out: new Float32Array(0),
        };
        return {
            directions(ids, beat) {
                if (ids === last.ids && beat === last.beat) return last.out;
                const out =
                    last.out.length === ids.length * 2
                        ? last.out
                        : new Float32Array(ids.length * 2);
                writeFacingDirections({
                    compiled: show.compiled,
                    ids,
                    clock: clockAt(beat),
                    include,
                    out,
                });
                last = { ids, beat, out };
                return out;
            },
            degreesAt(id, beat) {
                if (!include(id)) return null;
                return facingAt(show.compiled, id, clockAt(beat));
            },
        };
    }, [show, beats, on]);
}

/** Show facing on or off (the display bar's button and the palette's action). */
export function toggleFacingArrows(): void {
    const { uiSettings, setUiSettings } = useUiSettingsStore.getState();
    setUiSettings({ ...uiSettings, facingArrows: !uiSettings.facingArrows });
}
