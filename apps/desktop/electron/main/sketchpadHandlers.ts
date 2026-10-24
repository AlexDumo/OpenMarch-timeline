/**
 * What main's `sketch:*` channels do (ADR 0006 D-4, D-6), apart from who may call them, which
 * `sketchpadWindow.ts` checks. Every payload arrives unchecked and is validated here with the
 * schemas in `src/sketchpad/protocol.ts` before it reaches the show's database or the Library.
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import * as z from "zod";
import {
    removedSketchSchema,
    SKETCH_DOC_MAX_BYTES,
    sketchFileIdSchema,
    sketchIdSchema,
    sketchPutFileSchema,
    sketchRenameSchema,
    sketchSaveSchema,
    sketchTemplateSchema,
    templateRefSchema,
    templateSaveSchema,
    type RemovedSketch,
    type SketchListItem,
    type SketchTemplateListItem,
} from "../../src/sketchpad/protocol";
import type { SketchDoc, SketchTemplate } from "@openmarch/sketchpad";
import * as Sketches from "../database/sketches";
import type { LibraryStore } from "./library/store";

export interface SketchHandlerDeps {
    /**
     * The show's connection, once no transaction is open on it (the editor's statements share
     * it). Throws when no show is open. Use it before awaiting anything else, so the editor
     * can't begin a transaction in between.
     */
    getDb: () => Promise<
        Pick<DatabaseSync, "prepare" | "exec" | "isTransaction">
    >;
    /** The Library, for templates saved to "My Library" */
    getLibraryStore: () => Promise<LibraryStore>;
    /** A sketch or template changed: tell the editor */
    onChanged: (id: string | null) => void;
}

/** A sketch the editor deleted can't come back from a save the window had in flight */
const removedIds = new Set<string>();

function parseStored<T>(schema: z.ZodType<T>, json: string, what: string): T {
    const result = schema.safeParse(JSON.parse(json));
    if (!result.success) throw new Error(`${what} is unreadable`);
    return result.data;
}

// eslint-disable-next-line max-lines-per-function -- one object of small handlers
export function createSketchHandlers(deps: SketchHandlerDeps) {
    const { getDb, onChanged } = deps;

    return {
        async list(): Promise<SketchListItem[]> {
            return Sketches.listSketches(await getDb());
        },

        async load(payload: unknown): Promise<SketchDoc> {
            const id = sketchIdSchema.parse(payload);
            const json = Sketches.loadSketchJson(await getDb(), id);
            if (json === null) throw new Error(`No sketch ${id}`);
            // The package's own parser checks the rest on load
            return JSON.parse(json) as SketchDoc;
        },

        async save(payload: unknown): Promise<void> {
            const { doc, render } = sketchSaveSchema.parse(payload);
            if (removedIds.has(doc.id)) return;
            if (JSON.stringify(doc).length > SKETCH_DOC_MAX_BYTES)
                throw new Error("The sketch is too large to save");
            Sketches.saveSketch(await getDb(), { doc, render });
            onChanged(doc.id);
        },

        async remove(payload: unknown): Promise<RemovedSketch | null> {
            const id = sketchIdSchema.parse(payload);
            const removed = Sketches.removeSketch(await getDb(), id);
            if (removed) {
                removedIds.add(id);
                onChanged(id);
            }
            return removed;
        },

        async restore(payload: unknown): Promise<boolean> {
            const removed = removedSketchSchema.parse(payload);
            removedIds.delete(removed.sketch.id);
            const restored = Sketches.restoreSketch(await getDb(), removed);
            if (restored) onChanged(removed.sketch.id);
            return restored;
        },

        async rename(payload: unknown): Promise<boolean> {
            const { id, name } = sketchRenameSchema.parse(payload);
            const renamed = Sketches.renameSketch(await getDb(), id, name);
            if (renamed) onChanged(id);
            return renamed;
        },

        async duplicate(
            payload: unknown,
        ): Promise<{ id: string; name: string } | null> {
            const id = sketchIdSchema.parse(payload);
            const copy = Sketches.duplicateSketch(
                await getDb(),
                id,
                randomUUID(),
            );
            if (copy) onChanged(copy.id);
            return copy;
        },

        async getFile(
            payload: unknown,
        ): Promise<{ mime: string; data: Uint8Array } | null> {
            const sha256 = sketchFileIdSchema.parse(payload);
            return Sketches.getSketchFile(await getDb(), sha256);
        },

        async putFile(payload: unknown): Promise<string> {
            const file = sketchPutFileSchema.parse(payload);
            return Sketches.putSketchFile(await getDb(), file);
        },

        async listTemplates(): Promise<SketchTemplateListItem[]> {
            const show = Sketches.listShowTemplates(await getDb());
            let library: SketchTemplateListItem[] = [];
            try {
                library = (
                    await (await deps.getLibraryStore()).listSketchTemplates()
                ).map((t) => ({
                    id: t.id,
                    name: t.name,
                    destination: "library",
                }));
            } catch (error) {
                // The show's templates still list without a readable Library
                console.warn("Couldn't list Library sketch templates", error);
            }
            return [...show, ...library];
        },

        async loadTemplate(payload: unknown): Promise<SketchTemplate> {
            const { id, destination } = templateRefSchema.parse(payload);
            if (destination === "show") {
                const json = Sketches.loadShowTemplateJson(await getDb(), id);
                if (json === null) throw new Error(`No template ${id}`);
                return parseStored(
                    sketchTemplateSchema,
                    json,
                    "The template",
                ) as unknown as SketchTemplate;
            }
            const entry = await (
                await deps.getLibraryStore()
            ).readSketchTemplate(id);
            const template = sketchTemplateSchema.parse(entry.data);
            // Its images come into the show, so sketches made from it have them. Nothing is
            // awaited from here on: the editor can't start a transaction in between.
            const db = await getDb();
            for (const [sha256, file] of Object.entries(entry.files)) {
                const put = sketchPutFileSchema.safeParse({
                    mime: file.mime,
                    data: new Uint8Array(Buffer.from(file.base64, "base64")),
                });
                if (put.success && Sketches.sha256Hex(put.data.data) === sha256)
                    Sketches.putSketchFile(db, put.data);
            }
            return template as unknown as SketchTemplate;
        },

        async saveTemplate(payload: unknown): Promise<void> {
            const { template, destination } = templateSaveSchema.parse(payload);
            if (JSON.stringify(template).length > SKETCH_DOC_MAX_BYTES)
                throw new Error("The template is too large to save");
            const db = await getDb();
            if (destination === "show") {
                Sketches.saveShowTemplate(db, template);
            } else {
                const files = Object.fromEntries(
                    Object.entries(Sketches.templateFiles(db, template)).map(
                        ([sha256, f]) => [
                            sha256,
                            {
                                mime: f.mime,
                                base64: Buffer.from(f.data).toString("base64"),
                            },
                        ],
                    ),
                );
                await (
                    await deps.getLibraryStore()
                ).saveSketchTemplate({
                    id: template.id,
                    name: template.name,
                    data: template as z.core.util.JSONType,
                    files,
                });
            }
            onChanged(template.id);
        },

        async removeTemplate(payload: unknown): Promise<void> {
            const { id, destination } = templateRefSchema.parse(payload);
            if (destination === "show")
                Sketches.removeShowTemplate(await getDb(), id);
            else await (await deps.getLibraryStore()).deleteSketchTemplate(id);
            onChanged(id);
        },
    };
}

export type SketchHandlers = ReturnType<typeof createSketchHandlers>;

/** For tests: forget which sketches were deleted */
export function _resetRemovedSketchIds() {
    removedIds.clear();
}
