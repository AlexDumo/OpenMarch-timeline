/**
 * The editor's side of storing a uniform pack the 3D View window sent (fork #1257): checks the
 * request, stores the pack, and answers on `VIEW3D_UNIFORM_PACK_RESULT_CHANNEL` with the
 * request's `id`, whether storing worked or not. The answer comes from the store's own promise,
 * so it fires even when requests overlap or the component that started it has gone.
 */
import { z } from "zod";
import {
    VIEW3D_UNIFORM_PACK_RESULT_CHANNEL,
    type View3dUniformPackResult,
} from "./protocol";

/** The window's request (`View3dVenueChangeRequest.uniformPack`) */
const uniformPackRequestSchema = z.object({
    id: z.string().min(1).max(64),
    bytes: z.instanceof(Uint8Array),
});

/**
 * Stores the pack `raw` asks for with `store` (which reads it in the uniform pack worker and
 * refuses one that doesn't read) and answers with `publish`. An invalid request is ignored: it
 * has no `id` to answer.
 */
export function storeUniformPackRequest(
    raw: unknown,
    store: (pack: Uint8Array) => Promise<string>,
    publish: (
        channel: typeof VIEW3D_UNIFORM_PACK_RESULT_CHANNEL,
        result: View3dUniformPackResult,
    ) => void = (channel, result) =>
        window.electron.publishToView3d(channel, result),
): Promise<void> {
    const asked = uniformPackRequestSchema.safeParse(raw);
    if (!asked.success) {
        console.warn(
            "3D View: ignored an invalid uniform pack request",
            asked.error,
        );
        return Promise.resolve();
    }
    const { id, bytes } = asked.data;
    const answer = (result: View3dUniformPackResult) =>
        publish(VIEW3D_UNIFORM_PACK_RESULT_CHANNEL, result);
    return store(bytes)
        .then((value) => answer({ id, ok: true, value }))
        .catch(() => answer({ id, ok: false }));
}
