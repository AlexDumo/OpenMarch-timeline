/**
 * Logos, numbers and prints placed on the band's imported uniform (fork #1258;
 * docs/3d/uniform-artwork.md, "Placing items"). "Add logo or number…" picks a PNG or SVG,
 * decoded in the uniform pack worker; each item is a row where its panel, place, size, rotation
 * and grade are chosen, and it can be removed.
 *
 * Every change shows in the 3D View at once (an item draft, `itemDrafts.ts`) and is saved a
 * moment later as a new version of the uniform, with undo like any venue change. Every control is
 * a visible button, menu or field, so touch reaches all of it.
 *
 * A preview, like the uniform import: only where `uniformArtworkAvailable()`, and only for a
 * uniform imported into the show.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { TrashIcon } from "@phosphor-icons/react";
import {
    Button,
    Select,
    SelectContent,
    SelectItem,
    SelectTriggerCompact,
    UnitInput,
} from "@openmarch/ui";
import { touchSafeAccept } from "@/utilities/fileAccept";
import { uniformPackQueryOptions } from "@/hooks/queries/useUniformPack";
import {
    flatsArtworkOf,
    isUniformPackValue,
    itemPresets,
    itemSize,
    regionUnder,
    type FlatsRegions,
    type ItemPreset,
} from "@/view3d/core/marchers/uniformArtwork";
import {
    FLATS_PANELS,
    FLATS_REGION_IDS,
    ITEM_GRADES,
    ITEM_MIN_TILE_IN,
    UNIFORM_PACK_MAX_ITEMS,
    panelOfRegion,
    type FlatsRegionId,
    type ItemGrade,
    type UniformPackItem,
} from "@/view3d/core/uniformPack/format";
import { uniformArtworkAvailable } from "@/view3d/window/uniformArtworkPreview";
import { loadFlatsGeometry } from "@/view3d/window/performers/marchers/flatsAtlas";
import {
    editItems,
    itemsFor,
    newItemId,
    observeWorn,
    useItemDrafts,
} from "@/view3d/window/uniformPack/itemDrafts";
import { importItemFile } from "@/view3d/window/uniformPack/importItem";
import { contentsOf } from "@/view3d/core/uniformPack/modeEdits";
import { UniformImportError } from "@/view3d/window/uniformPack/importUniform";
import { Segmented, SegmentedMany } from "./Panel";
import { useVenueRequest } from "./VenueControls";

const ACCEPT = "image/png,image/svg+xml,.png,.svg";
type Panel = (typeof FLATS_PANELS)[number];
const CUSTOM = "custom";

/** The size a new item gets, inches, on its longer side */
const NEW_ITEM_IN = 6;

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The preset an item sits on, if any */
const presetOf = (presets: ItemPreset[], item: UniformPackItem) =>
    presets.find(
        (p) =>
            p.panel === item.panel &&
            Math.abs(p.at[0] - item.at[0]) < 0.01 &&
            Math.abs(p.at[1] - item.at[1]) < 0.01,
    );

export function UniformItemsControls() {
    const { t } = useTranslate();
    const { settings } = useVenueRequest();
    const input = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const [regions, setRegions] = useState<FlatsRegions | null>(null);
    const draft = useItemDrafts((s) => s.draft);
    const saving = useItemDrafts((s) => s.saving);
    const failed = useItemDrafts((s) => s.failed);

    const worn = flatsArtworkOf(settings?.uniformArtwork);
    const wornPack = worn && isUniformPackValue(worn) ? worn : null;
    const { data: pack } = useQuery(uniformPackQueryOptions(wornPack));
    useEffect(() => observeWorn(wornPack), [wornPack, draft]);
    useEffect(() => {
        let live = true;
        void loadFlatsGeometry().then(({ regions: r }) => {
            if (live) setRegions(r);
        });
        return () => {
            live = false;
        };
    }, []);

    if (!uniformArtworkAvailable() || !wornPack || !pack) return null;
    const stored = contentsOf(pack.manifest);
    const items = itemsFor(draft, wornPack, stored);
    const presets = regions ? itemPresets(regions) : [];
    const full = items.length >= UNIFORM_PACK_MAX_ITEMS;
    /** An item image's width over height: a new one's bitmap, else its stored PNG's header */
    const aspectOf = (file: string): number | null => {
        const image = draft?.images[file]?.bitmap;
        if (image) return image.width / image.height;
        const size = pack.itemSizes[file];
        return size ? size.width / size.height : null;
    };

    const edit = (
        change: (items: UniformPackItem[]) => UniformPackItem[],
        options?: Parameters<typeof editItems>[3],
    ) => editItems(wornPack, stored, change, options);
    const update = (id: string, patch: Partial<UniformPackItem>) =>
        edit((list) =>
            list.map((item) =>
                item.id === id ? withPatch(item, patch, regions) : item,
            ),
        );

    const onPick = async (file: File | undefined) => {
        if (!file) return;
        setBusy(true);
        setProblem(null);
        try {
            const imported = await importItemFile(file);
            const chest = presets.find((p) => p.id === "chest");
            const now = useItemDrafts.getState().draft;
            const { id, file: itemFile } = newItemId(
                itemsFor(now, wornPack, stored),
                Object.keys(now?.images ?? {}),
            );
            edit(
                (list) => [
                    ...list,
                    {
                        id,
                        name: imported.name,
                        file: itemFile,
                        panel: chest?.panel ?? "front",
                        at: chest ? [chest.at[0], chest.at[1]] : [17, 25.32],
                        ...(imported.aspect >= 1
                            ? { width: NEW_ITEM_IN }
                            : { height: NEW_ITEM_IN }),
                    },
                ],
                { images: { [itemFile]: imported.image }, now: true },
            );
        } catch (error) {
            console.warn("3D View: couldn't add the item", error);
            const code =
                error instanceof UniformImportError ? error.code : "unreadable";
            setProblem(t(`view3d.uniformImport.refused.${code}`));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex flex-col gap-8" data-testid="view3d-uniform-items">
            <span className="text-body">{t("view3d.uniformItems.title")}</span>
            <div className="flex flex-wrap items-center gap-6">
                <Button
                    variant="secondary"
                    size="compact"
                    disabled={busy}
                    aria-disabled={full || undefined}
                    tooltipText={
                        full
                            ? t("view3d.uniformItems.full", {
                                  count: UNIFORM_PACK_MAX_ITEMS,
                              })
                            : undefined
                    }
                    className={
                        full ? "cursor-not-allowed opacity-50" : undefined
                    }
                    data-testid="view3d-uniform-item-add"
                    onClick={() => {
                        if (full)
                            setProblem(
                                t("view3d.uniformItems.full", {
                                    count: UNIFORM_PACK_MAX_ITEMS,
                                }),
                            );
                        else input.current?.click();
                    }}
                >
                    {busy
                        ? t("view3d.uniformItems.adding")
                        : t("view3d.uniformItems.add")}
                </Button>
                {saving && (
                    <span className="text-sub text-text/60" role="status">
                        {t("view3d.uniformItems.saving")}
                    </span>
                )}
                <input
                    ref={input}
                    type="file"
                    accept={touchSafeAccept(ACCEPT)}
                    className="hidden"
                    aria-hidden
                    data-testid="view3d-uniform-item-file"
                    onChange={(e) => {
                        void onPick(e.target.files?.[0]);
                        e.target.value = "";
                    }}
                />
            </div>
            {items.length === 0 ? (
                <p className="text-sub text-text/60">
                    {t("view3d.uniformItems.hint")}
                </p>
            ) : (
                <ul className="flex flex-col gap-8">
                    {items.map((item) => (
                        <ItemRow
                            key={item.id}
                            item={item}
                            aspect={aspectOf(item.file)}
                            presets={presets}
                            onChange={(patch) => update(item.id, patch)}
                            onRemove={() =>
                                edit(
                                    (list) =>
                                        list.filter((i) => i.id !== item.id),
                                    { now: true },
                                )
                            }
                        />
                    ))}
                </ul>
            )}
            {failed && (
                <p className="text-sub text-red" role="alert">
                    {t("view3d.uniformItems.saveFailed")}
                </p>
            )}
            {problem && (
                <p className="text-sub text-red" role="alert">
                    {problem}
                </p>
            )}
        </div>
    );
}

/**
 * An item with `patch` applied, kept valid for the format: a tile gets the region under its
 * centre and a size of at least `ITEM_MIN_TILE_IN`; anything else loses its regions; regions on
 * another panel are dropped when the panel changes.
 */
export function withPatch(
    item: UniformPackItem,
    patch: Partial<UniformPackItem>,
    regions?: FlatsRegions | null,
): UniformPackItem {
    const next: UniformPackItem = { ...item, ...patch };
    if (next.grade !== "tile") {
        delete next.regions;
        return next;
    }
    const own = (next.regions ?? []).filter(
        (r) => panelOfRegion(r) === next.panel,
    );
    if (own.length === 0) {
        const under = regions
            ? regionUnder(regions, next.panel, next.at[0], next.at[1])
            : null;
        own.push(
            (under as FlatsRegionId | null) ??
                FLATS_REGION_IDS.find((r) => panelOfRegion(r) === next.panel)!,
        );
    }
    next.regions = own;
    if (next.width !== undefined && next.width < ITEM_MIN_TILE_IN)
        next.width = ITEM_MIN_TILE_IN;
    if (next.height !== undefined && next.height < ITEM_MIN_TILE_IN)
        next.height = ITEM_MIN_TILE_IN;
    return next;
}

function ItemRow({
    item,
    aspect,
    presets,
    onChange,
    onRemove,
}: {
    item: UniformPackItem;
    /** Its image's width over height, once known */
    aspect: number | null;
    presets: ItemPreset[];
    onChange: (patch: Partial<UniformPackItem>) => void;
    onRemove: () => void;
}) {
    const { t } = useTranslate();
    const preset = presetOf(presets, item);
    const sizeBy: "width" | "height" =
        item.width !== undefined ? "width" : "height";
    const size = item[sizeBy] ?? NEW_ITEM_IN;
    const grade = item.grade ?? "proportional";
    const change = onChange;
    // its box on the median body; null when the image's shape makes a side too long (or, for a
    // tile, too short) to draw
    const box = aspect === null ? undefined : itemSize(item, aspect);

    return (
        <li
            className="rounded-6 border-stroke bg-fg-2 flex flex-col gap-8 border p-8"
            data-testid="view3d-uniform-item"
        >
            <div className="flex items-center gap-8">
                <span className="text-body min-w-0 flex-1 truncate">
                    {item.name || t("view3d.uniformItems.unnamed")}
                </span>
                <Button
                    variant="ghost"
                    size="compact"
                    content="icon"
                    aria-label={t("view3d.uniformItems.remove")}
                    tooltipText={t("view3d.uniformItems.remove")}
                    tooltipSide="left"
                    className="size-28 p-0"
                    data-testid="view3d-uniform-item-remove"
                    onClick={onRemove}
                >
                    <TrashIcon size={16} />
                </Button>
            </div>
            <Field label={t("view3d.uniformItems.place")}>
                {(id) => (
                    <Select
                        value={preset?.id ?? CUSTOM}
                        onValueChange={(value) => {
                            const p = presets.find((q) => q.id === value);
                            if (p)
                                change({
                                    panel: p.panel,
                                    at: [p.at[0], p.at[1]],
                                });
                        }}
                    >
                        <SelectTriggerCompact
                            id={id}
                            label={t(
                                `view3d.uniformItems.preset.${preset?.id ?? CUSTOM}`,
                            )}
                        />
                        <SelectContent>
                            {presets.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                    {t(`view3d.uniformItems.preset.${p.id}`)}
                                </SelectItem>
                            ))}
                            {!preset && (
                                <SelectItem value={CUSTOM}>
                                    {t("view3d.uniformItems.preset.custom")}
                                </SelectItem>
                            )}
                        </SelectContent>
                    </Select>
                )}
            </Field>
            <Segmented<Panel>
                value={item.panel}
                // no look draws a cape yet, so Cape shows only for an item already on it
                options={FLATS_PANELS.filter(
                    (panel) => panel !== "cape" || item.panel === "cape",
                ).map((panel) => ({
                    value: panel,
                    label: t(`view3d.uniformItems.panel.${panel}`),
                }))}
                onChange={(panel) => change({ panel })}
                label={t("view3d.uniformItems.panelLabel")}
                testId="view3d-uniform-item-panel"
            />
            <div className="grid grid-cols-2 gap-8">
                <NumberField
                    label={t("view3d.uniformItems.x")}
                    unit="in"
                    value={item.at[0]}
                    min={-50}
                    max={150}
                    step={0.25}
                    testId="view3d-uniform-item-x"
                    onValue={(x) => change({ at: [x, item.at[1]] })}
                />
                <NumberField
                    label={t("view3d.uniformItems.y")}
                    unit="in"
                    value={item.at[1]}
                    min={-50}
                    max={150}
                    step={0.25}
                    testId="view3d-uniform-item-y"
                    onValue={(y) => change({ at: [item.at[0], y] })}
                />
                <Field label={t("view3d.uniformItems.sizeBy")}>
                    {(id) => (
                        <Select
                            value={sizeBy}
                            onValueChange={(value) => {
                                const by = value as "width" | "height";
                                if (by === sizeBy) return;
                                // the item keeps its box: the other side's length becomes the number
                                const other = box
                                    ? round2(by === "width" ? box.w : box.h)
                                    : size;
                                onChange({
                                    width: by === "width" ? other : undefined,
                                    height: by === "height" ? other : undefined,
                                });
                            }}
                        >
                            <SelectTriggerCompact
                                id={id}
                                label={t(`view3d.uniformItems.${sizeBy}`)}
                            />
                            <SelectContent>
                                <SelectItem value="width">
                                    {t("view3d.uniformItems.width")}
                                </SelectItem>
                                <SelectItem value="height">
                                    {t("view3d.uniformItems.height")}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    )}
                </Field>
                <NumberField
                    label={t("view3d.uniformItems.size")}
                    unit="in"
                    value={size}
                    min={grade === "tile" ? ITEM_MIN_TILE_IN : 0.25}
                    max={120}
                    step={0.25}
                    testId="view3d-uniform-item-size"
                    onValue={(v) => change({ [sizeBy]: v })}
                />
                <NumberField
                    label={t("view3d.uniformItems.rotate")}
                    unit="°"
                    value={item.rotate ?? 0}
                    min={-360}
                    max={360}
                    step={1}
                    testId="view3d-uniform-item-rotate"
                    onValue={(rotate) => change({ rotate })}
                />
                <Field label={t("view3d.uniformItems.grade")}>
                    {(id) => (
                        <Select
                            value={grade}
                            onValueChange={(value) =>
                                change({ grade: value as ItemGrade })
                            }
                        >
                            <SelectTriggerCompact
                                id={id}
                                label={t(`view3d.uniformItems.grades.${grade}`)}
                            />
                            <SelectContent>
                                {ITEM_GRADES.map((g) => (
                                    <SelectItem key={g} value={g}>
                                        {t(`view3d.uniformItems.grades.${g}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                </Field>
            </div>
            {grade === "tile" && <TileRegions item={item} onChange={change} />}
            {box === null && (
                <p
                    className="text-sub text-yellow"
                    role="status"
                    data-testid="view3d-uniform-item-not-drawn"
                >
                    {t(
                        grade === "tile"
                            ? "view3d.uniformItems.notDrawnTile"
                            : "view3d.uniformItems.notDrawn",
                    )}
                </p>
            )}
        </li>
    );
}

/** The regions a tile repeats over: one toggle per region on its side */
function TileRegions({
    item,
    onChange,
}: {
    item: UniformPackItem;
    onChange: (patch: Partial<UniformPackItem>) => void;
}) {
    const { t } = useTranslate();
    const [refused, setRefused] = useState(false);
    const own = FLATS_REGION_IDS.filter((r) => panelOfRegion(r) === item.panel);
    const needsOne = t("view3d.uniformItems.needsRegion");
    return (
        <div className="flex flex-col gap-4">
            <span className="text-sub text-text/70">
                {t("view3d.uniformItems.repeatOver")}
            </span>
            <SegmentedMany<FlatsRegionId>
                value={(item.regions ?? []).filter((r) => own.includes(r))}
                options={own.map((region) => ({
                    value: region,
                    label: t(
                        `view3d.uniformItems.region.${
                            region === "cape"
                                ? "cape"
                                : region.replace(/^(front|back)-/, "")
                        }`,
                    ),
                }))}
                onChange={(regions) => {
                    setRefused(false);
                    // in the template's order
                    onChange({
                        regions: own.filter((r) => regions.includes(r)),
                    });
                }}
                lastReason={needsOne}
                onRefused={() => setRefused(true)}
                label={t("view3d.uniformItems.repeatOver")}
                testId="view3d-uniform-item-regions"
            />
            {refused && (
                <span className="text-sub text-text/60" role="status">
                    {needsOne}
                </span>
            )}
        </div>
    );
}

/** A label above a control, the control given the label's id */
function Field({
    label,
    children,
}: {
    label: string;
    children: (id: string) => ReactNode;
}) {
    const id = useId();
    return (
        <label className="flex min-w-0 flex-col gap-4" htmlFor={id}>
            <span className="text-sub text-text/70">{label}</span>
            {children(id)}
        </label>
    );
}

/**
 * A number in a unit. Each valid number typed is applied at once (the 3D View follows); leaving
 * the field puts back the current value if what's typed isn't a number in range.
 */
function NumberField({
    label,
    unit,
    value,
    min,
    max,
    step,
    testId,
    onValue,
}: {
    label: string;
    unit: string;
    value: number;
    min: number;
    max: number;
    step: number;
    testId: string;
    onValue: (value: number) => void;
}) {
    const id = useId();
    const [text, setText] = useState(String(round2(value)));
    const focused = useRef(false);
    useEffect(() => {
        if (!focused.current) setText(String(round2(value)));
    }, [value]);
    return (
        <label className="flex min-w-0 flex-col gap-4" htmlFor={id}>
            <span className="text-sub text-text/70">{label}</span>
            <UnitInput
                id={id}
                compact
                unit={unit}
                step={step}
                min={min}
                max={max}
                value={text}
                data-testid={testId}
                onFocus={() => {
                    focused.current = true;
                }}
                onBlur={() => {
                    focused.current = false;
                    setText(String(round2(value)));
                }}
                onChange={(event) => {
                    setText(event.target.value);
                    const n = Number(event.target.value);
                    if (
                        event.target.value.trim() !== "" &&
                        Number.isFinite(n) &&
                        n >= min &&
                        n <= max
                    )
                        onValue(round2(n));
                }}
            />
        </label>
    );
}
