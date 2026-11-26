import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { workerPolicyFor } from "../../src/security/appCsp";

/** The types of the files `build:browser` writes; anything else is sent as bytes */
const CONTENT_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".map": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".glb": "model/gltf-binary",
    ".mp4": "video/mp4",
    ".wasm": "application/wasm",
};

export type RendererServer = {
    /** `http://127.0.0.1:<port>`: a secure context, as AudioWorklet needs */
    origin: string;
    close: () => Promise<void>;
};

/**
 * Serves the built renderer (`dist-browser/`) on a port of the loopback interface the system
 * picks. A Playwright route can't stand in for this: Chromium fetches AudioWorklet modules
 * (the time-stretch worklet, #216) without passing them through it, so with no server behind
 * the origin they fail with a network error.
 */
export async function serveRenderer(
    rendererDir: string,
): Promise<RendererServer> {
    const server = http.createServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        // A malformed escape (`%zz`) is a 404, not a throw that takes the worker down
        let pathname: string | null;
        try {
            pathname = decodeURIComponent(url.pathname);
        } catch {
            pathname = null;
        }
        const file =
            pathname === null
                ? null
                : path.join(
                      rendererDir,
                      pathname === "/" ? "index.html" : pathname,
                  );
        if (
            file === null ||
            !file.startsWith(rendererDir + path.sep) ||
            !fs.existsSync(file) ||
            !fs.statSync(file).isFile()
        ) {
            response.writeHead(404).end("Not found");
            return;
        }
        // A worker's own policy, as the web build's `_headers` sends it
        const worker = workerPolicyFor(url.href);
        response.writeHead(200, {
            "Content-Type":
                CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
            ...(worker ? { "Content-Security-Policy": worker.csp } : {}),
        });
        fs.createReadStream(file)
            .on("error", () => response.destroy())
            .pipe(response);
    });
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as AddressInfo;
    return {
        origin: `http://127.0.0.1:${port}`,
        close: () =>
            new Promise((resolve) => {
                server.closeAllConnections();
                server.close(() => resolve());
            }),
    };
}
