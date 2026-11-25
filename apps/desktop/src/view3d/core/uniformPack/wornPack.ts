/**
 * Why the band wears its preset although the venue names an imported uniform (fork #1257; ADR
 * 0010, "Removal"): the show doesn't have that uniform (an undo after Remove unused…), or it has
 * it but its file doesn't read: the manifest, or an image whose data won't decode (the read
 * decodes them all, except in the 3D View, whose composing decodes them, and whose compose
 * failure reads them again decoded, `recheckUniformPack`), or it was made by a newer OpenMarch
 * ("newer", a kind of unreadable: updating draws it). The Assets view, the uniform picker and the 3D View settings all
 * ask this, so they agree.
 *
 * Pure: no React, no database.
 */
export type WornPackProblem = "missing" | "unreadable" | "newer";

/**
 * @param value the imported uniform the venue names, or null for a preset or built-in
 * @param inShow whether the show has a uniform asset of that value; undefined while loading
 * @param read the pack as read: undefined while reading (or while a passing worker failure is
 *   retried), null when it doesn't read (or isn't there)
 * @param newer whether a read that gave null was refused as made by a newer OpenMarch
 *   (`uniformPackIsNewer`)
 */
export function wornPackProblem(
    value: string | null,
    inShow: boolean | undefined,
    read: unknown,
    newer = false,
): WornPackProblem | null {
    if (!value || inShow === undefined) return null;
    if (!inShow) return "missing";
    if (read === undefined) return null;
    if (read !== null) return null;
    return newer ? "newer" : "unreadable";
}
