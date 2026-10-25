import { useMemo, useRef } from "react";
import { FieldPropertiesTemplates } from "@openmarch/core";
import {
    dataUrlToBlob,
    downloadBlob,
    parseOmSketchFile,
    referencedFileIds,
    Sketchpad,
    toFieldPropertiesJson,
    type OmSketchFile,
    type SketchDoc,
    type SketchpadHandle,
    type SketchStore,
} from "@openmarch/sketchpad";
import { createIndexedDbStore } from "./idbStore";

/** The static site has no show, so its field is the default high-school field */
const FIELD = toFieldPropertiesJson(
    FieldPropertiesTemplates.HIGH_SCHOOL_FOOTBALL_FIELD_NO_END_ZONES,
);

const blobToDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });

/** A sketch and its images as one `.omsketch` JSON file */
async function toOmSketchFile(
    store: SketchStore,
    doc: SketchDoc,
): Promise<Blob> {
    const files: OmSketchFile["files"] = {};
    for (const id of referencedFileIds(doc)) {
        const blob = await store.getFile(id);
        if (blob)
            files[id] = {
                mimeType: blob.type || "image/png",
                dataURL: await blobToDataUrl(blob),
            };
    }
    const file: OmSketchFile = { type: "openmarch-sketch", sketch: doc, files };
    return new Blob([JSON.stringify(file)], { type: "application/json" });
}

function pickFile(accept: string): Promise<File | null> {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = accept;
        input.onchange = () => resolve(input.files?.[0] ?? null);
        input.click();
    });
}

const OPEN_KEY = "openmarch-sketchpad:open-tabs";

/** The tabs open last time, active one last (a convenience; the sketches are in IndexedDB) */
function readOpenTabs(): string[] | undefined {
    try {
        const ids = JSON.parse(
            localStorage.getItem(OPEN_KEY) ?? "null",
        ) as unknown;
        return Array.isArray(ids) &&
            ids.every((id) => typeof id === "string") &&
            ids.length > 0
            ? ids
            : undefined;
    } catch {
        return undefined;
    }
}

function rememberOpenTabs(ids: string[], activeId: string | null) {
    try {
        const ordered = activeId
            ? [...ids.filter((id) => id !== activeId), activeId]
            : ids;
        localStorage.setItem(OPEN_KEY, JSON.stringify(ordered));
    } catch {
        // Private windows may refuse storage; the next visit opens the latest sketch instead
    }
}

export function App() {
    const store = useMemo(() => createIndexedDbStore(), []);
    const initialOpenIds = useMemo(() => readOpenTabs(), []);
    const ref = useRef<SketchpadHandle>(null);

    const openFile = async () => {
        const file = await pickFile(".omsketch,application/json");
        if (!file) return;
        try {
            const parsed = parseOmSketchFile(await file.text());
            for (const { dataURL } of Object.values(parsed.files))
                await store.putFile(await dataUrlToBlob(dataURL));
            await ref.current?.openDoc(parsed.sketch);
        } catch (error) {
            alert(`Couldn't open ${file.name}: ${(error as Error).message}`);
        }
    };

    return (
        <Sketchpad
            ref={ref}
            store={store}
            initialField={FIELD}
            assetPath="/sketchpad-assets/"
            initialOpenIds={initialOpenIds}
            onOpenChange={rememberOpenTabs}
            menuItems={[
                {
                    label: "Save as .omsketch file",
                    testId: "menu-save-file",
                    onSelect: (doc) =>
                        void ref.current
                            ?.flush()
                            .then(() => toOmSketchFile(store, doc))
                            .then((blob) =>
                                downloadBlob(blob, `${doc.name}.omsketch`),
                            ),
                },
                {
                    label: "Open .omsketch file…",
                    testId: "menu-open-file",
                    onSelect: () => void openFile(),
                },
            ]}
        />
    );
}
