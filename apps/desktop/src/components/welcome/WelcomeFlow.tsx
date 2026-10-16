import { useEffect, useMemo, useState } from "react";
import { Button } from "@openmarch/ui";
import { T, useTolgee, useTranslate } from "@tolgee/react";
import NewShowProgressIndicator from "@/components/launchpage/newShow/components/NewShowProgressIndicator";
import { useEditorModeStore, type EditorMode } from "@/stores/EditorModeStore";
import OpenMarchLogo from "@/components/OpenMarchLogo";
import { saveAnalyticsChoice } from "@/utilities/analyticsConsent";
import { matchAppLanguage } from "@/utilities/languages";
import { isWebBuild } from "@/utilities/webBuild";
import { useTheme } from "@/context/ThemeContext";
import {
    canContinueFrom,
    getWelcomeSteps,
    isAnalyticsChoiceMade,
    type WelcomeStepId,
} from "./welcomeFlowSteps";
import WelcomeStep from "./steps/WelcomeStep";
import LanguageStep from "./steps/LanguageStep";
import ThemeStep from "./steps/ThemeStep";
import ModeStep from "./steps/ModeStep";
import AnalyticsStep from "./steps/AnalyticsStep";

export interface WelcomeFlowProps {
    /**
     * Called once the choices are saved. `willReload` is true when the window
     * reloads next (after an analytics answer, as the old opt-in modal did).
     */
    onFinish: (result: { willReload: boolean }) => void;
    /** Reloads the window; replaced in tests. */
    reload?: () => void;
}

const STEP_TITLE_KEYS: Record<Exclude<WelcomeStepId, "welcome">, string> = {
    language: "welcomeFlow.language.title",
    theme: "welcomeFlow.theme.title",
    mode: "welcomeFlow.mode.title",
    analytics: "analyticsOptIn.title",
};

/**
 * The language to start the language step on: the app's, unless that is the
 * default English and the system prefers another language the app has.
 */
function initialLanguage(current: string | undefined): string {
    if (current && current !== "en") return current;
    return matchAppLanguage(navigator.languages ?? []) ?? current ?? "en";
}

/**
 * First launch (UI-19): a welcome page, then language, light or dark, Basic or
 * Expert, and the analytics opt-in when it hasn't been answered (never on the
 * web). It fills the launch page until it's finished, then the launch page
 * shows. Language and theme apply and save as they're picked; finishing saves
 * the mode.
 */
// eslint-disable-next-line max-lines-per-function
export default function WelcomeFlow({
    onFinish,
    reload = () => window.location.reload(),
}: WelcomeFlowProps) {
    const { t } = useTranslate();
    const tolgee = useTolgee();
    const { theme, setTheme } = useTheme();
    const [language, setLanguage] = useState(() =>
        initialLanguage(tolgee.getLanguage()),
    );
    const setMode = useEditorModeStore((state) => state.setMode);
    const [analyticsChoiceMade, setAnalyticsChoiceMade] = useState<
        boolean | null
    >(null);
    const [stepIndex, setStepIndex] = useState(0);
    const [chosenMode, setChosenMode] = useState<EditorMode | null>(null);

    useEffect(() => {
        let active = true;
        void Promise.resolve(
            window.electron.invoke("settings:get", "optOutAnalytics"),
        )
            .catch(() => undefined)
            .then((value: unknown) => {
                if (active)
                    setAnalyticsChoiceMade(isAnalyticsChoiceMade(value));
            });
        return () => {
            active = false;
        };
    }, []);

    // Until the analytics setting is read, assume the question is asked; the
    // first step is the same either way.
    const steps = useMemo(
        () =>
            getWelcomeSteps({
                analyticsChoiceMade: analyticsChoiceMade ?? false,
                isWeb: isWebBuild,
            }),
        [analyticsChoiceMade],
    );
    const step = steps[Math.min(stepIndex, steps.length - 1)];
    const isLast = stepIndex >= steps.length - 1;
    // The welcome page isn't counted: the bar and "Step 1 of 4" are the setup.
    const setupIndex = stepIndex - 1;
    const setupCount = steps.length - 1;
    const completed = useMemo(
        () => new Set(Array.from({ length: setupIndex }, (_, i) => i)),
        [setupIndex],
    );

    const chooseLanguage = (code: string) => {
        setLanguage(code);
        void tolgee.changeLanguage(code);
        void window.electron.setLanguage(code);
    };

    const finish = (analyticsOptOut?: boolean) => {
        if (!chosenMode) return;
        setMode(chosenMode);
        const willReload = analyticsOptOut !== undefined;
        if (willReload) saveAnalyticsChoice(analyticsOptOut);
        onFinish({ willReload });
        if (willReload) reload();
    };

    const next = () => {
        if (!canContinueFrom(step, chosenMode)) return;
        // A language picked for them from the system is saved on Continue.
        if (step === "language" && language !== tolgee.getLanguage())
            chooseLanguage(language);
        // The mode step finishes when the analytics step is skipped. Wait for
        // the analytics setting so the question isn't skipped by mistake.
        if (isLast) {
            if (analyticsChoiceMade !== null) finish();
            return;
        }
        setStepIndex(stepIndex + 1);
    };

    if (step === "welcome")
        return (
            <WelcomeStep
                onStart={next}
                aria-label={t("welcomeFlow.dialogLabel")}
            />
        );

    return (
        <main
            className="flex min-h-0 flex-1 p-8"
            aria-label={t("welcomeFlow.dialogLabel")}
            data-testid="welcome-flow"
        >
            <div className="bg-fg-1 border-stroke rounded-6 flex min-h-0 flex-1 flex-col overflow-y-auto border px-24 py-32">
                <div className="m-auto flex w-full max-w-[46rem] flex-col gap-24">
                    <div className="flex items-center gap-24">
                        <OpenMarchLogo
                            height={28}
                            className="text-text shrink-0"
                        />
                        <NewShowProgressIndicator
                            currentStepIndex={setupIndex}
                            steps={steps.slice(1)}
                            completedSteps={completed}
                        />
                    </div>
                    <div className="flex flex-col items-center gap-4">
                        <span className="text-sub text-text-subtitle tracking-wide uppercase">
                            {t("welcomeFlow.step", {
                                current: setupIndex + 1,
                                total: setupCount,
                            })}
                        </span>
                        <h1 className="text-h3 text-text text-center font-medium">
                            <T keyName={STEP_TITLE_KEYS[step]} />
                        </h1>
                    </div>

                    <div key={step} className="animate-fade-in">
                        {step === "language" && (
                            <LanguageStep
                                value={language}
                                onChange={chooseLanguage}
                            />
                        )}
                        {step === "theme" && (
                            <ThemeStep value={theme} onChange={setTheme} />
                        )}
                        {step === "mode" && (
                            <ModeStep
                                value={chosenMode}
                                onChange={setChosenMode}
                            />
                        )}
                        {step === "analytics" && <AnalyticsStep />}
                    </div>

                    <div className="flex w-full justify-between gap-8 pt-8">
                        <Button
                            variant="secondary"
                            onClick={() => setStepIndex(stepIndex - 1)}
                            data-testid="welcome-back"
                        >
                            <T keyName="welcomeFlow.back" />
                        </Button>
                        <div className="flex gap-8">
                            {step === "analytics" ? (
                                <>
                                    <Button
                                        variant="secondary"
                                        onClick={() => finish(true)}
                                        data-testid="welcome-analytics-opt-out"
                                    >
                                        <T keyName="analyticsOptIn.optOut" />
                                    </Button>
                                    <Button
                                        onClick={() => finish(false)}
                                        data-testid="welcome-analytics-opt-in"
                                    >
                                        <T keyName="analyticsOptIn.optIn" />
                                    </Button>
                                </>
                            ) : (
                                <Button
                                    onClick={next}
                                    disabled={
                                        !canContinueFrom(step, chosenMode) ||
                                        (isLast && analyticsChoiceMade === null)
                                    }
                                    data-testid="welcome-continue"
                                >
                                    <T
                                        keyName={
                                            isLast
                                                ? "welcomeFlow.finish"
                                                : "welcomeFlow.continue"
                                        }
                                    />
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </main>
    );
}
