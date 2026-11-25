import { useMemo } from "react";
import { facingAt } from "@openmarch/core";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { isPerformer } from "@/global/classes/Marcher";
import { cueClockAtBeat, writeFacingDirections } from "./fieldFacing";
import { useShowCues } from "./useShowCues";

/** Which way each performer faces at a beat, for the 2D field's facing arrows (fork #1316). */
export interface FieldFacing {
    /**
     * Writes each of `ids`' facing direction at spec beat `beat` (fractional while playing) into
     * `out`, x, y per id in field units, 0, 0 for one with no arrow. Cheap enough to call every
     * frame.
     */
    write(ids: readonly number[], beat: number, out: Float32Array): void;
    /** The facing drawn for `id` at `beat`, in unwrapped degrees, or null for no arrow. */
    degreesAt(id: number, beat: number): number | null;
}

/**
 * The facing the 2D field draws arrows for while the field display bar's Show facing is on, or
 * null while it's off. Every performer gets one: a performer with no Facing cue faces front.
 * Props and equipment don't face.
 */
export function useFieldFacing(): FieldFacing | null {
    const show = useShowCues();
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
        return {
            write(ids, beat, out) {
                writeFacingDirections({
                    compiled: show.compiled,
                    ids,
                    clock: clockAt(beat),
                    include,
                    out,
                });
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
