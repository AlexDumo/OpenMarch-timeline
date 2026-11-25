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

/** The editor couldn't store the pack, didn't answer in time, or (an item edit) dropped it */
export class UniformPackStoreError extends Error {
    constructor(readonly reason: "refused" | "timedOut" | "superseded") {
        super(
            reason === "refused"
                ? "the editor refused"
                : reason === "timedOut"
                  ? "the editor didn't answer"
                  : "the venue had moved on, so the editor stored nothing",
        );
        this.name = "UniformPackStoreError";
    }
}

type Api = Pick<typeof window.view3d, "on" | "requestUniformPack">;

/** Sends one request and waits for its answer */
function request(
    bytes: Uint8Array,
    extra: { versionOf?: string; expect?: string; amend?: string },
    { api, timeoutMs }: { api: Api; timeoutMs: number },
): Promise<{ value: string; token?: string | null }> {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
        const stop = api.on(
            VIEW3D_UNIFORM_PACK_RESULT_CHANNEL,
            (result: View3dUniformPackResult) => {
                if (result?.id !== id) return;
                clearTimeout(timer);
                stop();
                if (result.ok && typeof result.value === "string")
                    resolve({ value: result.value, token: result.token });
                else
                    reject(
                        new UniformPackStoreError(
                            result?.superseded ? "superseded" : "refused",
                        ),
                    );
            },
        );
        const timer = setTimeout(() => {
            stop();
            reject(new UniformPackStoreError("timedOut"));
        }, timeoutMs);
        const fields = Object.fromEntries(
            Object.entries(extra).filter(([, v]) => v !== undefined),
        );
        api.requestUniformPack({ id, bytes, ...fields });
    });
}

/** Resolves with the value now in `uniformArtwork`: an imported pack, a new uniform */
export async function storeUniformPack(
    bytes: Uint8Array,
    {
        api = window.view3d,
        timeoutMs = UNIFORM_PACK_STORE_TIMEOUT_MS,
    }: { api?: Api; timeoutMs?: number } = {},
): Promise<string> {
    return (await request(bytes, {}, { api, timeoutMs })).value;
}

/**
 * Saves an edit of the band's uniform items (fork #1258): `bytes` is a new version of uniform
 * `versionOf`, stored only while the venue still names `expect` (otherwise it rejects with
 * reason `superseded`). `amend` is the token the burst's first save returned; resolves with the
 * value now in `uniformArtwork` and the burst's token.
 */
export function storeUniformItemsPack(
    bytes: Uint8Array,
    {
        versionOf,
        expect,
        amend,
        api = window.view3d,
        timeoutMs = UNIFORM_PACK_STORE_TIMEOUT_MS,
    }: {
        versionOf?: string;
        expect: string;
        amend?: string;
        api?: Api;
        timeoutMs?: number;
    },
): Promise<{ value: string; token?: string | null }> {
    return request(bytes, { versionOf, expect, amend }, { api, timeoutMs });
}
