// @vitest-environment node
/**
 * Main's `sketch:*` handlers (ADR 0006 D-4, D-6) on a real show file and a real Library in a
 * temporary folder: payloads are validated before anything is written, images are stored once,
 * and templates go to the show or the Library with their images.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    _resetRemovedSketchIds,
    createSketchHandlers,
    type SketchHandlers,
} from "../sketchpadHandlers";
import { openLibraryStore, type LibraryStore } from "../library/store";
import {
    ID_A,
    ID_B,
    ID_C,
    openBlankShow,
    sketch,
} from "../../database/__test__/sketchFixtures";

let dir: string;
let db: DatabaseSync;
let library: LibraryStore;
let handlers: SketchHandlers;
let changed: (string | null)[];

beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "om-sketch-handlers-"));
    db = openBlankShow(dir);
    library = await openLibraryStore({ root: path.join(dir, "library") });
    changed = [];
    _resetRemovedSketchIds();
    handlers = createSketchHandlers({
        getDb: async () => db,
        getLibraryStore: async () => library,
        onChanged: (id) => changed.push(id),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

describe("sketch handlers", () => {
    it("saves and loads a sketch, and tells the editor", async () => {
        await handlers.save(sketch(ID_A, "Opener"));
        expect(changed).toEqual([ID_A]);
        expect(await handlers.load(ID_A)).toMatchObject({
            id: ID_A,
            name: "Opener",
        });
        expect((await handlers.list()).map((s) => s.name)).toEqual(["Opener"]);
    });

    it.each<[string, unknown]>([
        ["no payload", undefined],
        ["a doc without pages", { ...sketch(ID_A, "x"), doc: { id: ID_A } }],
        [
            "an id that isn't a uuid",
            {
                ...sketch(ID_A, "x"),
                doc: { ...sketch(ID_A, "x").doc, id: "../x" },
            },
        ],
        [
            "a thumbnail that isn't bytes",
            {
                ...sketch(ID_A, "x"),
                render: { pages: [], thumbnail: "data:image/png;base64," },
            },
        ],
        [
            "an element without an id",
            {
                ...sketch(ID_A, "x", [{ type: "rectangle" }]),
            },
        ],
    ])("refuses a save with %s and writes nothing", async (_, payload) => {
        await expect(handlers.save(payload)).rejects.toThrow();
        expect(await handlers.list()).toEqual([]);
        expect(changed).toEqual([]);
    });

    it("refuses loads, renames and file reads with bad ids", async () => {
        await expect(handlers.load("1; DROP TABLE sketches")).rejects.toThrow();
        await expect(handlers.rename({ id: ID_A, name: "" })).rejects.toThrow();
        await expect(handlers.getFile("abc")).rejects.toThrow();
        await expect(handlers.load(ID_C)).rejects.toThrow(/No sketch/);
    });

    it("renames, duplicates, deletes and restores", async () => {
        await handlers.save(sketch(ID_A, "Opener"));
        expect(await handlers.rename({ id: ID_A, name: "  Closer " })).toBe(
            true,
        );
        const copy = await handlers.duplicate(ID_A);
        expect(copy?.name).toBe("Closer copy");
        const removed = await handlers.remove(ID_A);
        expect((await handlers.list()).map((s) => s.name)).toEqual([
            "Closer copy",
        ]);
        expect(await handlers.restore(removed)).toBe(true);
        expect((await handlers.list()).map((s) => s.name)).toEqual([
            "Closer",
            "Closer copy",
        ]);
    });

    it("ignores a save of a sketch deleted since, until it's restored", async () => {
        await handlers.save(sketch(ID_A, "Opener"));
        const removed = await handlers.remove(ID_A);
        await handlers.save(sketch(ID_A, "In flight"));
        expect(await handlers.list()).toEqual([]);
        await handlers.restore(removed);
        await handlers.save(sketch(ID_A, "After undo"));
        expect((await handlers.list())[0]!.name).toBe("After undo");
    });

    it("refuses a restore that isn't one", async () => {
        await expect(
            handlers.restore({ sketch: { id: ID_A }, pins: [] }),
        ).rejects.toThrow();
    });

    it("stores an image once under the sha256 it computes, and only images", async () => {
        const a = await handlers.putFile({ mime: "image/png", data: PNG });
        const b = await handlers.putFile({ mime: "image/png", data: PNG });
        expect(a).toBe(b);
        expect(a).toMatch(/^[0-9a-f]{64}$/);
        expect(await handlers.getFile(a)).toEqual({
            mime: "image/png",
            data: PNG,
        });
        await expect(
            handlers.putFile({ mime: "text/html", data: PNG }),
        ).rejects.toThrow();
        await expect(
            handlers.putFile({ mime: "image/png", data: new Uint8Array() }),
        ).rejects.toThrow();
    });
});

describe("template handlers", () => {
    const template = (
        id: string,
        elements: Record<string, unknown>[] = [],
    ) => ({
        id,
        name: "Grid paper",
        style: { preset: "paper", grid: true },
        pages: [{ id: "p1", name: "Page 1", elements }],
        schemaVersion: 1,
    });

    it("saves a template to the show and lists it", async () => {
        await handlers.saveTemplate({
            template: template(ID_B),
            destination: "show",
        });
        expect(await handlers.listTemplates()).toMatchObject([
            { id: ID_B, name: "Grid paper", destination: "show" },
        ]);
        expect(
            await handlers.loadTemplate({ id: ID_B, destination: "show" }),
        ).toEqual(template(ID_B));
        await handlers.removeTemplate({ id: ID_B, destination: "show" });
        expect(await handlers.listTemplates()).toEqual([]);
    });

    it("saves a template to the Library with its images, which another show then gets", async () => {
        const sha = await handlers.putFile({ mime: "image/png", data: PNG });
        const elements = [{ id: "i1", type: "image", fileId: sha }];
        await handlers.saveTemplate({
            template: template(ID_C, elements),
            destination: "library",
        });
        expect(await handlers.listTemplates()).toMatchObject([
            { id: ID_C, name: "Grid paper", destination: "library" },
        ]);

        // Another show, same Library
        const other = fs.mkdtempSync(path.join(dir, "other-"));
        const otherDb = openBlankShow(other);
        try {
            const otherHandlers = createSketchHandlers({
                getDb: async () => otherDb,
                getLibraryStore: async () => library,
                onChanged: () => {},
            });
            expect(await otherHandlers.getFile(sha)).toBeNull();
            expect(
                await otherHandlers.loadTemplate({
                    id: ID_C,
                    destination: "library",
                }),
            ).toEqual(template(ID_C, elements));
            expect(await otherHandlers.getFile(sha)).toEqual({
                mime: "image/png",
                data: PNG,
            });
        } finally {
            otherDb.close();
        }

        await handlers.removeTemplate({ id: ID_C, destination: "library" });
        expect(await handlers.listTemplates()).toEqual([]);
    });

    it("refuses a template without pages, or for an unknown destination", async () => {
        await expect(
            handlers.saveTemplate({
                template: { ...template(ID_B), pages: [] },
                destination: "show",
            }),
        ).rejects.toThrow();
        await expect(
            handlers.saveTemplate({
                template: template(ID_B),
                destination: "cloud",
            }),
        ).rejects.toThrow();
        expect(await handlers.listTemplates()).toEqual([]);
    });

    it("still lists the show's templates when the Library can't be read", async () => {
        await handlers.saveTemplate({
            template: template(ID_B),
            destination: "show",
        });
        const broken = createSketchHandlers({
            getDb: async () => db,
            getLibraryStore: async () => {
                throw new Error("no Library");
            },
            onChanged: () => {},
        });
        expect(await broken.listTemplates()).toHaveLength(1);
    });

    describe("editing templates from the sidebar", () => {
        const THUMB = new Uint8Array([137, 80, 78, 71, 1]);

        it.each(["show", "library"] as const)(
            "renames, duplicates and saves back a %s template, with its thumbnail",
            async (destination) => {
                await handlers.saveTemplate({
                    template: template(ID_B),
                    destination,
                    thumbnail: THUMB,
                });
                let [listed] = await handlers.listTemplates();
                expect(listed).toMatchObject({
                    id: ID_B,
                    destination,
                    thumbnail: THUMB,
                });
                expect(listed!.updatedAt).toBeGreaterThan(0);

                expect(
                    await handlers.renameTemplate({
                        id: ID_B,
                        destination,
                        name: "Block band",
                    }),
                ).toBe(true);
                expect(
                    (await handlers.loadTemplate({ id: ID_B, destination }))
                        .name,
                ).toBe("Block band");

                // Edited in the window: the same id saves in place, and no thumbnail keeps it
                const edited = {
                    ...template(ID_B, [{ id: "r1", type: "rectangle" }]),
                    name: "Block band",
                };
                await handlers.saveTemplate({ template: edited, destination });
                expect(
                    await handlers.loadTemplate({ id: ID_B, destination }),
                ).toEqual(edited);
                [listed] = await handlers.listTemplates();
                expect(listed!.thumbnail).toEqual(THUMB);

                const copy = await handlers.duplicateTemplate({
                    id: ID_B,
                    destination,
                });
                expect(copy!.name).toBe("Block band copy");
                const loaded = await handlers.loadTemplate({
                    id: copy!.id,
                    destination,
                });
                expect(loaded).toMatchObject({
                    id: copy!.id,
                    name: "Block band copy",
                    pages: edited.pages,
                });
                expect(await handlers.listTemplates()).toHaveLength(2);
            },
        );

        it.each(["show", "library"] as const)(
            "deletes a %s template and Undo restores it as it was",
            async (destination) => {
                await handlers.saveTemplate({
                    template: template(ID_B),
                    destination,
                    thumbnail: THUMB,
                });
                const before = await handlers.listTemplates();
                const removed = await handlers.removeTemplate({
                    id: ID_B,
                    destination,
                });
                expect(removed?.destination).toBe(destination);
                expect(await handlers.listTemplates()).toEqual([]);
                // It crosses IPC to the editor and back
                expect(
                    await handlers.restoreTemplate(structuredClone(removed)),
                ).toBe(true);
                expect(await handlers.listTemplates()).toEqual(before);
                expect(
                    await handlers.restoreTemplate(structuredClone(removed)),
                ).toBe(false);
            },
        );

        it("won't delete a sketch as a template", async () => {
            await handlers.save(sketch(ID_A, "Opener"));
            expect(
                await handlers.removeTemplate({
                    id: ID_A,
                    destination: "show",
                }),
            ).toBeNull();
            expect(await handlers.list()).toHaveLength(1);
        });

        it("copies a template to the Library and back, with its images and thumbnail", async () => {
            const sha = await handlers.putFile({
                mime: "image/png",
                data: PNG,
            });
            const elements = [{ id: "i1", type: "image", fileId: sha }];
            await handlers.saveTemplate({
                template: template(ID_B, elements),
                destination: "show",
                thumbnail: THUMB,
            });
            const toLibrary = await handlers.copyTemplate({
                id: ID_B,
                from: "show",
                to: "library",
            });
            const lib = await handlers.loadTemplate({
                id: toLibrary.id,
                destination: "library",
            });
            expect(lib).toEqual({ ...template(toLibrary.id, elements) });
            const entry = await library.readSketchTemplate(toLibrary.id);
            expect(Object.keys(entry.files)).toEqual([sha]);

            const back = await handlers.copyTemplate({
                id: toLibrary.id,
                from: "library",
                to: "show",
            });
            expect(
                await handlers.loadTemplate({
                    id: back.id,
                    destination: "show",
                }),
            ).toEqual(template(back.id, elements));
            const listed = await handlers.listTemplates();
            expect(listed.map((t) => t.destination).sort()).toEqual([
                "library",
                "show",
                "show",
            ]);
            expect(listed.every((t) => t.thumbnail !== null)).toBe(true);
            await expect(
                handlers.copyTemplate({ id: ID_B, from: "show", to: "show" }),
            ).rejects.toThrow();
        });

        it("refuses a restore that isn't one", async () => {
            await expect(
                handlers.restoreTemplate({
                    destination: "library",
                    entry: { id: ID_B },
                }),
            ).rejects.toThrow();
        });
    });
});
