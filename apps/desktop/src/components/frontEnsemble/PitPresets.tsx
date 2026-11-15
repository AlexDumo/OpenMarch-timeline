import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { T, useTranslate } from "@tolgee/react";
import { Button, Checkbox, SegmentedTextSwitch } from "@openmarch/ui";
import { useTimingObjects } from "@/hooks";
import { fieldPropertiesQueryOptions } from "@/hooks/queries";
import {
    allItemsQueryOptions,
    applyPitPresetMutationOptions,
} from "@/hooks/queries/useItems";
import { pitVariant } from "@/view3d/core/pit/catalog";
import {
    PIT_PRESET_SIZES,
    pitPreset,
    pitPresetOnCanvas,
    type PitPresetSize,
} from "@/view3d/core/pit/presets";

const HEADING_CLASS =
    "text-sub text-text-subtitle font-medium tracking-wide uppercase";

/**
 * The Front ensemble's Small, Medium and Large presets (instruments.md section 6): pick a size
 * and apply it, in front of the front sideline at the 50, as one undo step. It replaces the
 * equipment the previous preset added, and with "Also add performers" adds a player for each
 * instrument and a drum major on the podium, skipping performers the show already has.
 */
export default function PitPresets() {
    const { t } = useTranslate();
    const queryClient = useQueryClient();
    const [size, setSize] = useState<PitPresetSize>("medium");
    const [addPerformers, setAddPerformers] = useState(true);
    const { data: field } = useQuery(fieldPropertiesQueryOptions());
    const { data: items } = useQuery(allItemsQueryOptions());
    const { beats } = useTimingObjects()!;
    const apply = useMutation(applyPitPresetMutationOptions(queryClient));
    const hasPreset = items?.some((item) => item.from_preset) ?? false;
    const firstBeat = beats[0];

    const onApply = () => {
        if (!field || !firstBeat) return;
        const placed = pitPresetOnCanvas(pitPreset(size), field);
        apply.mutate({
            // On field from the show's first count, so the pit is there all show
            beatId: firstBeat.id,
            equipment: placed.equipment.map((e) => ({
                variant: pitVariant(e.variantId)!,
                baseName: t(`pit.family.${e.familyId}`),
                home: e.home,
                rotation: e.rotation,
            })),
            performers: addPerformers
                ? placed.performers.map(({ section, home }) => ({
                      section,
                      home,
                  }))
                : [],
            performerReach: placed.reach,
        });
    };

    return (
        <div
            className="border-stroke bg-fg-2 rounded-6 flex flex-col gap-8 border p-8"
            role="group"
            aria-label={t("frontEnsemble.presets.title")}
        >
            <div className={HEADING_CLASS} aria-hidden>
                <T keyName="frontEnsemble.presets.title" />
            </div>
            <SegmentedTextSwitch
                ariaLabel={t("frontEnsemble.presets.size")}
                className="self-start"
                options={PIT_PRESET_SIZES.map((value) => ({
                    value,
                    label: t(`frontEnsemble.presets.${value}`),
                    testId: `pit-preset-${value}`,
                }))}
                selected={size}
                setSelected={(value) => setSize(value as PitPresetSize)}
            />
            <p className="text-sub text-text-subtitle">
                {t(`frontEnsemble.presets.summary.${size}`)}{" "}
                <T keyName="frontEnsemble.presets.always" />
            </p>
            <label className="text-body flex items-center gap-8">
                <Checkbox
                    checked={addPerformers}
                    onCheckedChange={(checked) =>
                        setAddPerformers(checked === true)
                    }
                />
                <T keyName="frontEnsemble.presets.addPerformers" />
            </label>
            {hasPreset && (
                <p className="text-sub text-text-subtitle">
                    <T keyName="frontEnsemble.presets.replaces" />
                </p>
            )}
            <Button
                size="compact"
                className="self-end"
                disabled={!field || !firstBeat || apply.isPending}
                onClick={onApply}
            >
                <T keyName="frontEnsemble.presets.apply" />
            </Button>
        </div>
    );
}
