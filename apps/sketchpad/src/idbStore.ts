import {
    parseSketchDoc,
    sha256Hex,
    type SketchDoc,
    type SketchRender,
    type SketchStore,
    type SketchSummary,
    type SketchTemplate,
    type TemplateSummary,
} from "@openmarch/sketchpad";

/**
 * A `SketchStore` in the browser's IndexedDB. The static site has no show and no Library, so
 * templates are saved in this browser only ("show" templates, ADR 0006 D-6).
 */

const DB_NAME = "openmarch-sketchpad";
const DB_VERSION = 1;

interface SketchRow {
    id: string;
    name: string;
    updatedAt: number;
    doc: string;
    render: Omit<SketchRender, "thumbnail">;
    thumbnail: Blob | null;
}

interface TemplateRow {
    id: string;
    name: string;
    destination: string;
    template: SketchTemplate;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function openDb(): Promise<IDBDatabase> {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("sketches", { keyPath: "id" });
        db.createObjectStore("files");
        db.createObjectStore("templates", { keyPath: "id" });
    };
    return request(req);
}

export const sha256 = (blob: Blob): Promise<string> => sha256Hex(blob);

// eslint-disable-next-line max-lines-per-function -- one object literal of small methods
export function createIndexedDbStore(): SketchStore {
    const db = openDb();
    const tx = async (name: string, mode: IDBTransactionMode = "readonly") =>
        (await db).transaction(name, mode).objectStore(name);

    return {
        async list(): Promise<SketchSummary[]> {
            const rows = (await request(
                (await tx("sketches")).getAll(),
            )) as SketchRow[];
            return rows.map(({ id, name, updatedAt }) => ({
                id,
                name,
                updatedAt,
            }));
        },
        async load(id: string): Promise<SketchDoc> {
            const row = (await request((await tx("sketches")).get(id))) as
                | SketchRow
                | undefined;
            if (!row) throw new Error(`No sketch ${id}`);
            return parseSketchDoc(row.doc);
        },
        async save(doc: SketchDoc, render: SketchRender): Promise<void> {
            const row: SketchRow = {
                id: doc.id,
                name: doc.name,
                updatedAt: Date.now(),
                doc: JSON.stringify(doc),
                render: { pages: render.pages },
                thumbnail: render.thumbnail,
            };
            await request((await tx("sketches", "readwrite")).put(row));
        },
        async remove(id: string): Promise<void> {
            await request((await tx("sketches", "readwrite")).delete(id));
        },
        async getFile(hash: string): Promise<Blob | undefined> {
            return (await request((await tx("files")).get(hash))) as
                | Blob
                | undefined;
        },
        async putFile(blob: Blob): Promise<string> {
            const hash = await sha256(blob);
            await request((await tx("files", "readwrite")).put(blob, hash));
            return hash;
        },
        templates: {
            destinations: [{ id: "show", label: "My templates" }],
            async list(): Promise<TemplateSummary[]> {
                const rows = (await request(
                    (await tx("templates")).getAll(),
                )) as TemplateRow[];
                return rows.map(({ id, name, destination }) => ({
                    id,
                    name,
                    destination,
                }));
            },
            async load(id: string): Promise<SketchTemplate> {
                const row = (await request((await tx("templates")).get(id))) as
                    | TemplateRow
                    | undefined;
                if (!row) throw new Error(`No template ${id}`);
                return row.template;
            },
            async save(
                template: SketchTemplate,
                destination: string,
            ): Promise<void> {
                const row: TemplateRow = {
                    id: template.id,
                    name: template.name,
                    destination,
                    template,
                };
                await request((await tx("templates", "readwrite")).put(row));
            },
            async remove(id: string): Promise<void> {
                await request((await tx("templates", "readwrite")).delete(id));
            },
        },
    };
}
