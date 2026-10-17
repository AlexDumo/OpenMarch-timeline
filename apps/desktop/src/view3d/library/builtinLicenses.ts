/**
 * The built-in catalog's licenses (props-spec.md section 10, ADR 0002 D-21,
 * package C5.8). Every file under the built-in asset roots is declared one
 * of two ways: a `LICENSE` in its folder or a folder above it (OpenMarch-made
 * content, the om-pose assets), or an entry in `assets/third-party.json`
 * carrying its SPDX license, author, source, attribution and retrieval date.
 * Third-party built-ins are CC0 or CC-BY 4.0 only. A test runs the check over
 * the repository, so CI fails on an entry outside the allow-list.
 */

/** The folders, relative to `apps/desktop`, whose files ship as built-ins. */
export const BUILTIN_ASSET_ROOTS = ["src/view3d/assets", "starter-kit"];

/** The licenses a third-party built-in may carry: no BY-SA, NC, ND or store licenses. */
export const THIRD_PARTY_LICENSES = ["CC0-1.0", "CC-BY-4.0"] as const;

/** One third-party built-in in `assets/third-party.json`. */
export interface ThirdPartyEntry {
    name: string;
    /** Its files, relative to `apps/desktop`. */
    files: readonly string[];
    /** An SPDX license id. */
    license: string;
    author: string;
    sourceUrl: string;
    /** The attribution text, as Credits shows it. */
    attribution: string;
    /** When it was retrieved, `YYYY-MM-DD`. */
    retrieved: string;
    /** Whether the built-in changes the source. */
    modified: boolean;
}

/** Files that describe a folder rather than ship in it. */
const NOT_ASSETS = new Set([
    "LICENSE",
    "CREDITS.md",
    "README.md",
    "third-party.json",
]);

const REQUIRED = ["author", "sourceUrl", "attribution", "retrieved"] as const;

const dirOf = (file: string) => file.slice(0, file.lastIndexOf("/"));
const baseOf = (file: string) => file.slice(file.lastIndexOf("/") + 1);

/** Whether a `LICENSE` sits in the file's folder or a folder above it, within its root. */
function folderLicensed(file: string, licenses: ReadonlySet<string>): boolean {
    const root = BUILTIN_ASSET_ROOTS.find((r) => file.startsWith(`${r}/`));
    for (let dir = dirOf(file); dir.length > 0; dir = dirOf(dir)) {
        if (licenses.has(dir)) return true;
        if (dir === root || !dir.includes("/")) break;
    }
    return false;
}

function entryProblems(
    entry: ThirdPartyEntry,
    present: ReadonlySet<string>,
): string[] {
    const out: string[] = [];
    if (!(THIRD_PARTY_LICENSES as readonly string[]).includes(entry.license))
        out.push(
            `${entry.name}: license "${entry.license}" isn't allowed (${THIRD_PARTY_LICENSES.join(", ")})`,
        );
    for (const field of REQUIRED)
        if (!entry[field]?.trim())
            out.push(`${entry.name}: ${field} is missing`);
    if (entry.sourceUrl?.trim() && !/^https:\/\/\S+$/.test(entry.sourceUrl))
        out.push(`${entry.name}: sourceUrl isn't an https URL`);
    if (entry.retrieved?.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(entry.retrieved))
        out.push(`${entry.name}: retrieved isn't a YYYY-MM-DD date`);
    for (const file of entry.files)
        if (!present.has(file))
            out.push(`${entry.name}: ${file} isn't in the repository`);
    return out;
}

/**
 * The problems with the built-ins' licenses, empty when every built-in
 * carries its license fields inside the allow-list.
 */
export function checkBuiltinLicenses({
    entries,
    files,
}: {
    entries: readonly ThirdPartyEntry[];
    /** Every file under the asset roots, relative to `apps/desktop`. */
    files: readonly string[];
}): string[] {
    const present = new Set(files);
    const listed = new Set(entries.flatMap((e) => e.files));
    const licenses = new Set(
        files.filter((f) => baseOf(f) === "LICENSE").map(dirOf),
    );
    const problems = entries.flatMap((e) => entryProblems(e, present));
    for (const file of files) {
        if (NOT_ASSETS.has(baseOf(file)) || listed.has(file)) continue;
        if (!folderLicensed(file, licenses))
            problems.push(
                `${file} has no license: list it in third-party.json or add a LICENSE to its folder`,
            );
    }
    return problems;
}
