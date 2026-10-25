// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    SKETCH_CHANNELS,
    removedSketchSchema,
    sketchOpenRequestSchema,
    sketchSaveSchema,
    sketchTemplateSchema,
} from "../protocol";
import {
    createIpcSketchStore,
    parseTemplateId,
    templateKey,
} from "../window/ipcSketchStore";

const PRELOADS = path.join(__dirname, "../../../electron/preload");
const preloadSource = (file: string) =>
    readFileSync(path.join(PRELOADS, file), "utf8");

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const doc = {
    id: ID,
    name: "Opener",
    field: {
        fieldProperties: { xCheckpoints: [], yCheckpoints: [], name: "HS" },
        style: { preset: "show", grid: true },
    },
    pages: [
        {
            id: "p1",
            name: "Page 1",
            elements: [
                { id: "e1", type: "rectangle", version: 3, isDeleted: true },
            ],
        },
    ],
    schemaVersion: 1,
};
const render = {
    pages: [{ pageId: "p1", svg: "<svg/>", bounds: null }],
    thumbnail: new Uint8Array([1]),
};

describe("sketch protocol", () => {
    it("keeps Excalidraw's element fields and the field snapshot as they are", () => {
        const parsed = sketchSaveSchema.parse({ doc, render });
        expect(parsed.doc).toEqual(doc);
    });

    it.each<[string, unknown]>([
        ["a missing schema version", { ...doc, schemaVersion: 2 }],
        ["no pages", { ...doc, pages: [] }],
        [
            "a page id with a slash",
            { ...doc, pages: [{ ...doc.pages[0], id: "a/b" }] },
        ],
        ["a name over 200 characters", { ...doc, name: "x".repeat(201) }],
        [
            "a field without checkpoints",
            {
                ...doc,
                field: { fieldProperties: {}, style: { preset: "show" } },
            },
        ],
        [
            "an element without a type",
            { ...doc, pages: [{ id: "p", name: "", elements: [{ id: "e" }] }] },
        ],
    ])("refuses a doc with %s", (_, bad) => {
        expect(sketchSaveSchema.safeParse({ doc: bad, render }).success).toBe(
            false,
        );
    });

    it("refuses a render whose thumbnail isn't bytes or is too large", () => {
        for (const thumbnail of [
            "png",
            [1, 2],
            new Uint8Array(4 * 1024 * 1024 + 1),
        ])
            expect(
                sketchSaveSchema.safeParse({
                    doc,
                    render: { ...render, thumbnail },
                }).success,
            ).toBe(false);
    });

    it("refuses a template without a name", () => {
        expect(
            sketchTemplateSchema.safeParse({
                id: ID,
                name: " ",
                style: { preset: "paper" },
                pages: doc.pages,
                schemaVersion: 1,
            }).success,
        ).toBe(false);
    });

    it("takes the open requests the editor sends and nothing else", () => {
        for (const ok of [
            { kind: "window" },
            { kind: "new" },
            { kind: "new", blank: true },
            { kind: "sketch", id: ID },
            { kind: "template", template: { id: ID, destination: "library" } },
            {
                kind: "edit-template",
                template: { id: ID, destination: "show" },
            },
        ])
            expect(sketchOpenRequestSchema.safeParse(ok).success).toBe(true);
        for (const bad of [
            { kind: "sketch", id: "x" },
            { kind: "template", template: { id: ID, destination: "cloud" } },
            { kind: "url", url: "https://example.com" },
        ])
            expect(sketchOpenRequestSchema.safeParse(bad).success).toBe(false);
    });

    it("refuses a restore with a bad pin", () => {
        expect(
            removedSketchSchema.safeParse({
                sketch: {
                    id: ID,
                    kind: "sketch",
                    name: "n",
                    field_json: "{}",
                    doc_json: "{}",
                    render_json: null,
                    thumbnail: null,
                    sort_index: 1,
                    created_at: "",
                    updated_at: "",
                },
                pins: [
                    {
                        id: 1,
                        sketch_id: ID,
                        page_id: "p",
                        beat_id: null,
                        opacity: 2,
                        position: "below",
                    },
                ],
            }).success,
        ).toBe(false);
    });

    it("all channels are distinct and under sketch:", () => {
        const channels = Object.values(SKETCH_CHANNELS);
        expect(new Set(channels).size).toBe(channels.length);
        for (const c of channels) expect(c).toMatch(/^sketch:[a-z-]+$/);
    });

    it("the Sketchpad's preload imports only electron and calls only sketch: channels", () => {
        const source = preloadSource("sketchpad.ts");
        const valueImports = [
            ...source.matchAll(/^import (?!type)[^;]* from "([^"]+)"/gm),
        ].map((m) => m[1]);
        expect(valueImports).toEqual(["electron"]);
        const used = [...source.matchAll(/"([a-z0-9]+:[a-z-]+)"/g)].map(
            (m) => m[1],
        );
        for (const c of used) expect(c).toMatch(/^sketch:/);
        // The editor's preload uses only the sidebar's channels
        const editor = new Set(
            [...preloadSource("index.ts").matchAll(/"(sketch:[a-z-]+)"/g)].map(
                (m) => m[1],
            ),
        );
        expect([...editor].sort()).toEqual(
            [
                "sketch:changed",
                "sketch:duplicate",
                "sketch:list",
                "sketch:open",
                "sketch:remove",
                "sketch:rename",
                "sketch:restore",
                "sketch:template-copy",
                "sketch:template-duplicate",
                "sketch:template-remove",
                "sketch:template-rename",
                "sketch:template-restore",
                "sketch:templates",
            ].sort(),
        );
    });
});

describe("the window's store", () => {
    it("names templates by destination and id, both ways", () => {
        expect(templateKey("library", ID)).toBe(`library:${ID}`);
        expect(parseTemplateId(`show:${ID}`)).toEqual({
            destination: "show",
            id: ID,
        });
        expect(() => parseTemplateId(`cloud:${ID}`)).toThrow();
    });

    it("sends thumbnails and images as bytes and lists templates under their keys", async () => {
        const calls: unknown[] = [];
        const store = createIpcSketchStore({
            list: async () => [],
            load: async () => doc as never,
            save: async (p) => void calls.push(p),
            remove: async () => null,
            getFile: async () => ({
                mime: "image/png",
                data: new Uint8Array([7]),
            }),
            putFile: async (f) => {
                calls.push(f);
                return "f".repeat(64);
            },
            templates: {
                list: async () => [
                    { id: ID, name: "T", destination: "library" },
                ],
                load: async () => ({}) as never,
                save: async () => {},
                remove: async () => {},
            },
        });
        await store.save(doc as never, {
            pages: [],
            thumbnail: new Blob([new Uint8Array([1, 2])], {
                type: "image/png",
            }),
        });
        await store.putFile(
            new Blob([new Uint8Array([3])], { type: "image/jpeg" }),
        );
        expect(calls).toEqual([
            { doc, render: { pages: [], thumbnail: new Uint8Array([1, 2]) } },
            { mime: "image/jpeg", data: new Uint8Array([3]) },
        ]);
        const blob = await store.getFile("x");
        expect(blob?.type).toBe("image/png");
        expect(await store.templates.list()).toEqual([
            { id: `library:${ID}`, name: "T", destination: "library" },
        ]);
    });
});
