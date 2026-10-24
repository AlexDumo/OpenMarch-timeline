// @vitest-environment node
/**
 * The main process prunes the show Library on close and before Save Copy (C2.1). It loads the
 * prune lazily, so the prune's modules must load where there's no window, no stores and no
 * renderer: this test loads it in plain Node and runs it on a real file.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { migrationsFolder } from "./convertOnOpenFixtures";

const HASH = "a".repeat(64);

describe("pruneShowLibraryAt", () => {
    let dir: string;
    let file: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "om-prune-"));
        file = path.join(dir, "show.dots");
        // A new show: every migration applied
        fs.copyFileSync(path.join(migrationsFolder, "_blank.dots"), file);
        const db = new DatabaseSync(file);
        try {
            db.prepare(
                "INSERT INTO library_blobs (hash, data) VALUES (?, ?)",
            ).run(HASH, new Uint8Array([1, 2, 3]));
            db.prepare(
                "INSERT INTO library_items (item_id, version_hash, kind, name, parts, metadata) VALUES (?, ?, 'model', 'Rifle', ?, '{}')",
            ).run(
                "11111111-1111-4111-8111-111111111111",
                "b".repeat(64),
                JSON.stringify({ glb: HASH }),
            );
        } finally {
            db.close();
        }
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it("loads without the renderer and prunes what nothing keeps", async () => {
        expect(typeof (globalThis as { window?: unknown }).window).toBe(
            "undefined",
        );
        const { pruneShowLibraryAt } = await import("../showLibraryPrune");
        await pruneShowLibraryAt(file);
        const db = new DatabaseSync(file);
        try {
            const count = (table: string) =>
                (
                    db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {
                        n: number;
                    }
                ).n;
            expect([count("library_items"), count("library_blobs")]).toEqual([
                0, 0,
            ]);
        } finally {
            db.close();
        }
    });
});
