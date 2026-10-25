import { Switch, ToggleGroup, ToggleGroupItem } from "@openmarch/ui";
import { T } from "@tolgee/react";
import { Fragment } from "react";
import {
    type TempoLabFlags,
    useUiSettingsStore,
} from "@/stores/UiSettingsStore";
import SettingRow from "@/settings/SettingRow";
import SettingsPanel from "@/settings/SettingsPanel";

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
    "reimportInPlace",
];

/** Two-way choices, with their options. Shown after the switch they refine. */
const CHOICES = {
    alignDragScope: ["page", "toSynced"],
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
        <SettingRow
            label={<T keyName={`settings.tempoLab.${flag}`} />}
            htmlFor={`tempo-lab-${flag}`}
            description={
                <T keyName={`settings.tempoLab.${flag}.description`} />
            }
        >
            {control}
        </SettingRow>
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
                    className="shrink-0"
                    type="single"
                    value={tempoLab[flag]}
                    onValueChange={(value: string) => {
                        const option = CHOICES[flag].find((o) => o === value);
                        if (option) setFlag(flag, option as never);
                    }}
                >
                    {CHOICES[flag].map((option) => (
                        <ToggleGroupItem
                            key={option}
                            value={option}
                            className="whitespace-nowrap"
                        >
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
        <SettingsPanel>
            {SWITCHES.map((flag) => (
                <Fragment key={flag}>
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
                    {flag === "alignView" && choiceRow("alignDragScope")}
                </Fragment>
            ))}
        </SettingsPanel>
    );
}
