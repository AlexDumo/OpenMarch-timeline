/**
 * Throwaway spike for fork issue #995: test hooks the harness calls from
 * Playwright, in the real Electron app and the real web build.
 */
import SpikeWorker from "./modelImport.worker.ts?worker";
import type { SpikeRequest, SpikeResult } from "./modelImport.worker";

const EMPTY_WASM = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);

function toBase64(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
}

async function compiles(): Promise<string> {
    try {
        await WebAssembly.compile(EMPTY_WASM);
        return "allowed";
    } catch (error) {
        return `blocked: ${String(error)}`;
    }
}

function ask<T>(worker: Worker, message: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
        worker.onmessage = (e) => resolve(e.data as T);
        worker.onerror = (e) => reject(new Error(e.message || "worker error"));
        worker.postMessage(message);
    });
}

declare global {
    interface Window {
        __spikeProbe?: () => Promise<unknown>;
        __spikeModelImport?: (
            b64: string,
            options: Omit<SpikeRequest, "id" | "bytes">,
        ) => Promise<Omit<SpikeResult, "outBytes"> & { outB64?: string }>;
    }
}

window.__spikeProbe = async () => {
    const worker = new SpikeWorker();
    const inWorker = await ask(worker, "probe");
    worker.terminate();
    // A blob: worker inherits the page's policy, unlike a worker loaded from
    // a URL, which gets the policy its own response carries.
    const blobUrl = URL.createObjectURL(
        new Blob(
            [
                `WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0])).then(()=>postMessage("allowed"),e=>postMessage("blocked: "+e))`,
            ],
            { type: "text/javascript" },
        ),
    );
    const blobWorker = new Worker(blobUrl);
    const inBlobWorker = await ask(blobWorker, null);
    blobWorker.terminate();
    return {
        page: await compiles(),
        pageUrl: window.location.href,
        worker: inWorker,
        blobWorker: inBlobWorker,
    };
};

let nextId = 1;
window.__spikeModelImport = async (b64, options) => {
    const worker = new SpikeWorker();
    const bytes = fromBase64(b64);
    const t0 = performance.now();
    const result = await new Promise<SpikeResult>((resolve, reject) => {
        worker.onmessage = (e) => resolve(e.data as SpikeResult);
        worker.onerror = (e) => reject(new Error(e.message || "worker error"));
        const request: SpikeRequest = { id: nextId++, bytes, ...options };
        worker.postMessage(request, [bytes.buffer]);
    });
    const roundTrip = Math.round(performance.now() - t0);
    worker.terminate();
    const { outBytes, ...rest } = result;
    return {
        ...rest,
        steps: { ...rest.steps, roundTrip },
        ...(outBytes ? { outB64: toBase64(outBytes) } : {}),
    };
};
