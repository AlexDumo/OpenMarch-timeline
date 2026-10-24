/**
 * The Sketchpad window's `SketchStore` (ADR 0006 D-2): every call goes to main over the window's
 * preload (`window.sketchpad`), which writes the show's sketch tables. Blobs cross IPC as bytes.
 *
 * Template ids carry their destination ("show:<id>" or "library:<id>"), since the package names
 * a template by id alone.
 */
import type {
    SketchStore,
    SketchTemplate,
    TemplateDestination,
    TemplateSummary,
} from "@openmarch/sketchpad";
import type { SketchpadApi } from "../../../electron/preload/sketchpad";
import type { TemplateDestinationId } from "../protocol";

export const TEMPLATE_DESTINATIONS: TemplateDestination[] = [
    { id: "show", label: "This show" },
    { id: "library", label: "My Library" },
];

/** "show:<id>" or "library:<id>" for the package; the inverse is `parseTemplateId` */
export const templateKey = (destination: TemplateDestinationId, id: string) =>
    `${destination}:${id}`;

export function parseTemplateId(key: string): {
    destination: TemplateDestinationId;
    id: string;
} {
    const at = key.indexOf(":");
    const destination = key.slice(0, at);
    if (destination !== "show" && destination !== "library")
        throw new Error(`Not a template id: ${key}`);
    return { destination, id: key.slice(at + 1) };
}

const toDestination = (id: string): TemplateDestinationId => {
    if (id !== "show" && id !== "library")
        throw new Error(`Unknown template destination ${id}`);
    return id;
};

async function bytes(blob: Blob): Promise<Uint8Array> {
    return new Uint8Array(await blob.arrayBuffer());
}

// eslint-disable-next-line max-lines-per-function -- one object literal of small methods
export function createIpcSketchStore(
    api: Pick<
        SketchpadApi,
        | "list"
        | "load"
        | "save"
        | "remove"
        | "getFile"
        | "putFile"
        | "templates"
    >,
): SketchStore {
    return {
        async list() {
            return (await api.list()).map(({ id, name, updatedAt }) => ({
                id,
                name,
                updatedAt,
            }));
        },
        load: (id) => api.load(id),
        async save(doc, render) {
            await api.save({
                doc,
                render: {
                    pages: render.pages,
                    thumbnail: render.thumbnail
                        ? await bytes(render.thumbnail)
                        : null,
                },
            });
        },
        async remove(id) {
            await api.remove(id);
        },
        async getFile(sha256) {
            const file = await api.getFile(sha256);
            return file
                ? new Blob([file.data as Uint8Array<ArrayBuffer>], {
                      type: file.mime,
                  })
                : undefined;
        },
        async putFile(blob) {
            return api.putFile({
                mime: blob.type || "image/png",
                data: await bytes(blob),
            });
        },
        templates: {
            destinations: TEMPLATE_DESTINATIONS,
            async list(): Promise<TemplateSummary[]> {
                return (await api.templates.list()).map((t) => ({
                    id: templateKey(t.destination, t.id),
                    name: t.name,
                    destination: t.destination,
                }));
            },
            async load(key): Promise<SketchTemplate> {
                const { destination, id } = parseTemplateId(key);
                return api.templates.load(id, destination);
            },
            async save(template, destination, render) {
                await api.templates.save(
                    template,
                    toDestination(destination),
                    render?.thumbnail ? await bytes(render.thumbnail) : null,
                );
            },
            async update(key, template, render) {
                const { destination } = parseTemplateId(key);
                await api.templates.save(
                    template,
                    destination,
                    render.thumbnail ? await bytes(render.thumbnail) : null,
                );
            },
            async remove(key) {
                const { destination, id } = parseTemplateId(key);
                await api.templates.remove(id, destination);
            },
        },
    };
}
