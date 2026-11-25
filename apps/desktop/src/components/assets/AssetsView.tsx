import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    CaretRightIcon,
    PackageIcon,
    WarningIcon,
} from "@phosphor-icons/react";
import { T, useTranslate } from "@tolgee/react";
import clsx from "clsx";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogTitle,
    Button,
} from "@openmarch/ui";
import ItemPanelHeader from "@/components/items/ItemPanelHeader";
import { PropListContents } from "@/components/items/PropsModal";
import { useSidebarModalStore } from "@/stores/SidebarModalStore";
import { useItemDrawingStore } from "@/stores/ItemDrawingStore";
import { ModelThumbnail } from "@/components/items/modelImport/ImportedModels";
import { CreditFields } from "@/components/items/modelImport/ModelImportReview";
import { allItemsQueryOptions } from "@/hooks/queries/useItems";
import { allCuesQueryOptions } from "@/hooks/queries/useCues";
import { storedVenueSettingsQueryOptions } from "@/hooks/queries/useVenueSettings";
import {
    removeUnusedShowAssetsMutationOptions,
    setShowAssetCreditsMutationOptions,
    showAssetsQueryOptions,
    showAssetSizesQueryOptions,
    uniformsInHistoryKeys,
    uniformsInHistoryQueryOptions,
} from "@/hooks/queries/useShowAssets";
import {
    removableCount,
    removableLines,
    groupAssetVersions,
    type AssetGroup,
    LARGE_SHOW_ASSET_BYTES,
    keptForHistory,
    showAssetUse,
    sizeParts,
    type AssetUse,
} from "@/showAssets/assetUse";
import { withoutEmpty } from "@/showAssets/modelImport/review/modelImportSession";
import type { ModelCredits } from "@/showAssets/modelImport/types";
import type { JsonObject } from "@/showAssets/hash";
import { UNIFORM_ASSET_KIND } from "@/view3d/core/uniformPack/format";
import {
    wornPackProblem,
    type WornPackProblem,
} from "@/view3d/core/uniformPack/wornPack";
import {
    uniformPackIsNewer,
    uniformPackQueryOptions,
} from "@/hooks/queries/useUniformPack";
import { useCustomUniforms } from "@/view3d/window/uniformArtworkPreview";
import { parseShowAssetRef, showAssetRefValue } from "@/showAssets/ref";

/**
 * The show's own assets (fork #1001, owner 2026-11-17): every imported model with its picture,
 * size, how many things use it and its credits, and at the top the notes about them. Assets are
 * never removed on their own: Remove unused… lists what it would remove and asks first. A view of
 * the Props panel while models are the only assets; the notes move into the Issues panel once
 * there is one (#599), and the view can become its own tab when flags join it (#985).
 */
/** A size in words: "4.1 MB" */
export function useSizeText() {
    const { t } = useTranslate();
    return (bytes: number) => {
        const { value, unit } = sizeParts(bytes);
        return t(`assets.size.${unit}`, { value });
    };
}

/** The show's assets and who uses them, live */
function useAssetUse() {
    const { data: assets } = useQuery(showAssetsQueryOptions());
    const { data: sizes } = useQuery(showAssetSizesQueryOptions());
    const { data: items } = useQuery(allItemsQueryOptions());
    const { data: cues } = useQuery(allCuesQueryOptions());
    // the band's imported uniform is a use too (fork #1257)
    const { data: venue } = useQuery(storedVenueSettingsQueryOptions());
    const armed = useItemDrawingStore((state) =>
        state.placing?.kind === "model" ? state.placing.modelValue : null,
    );
    const uniforms = useMemo(
        () =>
            (assets ?? [])
                .filter((asset) => asset.kind === UNIFORM_ASSET_KIND)
                .map(showAssetRefValue),
        [assets],
    );
    // uniforms an undo or redo would bring back are never offered for removal; the list shows
    // while that's checked, and every uniform counts as kept until it's known
    const { data: inHistory, isError: historyFailed } = useQuery(
        uniformsInHistoryQueryOptions(uniforms),
    );
    const worn =
        typeof venue?.uniformArtwork === "string" &&
        venue.uniformArtwork.startsWith("library:")
            ? venue.uniformArtwork
            : null;
    // whether the band's uniform reads: when it doesn't, the band wears its preset
    const { data: wornPack } = useQuery(uniformPackQueryOptions(worn));
    return useMemo(() => {
        // `venue` is null with no venue row, undefined while it loads
        if (!assets || !sizes || !items || !cues || venue === undefined)
            return null;
        const use = showAssetUse(
            assets,
            sizes,
            [
                ...items.map((item) => item.model),
                ...cues.map((cue) => cue.value),
                armed,
                worn,
                // a version the band wears in place of a removed one the venue names (see
                // `resolveStoredUniformPack`) is in use too, so Remove unused… never offers it
                wornPack && wornPack.value !== worn ? wornPack.value : null,
            ],
            // a failed read keeps every uniform, even if an older read succeeded
            keptForHistory(uniforms, historyFailed ? undefined : inHistory),
        );
        const known = new Set(use.assets.map((row) => row.value));
        // Props naming a model the show doesn't have: an undo brought one back, say
        const missingProps = items.filter(
            (item) =>
                item.model?.startsWith("library:") && !known.has(item.model),
        ).length;
        // The band's uniform when the show doesn't have it (an undo after Remove unused…), or
        // has it but its file doesn't read, or was made by a newer OpenMarch
        // any version of it: a version an item edit just replaced still counts (fork #1258)
        const wornId = parseShowAssetRef(worn)?.id;
        const uniformProblem = wornPackProblem(
            worn,
            known.has(worn ?? "") ||
                use.assets.some(
                    (row) =>
                        row.asset.id === wornId &&
                        row.asset.kind === UNIFORM_ASSET_KIND,
                ),
            wornPack,
            uniformPackIsNewer(worn),
        );
        return {
            ...use,
            groups: groupAssetVersions(use.assets, sizes),
            missingProps,
            uniformProblem,
            historyFailed,
        };
    }, [
        assets,
        sizes,
        items,
        cues,
        armed,
        venue,
        worn,
        uniforms,
        inHistory,
        historyFailed,
        wornPack,
    ]);
}

export function AssetsContents({
    openRemove = false,
}: {
    /** Opens Remove unused… at once (the `removeUnusedAssets` action) */
    openRemove?: boolean;
}) {
    const use = useAssetUse();
    const [removing, setRemoving] = useState(openRemove);
    // Remove unused… reads again which uniforms undo or redo names: an edit elsewhere may have
    // cleared the redo steps since. Its list and size wait for that read.
    const queryClient = useQueryClient();
    const [checked, setChecked] = useState(false);
    useEffect(() => {
        setChecked(false);
        if (!removing) return;
        let live = true;
        void queryClient
            .refetchQueries({ queryKey: uniformsInHistoryKeys.all() })
            .finally(() => {
                if (live) setChecked(true);
            });
        return () => {
            live = false;
        };
    }, [removing, queryClient]);
    const { setContent } = useSidebarModalStore();
    return (
        <div className="animate-scale-in text-text flex h-full w-fit flex-col gap-16">
            <ItemPanelHeader
                title={<T keyName="assets.title" />}
                onBack={() => setContent(<PropListContents />, "props")}
            />
            <div
                className="flex w-[28rem] grow flex-col gap-16 overflow-y-auto"
                data-testid="assets-view"
            >
                {use && (
                    <AssetNotes
                        unused={use.unused}
                        all={use.assets}
                        unusedBytes={use.unusedBytes}
                        totalBytes={use.totalBytes}
                        missingProps={use.missingProps}
                        uniformProblem={use.uniformProblem}
                        historyFailed={use.historyFailed}
                        onRemove={() => setRemoving(true)}
                    />
                )}
                {use && use.assets.length === 0 && (
                    <p className="text-sub text-text-subtitle">
                        <T keyName="assets.empty" />
                    </p>
                )}
                <ul className="flex flex-col gap-8">
                    {use?.groups.map((group) => (
                        <AssetRow
                            key={group.row.asset.id}
                            row={group.row}
                            group={group}
                        />
                    ))}
                </ul>
            </div>
            {use && (
                <RemoveUnusedDialog
                    open={removing}
                    onOpenChange={setRemoving}
                    checking={!checked}
                    unused={use.unused}
                    all={use.assets}
                    unusedBytes={use.unusedBytes}
                />
            )}
        </div>
    );
}

/** The quiet notes at the top: unused assets, props whose model is gone, a large show */
function AssetNotes({
    unused,
    all,
    unusedBytes,
    totalBytes,
    missingProps,
    uniformProblem,
    historyFailed,
    onRemove,
}: {
    unused: readonly AssetUse[];
    /** Every asset version, to count unused ones as the Remove unused… list groups them */
    all: readonly AssetUse[];
    unusedBytes: number;
    totalBytes: number;
    missingProps: number;
    uniformProblem: WornPackProblem | null;
    historyFailed: boolean;
    onRemove: () => void;
}) {
    const tally = removableCount(removableLines(unused, all));
    const sizeText = useSizeText();
    const customUniforms = useCustomUniforms();
    const notes: React.ReactNode[] = [];
    if (unused.length > 0)
        notes.push(
            <li
                key="unused"
                className="flex items-center justify-between gap-12"
                data-testid="assets-unused-note"
            >
                <span>
                    <T
                        keyName={
                            tally.unit === "versions"
                                ? "assets.notes.unusedVersions"
                                : "assets.notes.unused"
                        }
                        params={{
                            count: tally.count,
                            size: sizeText(unusedBytes),
                        }}
                    />
                </span>
                <Button
                    size="compact"
                    variant="secondary"
                    onClick={onRemove}
                    data-testid="assets-remove-unused"
                >
                    <T keyName="assets.removeUnused.button" />
                </Button>
            </li>,
        );
    if (missingProps > 0)
        notes.push(
            <li key="missing" data-testid="assets-missing-note">
                <T
                    keyName="assets.notes.missing"
                    params={{ count: missingProps }}
                />
            </li>,
        );
    // with Custom uniforms (preview) off there's no Import button: the notes say how to get one
    if (uniformProblem === "missing")
        notes.push(
            <li key="missingUniform" data-testid="assets-missing-uniform-note">
                <T
                    keyName={
                        customUniforms
                            ? "assets.notes.missingUniform"
                            : "assets.notes.missingUniformPreviewOff"
                    }
                />
            </li>,
        );
    if (uniformProblem === "unreadable")
        notes.push(
            <li
                key="unreadableUniform"
                data-testid="assets-unreadable-uniform-note"
            >
                <T
                    keyName={
                        customUniforms
                            ? "assets.notes.unreadableUniform"
                            : "assets.notes.unreadableUniformPreviewOff"
                    }
                />
            </li>,
        );
    if (uniformProblem === "newer")
        notes.push(
            <li key="newerUniform" data-testid="assets-newer-uniform-note">
                <T keyName="assets.notes.newerUniform" />
            </li>,
        );
    if (historyFailed)
        notes.push(
            <li key="historyFailed" data-testid="assets-history-failed-note">
                <T keyName="assets.notes.historyFailed" />
            </li>,
        );
    if (totalBytes > LARGE_SHOW_ASSET_BYTES)
        notes.push(
            <li key="large" data-testid="assets-large-note">
                <T
                    keyName="assets.notes.large"
                    params={{ size: sizeText(totalBytes) }}
                />
            </li>,
        );
    if (notes.length === 0) return null;
    return (
        <ul className="bg-fg-2 border-stroke rounded-6 text-sub flex flex-col gap-8 border p-12">
            {notes}
        </ul>
    );
}

/** No license, or one marked unknown: whoever shares the show may not have the right to */
const licenseOf = (credits: JsonObject): string | null => {
    const license =
        typeof credits.license === "string" ? credits.license.trim() : "";
    return license === "" || /^(LicenseRef-)?unknown$/i.test(license)
        ? null
        : license;
};

/** One asset: its picture, name, kind, size and use, and its credits to read or edit */
function AssetRow({ row, group }: { row: AssetUse; group: AssetGroup }) {
    const { t } = useTranslate();
    const sizeText = useSizeText();
    const [open, setOpen] = useState(false);
    const panelId = useId();
    const { asset } = row;
    const license = licenseOf(asset.credits);
    return (
        <li
            className="border-stroke rounded-6 flex flex-col gap-12 border p-8"
            data-testid="asset-row"
        >
            <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpen(!open)}
                className="flex items-center gap-12 text-left"
            >
                <ModelThumbnail
                    hash={asset.parts.thumbnail}
                    className="h-48 w-64 shrink-0"
                />
                <span className="flex min-w-0 grow flex-col gap-2">
                    <span className="text-body truncate font-medium">
                        {asset.name}
                    </span>
                    <span className="text-sub text-text-subtitle">
                        {[
                            t(`assets.kind.${asset.kind}`, {
                                defaultValue: asset.kind,
                            }),
                            sizeText(row.bytes),
                            row.uses > 0
                                ? t("assets.uses", { count: row.uses })
                                : t("assets.unused"),
                        ].join(" · ")}
                    </span>
                    {group.others.length > 0 && (
                        <span
                            className="text-sub text-text-subtitle"
                            data-testid="asset-other-versions"
                        >
                            {t(
                                group.allOlder
                                    ? "assets.olderVersions"
                                    : "assets.otherVersions",
                                {
                                    count: group.others.length,
                                    size: sizeText(group.othersBytes),
                                },
                            )}
                        </span>
                    )}
                    <span className="text-sub text-text-subtitle flex items-center gap-4">
                        {license ? (
                            license === "LicenseRef-Proprietary" ? (
                                t("props.import.credits.proprietary")
                            ) : (
                                license
                            )
                        ) : (
                            <>
                                <WarningIcon
                                    size={14}
                                    className="text-yellow shrink-0"
                                    aria-hidden
                                />
                                <T keyName="assets.shareNote" />
                            </>
                        )}
                    </span>
                </span>
                <CaretRightIcon
                    size={14}
                    className={clsx(
                        "shrink-0 duration-150",
                        open && "rotate-90",
                    )}
                />
            </button>
            {open && (
                <div id={panelId}>
                    {asset.kind === UNIFORM_ASSET_KIND ? (
                        <FixedCredits credits={asset.credits} />
                    ) : (
                        <AssetCredits row={row} />
                    )}
                </div>
            )}
        </li>
    );
}

/** The credit fields a person edits, text only (a file may have put anything there) */
const textCredits = (credits: JsonObject): ModelCredits => {
    const out: ModelCredits = {};
    for (const key of [
        "license",
        "author",
        "sourceUrl",
        "attribution",
    ] as const)
        if (typeof credits[key] === "string") out[key] = credits[key];
    return out;
};

/**
 * An imported uniform's credits, read only: they live in its pack file too, and Save uniform
 * file writes the stored file as it is, so an edit here would leave the two disagreeing (fork
 * #1257). Editable once a uniform can be re-packed.
 */
function FixedCredits({ credits }: { credits: JsonObject }) {
    const { t } = useTranslate();
    const text = (key: string) =>
        typeof credits[key] === "string" && credits[key] !== ""
            ? (credits[key] as string)
            : null;
    const rows = [
        ["license", text("license")],
        ["author", text("author")],
        ["sourceUrl", text("source")],
    ] as const;
    return (
        <div className="flex flex-col gap-6" data-testid="asset-fixed-credits">
            <dl className="text-sub grid grid-cols-[auto_1fr] gap-x-12 gap-y-4">
                {rows.map(([key, value]) => (
                    <div key={key} className="contents">
                        <dt className="text-text-subtitle">
                            {t(`props.import.credits.${key}`)}
                        </dt>
                        <dd className="min-w-0 break-words">
                            {value ?? t("props.import.credits.unknown")}
                        </dd>
                    </div>
                ))}
            </dl>
            <p className="text-sub text-text-subtitle">
                {t("assets.uniformCreditsFixed")}
            </p>
        </div>
    );
}

/** Saves after typing pauses, so each keystroke isn't a write */
const SAVE_AFTER_MS = 600;

/** An asset's credits, editable; they're outside its Version, so it stays the same asset */
function AssetCredits({ row }: { row: AssetUse }) {
    const queryClient = useQueryClient();
    const { mutate } = useMutation(
        setShowAssetCreditsMutationOptions(queryClient),
    );
    const [draft, setDraft] = useState<ModelCredits>(() =>
        textCredits(row.asset.credits),
    );
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pending = useRef<ModelCredits | null>(null);
    const save = (credits: ModelCredits) =>
        mutate({
            ref: row.asset,
            credits: withoutEmpty(credits) as JsonObject,
        });
    // A pending edit is saved when the row closes or the panel goes
    useEffect(
        () => () => {
            if (timer.current) clearTimeout(timer.current);
            if (pending.current) save(pending.current);
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on the way out
        [],
    );
    return (
        <CreditFields
            credits={draft}
            testIdPrefix="asset"
            startOpen
            onChange={(credits) => {
                setDraft(credits);
                pending.current = credits;
                if (timer.current) clearTimeout(timer.current);
                timer.current = setTimeout(() => {
                    pending.current = null;
                    save(credits);
                }, SAVE_AFTER_MS);
            }}
        />
    );
}

/** Lists every asset Remove unused… would take out, and takes out only those */
function RemoveUnusedDialog({
    open,
    onOpenChange,
    checking,
    unused: given,
    all,
    unusedBytes,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Still reading what undo or redo names: lists nothing and offers nothing yet */
    checking: boolean;
    unused: readonly AssetUse[];
    /** Every asset version, to tell older versions of a kept asset from whole assets */
    all: readonly AssetUse[];
    unusedBytes: number;
}) {
    const { t } = useTranslate();
    const unused = checking ? [] : given;
    // one line per asset, and a count that matches the lines
    const lines = removableLines(unused, all);
    const tally = removableCount(lines);
    const queryClient = useQueryClient();
    const sizeText = useSizeText();
    const { mutate, isPending } = useMutation(
        removeUnusedShowAssetsMutationOptions(queryClient),
    );
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent data-testid="assets-remove-dialog">
                <AlertDialogTitle>
                    {checking ? (
                        <T keyName="assets.removeUnused.button" />
                    ) : (
                        <T
                            keyName={
                                tally.unit === "versions"
                                    ? "assets.removeUnused.titleVersions"
                                    : "assets.removeUnused.title"
                            }
                            params={{ count: tally.count }}
                        />
                    )}
                </AlertDialogTitle>
                <AlertDialogDescription>
                    {checking ? (
                        <T keyName="assets.removeUnused.checking" />
                    ) : unused.length > 0 ? (
                        <T
                            keyName="assets.removeUnused.description"
                            params={{ size: sizeText(unusedBytes) }}
                        />
                    ) : (
                        <T keyName="assets.removeUnused.none" />
                    )}
                </AlertDialogDescription>
                {unused.length > 0 && (
                    <ul
                        className="text-body flex max-h-[16rem] flex-col gap-4 overflow-y-auto"
                        data-testid="assets-remove-list"
                    >
                        {lines.map((line) => (
                            <li
                                key={line.id}
                                className="flex justify-between gap-12"
                            >
                                <span className="truncate">
                                    {line.olderOnly
                                        ? t(
                                              line.allOlder
                                                  ? "assets.removeUnused.olderVersions"
                                                  : "assets.removeUnused.otherVersions",
                                              {
                                                  count: line.count,
                                                  name: line.name,
                                              },
                                          )
                                        : line.count > 1
                                          ? t("assets.removeUnused.versions", {
                                                count: line.count,
                                                name: line.name,
                                            })
                                          : line.name}
                                </span>
                                <span className="text-text-subtitle shrink-0">
                                    {sizeText(line.bytes)}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
                <div className="flex w-full justify-end gap-8">
                    <AlertDialogCancel asChild>
                        <Button variant="secondary" disabled={isPending}>
                            <T keyName="assets.removeUnused.cancel" />
                        </Button>
                    </AlertDialogCancel>
                    {unused.length > 0 && (
                        <AlertDialogAction>
                            <Button
                                variant="red"
                                disabled={isPending}
                                data-testid="assets-remove-confirm"
                                onClick={() =>
                                    mutate(
                                        unused.map((row) => row.asset),
                                        {
                                            onSettled: () =>
                                                onOpenChange(false),
                                        },
                                    )
                                }
                            >
                                <T
                                    keyName={
                                        tally.unit === "versions"
                                            ? "assets.removeUnused.confirmVersions"
                                            : "assets.removeUnused.confirm"
                                    }
                                    params={{ count: tally.count }}
                                />
                            </Button>
                        </AlertDialogAction>
                    )}
                </div>
            </AlertDialogContent>
        </AlertDialog>
    );
}
