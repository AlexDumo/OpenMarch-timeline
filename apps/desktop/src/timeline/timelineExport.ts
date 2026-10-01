import { createResolver, type Resolver } from "@openmarch/core";
import { getBeats } from "@/db-functions/beat";
import type { DbConnection } from "@/db-functions/types";
import { calculateTimestamps, fromDatabaseBeat } from "@/global/classes/Beat";
import { beatAtTime, type BeatTiming } from "./timeMap";
import {
    TimelinePositionBuffer,
    type MarcherWithId,
    type TimelinePositionSource,
} from "./timelineCanvas";
import { readTimelineTables } from "./timelineRows";
import { useTimelineResolverStore } from "./timelineStore";
import {
    buildKeyframes,
    keyframesToJson,
    DEFAULT_KEYFRAME_TOLERANCE,
    type KeyframeExportOptions,
} from "./timelineKeyframes";

/**
 * What the exports need from the timeline (docs/timeline/phases/07-page-parity.md P7.8, P7.9):
 * a resolver, the show's beats, and a frame sampler over them. Page mode never calls these.
 */

/**
 * The resolver for an export. The store's resolver is used when it is ready (the app keeps it
 * current while the file's timeline flag is on); otherwise one is cold-built from the tables,
 * the same way the store does it. A cold-built resolver is private to the export and not
 * subscribed to changes, which is fine: an export reads one moment.
 */
export async function acquireExportResolver(
    db: DbConnection,
): Promise<Resolver> {
    const { status, resolver } = useTimelineResolverStore.getState();
    if (status === "ready" && resolver) return resolver;
    const { snapshot } = await readTimelineTables(db);
    return createResolver(snapshot);
}

/** The show's beats with cumulative timestamps, as the tempo map (`timeMap.ts`) reads them. */
export async function readExportBeats(db: DbConnection): Promise<BeatTiming[]> {
    const rows = await getBeats({ db });
    return calculateTimestamps(rows.map((row, i) => fromDatabaseBeat(row, i)));
}

/**
 * Samples every marcher's position at a show time for the video export: seconds become a beat
 * through `beatAtTime`, and the resolver fills one reused `Float64Array`. Positions are applied
 * by marcher id, so a canvas marcher the resolver doesn't know stays where it is.
 */
export class ResolverFrameSampler {
    private readonly buffer: TimelinePositionBuffer;

    constructor(
        resolver: Pick<Resolver, "marcherIds" | "positionsAt">,
        private readonly beats: readonly BeatTiming[],
    ) {
        const source: TimelinePositionSource = {
            marcherIds: () => resolver.marcherIds(),
            positionsAt: (beat, out) => {
                resolver.positionsAt(beat, out);
                return true;
            },
        };
        this.buffer = new TimelinePositionBuffer(source);
    }

    /** The beat a show time maps to; what `apply` samples at. */
    beatAt(timeSeconds: number): number {
        return beatAtTime(this.beats, timeSeconds);
    }

    /** Calls `apply(marcher, x, y)` for each marcher the resolver knows, at `timeSeconds`. */
    apply<M extends MarcherWithId>(
        timeSeconds: number,
        marchers: Iterable<M>,
        apply: (marcher: M, x: number, y: number) => void,
    ): void {
        if (!this.buffer.fill(this.beatAt(timeSeconds))) return;
        this.buffer.forEachMarcher(marchers, apply);
    }
}

/**
 * Builds the keyframe export for the open file and returns it as JSON text. A dev and console
 * export only (`window.openmarchTimeline.exportKeyframes()`); no UI, and nothing reads it back.
 */
export async function exportTimelineKeyframesJson(
    db: DbConnection,
    options: KeyframeExportOptions = {},
): Promise<string> {
    const [resolver, beats] = await Promise.all([
        acquireExportResolver(db),
        readExportBeats(db),
    ]);
    return keyframesToJson(
        buildKeyframes(resolver, beats, options),
        options.tolerance ?? DEFAULT_KEYFRAME_TOLERANCE,
    );
}
