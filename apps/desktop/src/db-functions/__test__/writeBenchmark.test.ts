/**
 * Write-path benchmark for the collaboration spike's measurement (docs/collaboration/spike/
 * RESULTS.md). Skipped unless `OM_WRITE_BENCH=<output folder>` is set, so it never runs in CI.
 *
 *   OM_WRITE_BENCH=/tmp/bench pnpm exec vitest run src/db-functions/__test__/writeBenchmark.test.ts
 *
 * Runs real edits through db-functions on a copy of the `marchersAndPages` fixture (76 marchers,
 * 6 pages, converted to timelines), over the same `sql:proxy` handler the main process uses
 * (`handleSqlProxyWithDb` on `node:sqlite`), counting every statement. Modes:
 *
 * - `solo`: no session.
 * - `session`: `startCapture` + `setSyncSession` with a no-op `onLocalOp` (only on a checkout
 *   that has `src/sync/`; the file is the same on both sides of the comparison).
 *
 * Writes `<folder>/<label>.json` (`OM_WRITE_BENCH_LABEL`, default "run") with per-edit times
 * and statement counts, and `<label>-statements-<mode>.txt` with the SQL of one edit of each
 * workload, to diff between checkouts.
 */
import { sql } from "drizzle-orm";
import { drizzle as sqliteProxyDrizzle } from "drizzle-orm/sqlite-proxy";
import { DatabaseSync } from "node:sqlite";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { describe, it as vitestIt } from "vitest";
import { describeDbTests, schema, type DbConnection } from "@/test/base";
import { handleSqlProxyWithDb } from "@/../electron/database/database.services";
import { handleSqlReadBatchWithDb } from "@/../electron/database/sqlProxy";
import { createSqlReadBatch } from "@/global/database/sqlReadBatch";
import { createMarchers } from "@/db-functions/marcher";
import { moveMarchersOnPage } from "@/db-functions/timelineMoves";
import { readShowTiming } from "@/timeline/showTiming";

const OUT = process.env.OM_WRITE_BENCH;
const LABEL = process.env.OM_WRITE_BENCH_LABEL ?? "run";
const ROUNDS = Number(process.env.OM_WRITE_BENCH_ROUNDS ?? 7);

// Present only on the spike; empty on the merge base
const syncModules = import.meta.glob([
    "../../sync/capture.ts",
    "../../sync/session.ts",
    "../../sync/apply.ts",
]);

type LocalOpLike = { label: string; changes: unknown[]; workload?: string };
type SyncApi = {
    start: (db: DbConnection, ops: LocalOpLike[]) => Promise<void>;
    stop: (db: DbConnection) => Promise<void>;
    apply: (db: DbConnection, changes: unknown[]) => Promise<unknown>;
};

async function loadSync(): Promise<SyncApi | null> {
    const captureLoader = syncModules["../../sync/capture.ts"];
    const sessionLoader = syncModules["../../sync/session.ts"];
    const applyLoader = syncModules["../../sync/apply.ts"];
    if (!captureLoader || !sessionLoader || !applyLoader) return null;
    const applyMod = (await applyLoader()) as {
        applyRemoteChanges: (
            db: DbConnection,
            changes: unknown[],
        ) => Promise<unknown>;
    };
    const capture = (await captureLoader()) as {
        startCapture: (db: DbConnection) => Promise<void>;
        stopCapture: (db: DbConnection) => Promise<void>;
    };
    const session = (await sessionLoader()) as {
        setSyncSession: (s: unknown) => void;
        ID_BLOCK_SIZE: number;
    };
    return {
        apply: (db, changes) => applyMod.applyRemoteChanges(db, changes),
        start: async (db, ops) => {
            await capture.startCapture(db);
            session.setSyncSession({
                isLive: () => true,
                onLocalOp: (op: LocalOpLike) => ops.push(op),
                idBase: session.ID_BLOCK_SIZE,
            });
        },
        stop: async (db) => {
            session.setSyncSession(null);
            await capture.stopCapture(db);
        },
    };
}

/** A connection like the app's, on its own copy of `template`, counting statements. */
function openCounted(template: string) {
    const file = path.join(
        os.tmpdir(),
        `om-write-bench-${process.pid}-${Math.random().toString(36).slice(2)}.dots`,
    );
    fs.copyFileSync(template, file);
    const raw = new DatabaseSync(file);
    const counter = { statements: 0, log: null as string[] | null };
    const db = sqliteProxyDrizzle(
        async (query, params, method) => {
            counter.statements++;
            counter.log?.push(query);
            return handleSqlProxyWithDb(raw, query, params, method);
        },
        createSqlReadBatch(async (queries) => {
            counter.statements += queries.length;
            counter.log?.push(...queries.map((q) => `[batch] ${q.sql}`));
            return handleSqlReadBatchWithDb(raw, queries);
        }),
        { schema, casing: "snake_case" },
    ) as unknown as DbConnection;
    return {
        db,
        counter,
        close: () => {
            raw.close();
            fs.removeSync(file);
        },
    };
}

type Sample = { ms: number; statements: number };
type Workload = {
    name: string;
    edits: number;
    run: (db: DbConnection, i: number) => Promise<unknown>;
};

const median = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
};

const run = OUT
    ? describeDbTests
    : (name: string, tests: Parameters<typeof describeDbTests>[1]) =>
          describe.skip(name, () => tests(vitestIt as never, "better-sqlite3"));

run("write benchmark (collaboration spike measurement)", (it) => {
    it(
        "times edits solo and in a session",
        { timeout: 600_000 },
        async ({ db, marchersAndPages }) => {
            const template = path.join(
                os.tmpdir(),
                `om-write-bench-template-${process.pid}.dots`,
            );
            fs.removeSync(template);
            await db.run(sql.raw(`VACUUM INTO '${template}'`));

            const pages = [...(await readShowTiming(db)).pages].sort(
                (a, b) => a.order - b.order,
            );
            const page = pages[3]!;
            const ids = marchersAndPages.expectedMarchers.map((m) => m.id);

            const workloads: Workload[] = [
                {
                    name: "move 1 marcher (timeline move)",
                    edits: 40,
                    run: (d, i) =>
                        moveMarchersOnPage({
                            db: d,
                            page,
                            moves: [
                                {
                                    marcherId: ids[i % ids.length]!,
                                    x: 100 + i,
                                    y: 60 + (i % 7),
                                },
                            ],
                        }),
                },
                {
                    name: "move 10 marchers (timeline move)",
                    edits: 20,
                    run: (d, i) =>
                        moveMarchersOnPage({
                            db: d,
                            page,
                            moves: ids.slice(0, 10).map((marcherId, k) => ({
                                marcherId,
                                x: 200 + i + k * 3,
                                y: 80 + k,
                            })),
                        }),
                },
                {
                    name: "create 1 marcher",
                    edits: 15,
                    run: (d, i) =>
                        createMarchers({
                            db: d,
                            newMarchers: [
                                {
                                    section: "Brass",
                                    drill_prefix: "Z",
                                    drill_order: 100 + i,
                                },
                            ],
                        }),
                },
            ];

            const sync = await loadSync();
            const modes = sync
                ? (["solo", "session"] as const)
                : (["solo"] as const);
            const samples: Record<string, Record<string, Sample[][]>> = {};
            const statementLogs: Record<string, string[]> = {};

            // Round 0 is warm-up and is dropped; the mode order alternates by round
            for (let round = 0; round <= ROUNDS; round++) {
                const order = round % 2 ? [...modes].reverse() : modes;
                for (const mode of order) {
                    const c = openCounted(template);
                    try {
                        const ops: LocalOpLike[] = [];
                        if (mode === "session") await sync!.start(c.db, ops);
                        for (const w of workloads) {
                            const these: Sample[] = [];
                            for (let i = 0; i < w.edits; i++) {
                                const logThis = round === 1 && i === 1;
                                c.counter.log = logThis ? [] : null;
                                const before = c.counter.statements;
                                const t0 = performance.now();
                                await w.run(c.db, i);
                                const ms = performance.now() - t0;
                                these.push({
                                    ms,
                                    statements: c.counter.statements - before,
                                });
                                if (logThis)
                                    (statementLogs[mode] ??= []).push(
                                        `## ${w.name}`,
                                        ...c.counter.log!,
                                    );
                            }
                            c.counter.log = null;
                            for (const op of ops) op.workload ??= w.name;
                            if (round > 0)
                                ((samples[mode] ??= {})[w.name] ??= []).push(
                                    these,
                                );
                        }
                        if (mode === "session") {
                            await sync!.stop(c.db);
                            // The same ops, applied as remote ops on a fresh copy (a peer)
                            const peer = openCounted(template);
                            try {
                                const these: Record<string, Sample[]> = {};
                                for (const op of ops) {
                                    const before = peer.counter.statements;
                                    const t0 = performance.now();
                                    await sync!.apply(peer.db, op.changes);
                                    (these[op.workload!] ??= []).push({
                                        ms: performance.now() - t0,
                                        statements:
                                            peer.counter.statements - before,
                                    });
                                }
                                if (round > 0)
                                    for (const [name, list] of Object.entries(
                                        these,
                                    ))
                                        ((samples["remote apply"] ??= {})[
                                            name
                                        ] ??= []).push(list);
                            } finally {
                                peer.close();
                            }
                        }
                    } finally {
                        c.close();
                    }
                }
            }
            fs.removeSync(template);

            const summary: Record<string, Record<string, unknown>> = {};
            for (const [mode, byWorkload] of Object.entries(samples)) {
                summary[mode] = {};
                for (const [name, rounds] of Object.entries(byWorkload)) {
                    const roundMedians = rounds.map((r) =>
                        median(r.map((s) => s.ms)),
                    );
                    const all = rounds.flat();
                    summary[mode]![name] = {
                        medianMs: median(all.map((s) => s.ms)),
                        roundMediansMs: roundMedians.map(
                            (m) => Math.round(m * 1000) / 1000,
                        ),
                        minRoundMedianMs: Math.min(...roundMedians),
                        maxRoundMedianMs: Math.max(...roundMedians),
                        statementsPerEdit: {
                            min: Math.min(...all.map((s) => s.statements)),
                            median: median(all.map((s) => s.statements)),
                            max: Math.max(...all.map((s) => s.statements)),
                        },
                    };
                }
            }
            fs.ensureDirSync(OUT!);
            fs.writeJsonSync(
                path.join(OUT!, `${LABEL}.json`),
                { rounds: ROUNDS, summary },
                { spaces: 2 },
            );
            for (const [mode, log] of Object.entries(statementLogs))
                fs.writeFileSync(
                    path.join(OUT!, `${LABEL}-statements-${mode}.txt`),
                    log.join("\n") + "\n",
                );
        },
    );
});
