import { copyFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { eq } from "drizzle-orm";
import { drizzle as sqliteProxyDrizzle } from "drizzle-orm/sqlite-proxy";
import { schema } from "@/../electron/database/db";
import { createAllUndoTriggers, dropAllUndoTriggers } from "@/db-functions";
import type { DbConnection } from "@/db-functions/types";
import { createTrackInTransaction } from "@/db-functions/timelineCommands";
import { createTimelineShapesInTransaction } from "@/db-functions/timelineShapes";
import { applyTimelineModeToFile } from "@/test/timelineMode";
import { handleSqlProxyWithDbBetterSqlite } from "@/test/sqlProxyTestUtil";
import type { TempoTruth } from "./truth";

/**
 * Builds kit shows as `.dots` files with the app's own schema and functions: the page show
 * (beats, measures, pages, marchers, page sets) is written into a copy of the blank file, then
 * converted to timeline rows by the app's converter (`applyTimelineModeToFile`, which also turns
 * the timeline flag on), then any breakaway clips are added with `createTrackInTransaction`.
 */

const BLANK = path.join(
    __dirname,
    "..",
    "electron",
    "database",
    "migrations",
    "_blank.dots",
);

export interface KitMarcher {
    section: string;
    prefix: string;
    order: number;
}

/** A breakaway clip: some marchers into a line shape over a range of counts. */
export interface KitClip {
    name: string;
    marchers: { prefix: string; from: number; to: number };
    /** Count indexes (beat ordinals): the clip runs from `start` up to `end` */
    start: number;
    end: number;
    line: [[number, number], [number, number]];
}

export interface KitShowArgs {
    file: string;
    truth: TempoTruth;
    /** One per truth count: the show's beat durations */
    durations: number[];
    audioOffsetSeconds: number;
    audio?: { name: string; bytes: Uint8Array };
    marchers: KitMarcher[];
    clips?: KitClip[];
}

export const marchingBand = (
    sections: [section: string, prefix: string, n: number][],
): KitMarcher[] =>
    sections.flatMap(([section, prefix, n]) =>
        Array.from({ length: n }, (_, i) => ({
            section,
            prefix,
            order: i + 1,
        })),
    );

const STEP = 1800 / 160;

/** Page `k`'s set: a block, two lines, an arc or a wedge, drifting around the field. */
export const formation = (k: number, n: number): [number, number][] => {
    const cx = 900 + 160 * Math.sin(k * 0.7);
    const cy = 520 + 90 * Math.cos(k * 0.5);
    const kind = k % 4;
    return Array.from({ length: n }, (_, i): [number, number] => {
        if (kind === 0) {
            const cols = 10;
            const rows = Math.ceil(n / cols);
            return [
                cx + ((i % cols) - (cols - 1) / 2) * 3 * STEP,
                cy + (Math.floor(i / cols) - (rows - 1) / 2) * 3 * STEP,
            ];
        }
        if (kind === 1) {
            const per = Math.ceil(n / 2);
            return [
                cx + ((i % per) - (per - 1) / 2) * 2 * STEP,
                cy + (Math.floor(i / per) - 0.5) * 6 * STEP,
            ];
        }
        if (kind === 2) {
            const a = Math.PI * (0.15 + (0.7 * i) / Math.max(1, n - 1));
            return [
                cx - Math.cos(a) * 34 * STEP,
                cy + 14 * STEP - Math.sin(a) * 26 * STEP,
            ];
        }
        const side = i % 2 === 0 ? -1 : 1;
        const d = Math.floor(i / 2);
        return [cx + side * d * 1.6 * STEP, cy - 16 * STEP + d * 1.2 * STEP];
    });
};

const openOrm = (sqlite: DatabaseSync) =>
    sqliteProxyDrizzle(
        async (sql, params, method) =>
            handleSqlProxyWithDbBetterSqlite(sqlite, sql, params, method),
        { schema, casing: "snake_case" },
    ) as unknown as DbConnection;

const chunks = <T>(rows: T[], size = 400): T[][] =>
    Array.from({ length: Math.ceil(rows.length / size) }, (_, i) =>
        rows.slice(i * size, (i + 1) * size),
    );

/** Writes the page show into a fresh copy of the blank file. */
// eslint-disable-next-line max-lines-per-function
const writePageShow = async (args: KitShowArgs) => {
    const { truth, durations } = args;
    if (durations.length !== truth.counts.length)
        throw new Error(`${args.file}: one duration per count`);
    copyFileSync(BLANK, args.file);
    const sqlite = new DatabaseSync(args.file);
    try {
        const orm = openOrm(sqlite);
        await dropAllUndoTriggers(orm);
        await orm.transaction(async (tx) => {
            for (const rows of chunks(
                durations.map((duration, i) => ({
                    id: i + 1,
                    position: i + 1,
                    duration,
                })),
            ))
                await tx.insert(schema.beats).values(rows).run();
            await tx
                .insert(schema.measures)
                .values(
                    truth.measures.map((m, i) => ({
                        id: i + 1,
                        start_beat: m.firstCount,
                        rehearsal_mark: m.mark ?? null,
                    })),
                )
                .run();
            await tx
                .insert(schema.pages)
                .values(
                    truth.pages.map((count, i) => ({
                        id: i + 1,
                        start_beat: count,
                    })),
                )
                .run();
            const home = formation(0, args.marchers.length);
            await tx
                .insert(schema.marchers)
                .values(
                    args.marchers.map((m, i) => ({
                        id: i + 1,
                        section: m.section,
                        drill_prefix: m.prefix,
                        drill_order: m.order,
                        home_x: home[i]![0],
                        home_y: home[i]![1],
                    })),
                )
                .run();
            const sets = [0, ...truth.pages.map((_, i) => i + 1)].flatMap(
                (pageId) => {
                    const xy = formation(pageId, args.marchers.length);
                    return args.marchers.map((_, i) => ({
                        marcher_id: i + 1,
                        page_id: pageId,
                        x: xy[i]![0],
                        y: xy[i]![1],
                    }));
                },
            );
            for (const rows of chunks(sets))
                await tx.insert(schema.marcher_pages).values(rows).run();
            const lastPageCounts =
                truth.counts.length - truth.pages[truth.pages.length - 1]! + 1;
            await tx
                .update(schema.utility)
                .set({ last_page_counts: lastPageCounts })
                .run();
            const row = await tx.select().from(schema.workspace_settings).get();
            const settings = row
                ? (JSON.parse(row.json_data) as Record<string, unknown>)
                : {};
            await tx
                .update(schema.workspace_settings)
                .set({
                    json_data: JSON.stringify({
                        ...settings,
                        audioOffsetSeconds: args.audioOffsetSeconds,
                        measurementOffset: truth.firstMeasureNumber,
                        projectName: truth.title,
                    }),
                })
                .run();
        });
        if (args.audio)
            sqlite
                .prepare(
                    "INSERT INTO audio_files (path, nickname, data, selected) VALUES (?, ?, ?, 1)",
                )
                .run(args.audio.name, args.audio.name, args.audio.bytes);
        await orm.delete(schema.history_undo).run();
        await orm.delete(schema.history_redo).run();
        await createAllUndoTriggers(orm);
    } finally {
        sqlite.close();
    }
};

/** Adds breakaway clips to a converted show, outside undo history. */
const addClips = async (
    file: string,
    clips: KitClip[],
    marchers: KitMarcher[],
) => {
    const sqlite = new DatabaseSync(file);
    try {
        const orm = openOrm(sqlite);
        await dropAllUndoTriggers(orm);
        await orm.transaction(async (tx) => {
            for (const clip of clips) {
                const ids = marchers
                    .map((m, i) => ({ m, id: i + 1 }))
                    .filter(
                        ({ m }) =>
                            m.prefix === clip.marchers.prefix &&
                            m.order >= clip.marchers.from &&
                            m.order <= clip.marchers.to,
                    )
                    .map(({ id }) => id);
                const [shape] = await createTimelineShapesInTransaction({
                    tx,
                    newShapes: [
                        {
                            name: clip.name,
                            kind: "line",
                            geometry: { points: clip.line },
                        },
                    ],
                });
                const track = await createTrackInTransaction({
                    tx,
                    target: {
                        kind: "shape",
                        shapeId: shape!.id,
                        marcherIds: ids,
                    },
                    startBeat: clip.start,
                    endBeat: clip.end,
                });
                await tx
                    .update(schema.timelines)
                    .set({ name: clip.name })
                    .where(eq(schema.timelines.id, track.timelineId))
                    .run();
            }
        });
        await orm.delete(schema.timeline_change_log).run();
        await orm.delete(schema.history_undo).run();
        await orm.delete(schema.history_redo).run();
        await createAllUndoTriggers(orm);
    } finally {
        sqlite.close();
    }
};

/** Writes a kit show: page show, conversion to timeline mode, clips. */
export const buildShow = async (args: KitShowArgs): Promise<void> => {
    await writePageShow(args);
    await applyTimelineModeToFile(args.file);
    if (args.clips?.length)
        await addClips(args.file, args.clips, args.marchers);
};
