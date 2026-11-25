/**
 * Why the band wears its preset although the venue names an imported uniform (fork #1257; ADR
 * 0010, "Removal"): the show doesn't have that uniform (an undo after Remove unused…), or it has
 * it but its file doesn't read: the manifest, or an image whose data won't decode (the read
 * decodes them all, except in the 3D View, whose composing decodes them, and whose compose
 * failure reads them again decoded, `recheckUniformPack`), or it was made by a newer OpenMarch
 * ("newer", a kind of unreadable: updating draws it). Or it couldn't be loaded just now
 * ("loadFailed"): reading it still failed after its retries (a worker that ran out of time or
 * died, an asset read that failed). That says nothing about the file, so it isn't called
 * damaged, and Try again reads it again. A failed list of the show's uniforms alone isn't a
 * problem with the band's uniform (it may read and be worn): the picker says so on its own. The Assets view, the uniform
 * picker and the 3D View settings all ask this, so they agree.
 *
 * Pure: no React, no database.
 */
export type WornPackProblem = "missing" | "unreadable" | "newer" | "loadFailed";

/**
 * @param value the imported uniform the venue names, or null for a preset or built-in
 * @param inShow whether the show has a uniform asset of that value; undefined while the list
 *   loads, or when it failed
 * @param read the pack as read: undefined while reading (or while a passing worker failure is
 *   retried), null when it doesn't read (or isn't there)
 * @param newer whether a read that gave null was refused as made by a newer OpenMarch
 *   (`uniformPackIsNewer`)
 * @param readFailed whether reading this uniform ended in an error with nothing read (the
 *   query's error state after its retries); a failed list doesn't count
 */
export function wornPackProblem(
    value: string | null,
    inShow: boolean | undefined,
    read: unknown,
    newer = false,
    readFailed = false,
): WornPackProblem | null {
    if (!value) return null;
    // the read failed: whatever the list says, nothing was read to wear
    if (readFailed && read === undefined)
        return inShow === false ? "missing" : "loadFailed";
    if (inShow === undefined) return null;
    if (!inShow) return "missing";
    if (read === undefined) return null;
    if (read !== null) return null;
    return newer ? "newer" : "unreadable";
}
