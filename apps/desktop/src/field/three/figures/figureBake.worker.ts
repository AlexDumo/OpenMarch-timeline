/**
 * Bakes performer figures off the editor's main thread (ADR 0019): the same bake
 * (`bakeFigures.ts`) on an `OffscreenCanvas`, so building the marchers, compiling their shaders
 * and cutting out each picture never hold the editor up. One bake per worker: the editor starts
 * one for a bake and ends it after, which frees its models and its WebGL context.
 */
import type { UniformLook } from "@/view3d/core/marchers/looks";
import { bakeFigures } from "./bakeFigures";
import type { FigureBakeReply, FigureBakeRequest } from "./figureBakeProtocol";

const reply = (message: FigureBakeReply, transfer: Transferable[] = []) =>
    (globalThis as unknown as Worker).postMessage(message, transfer);

/** Whether this worker can draw with WebGL 2 at all: some browsers have no WebGL in workers */
function canDraw(): boolean {
    try {
        const gl = new OffscreenCanvas(1, 1).getContext("webgl2");
        (
            gl?.getExtension("WEBGL_lose_context") as WEBGL_lose_context | null
        )?.loseContext();
        return !!gl;
    } catch {
        return false;
    }
}

onmessage = async (event: MessageEvent<FigureBakeRequest>) => {
    const { looks } = event.data;
    if (typeof OffscreenCanvas === "undefined" || !canDraw()) {
        reply({ type: "unsupported" });
        return;
    }
    const reports: string[] = [];
    try {
        const figures = await bakeFigures(
            looks as UniformLook[],
            undefined,
            (text) => reports.push(text),
        );
        reply(
            { type: "baked", figures, reports },
            figures.flatMap((f) => (f ? [f.image.buffer] : [])),
        );
    } catch (error) {
        reply({
            type: "error",
            message: error instanceof Error ? error.message : String(error),
            reports,
        });
    }
};
