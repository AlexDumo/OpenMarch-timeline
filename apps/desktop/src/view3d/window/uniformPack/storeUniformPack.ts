/**
 * Sends an imported uniform pack to the editor, which stores it in the show and dresses the band
 * in it (fork #1257), and waits for its answer on `VIEW3D_UNIFORM_PACK_RESULT_CHANNEL`. The
 * window says the band wears it only once this resolves.
 */
import {
    VIEW3D_UNIFORM_PACK_RESULT_CHANNEL,
    type View3dUniformPackResult,
} from "@/view3d/sync/protocol";
import { UNIFORM_PACK_JOB_TIMEOUT_MS } from "@/view3d/uniformPack/protocol";

/** The editor reads the pack in its own worker, then writes: give it that long and a margin */
export const UNIFORM_PACK_STORE_TIMEOUT_MS =
    UNIFORM_PACK_JOB_TIMEOUT_MS + 30_000;

/** The editor couldn't store the pack, or didn't answer in time */
export class UniformPackStoreError extends Error {
    constructor(readonly reason: "refused" | "timedOut") {
        super(
            `the editor ${reason === "refused" ? "refused" : "didn't answer"}`,
        );
        this.name = "UniformPackStoreError";
    }
}

/** Resolves with the value now in `uniformArtwork` */
export function storeUniformPack(
    bytes: Uint8Array,
    {
        api = window.view3d,
        timeoutMs = UNIFORM_PACK_STORE_TIMEOUT_MS,
    }: {
        api?: Pick<typeof window.view3d, "on" | "requestUniformPack">;
        timeoutMs?: number;
    } = {},
): Promise<string> {
    const id = crypto.randomUUID();
    return new Promise<string>((resolve, reject) => {
        const stop = api.on(
            VIEW3D_UNIFORM_PACK_RESULT_CHANNEL,
            (result: View3dUniformPackResult) => {
                if (result?.id !== id) return;
                clearTimeout(timer);
                stop();
                if (result.ok && typeof result.value === "string")
                    resolve(result.value);
                else reject(new UniformPackStoreError("refused"));
            },
        );
        const timer = setTimeout(() => {
            stop();
            reject(new UniformPackStoreError("timedOut"));
        }, timeoutMs);
        api.requestUniformPack({ id, bytes });
    });
}
