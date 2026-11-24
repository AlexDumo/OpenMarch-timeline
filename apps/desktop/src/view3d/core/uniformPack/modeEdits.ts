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
 * - **Removing a mode never removes an image** (a layer), like deleting a layer comp in a design
 *   tool: another mode may have it turned off for now. Images no mode shows are removed on their
 *   own ({@link removeUnusedLayers}). Removing the last mode is the exception: the pack then draws
 *   every layer, so it keeps exactly that mode's layers and items, and folds its colors and parts
 *   into the pack's own, so it draws what that mode drew.
 * - **A mode id is never reused.** Each new id ends in a random part, so a mode made after one was
 *   removed never takes its id, and a venue or cue naming the removed one falls back to the
 *   default instead of picking up the new one.
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

/** What an edit can change: the pack's lists (never left out), and its own colors and parts */
export type PackContents = {
    layers: UniformPackLayer[];
    items: NonNullable<UniformPackContents["items"]>;
    modes: UniformPackMode[];
    palette: UniformPackManifest["palette"];
    options: UniformPackManifest["options"];
};

/** A manifest's or a draft's contents, with the optional lists filled in */
export const contentsOf = (
    from: Pick<
        UniformPackManifest,
        "layers" | "items" | "modes" | "palette" | "options"
    >,
): PackContents => ({
    layers: from.layers,
    items: from.items ?? [],
    modes: from.modes ?? [],
    palette: from.palette,
    options: from.options,
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

/** Makes the random part of a mode id; tests pass their own */
export type RandomPart = () => string;

const randomPart: RandomPart = () => {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    return [...bytes]
        .map((b) => (b % 36).toString(36))
        .join("")
        .padEnd(4, "0");
};

/**
 * A new mode id for `name`: its stem and a random part (`sash-out-k3f9`), never one of `modes`.
 * The random part keeps a removed mode's id from coming back (see the module comment).
 */
export function newModeId(
    modes: readonly UniformPackMode[],
    name: string,
    random: RandomPart = randomPart,
): string {
    const taken = new Set(modes.map((m) => m.id));
    const stem = stemOf(name, "mode").slice(0, 26).replace(/-+$/, "");
    for (;;) {
        const id = `${stem}-${random()}`;
        if (!taken.has(id)) return id;
    }
}

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
const impliedDefault = (
    contents: PackContents,
    name: string,
    random?: RandomPart,
) => ({
    id: newModeId([], name, random),
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
        random,
    }: {
        name: string;
        defaultName: string;
        layer?: UniformPackLayer;
        /** Makes ids' random parts; tests pass their own */
        random?: RandomPart;
    },
): { contents: PackContents; id: string } {
    const refusal = addModeRefusal(contents, { withLayer: !!layer });
    if (refusal) throw new Error(`uniform modes: ${refusal}`);
    const modes: UniformPackMode[] =
        contents.modes.length > 0
            ? contents.modes
            : [
                  impliedDefault(
                      contents,
                      defaultName.trim() || "Default",
                      random,
                  ),
              ];
    const base = modes[0];
    const trimmed = name.trim() || "Mode";
    const id = newModeId(modes, trimmed, random);
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
 * Removes mode `id`, keeping every layer. Removing the last mode keeps exactly its layers and
 * items, and makes its colors and parts the pack's own, so the pack draws what that mode drew.
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
            palette: { ...contents.palette, ...gone.palette },
            options: { ...contents.options, ...gone.options },
        };
    }
    return tidyContents({ ...contents, modes });
}

/** The layers no mode shows (none for a pack without modes, which shows them all) */
export const unusedLayers = (contents: PackContents): UniformPackLayer[] => {
    if (contents.modes.length === 0) return [];
    const used = new Set(contents.modes.flatMap((m) => m.layers));
    return contents.layers.filter((l) => !used.has(l.id));
};

/** Removes the layers no mode shows ({@link unusedLayers}) */
export function removeUnusedLayers(contents: PackContents): PackContents {
    const unused = new Set(unusedLayers(contents).map((l) => l.id));
    if (unused.size === 0) return contents;
    return tidyContents({
        ...contents,
        layers: contents.layers.filter((l) => !unused.has(l.id)),
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
    id: string,
    role: PaletteRole,
    color: string | null,
): PackContents {
    const mode = contents.modes.find((m) => m.id === id);
    if (!mode) return contents;
    const base = contents.palette;
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
    id: string,
    on: readonly PartOption[],
): PackContents {
    const mode = contents.modes.find((m) => m.id === id);
    if (!mode) return contents;
    const base = contents.options;
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
