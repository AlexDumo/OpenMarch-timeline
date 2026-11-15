import {
    Select,
    SelectContent,
    SelectItem,
    SelectTriggerButton,
} from "@openmarch/ui";
import { WizardFormField } from "@/components/ui/FormField";
import { useTranslate } from "@tolgee/react";
import {
    ACTIVITY_LABELS,
    DEFAULT_ACTIVITY,
    activityLabelKey,
} from "@/global/classes/Activities";
import type { NewShowEnsembleData } from "../../newShowTypes";
import { useEffect, useRef, useState } from "react";
import PitPresetCards from "@/components/frontEnsemble/PitPresetCards";
import type { PitPresetSize } from "@/view3d/core/pit/presets";

interface EnsembleStepProps {
    ensemble: NewShowEnsembleData | null;
    onChange: (ensemble: NewShowEnsembleData) => void;
}

export default function EnsembleStep({
    ensemble,
    onChange,
}: EnsembleStepProps) {
    const { t } = useTranslate();
    const [activity, setActivity] = useState(
        ensemble?.activity ?? DEFAULT_ACTIVITY,
    );
    const [frontEnsemble, setFrontEnsemble] = useState<PitPresetSize | null>(
        ensemble?.frontEnsemble ?? null,
    );

    // The stored activity is its English label; show it in the app language, or as saved when unknown.
    const activityLabel = (value: string) => {
        const key = activityLabelKey(value);
        return key ? t(key) : value;
    };

    const hasSyncedInitial = useRef(ensemble !== null);
    useEffect(() => {
        if (hasSyncedInitial.current) return;
        hasSyncedInitial.current = true;
        onChange({ activity, frontEnsemble });
    }, [activity, frontEnsemble, onChange]);

    return (
        <div className="mx-auto flex w-full max-w-lg flex-col gap-16">
            <WizardFormField
                label={t("launchpage.newShow.steps.ensemble.typeLabel")}
            >
                <Select
                    value={activity}
                    onValueChange={(next) => {
                        setActivity(next);
                        onChange({ activity: next, frontEnsemble });
                    }}
                >
                    <SelectTriggerButton label={activityLabel(activity)} />
                    <SelectContent>
                        {ACTIVITY_LABELS.map((label) => (
                            <SelectItem key={label} value={label}>
                                {activityLabel(label)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </WizardFormField>
            <div className="flex flex-col gap-8">
                <span
                    id="new-show-front-ensemble-label"
                    className="text-body text-text font-medium"
                >
                    {t("launchpage.newShow.steps.ensemble.frontEnsembleLabel")}
                </span>
                <PitPresetCards
                    value={frontEnsemble}
                    onChange={(next) => {
                        setFrontEnsemble(next);
                        onChange({ activity, frontEnsemble: next });
                    }}
                    aria-labelledby="new-show-front-ensemble-label"
                />
                <p className="text-sub text-text-subtitle">
                    {t("launchpage.newShow.steps.ensemble.frontEnsembleHint")}
                </p>
            </div>
        </div>
    );
}
