/**
 * Entry for the Sketchpad window (`?view=sketchpad`, ADR 0006 D-4).
 *
 * `main.tsx` loads this with a dynamic `import()`, so the editor never loads Excalidraw. The
 * window hosts `<Sketchpad>` from `@openmarch/sketchpad` with a store that saves through main
 * (`ipcSketchStore.ts`), the show's current field for new sketches, and Excalidraw's fonts
 * served from the app itself (`sketchpad-assets/fonts`, copied by `vite.config.mts`), so nothing
 * loads from a CDN. Main passes the show name, theme and language in the query string.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TolgeeProvider, useTranslate } from "@tolgee/react";
import {
    Sketchpad,
    type FieldPropertiesJson,
    type SketchpadHandle,
} from "@openmarch/sketchpad";
import "@openmarch/sketchpad/index.css";
import TitleBar from "@/components/titlebar/TitleBar";
import tolgee from "@/global/singletons/Tolgee";
import type { SketchOpenRequest } from "../protocol";
import { createIpcSketchStore, templateKey } from "./ipcSketchStore";

export interface SketchpadWindowParams {
    showName: string;
    theme: "light" | "dark";
    language: string;
}

/** Reads the parameters main puts in the window's query string. */
export function readSketchpadWindowParams(
    search: string,
): SketchpadWindowParams {
    const query = new URLSearchParams(search);
    return {
        showName: query.get("show") ?? "",
        theme: query.get("theme") === "light" ? "light" : "dark",
        language: query.get("lang") || "en",
    };
}

/** Where the fonts are, as an absolute URL (the app loads from `file:` in production) */
export const SKETCHPAD_ASSET_DIR = "sketchpad-assets/";

/**
 * How the window starts from the requests that came before it was listening: the sketches to
 * open, and whether to open the latest sketch when there are none (not when a new sketch is
 * coming).
 */
export function initialOpen(requests: readonly SketchOpenRequest[]): {
    ids: string[];
    autoOpen: boolean;
    later: SketchOpenRequest[];
} {
    const ids = requests.flatMap((r) => (r.kind === "sketch" ? [r.id] : []));
    const later = requests.filter(
        (r) =>
            r.kind === "new" ||
            r.kind === "template" ||
            r.kind === "edit-template",
    );
    return { ids, autoOpen: later.length === 0, later };
}

const params = readSketchpadWindowParams(window.location.search);

export default function SketchpadRoot() {
    useEffect(() => {
        document.documentElement.classList.toggle(
            "dark",
            params.theme === "dark",
        );
        if (params.language !== "en") {
            void tolgee.changeLanguage(params.language);
        }
    }, []);

    return (
        <TolgeeProvider tolgee={tolgee} fallback="Loading...">
            <SketchpadWindow />
        </TolgeeProvider>
    );
}

interface Start {
    field: FieldPropertiesJson;
    ids: string[];
    autoOpen: boolean;
}

function SketchpadWindow() {
    const { t } = useTranslate();
    const title = t("sketchpad.window.title", { showName: params.showName });
    const api = window.sketchpad;
    const store = useMemo(() => createIpcSketchStore(api), [api]);
    const assetPath = useMemo(
        () => new URL(SKETCHPAD_ASSET_DIR, window.location.href).href,
        [],
    );
    const ref = useRef<SketchpadHandle>(null);
    const [start, setStart] = useState<Start | null>(null);
    const [error, setError] = useState<string | null>(null);
    /** Requests that wait for the Sketchpad to mount */
    const queued = useRef<SketchOpenRequest[]>([]);

    const apply = useCallback((request: SketchOpenRequest) => {
        const handle = ref.current;
        if (!handle) {
            queued.current.push(request);
            return;
        }
        if (request.kind === "sketch")
            void handle.open(request.id).catch((e: unknown) => {
                console.error("Couldn't open the sketch", e);
            });
        else if (request.kind === "new")
            handle.newSketch({ blank: request.blank });
        else if (request.kind === "edit-template")
            void handle
                .editTemplate(
                    templateKey(
                        request.template.destination,
                        request.template.id,
                    ),
                )
                .catch((e: unknown) => {
                    console.error("Couldn't open the template", e);
                });
        else if (request.kind === "template")
            handle.newSketch({
                templateId: templateKey(
                    request.template.destination,
                    request.template.id,
                ),
            });
    }, []);

    useEffect(() => {
        document.title = title;
    }, [title]);

    useEffect(() => {
        const stopOpen = api.onOpenRequest(apply);
        const stopFlush = api.onFlushRequest((token) => {
            void (ref.current?.flush() ?? Promise.resolve())
                .catch((e: unknown) => console.error("Sketch save failed", e))
                .finally(() => api.flushed(token));
        });
        const stopExternal = api.onExternalChange((change) => {
            if (change.change === "removed") ref.current?.discard(change.id);
            else if (change.name) ref.current?.rename(change.id, change.name);
        });
        // A last try when the window goes; main also asks and waits before closing it
        const flush = () => void ref.current?.flush();
        window.addEventListener("beforeunload", flush);

        let cancelled = false;
        void Promise.all([api.field(), api.ready()]).then(
            ([field, requests]) => {
                if (cancelled) return;
                const { ids, autoOpen, later } = initialOpen(requests);
                queued.current.push(...later);
                setStart({ field, ids, autoOpen });
            },
            (e: unknown) => setError(String(e)),
        );
        return () => {
            cancelled = true;
            stopOpen();
            stopFlush();
            stopExternal();
            window.removeEventListener("beforeunload", flush);
        };
    }, [api, apply]);

    // Requests that came before the Sketchpad mounted
    useEffect(() => {
        if (!start) return;
        const timer = setTimeout(() => {
            for (const request of queued.current.splice(0)) apply(request);
        }, 0);
        return () => clearTimeout(timer);
    }, [start, apply]);

    return (
        <main className="bg-bg-1 text-text flex h-screen min-h-0 w-screen min-w-0 flex-col overflow-hidden font-sans">
            <TitleBar windowTitle={title} isMacOS={api.isMacOS} />
            <div
                className="relative min-h-0 flex-1"
                data-testid="sketchpad-window"
            >
                {error ? (
                    <p className="text-text-subtitle p-24">{error}</p>
                ) : start ? (
                    <Sketchpad
                        ref={ref}
                        store={store}
                        initialField={start.field}
                        initialOpenIds={start.ids}
                        autoOpen={start.autoOpen}
                        assetPath={assetPath}
                        hostName={params.showName}
                        theme={params.theme}
                    />
                ) : null}
            </div>
        </main>
    );
}
