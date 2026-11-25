/**
 * Why the band wears its preset although the venue names an imported uniform (fork #1257; ADR
 * 0010, "Removal"): the show doesn't have that uniform (an undo after Remove unused…), or it has
 * it but its file doesn't read: the manifest, or an image whose data won't decode (the read
 * decodes them all, except in the 3D View, whose composing decodes them, and whose compose
 * failure reads them again decoded, `recheckUniformPack`), or it was made by a newer OpenMarch
 * ("newer", a kind of unreadable: updating draws it). Or it couldn't be loaded just now
 * ("loadFailed"): reading it, or listing the show's uniforms, still failed after its retries (a
 * worker that ran out of time or died, an asset read that failed). That says nothing about the
 * file, so it isn't called damaged, and Try again reads it again. The Assets view, the uniform
 * picker and the 3D View settings all ask this, so they agree.
 *
 * Pure: no React, no database.
 */
export type WornPackProblem = "missing" | "unreadable" | "newer" | "loadFailed";

/**
 * @param value the imported uniform the venue names, or null for a preset or built-in
 * @param inShow whether the show has a uniform asset of that value; undefined while loading
 * @param read the pack as read: undefined while reading (or while a passing worker failure is
 *   retried), null when it doesn't read (or isn't there)
 * @param newer whether a read that gave null was refused as made by a newer OpenMarch
 *   (`uniformPackIsNewer`)
 * @param failed whether listing the show's uniforms, or reading this one, ended in an error with
 *   nothing read (the query's error state after its retries)
 */
export function wornPackProblem(
    value: string | null,
    inShow: boolean | undefined,
    read: unknown,
    newer = false,
    failed = false,
): WornPackProblem | null {
    if (!value) return null;
    if (inShow === undefined) return failed ? "loadFailed" : null;
    if (!inShow) return "missing";
    if (read === undefined) return failed ? "loadFailed" : null;
    if (read !== null) return null;
    return newer ? "newer" : "unreadable";
}
