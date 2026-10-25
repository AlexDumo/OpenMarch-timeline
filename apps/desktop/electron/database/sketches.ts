/**
 * Reads and writes the Sketchpad's tables (ADR 0006 D-5) with prepared statements. Main's
 * `sketch:*` handlers call these after checking the sender and validating the payload
 * (`src/sketchpad/protocol.ts`); nothing here trusts its input more than the schemas do.
 *
 * The tables have no undo triggers, so these writes never reach `history_undo`. Each function is
 * synchronous: `node:sqlite` is, so a write can't interleave with the editor's statements.
 */
import { createHash } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type {
    RemovedSketch,
    SketchListItem,
    SketchTemplateListItem,
} from "../../src/sketchpad/protocol";

type Db = Pick<DatabaseSync, "prepare" | "exec" | "isTransaction">;

/** A validated sketch to store: the doc and its render, as `sketchSaveSchema` checked them */
export interface SketchToSave {
    doc: { id: string; name: string; field: unknown };
    render: { pages: unknown[]; thumbnail: Uint8Array | null };
}

/** A validated template to store in the show */
export interface TemplateToSave {
    id: string;
    name: string;
    style: unknown;
}

export const sha256Hex = (data: Uint8Array) =>
    createHash("sha256").update(data).digest("hex");

const nowIso = () => new Date().toISOString();

/** Milliseconds for a stored time: ours are ISO strings, SQLite's defaults are "YYYY-MM-DD HH:MM:SS" UTC */
export function storedTimeMs(value: string): number {
    const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? 0 : ms;
}

/** Runs `fn` in one transaction, or inside the caller's */
function inTransaction<T>(db: Db, fn: () => T): T {
    if (db.isTransaction) return fn();
    db.exec("BEGIN IMMEDIATE");
    try {
        const result = fn();
        db.exec("COMMIT");
        return result;
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}

const toBytes = (value: unknown): Uint8Array | null =>
    value == null ? null : new Uint8Array(value as Uint8Array);

/* ------------------------------ sketches ------------------------------ */

/** The show's sketches, highest `sort_index` first (newest, unless one was duplicated) */
export function listSketches(db: Db): SketchListItem[] {
    const rows = db
        .prepare(
            "SELECT id, name, updated_at, thumbnail FROM sketches WHERE kind = 'sketch' ORDER BY sort_index DESC, updated_at DESC",
        )
        .all() as {
        id: string;
        name: string;
        updated_at: string;
        thumbnail: Uint8Array | null;
    }[];
    return rows.map((r) => ({
        id: r.id,
        name: r.name,
        updatedAt: storedTimeMs(r.updated_at),
        thumbnail: toBytes(r.thumbnail),
    }));
}

/** A sketch's `doc_json`, or null when there's no such sketch */
export function loadSketchJson(db: Db, id: string): string | null {
    const row = db
        .prepare(
            "SELECT doc_json FROM sketches WHERE id = ? AND kind = 'sketch'",
        )
        .get(id) as { doc_json: string } | undefined;
    return row?.doc_json ?? null;
}

const nextSortIndex = (db: Db) =>
    Number(
        (
            db
                .prepare(
                    "SELECT coalesce(max(sort_index), 0) + 1 AS n FROM sketches",
                )
                .get() as { n: number }
        ).n,
    );

/**
 * Stores a sketch: a new one goes to the top of the list; a stored one keeps its place and
 * creation time. Idempotent; the last write wins (ADR 0006 D-4).
 */
export function saveSketch(db: Db, { doc, render }: SketchToSave): void {
    const at = nowIso();
    inTransaction(db, () => {
        const existing = db
            .prepare("SELECT kind FROM sketches WHERE id = ?")
            .get(doc.id) as { kind: string } | undefined;
        if (existing && existing.kind !== "sketch")
            throw new Error(`${doc.id} is a template, not a sketch`);
        db.prepare(
            `INSERT INTO sketches (id, kind, name, field_json, doc_json, render_json, thumbnail, sort_index, created_at, updated_at)
             VALUES (?, 'sketch', ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET
                name = excluded.name,
                field_json = excluded.field_json,
                doc_json = excluded.doc_json,
                render_json = excluded.render_json,
                thumbnail = excluded.thumbnail,
                updated_at = excluded.updated_at`,
        ).run(
            doc.id,
            doc.name,
            JSON.stringify(doc.field),
            JSON.stringify(doc),
            JSON.stringify({ pages: render.pages }),
            render.thumbnail,
            existing ? 0 : nextSortIndex(db),
            at,
            at,
        );
    });
}

/** Renames a sketch, in its row and in its doc. Returns false when there's no such sketch. */
export function renameSketch(db: Db, id: string, name: string): boolean {
    const result = db
        .prepare(
            "UPDATE sketches SET name = ?, doc_json = json_set(doc_json, '$.name', ?), updated_at = ? WHERE id = ? AND kind = 'sketch'",
        )
        .run(name, name, nowIso(), id);
    return Number(result.changes) > 0;
}

/**
 * Copies a sketch as "<name> copy", right below the original in the list, with its field
 * snapshot, render and thumbnail. Pins aren't copied. Returns null when there's no such sketch.
 */
export function duplicateSketch(
    db: Db,
    id: string,
    newId: string,
    kind: "sketch" | "template" = "sketch",
): { id: string; name: string } | null {
    return inTransaction(db, () => {
        const row = db
            .prepare(
                "SELECT name, sort_index FROM sketches WHERE id = ? AND kind = ?",
            )
            .get(id, kind) as { name: string; sort_index: number } | undefined;
        if (!row) return null;
        const below = db
            .prepare(
                "SELECT max(sort_index) AS s FROM sketches WHERE sort_index < ?",
            )
            .get(row.sort_index) as { s: number | null };
        const sortIndex =
            (row.sort_index + (below.s ?? row.sort_index - 1)) / 2;
        const name = `${row.name} copy`;
        const at = nowIso();
        db.prepare(
            `INSERT INTO sketches (id, kind, name, field_json, doc_json, render_json, thumbnail, sort_index, created_at, updated_at)
             SELECT ?, kind, ?, field_json, json_set(doc_json, '$.id', ?, '$.name', ?), render_json, thumbnail, ?, ?, ?
             FROM sketches WHERE id = ?`,
        ).run(newId, name, newId, name, sortIndex, at, at, id);
        return { id: newId, name };
    });
}

const PIN_COLUMNS = "id, sketch_id, page_id, beat_id, opacity, position";

/**
 * Deletes a sketch or a show template (its pins go with it) and returns everything
 * `restoreSketch` needs to bring it back, or null when there's no such row.
 */
export function removeSketch(db: Db, id: string): RemovedSketch | null {
    return inTransaction(db, () => {
        const sketch = db
            .prepare(
                "SELECT id, kind, name, field_json, doc_json, render_json, thumbnail, sort_index, created_at, updated_at FROM sketches WHERE id = ?",
            )
            .get(id) as RemovedSketch["sketch"] | undefined;
        if (!sketch) return null;
        const pins = db
            .prepare(
                `SELECT ${PIN_COLUMNS} FROM sketch_pins WHERE sketch_id = ?`,
            )
            .all(id) as RemovedSketch["pins"];
        db.prepare("DELETE FROM sketch_pins WHERE sketch_id = ?").run(id);
        db.prepare("DELETE FROM sketches WHERE id = ?").run(id);
        return {
            sketch: { ...sketch, thumbnail: toBytes(sketch.thumbnail) },
            pins: pins.map((p) => ({ ...p })),
        };
    });
}

/**
 * Brings back what `removeSketch` deleted. A pin whose beat is gone since comes back unpinned.
 * Does nothing when a row with that id exists again.
 */
export function restoreSketch(db: Db, removed: RemovedSketch): boolean {
    return inTransaction(db, () => {
        const s = removed.sketch;
        const inserted = db
            .prepare(
                `INSERT OR IGNORE INTO sketches (id, kind, name, field_json, doc_json, render_json, thumbnail, sort_index, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
                s.id,
                s.kind,
                s.name,
                s.field_json,
                s.doc_json,
                s.render_json,
                s.thumbnail,
                s.sort_index,
                s.created_at,
                s.updated_at,
            );
        if (Number(inserted.changes) === 0) return false;
        const beatExists = db.prepare("SELECT 1 FROM beats WHERE id = ?");
        const insertPin = db.prepare(
            `INSERT INTO sketch_pins (${PIN_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`,
        );
        for (const p of removed.pins) {
            const beat =
                p.beat_id !== null && beatExists.get(p.beat_id)
                    ? p.beat_id
                    : null;
            insertPin.run(
                // A pin made since may hold its id
                (db.prepare("SELECT 1 FROM sketch_pins WHERE id = ?").get(p.id)
                    ? null
                    : p.id) as SQLInputValue,
                s.id,
                p.page_id,
                beat,
                p.opacity,
                p.position,
            );
        }
        return true;
    });
}

/* -------------------------------- files -------------------------------- */

export function getSketchFile(
    db: Db,
    sha256: string,
): { mime: string; data: Uint8Array } | null {
    const row = db
        .prepare("SELECT mime, data FROM sketch_files WHERE sha256 = ?")
        .get(sha256) as { mime: string; data: Uint8Array } | undefined;
    return row ? { mime: row.mime, data: new Uint8Array(row.data) } : null;
}

/** Stores an image once, under the sha256 of its bytes (computed here, never taken from the caller) */
export function putSketchFile(
    db: Db,
    file: { mime: string; data: Uint8Array },
): string {
    const sha256 = sha256Hex(file.data);
    db.prepare(
        "INSERT OR IGNORE INTO sketch_files (sha256, mime, data, created_at) VALUES (?, ?, ?, ?)",
    ).run(sha256, file.mime, file.data, nowIso());
    return sha256;
}

/** The image ids live elements of stored sketches and show templates refer to */
export function referencedSketchFileIds(db: Db): Set<string> {
    const rows = db
        .prepare(
            `SELECT DISTINCT json_extract(e.value, '$.fileId') AS id
             FROM sketches, json_each(sketches.doc_json, '$.pages') AS p, json_each(p.value, '$.elements') AS e
             WHERE json_extract(e.value, '$.type') = 'image'
               AND coalesce(json_extract(e.value, '$.isDeleted'), 0) = 0
               AND json_extract(e.value, '$.fileId') IS NOT NULL`,
        )
        .all() as { id: string }[];
    return new Set(rows.map((r) => r.id));
}

/** Deletes images no sketch refers to (ADR 0006 D-5). Returns how many went. */
export function pruneSketchFiles(db: Db): number {
    return inTransaction(db, () => {
        const keep = referencedSketchFileIds(db);
        const all = db.prepare("SELECT sha256 FROM sketch_files").all() as {
            sha256: string;
        }[];
        const remove = db.prepare("DELETE FROM sketch_files WHERE sha256 = ?");
        let removed = 0;
        for (const { sha256 } of all) {
            if (keep.has(sha256)) continue;
            remove.run(sha256);
            removed++;
        }
        return removed;
    });
}

/* ------------------------------ templates ------------------------------ */

export function listShowTemplates(db: Db): SketchTemplateListItem[] {
    const rows = db
        .prepare(
            "SELECT id, name, updated_at, thumbnail FROM sketches WHERE kind = 'template' ORDER BY sort_index DESC",
        )
        .all() as {
        id: string;
        name: string;
        updated_at: string;
        thumbnail: Uint8Array | null;
    }[];
    return rows.map((r) => ({
        id: r.id,
        name: r.name,
        destination: "show",
        updatedAt: storedTimeMs(r.updated_at),
        thumbnail: toBytes(r.thumbnail),
    }));
}

/** Renames a show template, in its row and its JSON. Returns false when there's no such template. */
export function renameShowTemplate(db: Db, id: string, name: string): boolean {
    const result = db
        .prepare(
            "UPDATE sketches SET name = ?, doc_json = json_set(doc_json, '$.name', ?), updated_at = ? WHERE id = ? AND kind = 'template'",
        )
        .run(name, name, nowIso(), id);
    return Number(result.changes) > 0;
}

/** A show template's thumbnail, or null */
export function showTemplateThumbnail(db: Db, id: string): Uint8Array | null {
    const row = db
        .prepare(
            "SELECT thumbnail FROM sketches WHERE id = ? AND kind = 'template'",
        )
        .get(id) as { thumbnail: Uint8Array | null } | undefined;
    return toBytes(row?.thumbnail);
}

/** A show template's JSON, or null when there's no such template */
export function loadShowTemplateJson(db: Db, id: string): string | null {
    const row = db
        .prepare(
            "SELECT doc_json FROM sketches WHERE id = ? AND kind = 'template'",
        )
        .get(id) as { doc_json: string } | undefined;
    return row?.doc_json ?? null;
}

/**
 * Stores a template in the show: a `sketches` row with `kind = 'template'` (ADR 0006 D-6). A
 * thumbnail left out keeps the stored one.
 */
export function saveShowTemplate(
    db: Db,
    template: TemplateToSave,
    thumbnail?: Uint8Array | null,
): void {
    const at = nowIso();
    inTransaction(db, () => {
        const existing = db
            .prepare("SELECT kind FROM sketches WHERE id = ?")
            .get(template.id) as { kind: string } | undefined;
        if (existing && existing.kind !== "template")
            throw new Error(`${template.id} is a sketch, not a template`);
        db.prepare(
            `INSERT INTO sketches (id, kind, name, field_json, doc_json, thumbnail, sort_index, created_at, updated_at)
             VALUES (?, 'template', ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET
                name = excluded.name,
                field_json = excluded.field_json,
                doc_json = excluded.doc_json,
                thumbnail = CASE WHEN ? THEN thumbnail ELSE excluded.thumbnail END,
                updated_at = excluded.updated_at`,
        ).run(
            template.id,
            template.name,
            JSON.stringify({ style: template.style }),
            JSON.stringify(template),
            thumbnail ?? null,
            existing ? 0 : nextSortIndex(db),
            at,
            at,
            thumbnail === undefined ? 1 : 0,
        );
    });
}

export function removeShowTemplate(db: Db, id: string): boolean {
    const result = db
        .prepare("DELETE FROM sketches WHERE id = ? AND kind = 'template'")
        .run(id);
    return Number(result.changes) > 0;
}

/** The images a template's live elements refer to, read from the show, for a Library copy */
export function templateFiles(
    db: Db,
    template: { pages: { elements: Record<string, unknown>[] }[] },
): Record<string, { mime: string; data: Uint8Array }> {
    const files: Record<string, { mime: string; data: Uint8Array }> = {};
    for (const page of template.pages)
        for (const el of page.elements) {
            if (el.type !== "image" || el.isDeleted) continue;
            const id = el.fileId;
            if (typeof id !== "string" || files[id]) continue;
            const file = getSketchFile(db, id);
            if (file) files[id] = file;
        }
    return files;
}
