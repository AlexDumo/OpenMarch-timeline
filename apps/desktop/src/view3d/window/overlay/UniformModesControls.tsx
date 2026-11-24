/**
 * Modes of the band's imported uniform (format version 3, step 5 of fork #1257;
 * docs/3d/uniform-artwork.md, "Modes and variants"): plain, sash out, sash out and unzipped. A
 * mode is the layers it draws, the logos and numbers that show in it, and the colors and parts it
 * changes; the first is the default.
 *
 * - **Add mode…** names a mode and, optionally, imports an overlay: a transparent page-size PNG
 *   or SVG holding only what changes, decoded in the uniform pack worker like any layer. A mode
 *   with no overlay starts as a copy of the default, to change its colors or parts.
 * - Each mode can be renamed, moved, removed, and given its layers, items, colors and parts.
 * - **Band wears** picks the mode for the whole show. A Uniform cue will switch modes from a count
 *   on once fork #976 lands.
 *
 * Every edit goes through the same draft as the logos and numbers (`itemDrafts.ts`): the 3D View
 * shows it at once, it is saved as a new version of the uniform, and a burst of edits is one undo
 * step. Every control is a visible button, field or toggle, so touch reaches all of it.
 *
 * A preview, like the uniform import: only where `uniformArtworkAvailable()`, and only for a
 * uniform imported into the show.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import {
    ArrowDownIcon,
    ArrowUpIcon,
    CaretDownIcon,
    CaretRightIcon,
    TrashIcon,
} from "@phosphor-icons/react";
import { Button, Input } from "@openmarch/ui";
import { touchSafeAccept } from "@/utilities/fileAccept";
import { uniformPackQueryOptions } from "@/hooks/queries/useUniformPack";
import {
    flatsArtworkOf,
    isUniformPackValue,
} from "@/view3d/core/marchers/uniformArtwork";
import {
    UNIFORM_PACK_MAX_LAYERS,
    UNIFORM_PACK_MAX_MODES,
    modeOf,
    type UniformPackMode,
} from "@/view3d/core/uniformPack/format";
import {
    MODE_PALETTE_ROLES,
    MODE_PART_OPTIONS,
    addMode,
    addModeRefusal,
    contentsOf,
    moveMode,
    newLayerId,
    removeMode,
    removeUnusedLayers,
    renameMode,
    setModeColor,
    setModeItem,
    setModeLayer,
    setModeParts,
    type PackContents,
    type PartOption,
    unusedLayers,
} from "@/view3d/core/uniformPack/modeEdits";
import { uniformArtworkAvailable } from "@/view3d/window/uniformArtworkPreview";
import { loadFlatsGeometry } from "@/view3d/window/performers/marchers/flatsAtlas";
import {
    contentsFor,
    editPack,
    editUnsettled,
    observeWorn,
    useItemDrafts,
    type PackEditOptions,
} from "@/view3d/window/uniformPack/itemDrafts";
import {
    UniformImportError,
    importLayerFile,
    type ImportedPage,
} from "@/view3d/window/uniformPack/importUniform";
import { ColorField, Segmented, SegmentedMany } from "./Panel";
import { useVenueRequest } from "./VenueControls";

const ACCEPT = "image/png,image/svg+xml,.png,.svg";

export function UniformModesControls() {
    const { t } = useTranslate();
    const { settings, request } = useVenueRequest();
    const draft = useItemDrafts((s) => s.draft);
    const saving = useItemDrafts((s) => s.saving);
    const [adding, setAdding] = useState(false);
    const [open, setOpen] = useState<string | null>(null);
    const [problem, setProblem] = useState<string | null>(null);

    const worn = flatsArtworkOf(settings?.uniformArtwork);
    const wornPack = worn && isUniformPackValue(worn) ? worn : null;
    const { data: pack } = useQuery(uniformPackQueryOptions(wornPack));
    useEffect(() => observeWorn(wornPack), [wornPack, draft]);

    if (!uniformArtworkAvailable() || !wornPack || !pack) return null;
    const stored = contentsOf(pack.manifest);
    const contents = contentsFor(draft, wornPack, stored);
    const { modes } = contents;
    const unused = unusedLayers(contents);
    const wearing = modeOf(contents, settings?.uniformMode);
    const edit = (
        change: (c: PackContents) => PackContents,
        options?: PackEditOptions,
    ) => editPack(wornPack, stored, change, options);
    // a venue change sends the whole venue: while an edit is unsaved, it would put back the
    // uniform version it was made from, so the picker waits for the save
    const unsaved = editUnsettled(draft, saving);
    const pickReason = unsaved ? t("view3d.uniformModes.waitForSave") : null;
    const addReason = addModeRefusal(contents, { withLayer: false })
        ? t("view3d.uniformModes.full", { count: UNIFORM_PACK_MAX_MODES })
        : null;

    return (
        <div className="flex flex-col gap-8" data-testid="view3d-uniform-modes">
            <span className="text-body">{t("view3d.uniformModes.title")}</span>
            {modes.length >= 2 && (
                <div className="flex flex-col gap-4">
                    <span className="text-sub text-text/70">
                        {t("view3d.uniformModes.wears")}
                    </span>
                    <div
                        title={pickReason ?? undefined}
                        aria-disabled={unsaved || undefined}
                        className={
                            unsaved ? "cursor-not-allowed opacity-50" : ""
                        }
                    >
                        <Segmented
                            value={wearing?.id ?? null}
                            options={modes.map((mode) => ({
                                value: mode.id,
                                label: mode.name,
                            }))}
                            onChange={(uniformMode) => {
                                if (pickReason) setProblem(pickReason);
                                else
                                    request({
                                        kind: "uniformMode",
                                        uniformMode,
                                    });
                            }}
                            label={t("view3d.uniformModes.wears")}
                            testId="view3d-uniform-mode-picker"
                            className="flex-wrap"
                        />
                    </div>
                    {pickReason && (
                        <span className="text-sub text-text/60" role="status">
                            {pickReason}
                        </span>
                    )}
                    <span className="text-sub text-text/60">
                        {t("view3d.uniformModes.cueLater")}
                    </span>
                </div>
            )}
            {modes.length === 0 && !adding && (
                <p className="text-sub text-text/60">
                    {t("view3d.uniformModes.hint")}
                </p>
            )}
            {adding ? (
                <AddModeForm
                    contents={contents}
                    takenFiles={Object.keys(draft?.layerImages ?? {})}
                    onCancel={() => setAdding(false)}
                    onAdd={(name, page, layerFile) => {
                        let added = "";
                        edit(
                            (c) => {
                                const result = addMode(c, {
                                    name,
                                    defaultName: t(
                                        "view3d.uniformModes.defaultName",
                                    ),
                                    layer:
                                        page && layerFile
                                            ? {
                                                  ...layerFile,
                                                  name: page.name,
                                                  covers: "page",
                                              }
                                            : undefined,
                                });
                                added = result.id;
                                return result.contents;
                            },
                            {
                                layerImages:
                                    page && layerFile
                                        ? { [layerFile.file]: page.png }
                                        : {},
                                now: true,
                            },
                        );
                        setAdding(false);
                        setOpen(added || null);
                    }}
                />
            ) : (
                <div className="flex flex-wrap items-center gap-6">
                    <Button
                        variant="secondary"
                        size="compact"
                        aria-disabled={!!addReason || undefined}
                        tooltipText={addReason ?? undefined}
                        className={
                            addReason
                                ? "cursor-not-allowed opacity-50"
                                : undefined
                        }
                        data-testid="view3d-uniform-mode-add"
                        onClick={() => {
                            setProblem(addReason);
                            if (!addReason) setAdding(true);
                        }}
                    >
                        {t("view3d.uniformModes.add")}
                    </Button>
                </div>
            )}
            {modes.length > 0 && (
                <ul className="flex flex-col gap-8">
                    {modes.map((mode, i) => (
                        <ModeRow
                            key={mode.id}
                            mode={mode}
                            index={i}
                            count={modes.length}
                            contents={contents}
                            open={open === mode.id}
                            onToggle={() =>
                                setOpen(open === mode.id ? null : mode.id)
                            }
                            edit={edit}
                        />
                    ))}
                </ul>
            )}
            {unused.length > 0 && (
                <div
                    className="flex flex-wrap items-center gap-6"
                    data-testid="view3d-uniform-modes-unused"
                >
                    <span className="text-sub text-text/60">
                        {t("view3d.uniformModes.unusedImages", {
                            count: unused.length,
                        })}
                    </span>
                    <Button
                        variant="ghost"
                        size="compact"
                        data-testid="view3d-uniform-modes-remove-unused"
                        onClick={() =>
                            edit((c) => removeUnusedLayers(c), { now: true })
                        }
                    >
                        {t("view3d.uniformModes.removeUnused")}
                    </Button>
                </div>
            )}
            {problem && (
                <p className="text-sub text-red" role="alert">
                    {problem}
                </p>
            )}
        </div>
    );
}

/** Naming a new mode, and picking its overlay if it has one */
function AddModeForm({
    contents,
    takenFiles,
    onAdd,
    onCancel,
}: {
    contents: PackContents;
    takenFiles: string[];
    onAdd: (
        name: string,
        page: ImportedPage | null,
        layer: { id: string; file: string } | null,
    ) => void;
    onCancel: () => void;
}) {
    const { t } = useTranslate();
    const input = useRef<HTMLInputElement>(null);
    const [name, setName] = useState(() =>
        t("view3d.uniformModes.newName", {
            number: Math.max(contents.modes.length, 1) + 1,
        }),
    );
    const [page, setPage] = useState<ImportedPage | null>(null);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const layersFull =
        addModeRefusal(contents, { withLayer: true }) === "layersFull";
    const nameReason = name.trim() ? null : t("view3d.uniformModes.needsName");

    const onPick = async (file: File | undefined) => {
        if (!file) return;
        setBusy(true);
        setProblem(null);
        try {
            const { regions } = await loadFlatsGeometry();
            setPage(await importLayerFile(file, regions));
        } catch (error) {
            console.warn("3D View: couldn't read the overlay", error);
            const code =
                error instanceof UniformImportError ? error.code : "unreadable";
            setProblem(t(`view3d.uniformImport.refused.${code}`));
        } finally {
            setBusy(false);
        }
    };

    const submit = () => {
        if (nameReason) {
            setProblem(nameReason);
            return;
        }
        const layer = page
            ? newLayerId(contents.layers, page.name, takenFiles)
            : null;
        onAdd(name.trim(), page, layer);
    };

    return (
        <div
            className="rounded-6 border-stroke bg-fg-2 flex flex-col gap-8 border p-8"
            data-testid="view3d-uniform-mode-form"
        >
            <label className="flex flex-col gap-4">
                <span className="text-sub text-text/70">
                    {t("view3d.uniformModes.name")}
                </span>
                <Input
                    compact
                    value={name}
                    maxLength={120}
                    autoFocus
                    data-testid="view3d-uniform-mode-name"
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") submit();
                        else if (event.key === "Escape") onCancel();
                    }}
                />
            </label>
            <div className="flex flex-col gap-4">
                <span className="text-sub text-text/70">
                    {t("view3d.uniformModes.overlay")}
                </span>
                <div className="flex flex-wrap items-center gap-6">
                    <Button
                        variant="secondary"
                        size="compact"
                        disabled={busy}
                        aria-disabled={layersFull || undefined}
                        tooltipText={
                            layersFull
                                ? t("view3d.uniformModes.layersFull", {
                                      count: UNIFORM_PACK_MAX_LAYERS,
                                  })
                                : undefined
                        }
                        className={
                            layersFull
                                ? "cursor-not-allowed opacity-50"
                                : undefined
                        }
                        data-testid="view3d-uniform-mode-overlay"
                        onClick={() => {
                            if (layersFull)
                                setProblem(
                                    t("view3d.uniformModes.layersFull", {
                                        count: UNIFORM_PACK_MAX_LAYERS,
                                    }),
                                );
                            else input.current?.click();
                        }}
                    >
                        {busy
                            ? t("view3d.uniformModes.reading")
                            : page
                              ? t("view3d.uniformModes.overlayChange")
                              : t("view3d.uniformModes.overlayPick")}
                    </Button>
                    {page && (
                        <>
                            <span
                                className="text-sub min-w-0 truncate"
                                data-testid="view3d-uniform-mode-overlay-name"
                            >
                                {page.name}
                            </span>
                            <Button
                                variant="ghost"
                                size="compact"
                                onClick={() => setPage(null)}
                            >
                                {t("view3d.uniformModes.overlayClear")}
                            </Button>
                        </>
                    )}
                    <input
                        ref={input}
                        type="file"
                        accept={touchSafeAccept(ACCEPT)}
                        className="hidden"
                        aria-hidden
                        data-testid="view3d-uniform-mode-overlay-file"
                        onChange={(e) => {
                            void onPick(e.target.files?.[0]);
                            e.target.value = "";
                        }}
                    />
                </div>
                <span className="text-sub text-text/60">
                    {page
                        ? page.notes.includes("scaled")
                            ? t("view3d.uniformModes.overlayScaled")
                            : t("view3d.uniformModes.overlayHint")
                        : t("view3d.uniformModes.noOverlayHint")}
                </span>
            </div>
            <div className="flex flex-wrap items-center gap-6">
                <Button
                    variant="primary"
                    size="compact"
                    disabled={busy}
                    aria-disabled={!!nameReason || undefined}
                    tooltipText={nameReason ?? undefined}
                    className={
                        nameReason ? "cursor-not-allowed opacity-50" : undefined
                    }
                    data-testid="view3d-uniform-mode-create"
                    onClick={submit}
                >
                    {t("view3d.uniformModes.create")}
                </Button>
                <Button variant="ghost" size="compact" onClick={onCancel}>
                    {t("view3d.uniformModes.cancel")}
                </Button>
            </div>
            {problem && (
                <p className="text-sub text-red" role="alert">
                    {problem}
                </p>
            )}
        </div>
    );
}

/** One mode: its name, place and removal, and when open its layers, items, colors and parts */
function ModeRow({
    mode,
    index,
    count,
    contents,
    open,
    onToggle,
    edit,
}: {
    mode: UniformPackMode;
    index: number;
    count: number;
    contents: PackContents;
    open: boolean;
    onToggle: () => void;
    edit: (
        change: (c: PackContents) => PackContents,
        options?: PackEditOptions,
    ) => void;
}) {
    const { t } = useTranslate();
    const { palette, options } = contents;
    const [name, setName] = useState(mode.name);
    const [layerRefused, setLayerRefused] = useState(false);
    useEffect(() => setName(mode.name), [mode.name]);
    const first = index === 0;
    const last = index === count - 1;
    const upReason = first ? t("view3d.uniformModes.alreadyFirst") : null;
    const downReason = last ? t("view3d.uniformModes.alreadyLast") : null;
    const needsLayer = t("view3d.uniformModes.needsLayer");
    const commitName = () => {
        const trimmed = name.trim();
        if (trimmed && trimmed !== mode.name)
            edit((c) => renameMode(c, mode.id, trimmed));
        else setName(mode.name);
    };
    const parts = MODE_PART_OPTIONS.filter(
        (part) => mode.options?.[part] ?? options[part],
    );
    const recolored = !!mode.palette && Object.keys(mode.palette).length > 0;

    return (
        <li
            className="rounded-6 border-stroke bg-fg-2 flex flex-col gap-8 border p-8"
            data-testid="view3d-uniform-mode"
            data-mode={mode.id}
        >
            <div className="flex items-center gap-4">
                <Button
                    variant="ghost"
                    size="compact"
                    content="icon"
                    aria-expanded={open}
                    aria-label={
                        open
                            ? t("view3d.uniformModes.collapse")
                            : t("view3d.uniformModes.expand")
                    }
                    tooltipText={
                        open
                            ? t("view3d.uniformModes.collapse")
                            : t("view3d.uniformModes.expand")
                    }
                    className="size-28 shrink-0 p-0"
                    data-testid="view3d-uniform-mode-toggle"
                    onClick={onToggle}
                >
                    {open ? (
                        <CaretDownIcon size={16} />
                    ) : (
                        <CaretRightIcon size={16} />
                    )}
                </Button>
                <Input
                    compact
                    value={name}
                    maxLength={120}
                    aria-label={t("view3d.uniformModes.name")}
                    data-testid="view3d-uniform-mode-rename"
                    className="min-w-0 flex-1"
                    onChange={(event) => setName(event.target.value)}
                    onBlur={commitName}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        else if (event.key === "Escape") setName(mode.name);
                    }}
                />
                {first && (
                    <span
                        className="text-sub text-text/60 shrink-0"
                        title={t("view3d.uniformModes.defaultTip")}
                    >
                        {t("view3d.uniformModes.default")}
                    </span>
                )}
                <IconButton
                    label={t("view3d.uniformModes.moveUp")}
                    reason={upReason}
                    testId="view3d-uniform-mode-up"
                    onClick={() => edit((c) => moveMode(c, mode.id, -1))}
                >
                    <ArrowUpIcon size={16} />
                </IconButton>
                <IconButton
                    label={t("view3d.uniformModes.moveDown")}
                    reason={downReason}
                    testId="view3d-uniform-mode-down"
                    onClick={() => edit((c) => moveMode(c, mode.id, 1))}
                >
                    <ArrowDownIcon size={16} />
                </IconButton>
                <IconButton
                    label={t("view3d.uniformModes.remove")}
                    reason={null}
                    testId="view3d-uniform-mode-remove"
                    onClick={() =>
                        edit((c) => removeMode(c, mode.id), { now: true })
                    }
                >
                    <TrashIcon size={16} />
                </IconButton>
            </div>
            {open && (
                <>
                    <div className="flex flex-col gap-4">
                        <span className="text-sub text-text/70">
                            {t("view3d.uniformModes.layers")}
                        </span>
                        <SegmentedMany<string>
                            value={mode.layers}
                            options={contents.layers.map((layer) => ({
                                value: layer.id,
                                label: layer.name || layer.id,
                            }))}
                            onChange={(on) => {
                                setLayerRefused(false);
                                const now = new Set(on);
                                for (const layer of contents.layers) {
                                    const was = mode.layers.includes(layer.id);
                                    if (was !== now.has(layer.id))
                                        edit((c) =>
                                            setModeLayer(
                                                c,
                                                mode.id,
                                                layer.id,
                                                now.has(layer.id),
                                            ),
                                        );
                                }
                            }}
                            lastReason={needsLayer}
                            onRefused={() => setLayerRefused(true)}
                            label={t("view3d.uniformModes.layers")}
                            testId="view3d-uniform-mode-layers"
                        />
                        {layerRefused && (
                            <span
                                className="text-sub text-text/60"
                                role="status"
                            >
                                {needsLayer}
                            </span>
                        )}
                    </div>
                    {contents.items.length > 0 && (
                        <div className="flex flex-col gap-4">
                            <span className="text-sub text-text/70">
                                {t("view3d.uniformModes.items")}
                            </span>
                            <SegmentedMany<string>
                                value={mode.items}
                                options={contents.items.map((item) => ({
                                    value: item.id,
                                    label:
                                        item.name ||
                                        t("view3d.uniformItems.unnamed"),
                                }))}
                                onChange={(on) => {
                                    const now = new Set(on);
                                    for (const item of contents.items) {
                                        const was = mode.items.includes(
                                            item.id,
                                        );
                                        if (was !== now.has(item.id))
                                            edit((c) =>
                                                setModeItem(
                                                    c,
                                                    mode.id,
                                                    item.id,
                                                    now.has(item.id),
                                                ),
                                            );
                                    }
                                }}
                                label={t("view3d.uniformModes.items")}
                                testId="view3d-uniform-mode-items"
                            />
                        </div>
                    )}
                    <div className="flex flex-col gap-4">
                        <span className="text-sub text-text/70">
                            {t("view3d.uniformModes.colors")}
                        </span>
                        <div className="flex flex-wrap items-center gap-8">
                            {MODE_PALETTE_ROLES.map((role) => (
                                <ColorField
                                    key={role}
                                    label={t(
                                        `view3d.uniformModes.role.${role}`,
                                    )}
                                    value={
                                        mode.palette?.[role] ?? palette[role]
                                    }
                                    testId={`view3d-uniform-mode-color-${role}`}
                                    onCommit={(color) =>
                                        edit((c) =>
                                            setModeColor(
                                                c,
                                                mode.id,
                                                role,
                                                color,
                                            ),
                                        )
                                    }
                                />
                            ))}
                            {recolored && (
                                <Button
                                    variant="ghost"
                                    size="compact"
                                    data-testid="view3d-uniform-mode-colors-reset"
                                    onClick={() =>
                                        edit((c) => {
                                            let next = c;
                                            for (const role of MODE_PALETTE_ROLES)
                                                next = setModeColor(
                                                    next,
                                                    mode.id,
                                                    role,
                                                    null,
                                                );
                                            return next;
                                        })
                                    }
                                >
                                    {t("view3d.uniformModes.colorsReset")}
                                </Button>
                            )}
                        </div>
                    </div>
                    <div className="flex flex-col gap-4">
                        <span className="text-sub text-text/70">
                            {t("view3d.uniformModes.parts")}
                        </span>
                        <SegmentedMany<PartOption>
                            value={parts}
                            options={MODE_PART_OPTIONS.map((part) => ({
                                value: part,
                                label: t(`view3d.uniformModes.part.${part}`),
                            }))}
                            onChange={(on) =>
                                edit((c) => setModeParts(c, mode.id, on))
                            }
                            label={t("view3d.uniformModes.parts")}
                            testId="view3d-uniform-mode-parts"
                        />
                    </div>
                </>
            )}
        </li>
    );
}

/** A small icon button; with a `reason`, it's greyed out and says why */
function IconButton({
    label,
    reason,
    testId,
    onClick,
    children,
}: {
    label: string;
    reason: string | null;
    testId: string;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <Button
            variant="ghost"
            size="compact"
            content="icon"
            aria-label={label}
            aria-disabled={!!reason || undefined}
            tooltipText={reason ?? label}
            tooltipSide="left"
            className={
                reason
                    ? "size-28 shrink-0 cursor-not-allowed p-0 opacity-50"
                    : "size-28 shrink-0 p-0"
            }
            data-testid={testId}
            onClick={() => {
                if (!reason) onClick();
            }}
        >
            {children}
        </Button>
    );
}
