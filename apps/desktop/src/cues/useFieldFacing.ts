import { useMemo } from "react";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { isPerformer } from "@/global/classes/Marcher";
import {
    cueClockAtBeat,
    facingMarkAt,
    writeFacingMarks,
    type FacingMarks,
} from "./facingMarks";
import { useShowCues } from "./useShowCues";

/** Which way each performer faces at a beat, for the 2D field (fork #1316). */
export interface FieldFacing {
    /**
     * Writes each of `ids`' facing direction at spec beat `beat` (fractional while playing) into
     * `out`, x, y per id in field units, 0, 0 for none. Returns whether any is shown. Cheap enough
     * to call every frame.
     */
    write(ids: readonly number[], beat: number, out: Float32Array): boolean;
    /** The facing shown for `id` at `beat`, in unwrapped degrees, or null for none. */
    degreesAt(id: number, beat: number): number | null;
}

/**
 * The facing the 2D field draws, for whom the field display bar's Facing choice says: performers
 * not facing front (the default), everyone, or nobody (null). Null too while nobody would show:
 * "Not front" in a show without Facing cues. Props and equipment don't face.
 */
export function useFieldFacing(): FieldFacing | null {
    const show = useShowCues();
    const beats = useTimingObjects()?.beats;
    const shown: FacingMarks = useUiSettingsStore(
        (s) => s.uiSettings.facingMarks ?? "turned",
    );
    return useMemo(() => {
        if (!show || !beats || shown === "off") return null;
        if (shown === "turned" && !show.cues.some((c) => c.type === "facing"))
            return null;
        const performers = new Set(
            show.marchers.filter(isPerformer).map((m) => m.id),
        );
        const include = (id: number) => performers.has(id);
        const clockAt = (beat: number) =>
            cueClockAtBeat(beats, show.countOfBeat, beat);
        return {
            write(ids, beat, out) {
                return writeFacingMarks({
                    compiled: show.compiled,
                    ids,
                    clock: clockAt(beat),
                    shown,
                    include,
                    out,
                });
            },
            degreesAt(id, beat) {
                if (!include(id)) return null;
                return facingMarkAt(show.compiled, id, clockAt(beat), shown);
            },
        };
    }, [show, beats, shown]);
}
