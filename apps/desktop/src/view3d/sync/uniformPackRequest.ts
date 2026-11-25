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
    /** Store it as a new version of this uniform asset (an edit of its items, fork #1258) */
    versionOf: z.string().uuid().optional(),
    /** Store it only if the venue still names this value (an item edit, fork #1258) */
    expect: z.string().min(1).max(200).optional(),
    /** The undo entry this edit's burst extends (an item edit, fork #1258) */
    amend: z
        .string()
        .max(4 * 1024 * 1024)
        .optional(),
});

/** What storing a pack gave: the value now in `uniformArtwork`, and for an item edit its token */
export interface StoredUniformPackResult {
    value: string;
    token?: string | null;
}

/**
 * Stores the pack `raw` asks for with `store` (which reads it in the uniform pack worker and
 * refuses one that doesn't read) and answers with `publish`. An invalid request is ignored: it
 * has no `id` to answer.
 */
export function storeUniformPackRequest(
    raw: unknown,
    store: (request: {
        pack: Uint8Array;
        versionOf?: string;
        expect?: string;
        amend?: string;
    }) => Promise<StoredUniformPackResult>,
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
    const { id, bytes, versionOf, expect, amend } = asked.data;
    const answer = (result: View3dUniformPackResult) =>
        publish(VIEW3D_UNIFORM_PACK_RESULT_CHANNEL, result);
    return store({ pack: bytes, versionOf, expect, amend })
        .then(({ value, token }) =>
            answer({
                id,
                ok: true,
                value,
                ...(token !== undefined ? { token } : {}),
            }),
        )
        .catch((error: unknown) =>
            answer(
                // `UniformPackSupersededError` (db-functions/view3dUniformPack.ts)
                error instanceof Error &&
                    error.name === "UniformPackSupersededError"
                    ? { id, ok: false, superseded: true }
                    : { id, ok: false },
            ),
        );
}
