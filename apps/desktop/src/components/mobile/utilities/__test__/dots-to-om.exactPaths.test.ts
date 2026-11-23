import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, expect } from "vitest";
import {
    ExactPathListSchema,
    createExactPathReader,
    fromOpenMarchSchemaFile,
    toOpenMarchFile,
    toOpenMarchJson,
    type OpenMarchShowData,
} from "@openmarch/schema";
import { FieldProperties, TICKS_PER_BEAT } from "@openmarch/core";
import { betterSqliteTestWithProxy, getTempDotsPath } from "@/test/base";
import type { DB } from "@/global/database/db";
import * as DatabaseServices from "@/../electron/database/database.services";
import type { ConvertOnOpenDialogs } from "@/../electron/main/convertOnOpenFlow";
import { openShowFile } from "@/../electron/main/openShow";
import { FieldPropertiesSchema } from "@/components/field/fieldPropertiesSchema";
import { readShowTiming } from "@/timeline/showTiming";
import { pageEndBeat } from "@/timeline/pageEndBeat";
import { readTimelinePageSnapshot } from "@/timeline/timelinePagePositions";
import { stopTimelineResolver } from "@/timeline/timelineStore";
import { toOpenMarchSchema } from "../dots-to-om";
import { convertExactMoves, toSteps } from "../exact-paths-export";

/**
 * Exact paths in the `.om` export (issue #1163, spec Appendix M.7), on real shows: each show is
 * converted as the app does on open, exported, written to a file and read back, and played as a
 * reader plays it: with the schema package's reader (EP-R2) where it has an exact path, and a
 * straight line between sets where it has none. At every tick of the show, every performer must
 * be within 1/100 of a step of the app's `positionAt`.
 *
 * Runs on the v0.1.7 release files. More files, such as the parity shows, are opt-in, with a
 * report per show (gaps, counts and file sizes), and the exported files (`<show>.omz`) in a folder:
 *
 *     OM_EXACT_INPUTS=/a.dots:/b.dots OM_EXACT_REPORT=/tmp/report.json OM_EXACT_FILES=/tmp/om \
 *         pnpm --dir apps/desktop exec vitest run src/components/mobile/utilities/__test__/dots-to-om.exactPaths.test.ts
 */

const V017_DIR = path.resolve(
    __dirname,
    "../../../../../electron/database/__test__/v017-files",
);
const MIGRATIONS = path.resolve(
    __dirname,
    "../../../../../electron/database/migrations",
);
const RELEASE_FILES = ["small", "realistic", "field-image"].map((n) =>
    path.join(V017_DIR, `${n}.dots`),
);
const EXTRA = (process.env.OM_EXACT_INPUTS ?? "").split(":").filter(Boolean);
const REPORT = process.env.OM_EXACT_REPORT ?? "";
const FILES = process.env.OM_EXACT_FILES ?? "";

/** 1/100 of a step, in steps (the acceptance criterion) */
const TOLERANCE_STEPS = 0.01;

const noDialogs: ConvertOnOpenDialogs = {
    whilePreparing: (work) => work(undefined),
    backupFailed: async () => {},
    conversionFailed: async () => {},
};

async function openOnce(file: string, confirmed: boolean) {
    const result = await openShowFile(
        file,
        false,
        { migrationsFolder: MIGRATIONS, dialogs: () => noDialogs },
        { conversionConfirmed: confirmed },
    );
    result.db?.close();
    if (result.sqlSuspension !== undefined)
        DatabaseServices.resumeSqlProxy(result.sqlSuspension);
    DatabaseServices.forceResumeSqlProxy();
    DatabaseServices.closePersistentConnection();
    DatabaseServices.setDbPath("", false);
    return result.status;
}

/** Copies `input` and opens it through the main process's open path, converting if it asks. */
async function convertedShow(input: string): Promise<string> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openmarch-om-exact-"));
    const file = path.join(dir, path.basename(input));
    fs.copyFileSync(input, file);
    let status = await openOnce(file, false);
    if (status !== 200) status = await openOnce(file, true);
    expect(status).toBe(200);
    return file;
}

interface ShowReport {
    show: string;
    performers: number;
    pages: number;
    ticks: number;
    exactPaths: number;
    keys: number;
    maxKeys: number;
    shapes: Record<string, number>;
    worstGapSteps: number;
    worstAt: string;
    convertMs: number;
    exportMs: number;
    bytes: {
        json: number;
        jsonWithout: number;
        gzip: number;
        gzipWithout: number;
    };
}
const reports: ShowReport[] = [];

const gzipBytes = async (show: OpenMarchShowData) =>
    (await toOpenMarchFile(show, { compressed: true })).byteLength;

/**
 * A reader's straight line between sets: in the page holding `tick`, from the set before to the
 * page's own, by share of the page's ticks.
 */
function straightLines(show: OpenMarchShowData, endTick: number) {
    const pages = [...show.pages].sort(
        (a, b) => a.startBeatIndex - b.startBeatIndex,
    );
    const starts = pages.map((p) => p.startBeatIndex * TICKS_PER_BEAT);
    const at = new Map<string, readonly [number, number]>();
    for (const c of show.coordinates)
        at.set(`${c.marcherId}:${c.pageId}`, [c.xSteps, c.ySteps]);
    return (marcherId: string, tick: number): readonly [number, number] => {
        let k = 0;
        while (k + 1 < starts.length && starts[k + 1]! <= tick) k++;
        const to = at.get(`${marcherId}:${pages[k]!.id}`)!;
        if (k === 0) return to;
        const from = at.get(`${marcherId}:${pages[k - 1]!.id}`)!;
        const end = starts[k + 1] ?? endTick;
        const s =
            end > starts[k]! ? (tick - starts[k]!) / (end - starts[k]!) : 1;
        return [
            from[0] + s * (to[0] - from[0]),
            from[1] + s * (to[1] - from[1]),
        ];
    };
}

afterEach(() => stopTimelineResolver());

for (const input of [...RELEASE_FILES, ...EXTRA]) {
    const name = path.basename(input, ".dots");
    const it = betterSqliteTestWithProxy.extend<{ show: string }>({
        show: async ({ task }, use) => {
            const file = await convertedShow(input);
            fs.copyFileSync(file, getTempDotsPath(task));
            fs.rmSync(path.dirname(file), { recursive: true, force: true });
            await use(name);
        },
    });

    it(`${name}: exported exact paths play as the app does`, async ({
        show,
        db,
    }) => {
        const exportStarted = performance.now();
        const exported = await toOpenMarchSchema(db as unknown as DB);
        const exportMs = performance.now() - exportStarted;

        // The file as the phone gets it, read back with the schema package (which validates it)
        const bytes = await toOpenMarchFile(exported, { compressed: true });
        const data = await fromOpenMarchSchemaFile(
            bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer,
        );
        if (FILES) fs.writeFileSync(path.join(FILES, `${show}.omz`), bytes);
        const exactPaths = data.exactPaths ?? [];
        expect(ExactPathListSchema.safeParse(exactPaths).success).toBe(true);

        // The app's positions, in steps on the file's axes
        const snapshot = await readTimelinePageSnapshot(db);
        const convertStarted = performance.now();
        await convertExactMoves(
            snapshot.walks!,
            data.performers.map((p) => p.id),
        );
        const convertMs = performance.now() - convertStarted;
        const resolver = snapshot.walks!.resolver as unknown as {
            marcherIds(): readonly number[];
            positionsAt(beat: number, out: Float64Array): void;
        };
        const fieldRow = await db.query.field_properties.findFirst();
        const field = new FieldProperties(
            FieldPropertiesSchema.parse(JSON.parse(fieldRow!.json_data)),
        );
        const xs = field.xCheckpoints.map((c) => c.stepsFromCenterFront);
        const ys = field.yCheckpoints.map((c) => c.stepsFromCenterFront);
        const axes = {
            centerXPixels:
                ((Math.max(...xs) - Math.min(...xs)) / 2) * field.pixelsPerStep,
            fieldHeightSteps: Math.abs(Math.max(...ys) - Math.min(...ys)),
            pixelsPerStep: field.pixelsPerStep,
        };
        const { pages } = await readShowTiming(db);
        const endTick =
            Math.max(...pages.map((p) => pageEndBeat(p))) * TICKS_PER_BEAT;

        const reader = createExactPathReader(data);
        const straight = straightLines(data, endTick);
        const ids = resolver.marcherIds();
        const performerIds = new Set(data.performers.map((p) => p.id));
        const checked = ids
            .map((id, i) => [String(id), i] as const)
            .filter(([id]) => performerIds.has(Number(id)));
        const buffer = new Float64Array(2 * ids.length);
        let worst = 0;
        let worstAt = "";
        for (let tick = 0; tick <= endTick; tick++) {
            resolver.positionsAt(tick / TICKS_PER_BEAT, buffer);
            for (const [id, i] of checked) {
                const [ax, ay] = toSteps(
                    axes,
                    buffer[2 * i]!,
                    buffer[2 * i + 1]!,
                );
                const [x, y] =
                    reader.positionAt(id, tick) ?? straight(id, tick);
                const gap = Math.hypot(x - ax, y - ay);
                if (gap > worst) {
                    worst = gap;
                    worstAt = `marcher ${id} beat ${(tick / TICKS_PER_BEAT).toFixed(3)}`;
                }
            }
        }

        const shapes: Record<string, number> = {};
        let keys = 0;
        let maxKeys = 0;
        for (const e of exactPaths) {
            keys += e.path.keys.length;
            maxKeys = Math.max(maxKeys, e.path.keys.length);
            for (const s of e.path.shapes)
                shapes[s.kind] = (shapes[s.kind] ?? 0) + 1;
        }
        const without = { ...data, exactPaths: undefined };
        reports.push({
            show,
            performers: data.performers.length,
            pages: data.pages.length,
            ticks: endTick,
            exactPaths: exactPaths.length,
            keys,
            maxKeys,
            shapes,
            worstGapSteps: worst,
            worstAt,
            convertMs,
            exportMs,
            bytes: {
                json: toOpenMarchJson(data).length,
                jsonWithout: toOpenMarchJson(without).length,
                gzip: bytes.byteLength,
                gzipWithout: await gzipBytes(without),
            },
        });
        if (REPORT) fs.writeFileSync(REPORT, JSON.stringify(reports, null, 2));

        expect(worst, `${show}: ${worstAt}`).toBeLessThan(TOLERANCE_STEPS);
    }, 1_800_000);
}
