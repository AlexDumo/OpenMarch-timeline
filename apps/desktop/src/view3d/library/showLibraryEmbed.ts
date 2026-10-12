/**
 * Copying a local Library Version into the show (ADR 0002 D-12, C1.11).
 *
 * The editor reads every part over `library:read-parts`, an Artwork's original included, so a
 * show carries all it needs: it opens on a machine whose Library doesn't have the item, and
 * "Add to my Library" there passes main's hash check.
 */
import type { LibraryItem } from "@om-electron/main/library/types";
import type { EmbedLibraryVersion } from "@/db-functions/showLibrary";
import {
    READABLE_ROLES,
    type ReadableRole,
    type ReadPartsRequest,
    type Result,
} from "./protocol";

const isReadableRole = (role: string): role is ReadableRole =>
    (READABLE_ROLES as readonly string[]).includes(role);

/**
 * Reads one Version's parts and returns it ready for `embedLibraryVersionInTransaction`, which
 * checks the bytes against the Version hash.
 */
export async function versionToEmbed({
    item,
    versionHash,
    readParts,
}: {
    item: LibraryItem;
    versionHash: string;
    readParts: (
        request: ReadPartsRequest,
    ) => Promise<Result<Record<string, Uint8Array>>>;
}): Promise<EmbedLibraryVersion> {
    const version = item.versions.find((v) => v.hash === versionHash);
    if (!version) {
        throw new Error(`${item.name} has no Version ${versionHash}`);
    }
    const roles = Object.keys(version.parts);
    const unreadable = roles.filter((role) => !isReadableRole(role));
    if (unreadable.length > 0) {
        throw new Error(
            `Can't embed ${item.name}: read-parts doesn't serve ${unreadable.join(", ")}`,
        );
    }

    const result = await readParts({
        itemId: item.id,
        versionHash,
        roles: roles as ReadableRole[],
    });
    if (!result.ok) {
        throw new Error(
            `Couldn't read ${item.name} from the Library: ${result.error.message}`,
        );
    }
    const missing = roles.filter((role) => !result.value[role]);
    if (missing.length > 0) {
        throw new Error(
            `The Library is missing the ${missing.join(", ")} part of ${item.name}`,
        );
    }

    return {
        itemId: item.id,
        versionHash,
        kind: item.kind,
        name: item.name,
        builtIn: item.builtIn,
        metadata: {
            tags: item.tags,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            originalFilename: item.originalFilename,
            derivedFrom: item.derivedFrom,
            license: item.license,
            licenseText: item.licenseText,
            author: item.author,
            sourceUrl: item.sourceUrl,
            attribution: item.attribution,
            modified: item.modified,
        },
        // A Uniform's pins come with Uniforms (P12); nothing else pins
        pins: [],
        parts: Object.fromEntries(
            roles.map((role) => [role, result.value[role]]),
        ),
    };
}
