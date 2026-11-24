/**
 * Editing a uniform pack's modes (format version 3, step 5 of fork #1257; docs/3d/uniform-artwork.md,
 * "Modes and variants"). Each function takes the pack's layers, items and modes and returns new
 * ones, kept valid for the format; the window's draft applies them and saves the result as a new
 * version of the uniform.
 *
 * The rules:
 *
 * - **The first mode is the default.** A pack with no modes draws every layer and item; adding its
 *   first mode also adds a default mode holding exactly that, so nothing it draws changes.
 * - **A new mode starts as a copy of the default**, plus the overlay layer it was made with, if any.
 * - **A new item shows in every mode** ({@link tidyContents}); a removed item or layer leaves
 *   every mode that named it.
 * - **Removing a mode** drops the layers no remaining mode draws, so an overlay doesn't linger in
 *   the file. Removing the last mode keeps exactly its layers and items, so the pack draws what it
 *   drew. Turning a layer off in a mode never drops it.
 *
 * Pure: no React, no workers.
 */
import {
    UNIFORM_PACK_MAX_LAYERS,
    UNIFORM_PACK_MAX_MODES,
    type UniformPackContents,
    type UniformPackLayer,
    type UniformPackManifest,
    type UniformPackMode,
} from "./format";

/** The pack's lists, never left out */
export type PackContents = {
    layers: UniformPackLayer[];
    items: NonNullable<UniformPackContents["items"]>;
    modes: UniformPackMode[];
};

/** A manifest's or a draft's lists, with the optional ones filled in */
export const contentsOf = (
    from: Pick<UniformPackManifest, "layers" | "items" | "modes">,
): PackContents => ({
    layers: from.layers,
    items: from.items ?? [],
    modes: from.modes ?? [],
});

export type PaletteRole = keyof UniformPackManifest["palette"];
export type PartOption = keyof UniformPackManifest["options"];

/** The palette roles a mode can change in the app, in the order they're shown */
export const MODE_PALETTE_ROLES = [
    "primary",
    "secondary",
    "accent",
    "trim",
    "pants",
] as const satisfies readonly PaletteRole[];

/** The part options a mode can change in the app */
export const MODE_PART_OPTIONS = [
    "stripe",
    "collar",
    "cuffs",
    "gloves",
    "hat",
] as const satisfies readonly PartOption[];

/** An id like `<stem>-<n>`, unused by `taken` */
function freshId(stem: string, taken: Iterable<string>): string {
    const used = new Set(taken);
    if (!used.has(stem)) return stem;
    for (let n = 2; ; n++) if (!used.has(`${stem}-${n}`)) return `${stem}-${n}`;
}

/** A name's id stem: lower case, letters and digits joined by dashes, at most 24 characters */
function stemOf(name: string, fallback: string): string {
    const stem = name
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 24)
        .replace(/-+$/, "");
    return stem || fallback;
}

/** A new mode id for `name`, unused by `modes` */
export const newModeId = (modes: readonly UniformPackMode[], name: string) =>
    freshId(
        stemOf(name, "mode"),
        modes.map((m) => m.id),
    );

/**
 * A new layer id and file for `name`, unused by `layers` and by `takenFiles` (files a draft
 * already holds, so a layer added and removed again never shares bytes with a later one)
 */
export function newLayerId(
    layers: readonly UniformPackLayer[],
    name: string,
    takenFiles: Iterable<string> = [],
): { id: string; file: string } {
    const files = new Set([...layers.map((l) => l.file), ...takenFiles]);
    const taken = [
        ...layers.map((l) => l.id),
        ...[...files].map((f) => f.replace(/^layers\/|\.png$/g, "")),
    ];
    const id = freshId(stemOf(name, "layer"), taken);
    return { id, file: `layers/${id}.png` };
}

/**
 * The contents made valid for the format: each mode names only layers and items the pack has,
 * none twice, and at least one layer (the pack's first, if it lost them all); an item new since
 * `before` shows in every mode.
 */
export function tidyContents(
    contents: PackContents,
    before?: PackContents,
): PackContents {
    const layerIds = new Set(contents.layers.map((l) => l.id));
    const itemIds = contents.items.map((i) => i.id);
    const known = new Set(itemIds);
    const old = before ? new Set(before.items.map((i) => i.id)) : null;
    const added = old ? itemIds.filter((id) => !old.has(id)) : [];
    const modes = contents.modes.map((mode) => {
        const layers = [...new Set(mode.layers)].filter((id) =>
            layerIds.has(id),
        );
        const items = [...new Set([...mode.items, ...added])].filter((id) =>
            known.has(id),
        );
        return {
            ...mode,
            layers:
                layers.length > 0
                    ? layers
                    : contents.layers.slice(0, 1).map((l) => l.id),
            items,
        };
    });
    return { ...contents, modes };
}

/** The pack's default mode, as a mode, for a pack that has none yet: every layer and item */
const impliedDefault = (contents: PackContents, name: string) => ({
    id: newModeId([], name),
    name,
    layers: contents.layers.map((l) => l.id),
    items: contents.items.map((i) => i.id),
});

/** Whether another mode fits: refused with this reason, or null */
export function addModeRefusal(
    contents: PackContents,
    { withLayer }: { withLayer: boolean },
): "modesFull" | "layersFull" | null {
    // a pack without modes gains its default too
    const after = contents.modes.length === 0 ? 2 : contents.modes.length + 1;
    if (after > UNIFORM_PACK_MAX_MODES) return "modesFull";
    if (withLayer && contents.layers.length >= UNIFORM_PACK_MAX_LAYERS)
        return "layersFull";
    return null;
}

/**
 * Adds a mode called `name`: a copy of the default mode, with `layer` (a new overlay, stored under
 * its `file`) drawn on top when given. A pack without modes gains its default first, called
 * `defaultName`. Returns the contents and the new mode's id; throws when it doesn't fit
 * ({@link addModeRefusal}).
 */
export function addMode(
    contents: PackContents,
    {
        name,
        defaultName,
        layer,
    }: {
        name: string;
        defaultName: string;
        layer?: UniformPackLayer;
    },
): { contents: PackContents; id: string } {
    const refusal = addModeRefusal(contents, { withLayer: !!layer });
    if (refusal) throw new Error(`uniform modes: ${refusal}`);
    const modes: UniformPackMode[] =
        contents.modes.length > 0
            ? contents.modes
            : [impliedDefault(contents, defaultName.trim() || "Default")];
    const base = modes[0];
    const trimmed = name.trim() || "Mode";
    const id = newModeId(modes, trimmed);
    const layers = layer ? [...contents.layers, layer] : contents.layers;
    const mode: UniformPackMode = {
        id,
        name: trimmed.slice(0, 120),
        layers: layer ? [...base.layers, layer.id] : [...base.layers],
        items: [...base.items],
        ...(base.palette ? { palette: { ...base.palette } } : {}),
        ...(base.options ? { options: { ...base.options } } : {}),
    };
    return {
        contents: tidyContents({
            ...contents,
            layers,
            modes: [...modes, mode],
        }),
        id,
    };
}

/** Changes mode `id` by `patch`, kept valid */
export function updateMode(
    contents: PackContents,
    id: string,
    patch: Partial<Omit<UniformPackMode, "id">>,
): PackContents {
    return tidyContents({
        ...contents,
        modes: contents.modes.map((m) =>
            m.id === id ? { ...m, ...patch } : m,
        ),
    });
}

/** Renames mode `id`; an empty name keeps the old one */
export function renameMode(
    contents: PackContents,
    id: string,
    name: string,
): PackContents {
    const trimmed = name.trim().slice(0, 120);
    return trimmed ? updateMode(contents, id, { name: trimmed }) : contents;
}

/**
 * Removes mode `id`. The layers no remaining mode draws go too; removing the last mode keeps
 * exactly its layers and items, so the pack draws what that mode drew.
 */
export function removeMode(contents: PackContents, id: string): PackContents {
    const gone = contents.modes.find((m) => m.id === id);
    if (!gone) return contents;
    const modes = contents.modes.filter((m) => m.id !== id);
    if (modes.length === 0) {
        const byId = new Map(contents.layers.map((l) => [l.id, l]));
        const shown = new Set(gone.items);
        return {
            layers: gone.layers.flatMap((l) => byId.get(l) ?? []),
            items: contents.items.filter((i) => shown.has(i.id)),
            modes: [],
        };
    }
    const used = new Set(modes.flatMap((m) => m.layers));
    return tidyContents({
        ...contents,
        layers: contents.layers.filter((l) => used.has(l.id)),
        modes,
    });
}

/** Moves mode `id` by `delta` places (the first is the default) */
export function moveMode(
    contents: PackContents,
    id: string,
    delta: number,
): PackContents {
    const from = contents.modes.findIndex((m) => m.id === id);
    if (from < 0) return contents;
    const to = Math.max(0, Math.min(contents.modes.length - 1, from + delta));
    if (to === from) return contents;
    const modes = [...contents.modes];
    const [mode] = modes.splice(from, 1);
    modes.splice(to, 0, mode);
    return { ...contents, modes };
}

/**
 * Turns layer `layerId` on or off in mode `id`. Turned on, it's drawn in the pack's layer order
 * among the mode's others. The last layer can't be turned off (the mode keeps it).
 */
export function setModeLayer(
    contents: PackContents,
    id: string,
    layerId: string,
    on: boolean,
): PackContents {
    const mode = contents.modes.find((m) => m.id === id);
    if (!mode) return contents;
    const next = new Set(mode.layers);
    if (on) next.add(layerId);
    else if (next.size > 1) next.delete(layerId);
    // the pack's order is the drawing order: base first, then overlays
    const layers = contents.layers.map((l) => l.id).filter((l) => next.has(l));
    return updateMode(contents, id, { layers });
}

/** Shows or hides item `itemId` in mode `id` */
export function setModeItem(
    contents: PackContents,
    id: string,
    itemId: string,
    on: boolean,
): PackContents {
    const mode = contents.modes.find((m) => m.id === id);
    if (!mode) return contents;
    const next = new Set(mode.items);
    if (on) next.add(itemId);
    else next.delete(itemId);
    const items = contents.items.map((i) => i.id).filter((i) => next.has(i));
    return updateMode(contents, id, { items });
}

/**
 * Sets palette role `role` in mode `id` to `color` (`#rrggbb`), or back to the uniform's own with
 * null. A color equal to the uniform's is no change, so it isn't stored.
 */
export function setModeColor(
    contents: PackContents,
    base: UniformPackManifest["palette"],
    id: string,
    role: PaletteRole,
    color: string | null,
): PackContents {
    const mode = contents.modes.find((m) => m.id === id);
    if (!mode) return contents;
    const palette = { ...mode.palette };
    if (color === null || color.toLowerCase() === base[role].toLowerCase())
        delete palette[role];
    else palette[role] = color.toLowerCase();
    const next: UniformPackMode = { ...mode, palette };
    if (Object.keys(palette).length === 0) delete next.palette;
    return tidyContents({
        ...contents,
        modes: contents.modes.map((m) => (m.id === id ? next : m)),
    });
}

/**
 * Sets which part options are on in mode `id`: each that differs from the uniform's own is
 * stored, the rest aren't
 */
export function setModeParts(
    contents: PackContents,
    base: UniformPackManifest["options"],
    id: string,
    on: readonly PartOption[],
): PackContents {
    const mode = contents.modes.find((m) => m.id === id);
    if (!mode) return contents;
    const options: Partial<UniformPackManifest["options"]> = {};
    for (const part of MODE_PART_OPTIONS) {
        const value = on.includes(part);
        if (value !== base[part]) options[part] = value;
    }
    const next: UniformPackMode = { ...mode, options };
    if (Object.keys(options).length === 0) delete next.options;
    return tidyContents({
        ...contents,
        modes: contents.modes.map((m) => (m.id === id ? next : m)),
    });
}
