/// <reference lib="webworker" />
/**
 * Compiles Typst templates to PDF off the main thread. The compiler
 * (WebAssembly, about 7 MB over the wire with brotli), the two fonts and the
 * logo are fetched the first time something is exported, then reused for
 * every later export while the worker lives. Hashed asset URLs are cached by
 * the browser, so a second visit does not download them again.
 */
import {
    createTypstCompiler,
    loadFonts,
    type TypstCompiler,
} from "@myriaddreamin/typst.ts";
import wasmUrl from "@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url";
import regularUrl from "./fonts/LiberationSans-Regular.subset.ttf?url";
import boldUrl from "./fonts/LiberationSans-Bold.subset.ttf?url";
import logoSvg from "../../../src/assets/open-march-logo.svg?raw";
import sheetsTemplate from "./coordinate-sheets.typ?raw";
import chartTemplate from "./drill-chart.typ?raw";

export type CompileRequest = {
    id: number;
    template: "sheets" | "chart";
    /** Becomes /data.json, read by the template. */
    data: unknown;
    /** Extra virtual files (for example an SVG field image). */
    files?: Record<string, string>;
};

export type CompileResponse =
    | {
          id: number;
          ok: true;
          pdf: Uint8Array;
          initMs: number;
          compileMs: number;
      }
    | { id: number; ok: false; error: string };

const templates = { sheets: sheetsTemplate, chart: chartTemplate };
const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const encoder = new TextEncoder();
let ready: Promise<TypstCompiler> | undefined;
let initMs = 0;

async function fetchBytes(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
}

function start(): Promise<TypstCompiler> {
    ready ??= (async () => {
        const t0 = performance.now();
        const [regular, bold] = await Promise.all([
            fetchBytes(regularUrl),
            fetchBytes(boldUrl),
        ]);
        const compiler = createTypstCompiler();
        await compiler.init({
            getModule: () => fetch(wasmUrl),
            // Only our fonts: no default font download from a CDN.
            beforeBuild: [loadFonts([regular, bold], { assets: false })],
        });
        compiler.mapShadow(
            "/logo.svg",
            encoder.encode(logoSvg.replace(/currentColor/g, "black")),
        );
        for (const [name, source] of Object.entries(templates)) {
            compiler.addSource(`/${name}.typ`, source);
        }
        initMs = performance.now() - t0;
        return compiler;
    })();
    return ready;
}

scope.onmessage = async (event: MessageEvent<CompileRequest>) => {
    const { id, template, data, files } = event.data;
    try {
        const compiler = await start();
        const t0 = performance.now();
        compiler.mapShadow("/data.json", encoder.encode(JSON.stringify(data)));
        for (const [path, text] of Object.entries(files ?? {})) {
            compiler.mapShadow(path, encoder.encode(text));
        }
        const result = await compiler.compile({
            mainFilePath: `/${template}.typ`,
            format: 1, // PDF
            diagnostics: "full",
        });
        const compileMs = performance.now() - t0;
        if (!result.result) {
            throw new Error(
                (result.diagnostics ?? [])
                    .map(
                        (d: { message?: string }) =>
                            d.message ?? JSON.stringify(d),
                    )
                    .join("\n") || "Typst produced no PDF",
            );
        }
        const pdf = result.result;
        const reply: CompileResponse = { id, ok: true, pdf, initMs, compileMs };
        scope.postMessage(reply, [pdf.buffer]);
    } catch (error) {
        const reply: CompileResponse = { id, ok: false, error: String(error) };
        scope.postMessage(reply);
    }
};
