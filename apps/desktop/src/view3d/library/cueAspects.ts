/**
 * What the cue compile needs to know of the show's Library items and the
 * guard's flags for the Silk aspect note (ADR 0004 amendment of 2026-10-11,
 * props-spec.md section 3 "Fit" and [26.13]): an Artwork's chosen size and a
 * flag's Cut, each as an aspect, width ÷ height as the silk template lays it
 * out (fly wide, the Cut's overall depth tall; a Cut that isn't a rectangle
 * counts as its trim box, which is what the fit uses).
 *
 * Every compile caller passes `cueLibraryItemsOf` as `libraryItems` and
 * `cueSectionsOf` as `sections`, so the note sees the same aspects wherever
 * the show is compiled.
 */
import type { CueEquipment, CueLibraryItem, CueSection } from "@openmarch/core";
import { ArtworkSidecarSchema } from "@om-electron/main/artwork-import/sidecar";
import type { ShowLibraryItem } from "@/db-functions/showLibrary";
import { silkSurface } from "@/view3d/core/artworkTemplates/surfaces";
import { catalogEntry } from "@/view3d/core/sizes";
import type { HoldFamily } from "@/view3d/core/instruments/holds";

/** Width ÷ height of an Artwork's chosen size (its sidecar's `size`). */
export function artworkAspect(size: {
    width: { m: number };
    height: { m: number };
}): number {
    return size.width.m / size.height.m;
}

/** Width ÷ height of a silk Cut's template; undefined for an unknown Cut. */
export function silkCutAspect(catalogId: string): number | undefined {
    const entry = catalogEntry(catalogId);
    if (entry?.kind !== "silk") return undefined;
    const template = silkSurface(entry);
    return template.width.m / template.height.m;
}

/**
 * The Library items a show's Silk cues can name: each embedded Silk Artwork
 * Version, with its aspect. Other items are left out; a cue naming one stays
 * unknown to compile, as before.
 */
export function cueLibraryItemsOf(
    items: readonly ShowLibraryItem[],
): CueLibraryItem[] {
    const out: CueLibraryItem[] = [];
    for (const item of items) {
        if (item.kind !== "artwork") continue;
        const sidecar = ArtworkSidecarSchema.safeParse(item.sidecar);
        if (!sidecar.success || sidecar.data.surface !== "silk") continue;
        out.push({
            id: `library:${item.itemId}@${item.versionHash}`,
            channel: "silk",
            name: item.name,
            aspect: artworkAspect(sidecar.data.size),
        });
    }
    return out;
}

type FlagFamily = Extract<HoldFamily, "flag" | "swingFlag" | "doubleSwingFlag">;

/** The 3D View's flags (`instruments/guard.ts`) and the catalog Cut each one's silk is. */
const FLAGS: Readonly<
    Record<FlagFamily, { id: string; name: string; cut: string }>
> = {
    flag: {
        id: "builtin:model.flag6",
        name: "6 ft flag",
        cut: "silk-6ft-36x54",
    },
    swingFlag: {
        id: "builtin:model.swingFlag",
        name: "Swing flag",
        cut: "silk-swing-44x66",
    },
    doubleSwingFlag: {
        id: "builtin:model.doubleSwingFlag",
        name: "Double swing flags",
        cut: "silk-swing-44x66",
    },
};

/** The equipment a flag family is, with its Cut's aspect; undefined for any other family. */
export function flagEquipmentOf(
    family: HoldFamily | null,
): CueEquipment | undefined {
    const flag = family ? FLAGS[family as FlagFamily] : undefined;
    if (!flag) return undefined;
    const aspect = silkCutAspect(flag.cut);
    return {
        id: flag.id,
        name: flag.name,
        label: "Flag",
        holds: "flag",
        ...(aspect !== undefined ? { aspect } : {}),
    };
}

/**
 * Each section whose performers all carry the same flag, with that flag as
 * its usual equipment. Other sections are left out, so their Carry default
 * stays what each marcher carries.
 */
export function cueSectionsOf(
    marchers: readonly { section: string; family: HoldFamily | null }[],
): CueSection[] {
    const families = new Map<string, Set<HoldFamily | null>>();
    for (const { section, family } of marchers) {
        const key = section.trim().toLowerCase();
        const set = families.get(key) ?? new Set();
        set.add(family);
        families.set(key, set);
    }
    const out: CueSection[] = [];
    const seen = new Set<string>();
    for (const { section } of marchers) {
        const key = section.trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const set = families.get(key)!;
        if (set.size !== 1) continue;
        const equipment = flagEquipmentOf([...set][0] ?? null);
        if (equipment) out.push({ name: section, equipment });
    }
    return out;
}
