/**
 * Venue picker and lighting presets for the settings panel (ui.md UI-2), and
 * the hook every venue control uses. Every change goes to the editor through
 * `window.view3d.requestVenueChange` with the full, validated settings; the
 * editor saves it with undo, and the relayed invalidation updates the scene.
 */
import { useCallback, useState } from "react";
import { useTranslate } from "@tolgee/react";
import { useQuery } from "@tanstack/react-query";
import { fieldFootprint } from "@openmarch/core";
import { fieldPropertiesQueryOptions } from "@/hooks/queries/useFieldProperties";
import { FT } from "@/view3d/core/environment/units";
import { useVenueSettings } from "@/hooks/queries/useVenueSettings";
import type { LightingPreset, VenueKitId } from "@/view3d/core/types";
import {
    KIT_FIXED_FLOOR,
    KIT_FIXED_FLOOR_FALLBACK,
    KIT_LIGHTING,
    REAL_VENUES,
    VENUE_KIT_IDS,
    fieldLinesFor,
    kitFitsField,
    lightingForKit,
    venueKind,
    type FieldLines,
    type VenueKind,
    type VenueSettings,
} from "@/view3d/core/venueSettings";
import {
    GUARD_UNIFORM_PRESET_IDS,
    UNIFORM_PRESET_IDS,
    guardUniformPresetOf,
    uniformPresetOf,
    type GuardUniformPresetId,
    type UniformPresetId,
} from "@/view3d/core/marchers/uniformPresets";
import {
    FINISHES,
    TUBA_MODELS,
    type Finish,
    type TubaModelId,
} from "@/view3d/core/instruments/catalog";
import { brassFinishOf, tubaModelOf } from "@/view3d/core/venueSettings";
import {
    flatsArtworkOf,
    isUniformPackValue,
    type UniformPackValue,
} from "@/view3d/core/marchers/uniformArtwork";
import {
    uniformPackIsNewer,
    uniformPackQueryOptions,
    uniformEntryOf,
    uniformPacksQueryOptions,
} from "@/hooks/queries/useUniformPack";
import { wornPackProblem } from "@/view3d/core/uniformPack/wornPack";
import {
    useCustomUniforms,
    useCustomUniformsStore,
} from "@/view3d/window/uniformArtworkPreview";
import { Button } from "@openmarch/ui";
import { Segmented } from "./Panel";
import { venuePickBase } from "@/view3d/sync/venuePick";
import {
    applyVenueChange,
    venueChanged,
    type VenueChange,
} from "./venueChange";

/**
 * The show's venue settings and a function that asks the editor to change
 * them. `request` does nothing until the settings have loaded, or when the
 * change wouldn't change anything.
 */
export function useVenueRequest(): {
    settings: VenueSettings | undefined;
    request: (change: VenueChange) => void;
} {
    const { data: settings } = useVenueSettings();
    const request = useCallback(
        (change: VenueChange) => {
            if (!settings) return;
            try {
                const next = applyVenueChange(settings, change);
                if (venueChanged(settings, next)) {
                    // the uniform it was made against: the editor keeps a newer one
                    window.view3d.requestVenueChange(
                        next,
                        venuePickBase(settings),
                    );
                }
            } catch (error) {
                console.error("3D View: invalid venue change", error);
            }
        },
        [settings],
    );
    return { settings, request };
}

/** Meters to whole feet, for floor sizes. */
const feet = (meters: number) => Math.round(meters / FT);

/**
 * The venue kits, two to a row, in two groups: the venues sized to the
 * show's field, then the real venues (`REAL_VENUES`), each with its size as
 * a tooltip. A venue whose fixed floor the show's field doesn't fit is
 * dimmed; clicking it says why, under the picker. While the show's own
 * venue is one of those, a note says which venue shows instead.
 */
export function VenuePicker() {
    const { t } = useTranslate();
    const { settings, request } = useVenueRequest();
    const { data: field } = useQuery(fieldPropertiesQueryOptions());
    // The venue last refused; its reason is worked out afresh, so it goes when the field fits.
    const [refused, setRefused] = useState<VenueKitId | null>(null);
    const footprint = field ? fieldFootprint(field) : undefined;

    const fieldWidth = footprint ? feet(footprint.maxX - footprint.minX) : 0;
    const fieldDepth = footprint ? feet(footprint.maxZ - footprint.minZ) : 0;
    const floorOf = (kit: VenueKitId) => {
        const floor = KIT_FIXED_FLOOR[kit];
        return floor
            ? { width: feet(floor.width), depth: feet(floor.depth) }
            : undefined;
    };
    const reasonFor = (kit: VenueKitId): string | undefined => {
        if (!footprint || kitFitsField(kit, footprint)) return undefined;
        return t("view3d.venueFit.tooBig", {
            venue: t(`view3d.kit.${kit}`),
            ...floorOf(kit),
            fieldWidth,
            fieldDepth,
        });
    };
    const chosen = settings?.kit;
    const fallback =
        chosen && footprint && !kitFitsField(chosen, footprint)
            ? t("view3d.venueFit.fallback", {
                  venue: t(`view3d.kit.${chosen}`),
                  ...floorOf(chosen),
                  fallback: t(`view3d.kit.${KIT_FIXED_FLOOR_FALLBACK}`),
              })
            : null;
    const note = (refused && reasonFor(refused)) || fallback;
    const sizeOf = (kit: VenueKitId): string | undefined => {
        const real = REAL_VENUES[kit];
        if (!real) return undefined;
        return t(`view3d.venueKind.${real.surface}`, {
            venue: t(`view3d.kit.${kit}`),
            width: feet(real.width),
            depth: feet(real.depth),
        });
    };
    const group = (kind: VenueKind) => {
        const kits = VENUE_KIT_IDS.filter((kit) => venueKind(kit) === kind);
        return (
            <div
                className="flex flex-col gap-4"
                data-testid={`view3d-venue-group-${kind}`}
            >
                <p className="text-sub text-text/60">
                    {t(`view3d.venueKind.${kind}`)}
                </p>
                {kind === "real" && (
                    <p className="text-sub text-text/40">
                        {t("view3d.venueKind.realHint")}
                    </p>
                )}
                <Segmented
                    value={chosen && kits.includes(chosen) ? chosen : null}
                    options={kits.map((kit) => ({
                        value: kit,
                        label: t(`view3d.kit.${kit}`),
                        title: sizeOf(kit),
                        unavailable: reasonFor(kit),
                    }))}
                    onChange={(kit: VenueKitId) => {
                        setRefused(null);
                        request({ kind: "kit", kit });
                    }}
                    onUnavailable={(kit) => setRefused(kit)}
                    label={t(`view3d.venueKind.${kind}`)}
                    className="grid! grid-cols-2 [&>*]:justify-start"
                />
            </div>
        );
    };

    return (
        <div className="flex flex-col gap-6">
            <div
                className="flex flex-col gap-12"
                data-testid="view3d-venue-picker"
            >
                {group("fitted")}
                {group("real")}
            </div>
            {note && (
                <p
                    className="text-sub text-text/60"
                    role="status"
                    data-testid="view3d-venue-fit-note"
                >
                    {note}
                </p>
            )}
        </div>
    );
}

/** The current kit's lighting presets. */
export function LightingControl() {
    const { t } = useTranslate();
    const { settings, request } = useVenueRequest();
    if (!settings) return null;

    const presets = KIT_LIGHTING[settings.kit].presets;
    const active = lightingForKit(settings.kit, settings.lighting);
    return (
        <Segmented
            value={active}
            options={presets.map((preset) => ({
                value: preset,
                label: t(`view3d.lighting.${preset}`),
            }))}
            onChange={(lighting: LightingPreset) =>
                request({ kind: "lighting", lighting })
            }
            label={t("view3d.overlay.lighting")}
            testId="view3d-lighting-picker"
        />
    );
}

/**
 * Whose lines a venue with its own field paints: the show's field, or the
 * stadium's own, as they are on its turf. Marchers stay where they are.
 */
export function FieldLinesControl() {
    const { t } = useTranslate();
    const { settings, request } = useVenueRequest();
    if (!settings) return null;
    const lines = fieldLinesFor(settings.kit, settings.fieldLines);
    return (
        <div className="flex flex-col gap-6">
            <Segmented
                value={lines}
                options={(["show", "stadium"] as const).map((value) => ({
                    value,
                    label: t(`view3d.settings.fieldLinesOption.${value}`),
                }))}
                onChange={(fieldLines: FieldLines) =>
                    request({ kind: "fieldLines", fieldLines })
                }
                label={t("view3d.settings.fieldLines")}
                testId="view3d-field-lines-picker"
            />
            <p className="text-sub text-text/60">
                {lines === "stadium"
                    ? t("view3d.settings.fieldLinesStadiumNote")
                    : t("view3d.settings.fieldLinesShowNote")}
            </p>
        </div>
    );
}

/** The picker's value for the sample flats uniform (part of the custom-uniform preview). */
const FLATS_SAMPLE = "flats:sample" as const;

/**
 * The band's uniform: every built-in preset, two to a row, then (with Custom uniforms (preview)
 * on) the sample uniform drawn as flats and each uniform imported into the show (fork #1257), by
 * its name.
 *
 * With the setting off, a show whose band already wears a custom uniform (one from a colleague,
 * say) keeps wearing it: show data never changes on its own. The picker lists that one uniform,
 * picked, says the show uses a preview uniform and offers to turn the preview on. Picking a
 * preset still works, and nothing is removed from the show.
 *
 * When the band's uniform is gone from the show, doesn't read, or was made by a newer OpenMarch,
 * the band wears its preset and a note here says why, with the setting on or off. When it
 * couldn't be loaded just now (reading it, or listing the show's uniforms, failed after its
 * retries), the note says so, apart from a damaged file, with Try again.
 */
export function UniformPicker() {
    const { t } = useTranslate();
    const { settings, request } = useVenueRequest();
    const flats = useCustomUniforms();
    const turnOn = useCustomUniformsStore((s) => s.setEnabled);
    const named = settings ? flatsArtworkOf(settings.uniformArtwork) : null;
    const namedPack = named && isUniformPackValue(named) ? named : null;
    const packsQuery = useQuery({
        ...uniformPacksQueryOptions(),
        enabled: flats || namedPack !== null,
    });
    const packs = packsQuery.data;
    const packQuery = useQuery(uniformPackQueryOptions(namedPack));
    const { data: pack, isSuccess: packRead } = packQuery;
    // a read that failed after its retries with nothing read: not a damaged file (Try again)
    const packsFailed = packsQuery.isError && packs === undefined;
    const packFailed = packQuery.isError && pack === undefined;
    // the note Try again was pressed on, kept while it runs: a query with nothing read goes
    // back to pending when it fetches again, which would otherwise hide the note and its button
    const [retrying, setRetrying] = useState<"load" | "list" | null>(null);
    // the uniform whose version the band wears (editing items adds versions, fork #1258)
    const wornEntry = namedPack ? uniformEntryOf(packs, namedPack) : undefined;
    // a uniform the show no longer has (an undo after Remove unused…), or one whose file
    // doesn't read (or was made by a newer OpenMarch): the band wears its preset, so the preset
    // is the one picked, and a note under the picker says why, with the setting on or off
    const problem = wornPackProblem(
        namedPack,
        packs ? wornEntry !== undefined : undefined,
        packRead ? pack : undefined,
        uniformPackIsNewer(namedPack),
        packFailed,
    );
    const worn = problem ? null : named;
    // the list of the show's uniforms failed, though the band's uniform (if any) reads: a
    // note of its own, with the setting on (the list is the picker's choices) or while the band
    // wears a custom uniform
    const listFailed = packsFailed && !problem && (flats || namedPack !== null);
    const failedNote =
        retrying ??
        (problem === "loadFailed" ? "load" : listFailed ? "list" : null);
    const tryAgain = () => {
        if (retrying || !failedNote) return;
        setRetrying(failedNote);
        void Promise.allSettled([
            packsFailed ? packsQuery.refetch() : null,
            packFailed ? packQuery.refetch() : null,
        ]).finally(() => setRetrying(null));
    };
    type Value = UniformPresetId | typeof FLATS_SAMPLE | UniformPackValue;
    const sampleOption = {
        value: FLATS_SAMPLE as Value,
        label: t("view3d.uniformPreset.flatsSample"),
    };
    // each uniform once: the version the band wears, else its newest. Without the list (it
    // failed), the uniform the band wears, as read, so it still shows picked
    const packOptions = packs
        ? packs.map((entry) => ({
              value: (entry === wornEntry && namedPack
                  ? namedPack
                  : entry.value) as Value,
              label: entry.name,
          }))
        : worn && isUniformPackValue(worn) && pack
          ? [{ value: worn as Value, label: pack.name }]
          : [];
    // with the preview off, only the custom uniform the band wears
    const wornOptions = !worn
        ? []
        : isUniformPackValue(worn)
          ? packOptions.filter((option) => option.value === worn)
          : [sampleOption];
    const previewWorn = !flats && wornOptions.length > 0;
    return (
        <>
            <Segmented<Value>
                value={
                    settings
                        ? worn
                            ? isUniformPackValue(worn)
                                ? worn
                                : FLATS_SAMPLE
                            : uniformPresetOf(settings.uniforms)
                        : null
                }
                options={[
                    ...UNIFORM_PRESET_IDS.map((preset) => ({
                        value: preset as Value,
                        label: t(`view3d.uniformPreset.${preset}`),
                    })),
                    ...(flats ? [sampleOption, ...packOptions] : wornOptions),
                ]}
                onChange={(next) =>
                    next === FLATS_SAMPLE
                        ? request({
                              kind: "uniformArtwork",
                              uniformArtwork: "sample",
                          })
                        : next.startsWith("library:")
                          ? request({
                                kind: "uniformArtwork",
                                uniformArtwork: next as UniformPackValue,
                            })
                          : request({
                                kind: "uniforms",
                                uniforms: next as UniformPresetId,
                            })
                }
                label={t("view3d.settings.uniforms")}
                testId="view3d-uniform-picker"
                className="grid! grid-cols-2 [&>*]:justify-start"
            />
            {failedNote && (
                <div
                    className="flex flex-col items-start gap-6"
                    role="status"
                    data-testid={
                        failedNote === "list"
                            ? "view3d-uniform-list-failed"
                            : "view3d-uniform-loadFailed"
                    }
                >
                    <p className="text-sub text-yellow">
                        {failedNote === "list"
                            ? t("view3d.uniformImport.listFailed")
                            : t("view3d.uniformImport.loadFailed")}
                    </p>
                    <Button
                        variant="secondary"
                        size="compact"
                        onClick={tryAgain}
                        disabled={retrying !== null}
                        data-testid="view3d-uniform-try-again"
                    >
                        {retrying
                            ? t("view3d.uniformImport.loading")
                            : t("view3d.uniformImport.tryAgain")}
                    </Button>
                </div>
            )}
            {problem && problem !== "loadFailed" && (
                <p
                    className="text-sub text-yellow"
                    role="status"
                    data-testid={`view3d-uniform-${problem}`}
                >
                    {problem === "newer"
                        ? t("view3d.uniformImport.newer")
                        : flats
                          ? t(`view3d.uniformImport.${problem}`)
                          : t(`view3d.uniformPreview.${problem}Off`)}
                </p>
            )}
            {(previewWorn ||
                (!flats &&
                    problem &&
                    problem !== "newer" &&
                    problem !== "loadFailed")) && (
                <div
                    className="flex flex-wrap items-center gap-6"
                    role="status"
                    data-testid="view3d-uniform-preview-worn"
                >
                    {previewWorn && (
                        <span className="text-sub text-text/60">
                            {t("view3d.uniformPreview.showUses")}
                        </span>
                    )}
                    <Button
                        variant="secondary"
                        size="compact"
                        onClick={() => turnOn(true)}
                        data-testid="view3d-uniform-preview-turn-on"
                    >
                        {t("view3d.uniformPreview.turnOn")}
                    </Button>
                </div>
            )}
        </>
    );
}

/** The guard's uniform: the presets with a guard look, two to a row. */
export function GuardUniformPicker() {
    const { t } = useTranslate();
    const { settings, request } = useVenueRequest();
    return (
        <Segmented
            value={
                settings ? guardUniformPresetOf(settings.guardUniforms) : null
            }
            options={GUARD_UNIFORM_PRESET_IDS.map((preset) => ({
                value: preset,
                label: t(`view3d.uniformPreset.${preset}`),
            }))}
            onChange={(guardUniforms: GuardUniformPresetId) =>
                request({ kind: "guardUniforms", guardUniforms })
            }
            label={t("view3d.settings.guardUniforms")}
            testId="view3d-guard-uniform-picker"
            className="grid! grid-cols-2 [&>*]:justify-start"
        />
    );
}

/** The brass line's finish: gold lacquer or silver plate. */
export function BrassFinishPicker() {
    const { t } = useTranslate();
    const { settings, request } = useVenueRequest();
    return (
        <Segmented
            value={settings ? brassFinishOf(settings.brassFinish) : null}
            options={FINISHES.map((finish) => ({
                value: finish,
                label: t(`view3d.brassFinish.${finish}`),
            }))}
            onChange={(brassFinish: Finish) =>
                request({ kind: "brassFinish", brassFinish })
            }
            label={t("view3d.settings.brassFinish")}
            testId="view3d-brass-finish-picker"
        />
    );
}

/** What the Tuba section carries: marching tubas or sousaphones. */
export function TubaPicker() {
    const { t } = useTranslate();
    const { settings, request } = useVenueRequest();
    return (
        <Segmented
            value={settings ? tubaModelOf(settings.tuba) : null}
            options={TUBA_MODELS.map((tuba) => ({
                value: tuba,
                label: t(`view3d.tuba.${tuba}`),
            }))}
            onChange={(tuba: TubaModelId) => request({ kind: "tuba", tuba })}
            label={t("view3d.settings.tuba")}
            testId="view3d-tuba-picker"
        />
    );
}
