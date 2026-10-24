/**
 * The tempo write path (docs/tempo/README.md): retimes that change only beat durations, with the
 * audio offset and the synced counts they move, as one transaction and one undo entry.
 *
 * A retime keeps every beat id, its order and every page edge, so the timeline ripple is a no-op
 * for it (`timelineRipple.ts`, `sameGrid`) and drill can never refuse it. `retimeBeatsInTransaction`
 * checks that the page grid is unchanged anyway and refuses the edit if it isn't.
 */
import { asc, eq } from "drizzle-orm";
import { schema } from "@/global/database/db";
import { FIRST_BEAT_ID } from "./beat";
import { transactionWithHistory } from "./history";
import { readPageGrid, sameGrid } from "./timelineRipple";
import type { DbConnection, DbTransaction } from "./types";
import { updateWorkspaceSettingsWithHistoryInTransaction } from "./workspaceSettings";
import type { WorkspaceSettings } from "@/settings/workspaceSettings";

/** A retime the write path refused. `code` says why. */
export class TempoWriteError extends Error {
    readonly code:
        | "bad-duration"
        | "unknown-beat"
        | "first-beat"
        | "grid-changed";

    constructor(code: TempoWriteError["code"], message: string) {
        super(message);
        this.name = "TempoWriteError";
        this.code = code;
    }
}

/** The show's counts as the pure tempo library takes them: beat ids and durations by ordinal. */
export interface ShowCountDurations {
    /** Beat ids in position order; the ordinal of a beat is its index here. */
    beatIds: number[];
    /** `durations[i]` is the duration of `beatIds[i]`, in seconds. */
    durations: number[];
}

/** Reads every beat's id and duration in position order. */
export async function readCountDurationsInTransaction(
    tx: DbTransaction | DbConnection,
): Promise<ShowCountDurations> {
    const rows = await tx
        .select({ id: schema.beats.id, duration: schema.beats.duration })
        .from(schema.beats)
        .orderBy(asc(schema.beats.position), asc(schema.beats.id))
        .all();
    return {
        beatIds: rows.map((r) => r.id),
        durations: rows.map((r) => r.duration),
    };
}

/**
 * Pairs the pure library's durations (by ordinal) with beat ids, for `retimeBeats`. Throws if the
 * lengths differ, which means the show's beats changed since the durations were computed.
 */
export function durationsByBeatId(
    beatIds: readonly number[],
    durations: readonly number[],
): Map<number, number> {
    if (beatIds.length !== durations.length)
        throw new TempoWriteError(
            "grid-changed",
            `the show has ${beatIds.length} counts but the retime has ${durations.length}`,
        );
    return new Map(beatIds.map((id, i) => [id, durations[i]]));
}

export interface RetimeBeatsArgs {
    /** New durations in seconds by beat id. Beats left out keep theirs. */
    newDurationsByBeatId:
        | ReadonlyMap<number, number>
        | Readonly<Record<number, number>>;
    /**
     * How far count 1 moved against the music, in seconds (`RetimeResult.originShift`). The audio
     * offset changes by minus this, so the music keeps its place relative to the counts. Omit or 0
     * when count 1 didn't move.
     */
    originShift?: number;
    /** Replaces the synced beat ids (`tempoSyncedBeatIds`) in the same undo entry. */
    syncedBeatIds?: readonly number[];
    /** Replaces the tempo map's typed rows (`tempoMapMarks`) in the same undo entry. */
    tempoMapMarks?: TempoMapMarkSetting[];
}

/** A tempo map row as stored in the workspace settings. */
export type TempoMapMarkSetting = NonNullable<
    WorkspaceSettings["tempoMapMarks"]
>[number];

const entriesOf = (
    m: RetimeBeatsArgs["newDurationsByBeatId"],
): [number, number][] =>
    m instanceof Map
        ? [...m.entries()]
        : Object.entries(m).map(([k, v]) => [Number(k), v as number]);

/**
 * Writes new beat durations (and, optionally, the audio offset and synced beats) inside `tx`.
 * Refuses durations that aren't finite and non-negative, unknown beats, and a change to the fixed
 * first beat. Unchanged durations are skipped. Throws `TempoWriteError` with `grid-changed` if the
 * page grid differs afterwards, which a duration-only edit can't cause.
 *
 * @returns the beat ids whose duration changed
 */
export async function retimeBeatsInTransaction({
    tx,
    newDurationsByBeatId,
    originShift = 0,
    syncedBeatIds,
    tempoMapMarks,
}: RetimeBeatsArgs & { tx: DbTransaction }): Promise<number[]> {
    const before = await readPageGrid(tx);
    const current = await readCountDurationsInTransaction(tx);
    const durationOf = new Map(
        current.beatIds.map((id, i) => [id, current.durations[i]]),
    );

    const changed: [number, number][] = [];
    for (const [id, duration] of entriesOf(newDurationsByBeatId)) {
        if (!Number.isFinite(duration) || duration < 0)
            throw new TempoWriteError(
                "bad-duration",
                `beat ${id} can't last ${duration} seconds`,
            );
        const old = durationOf.get(id);
        if (old === undefined)
            throw new TempoWriteError("unknown-beat", `there is no beat ${id}`);
        if (old === duration) continue;
        if (id === FIRST_BEAT_ID)
            throw new TempoWriteError(
                "first-beat",
                "the first beat is fixed and can't be retimed",
            );
        changed.push([id, duration]);
    }

    for (const [id, duration] of changed)
        await tx
            .update(schema.beats)
            .set({ duration })
            .where(eq(schema.beats.id, id))
            .run();

    if (!sameGrid(before, await readPageGrid(tx)))
        throw new TempoWriteError(
            "grid-changed",
            "a retime changed the pages or counts; only count lengths may change",
        );

    if (!Number.isFinite(originShift))
        throw new TempoWriteError(
            "bad-duration",
            `count 1 can't move by ${originShift} seconds`,
        );
    if (
        originShift !== 0 ||
        syncedBeatIds !== undefined ||
        tempoMapMarks !== undefined
    ) {
        const known = new Set(current.beatIds);
        const synced = syncedBeatIds?.filter((id) => known.has(id));
        const marks = tempoMapMarks
            ?.filter((m) => known.has(m.beatId))
            .sort((a, b) => a.beatId - b.beatId);
        await updateWorkspaceSettingsWithHistoryInTransaction({
            tx,
            update: (s) => ({
                ...s,
                audioOffsetSeconds: s.audioOffsetSeconds - originShift,
                ...(synced === undefined
                    ? {}
                    : {
                          tempoSyncedBeatIds: [...new Set(synced)].sort(
                              (a, b) => a - b,
                          ),
                      }),
                ...(marks === undefined ? {} : { tempoMapMarks: marks }),
            }),
        });
    }
    return changed.map(([id]) => id);
}

/**
 * `retimeBeatsInTransaction` as its own undo entry. A retime that changes nothing writes nothing
 * and adds no undo entry.
 *
 * @returns the beat ids whose duration changed
 */
export async function retimeBeats({
    db,
    ...args
}: RetimeBeatsArgs & { db: DbConnection }): Promise<number[]> {
    if (!(await retimeChangesAnything({ db, ...args }))) return [];
    return await transactionWithHistory(db, "retimeBeats", (tx) =>
        retimeBeatsInTransaction({ tx, ...args }),
    );
}

/** Whether a retime would write anything (so `transactionWithHistory` has a change to record). */
async function retimeChangesAnything({
    db,
    newDurationsByBeatId,
    originShift = 0,
    syncedBeatIds,
    tempoMapMarks,
}: RetimeBeatsArgs & { db: DbConnection }): Promise<boolean> {
    if (originShift !== 0) return true;
    const current = await readCountDurationsInTransaction(db);
    const durationOf = new Map(
        current.beatIds.map((id, i) => [id, current.durations[i]]),
    );
    // Let the transaction refuse bad input with its own error
    if (
        entriesOf(newDurationsByBeatId).some(
            ([id, d]) => durationOf.get(id) !== d,
        )
    )
        return true;
    const known = new Set(current.beatIds);
    if (syncedBeatIds !== undefined) {
        const stored = (await readTempoSyncedBeatIds(db)).join(",");
        const next = [...new Set(syncedBeatIds.filter((id) => known.has(id)))]
            .sort((a, b) => a - b)
            .join(",");
        if (stored !== next) return true;
    }
    // The same marks again (a map edit that changes nothing) is no edit either (DE-4)
    if (tempoMapMarks === undefined) return false;
    const next = tempoMapMarks
        .filter((m) => known.has(m.beatId))
        .sort((a, b) => a.beatId - b.beatId);
    return canonical(await readTempoMapMarks(db)) !== canonical(next);
}

/** JSON with object keys sorted, so two marks compare by value */
const canonical = (value: unknown): string =>
    JSON.stringify(value, (_, v: unknown) =>
        v && typeof v === "object" && !Array.isArray(v)
            ? Object.fromEntries(
                  Object.entries(v as Record<string, unknown>).sort(
                      ([a], [b]) => a.localeCompare(b),
                  ),
              )
            : v,
    );

/** The tempo map marks stored in the file, as stored (none: an empty list). */
async function readTempoMapMarks(
    db: DbConnection | DbTransaction,
): Promise<unknown[]> {
    const row = await db.select().from(schema.workspace_settings).get();
    if (!row) return [];
    try {
        const marks = (JSON.parse(row.json_data) as { tempoMapMarks?: unknown })
            .tempoMapMarks;
        return Array.isArray(marks) ? marks : [];
    } catch {
        return [];
    }
}

/** The synced beat ids stored in the file, ascending. Ids of beats that no longer exist are left out. */
export async function readTempoSyncedBeatIds(
    db: DbConnection | DbTransaction,
): Promise<number[]> {
    const row = await db.select().from(schema.workspace_settings).get();
    if (!row) return [];
    let ids: unknown;
    try {
        ids = (JSON.parse(row.json_data) as { tempoSyncedBeatIds?: unknown })
            .tempoSyncedBeatIds;
    } catch {
        return [];
    }
    if (!Array.isArray(ids)) return [];
    const beats = await db
        .select({ id: schema.beats.id })
        .from(schema.beats)
        .all();
    const known = new Set(beats.map((b) => b.id));
    return [...new Set(ids)]
        .filter((id): id is number => Number.isInteger(id) && known.has(id))
        .sort((a, b) => a - b);
}

/**
 * Replaces the synced beat ids as its own undo entry (for Sync and Unsync without a retime).
 * Ids of beats that don't exist are dropped.
 */
export async function setTempoSyncedBeatIds({
    db,
    syncedBeatIds,
}: {
    db: DbConnection;
    syncedBeatIds: readonly number[];
}): Promise<void> {
    await retimeBeats({ db, newDurationsByBeatId: new Map(), syncedBeatIds });
}
