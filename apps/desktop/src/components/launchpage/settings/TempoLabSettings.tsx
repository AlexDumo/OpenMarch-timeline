import { Switch, ToggleGroup, ToggleGroupItem } from "@openmarch/ui";
import { T } from "@tolgee/react";
import {
    type TempoLabFlags,
    useUiSettingsStore,
} from "@/stores/UiSettingsStore";

type BooleanFlag = {
    [K in keyof TempoLabFlags]: TempoLabFlags[K] extends boolean ? K : never;
}[keyof TempoLabFlags];

/** On/off flags, in the order the experiment plan introduces them. */
const SWITCHES: readonly BooleanFlag[] = [
    "tapTheBeat",
    "alignView",
    "punchInTap",
    "tempoMap",
    "snapToAttacks",
    "drillChoices",
];

/** Two-way choices, with their options. Shown after the switch they refine. */
const CHOICES = {
    tapApply: ["stop", "drafts"],
    tapUnit: ["page", "count"],
} as const satisfies {
    [K in keyof TempoLabFlags]?: readonly TempoLabFlags[K][];
};

function FlagRow({
    flag,
    control,
}: {
    flag: keyof TempoLabFlags;
    control: React.ReactNode;
}) {
    return (
        <div className="flex items-center justify-between gap-16 px-8">
            <div className="flex flex-col gap-2">
                <label
                    htmlFor={`tempo-lab-${flag}`}
                    className="text-body text-text"
                >
                    <T keyName={`settings.tempoLab.${flag}`} />
                </label>
                <p className="text-sub text-text-subtitle">
                    <T keyName={`settings.tempoLab.${flag}.description`} />
                </p>
            </div>
            {control}
        </div>
    );
}

/**
 * Tempo lab (experimental): one control per flag in `uiSettings.tempoLab`, each with a line saying
 * what it turns on. All are off by default.
 */
export default function TempoLabSettings() {
    const tempoLab = useUiSettingsStore((s) => s.uiSettings.tempoLab);
    const setFlag = useUiSettingsStore((s) => s.setTempoLabFlag);

    const choiceRow = (flag: keyof typeof CHOICES) => (
        <FlagRow
            key={flag}
            flag={flag}
            control={
                <ToggleGroup
                    id={`tempo-lab-${flag}`}
                    type="single"
                    value={tempoLab[flag]}
                    onValueChange={(value: string) => {
                        const option = CHOICES[flag].find((o) => o === value);
                        if (option) setFlag(flag, option as never);
                    }}
                >
                    {CHOICES[flag].map((option) => (
                        <ToggleGroupItem key={option} value={option}>
                            <T
                                keyName={`settings.tempoLab.${flag}.${option}`}
                            />
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
            }
        />
    );

    return (
        <div
            className="bg-fg-1 border-stroke rounded-6 flex flex-col gap-12 border p-12"
            data-testid="tempo-lab-settings"
        >
            <p className="text-sub text-text-subtitle px-8">
                <T keyName="settings.tempoLab.description" />
            </p>
            {SWITCHES.map((flag) => (
                <div key={flag} className="contents">
                    <FlagRow
                        flag={flag}
                        control={
                            <Switch
                                id={`tempo-lab-${flag}`}
                                checked={tempoLab[flag]}
                                onCheckedChange={(checked) =>
                                    setFlag(flag, checked)
                                }
                            />
                        }
                    />
                    {flag === "punchInTap" &&
                        (Object.keys(CHOICES) as (keyof typeof CHOICES)[]).map(
                            choiceRow,
                        )}
                </div>
            ))}
        </div>
    );
}
