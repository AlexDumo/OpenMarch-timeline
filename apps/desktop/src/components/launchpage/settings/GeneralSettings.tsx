import { useTolgee, T } from "@tolgee/react";
import { useState, useEffect } from "react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTriggerButton,
    Switch,
} from "@openmarch/ui";
import { VIEW3D_AUTO_OPEN_SETTING } from "@/view3d/sync/protocol";
import SettingRow from "@/settings/SettingRow";
import SettingsPanel from "@/settings/SettingsPanel";
import EditorModeCards from "@/components/editorMode/EditorModeCards";
import { useEditorModeStore } from "@/stores/EditorModeStore";

const languages = [
    { code: "en", name: "English" },
    { code: "es", name: "Español" },
    { code: "fr", name: "Français" },
    { code: "pt-BR", name: "Português (Brasil)" },
    { code: "ja", name: "日本語" },
];

/** Basic or Expert (UI-19): full width, since the cards need room. */
function EditorModeSetting() {
    const mode = useEditorModeStore((state) => state.mode);
    const setMode = useEditorModeStore((state) => state.setMode);
    return (
        <div className="flex flex-col gap-8 py-12">
            <span id="editor-mode-label" className="text-body text-text">
                <T keyName="settings.general.editorMode" />
            </span>
            <EditorModeCards
                value={mode}
                onChange={setMode}
                size="compact"
                id="settings"
                aria-labelledby="editor-mode-label"
            />
            <p className="text-sub text-text-subtitle">
                <T keyName="settings.general.editorMode.note" />
            </p>
        </div>
    );
}

export default function GeneralSettings() {
    const tolgee = useTolgee();
    const [currentLanguage, setCurrentLanguage] = useState("en");
    const [automaticUpdatesEnabled, setAutomaticUpdatesEnabled] =
        useState(true);
    const [view3dAutoOpen, setView3dAutoOpen] = useState(false);

    useEffect(() => {
        // Load saved language from electron store
        const loadLanguage = async () => {
            const savedLanguage = await window.electron.getLanguage();
            if (savedLanguage) {
                setCurrentLanguage(savedLanguage);
                await tolgee.changeLanguage(savedLanguage);
            } else {
                const lang = tolgee.getLanguage();
                setCurrentLanguage(lang || "en");
            }
        };
        void loadLanguage();
    }, [tolgee]);

    useEffect(() => {
        let isMounted = true;
        const loadAutomaticUpdatesSetting = async () => {
            const savedValue = await window.electron.invoke(
                "settings:get",
                "automaticUpdates",
            );
            if (isMounted) setAutomaticUpdatesEnabled(savedValue !== false);
        };
        void loadAutomaticUpdatesSetting();
        void window.electron
            .invoke("settings:get", VIEW3D_AUTO_OPEN_SETTING)
            .then((savedValue: unknown) => {
                if (isMounted) setView3dAutoOpen(savedValue === true);
            });
        return () => {
            isMounted = false;
        };
    }, []);

    const handleLanguageChange = async (languageCode: string) => {
        try {
            await tolgee.changeLanguage(languageCode);
            setCurrentLanguage(languageCode);
            // Save to electron store
            await window.electron.setLanguage(languageCode);
        } catch (error) {
            console.error("Failed to change language:", error);
        }
    };

    const currentLanguageName =
        languages.find((lang) => lang.code === currentLanguage)?.name ||
        "English";

    return (
        <SettingsPanel>
            <EditorModeSetting />

            <SettingRow
                label={<T keyName="settings.general.language" />}
                htmlFor="language"
            >
                <Select
                    value={currentLanguage}
                    onValueChange={handleLanguageChange}
                >
                    <SelectTriggerButton
                        id="language"
                        label={currentLanguageName}
                        className="min-w-[120px]"
                    />
                    <SelectContent>
                        {languages.map((language) => (
                            <SelectItem
                                key={language.code}
                                value={language.code}
                            >
                                {language.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </SettingRow>

            <SettingRow
                label={<T keyName="settings.general.automaticUpdates" />}
                htmlFor="automatic-updates"
            >
                <Switch
                    id="automatic-updates"
                    checked={automaticUpdatesEnabled}
                    onCheckedChange={(checked) => {
                        setAutomaticUpdatesEnabled(checked);
                        window.electron.send("settings:set", {
                            automaticUpdates: checked,
                        });
                    }}
                />
            </SettingRow>

            <SettingRow
                label={<T keyName="settings.general.openView3dWithShow" />}
                htmlFor="view3d-auto-open"
            >
                <Switch
                    id="view3d-auto-open"
                    checked={view3dAutoOpen}
                    data-testid="settings-view3d-auto-open"
                    onCheckedChange={(checked) => {
                        setView3dAutoOpen(checked);
                        window.electron.send("settings:set", {
                            [VIEW3D_AUTO_OPEN_SETTING]: checked,
                        });
                    }}
                />
            </SettingRow>
        </SettingsPanel>
    );
}
