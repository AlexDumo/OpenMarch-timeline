/**
 * The show file's performer figures (ADR 0019, fork #1319): each look the show uses, seen from
 * straight above, baked by the editor for the 2D field. A cache: nothing else depends on a row,
 * a row no look uses is dropped when the figures are next written, and writing them isn't an
 * edit (`writeQuietly`), so it never publishes the show on its own.
 */
import type { DatabaseSync } from "node:sqlite";

/** One figure as the renderer sends and reads it. */
export interface PerformerFigureRow {
    /** lowercase hex sha256 of the look */
    fingerprint: string;
    /** WebP bytes */
    image: Uint8Array;
    /** JSON object: `{ w, h, pxPerMeter, cx, cy }` */
    layout: string;
}

/** What the editor writes: new figures, and every look the show still uses. */
export interface PerformerFiguresWrite {
    put: readonly PerformerFigureRow[];
    /** Fingerprints to keep; every other row goes. Null keeps every row. */
    keep: readonly string[] | null;
}

/**
 * The table, as migration 0031 makes it. Made here too when a file missed that migration (a file
 * from a branch whose migration is dated after it), so the figures never depend on the order
 * branches merged in.
 */
const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS \`performer_figures\` (
	\`fingerprint\` text PRIMARY KEY NOT NULL,
	\`image\` blob NOT NULL,
	\`layout\` text NOT NULL,
	\`created_at\` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT "performer_figures_fingerprint_check" CHECK(length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "performer_figures_layout_check" CHECK(json_valid(layout) AND json_type(layout) = 'object')
)`;

const FINGERPRINT = /^[0-9a-f]{64}$/;

const hasTable = (db: DatabaseSync) =>
    db
        .prepare(
            "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'performer_figures'",
        )
        .get() !== undefined;

/** Every figure in the file, or only those named. A file without the table has none. */
export function readPerformerFigures(
    db: DatabaseSync,
    fingerprints?: readonly string[],
): PerformerFigureRow[] {
    if (!hasTable(db)) return [];
    const rows = db
        .prepare(
            "SELECT fingerprint, image, layout FROM performer_figures ORDER BY fingerprint",
        )
        .all() as { fingerprint: string; image: Uint8Array; layout: string }[];
    const wanted = fingerprints ? new Set(fingerprints) : null;
    return rows
        .filter((row) => !wanted || wanted.has(row.fingerprint))
        .map((row) => ({
            fingerprint: row.fingerprint,
            image: new Uint8Array(row.image),
            layout: row.layout,
        }));
}

/** Checks a write from the renderer before anything touches the file. */
export function parsePerformerFiguresWrite(
    value: unknown,
): PerformerFiguresWrite {
    if (typeof value !== "object" || value === null)
        throw new Error("Performer figures: expected an object");
    const { put, keep } = value as Record<string, unknown>;
    if (!Array.isArray(put))
        throw new Error("Performer figures: `put` must be a list");
    if (keep !== null && !Array.isArray(keep))
        throw new Error("Performer figures: `keep` must be a list or null");
    const rows = put.map((row: unknown): PerformerFigureRow => {
        const r = row as Record<string, unknown>;
        if (
            typeof r?.fingerprint !== "string" ||
            !FINGERPRINT.test(r.fingerprint)
        )
            throw new Error("Performer figures: bad fingerprint");
        if (!(r.image instanceof Uint8Array) || r.image.byteLength === 0)
            throw new Error("Performer figures: bad image");
        if (typeof r.layout !== "string")
            throw new Error("Performer figures: bad layout");
        return { fingerprint: r.fingerprint, image: r.image, layout: r.layout };
    });
    if (keep)
        for (const k of keep)
            if (typeof k !== "string" || !FINGERPRINT.test(k))
                throw new Error("Performer figures: bad fingerprint to keep");
    return { put: rows, keep: keep as readonly string[] | null };
}

/** Writes new figures and drops the ones no look uses, in one transaction. */
export function writePerformerFigures(
    db: DatabaseSync,
    { put, keep }: PerformerFiguresWrite,
): void {
    db.exec("BEGIN IMMEDIATE");
    try {
        db.exec(CREATE_TABLE);
        if (keep) {
            const kept = new Set([...keep, ...put.map((r) => r.fingerprint)]);
            const stale = (
                db
                    .prepare("SELECT fingerprint FROM performer_figures")
                    .all() as {
                    fingerprint: string;
                }[]
            ).filter((row) => !kept.has(row.fingerprint));
            const drop = db.prepare(
                "DELETE FROM performer_figures WHERE fingerprint = ?",
            );
            for (const row of stale) drop.run(row.fingerprint);
        }
        const insert = db.prepare(
            "INSERT OR REPLACE INTO performer_figures (fingerprint, image, layout) VALUES (?, ?, ?)",
        );
        for (const row of put)
            insert.run(row.fingerprint, row.image, row.layout);
        db.exec("COMMIT");
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}
