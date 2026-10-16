import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import * as RadixDialog from "@radix-ui/react-dialog";
import { Button, Dialog, DialogContent } from "@openmarch/ui";
import { T, useTolgee, useTranslate } from "@tolgee/react";
import NewShowProgressIndicator from "@/components/launchpage/newShow/components/NewShowProgressIndicator";
import { useEditorModeStore, type EditorMode } from "@/stores/EditorModeStore";
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
    open: boolean;
    /**
     * Called once the choices are saved. `willReload` is true when the window
     * reloads next (after an analytics answer, as the old opt-in modal did).
     */
    onFinish: (result: { willReload: boolean }) => void;
    /** Reloads the window; replaced in tests. */
    reload?: () => void;
}

const STEP_TITLE_KEYS: Record<WelcomeStepId, string> = {
    welcome: "welcomeFlow.welcome.title",
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
 * web). It can't be dismissed. Language and theme apply and save as they're
 * picked; finishing saves the mode.
 */
// eslint-disable-next-line max-lines-per-function
export default function WelcomeFlow({
    open,
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
        if (!open) return;
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
    }, [open]);

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
    const isFirst = stepIndex === 0;
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

    return (
        <Dialog open={open}>
            <DialogContent
                className="min-h-[31rem] w-[46rem] max-w-[calc(100vw-2rem)]"
                aria-label={t("welcomeFlow.dialogLabel")}
                aria-describedby={undefined}
                onEscapeKeyDown={(event) => event.preventDefault()}
                onPointerDownOutside={(event) => event.preventDefault()}
                onInteractOutside={(event) => event.preventDefault()}
                data-testid="welcome-flow"
            >
                {step === "welcome" ? (
                    // The greeting cycles through languages, so the title is
                    // for screen readers only.
                    <RadixDialog.Title className="sr-only">
                        <T keyName={STEP_TITLE_KEYS.welcome} />
                    </RadixDialog.Title>
                ) : (
                    <>
                        <NewShowProgressIndicator
                            currentStepIndex={setupIndex}
                            steps={steps.slice(1)}
                            completedSteps={completed}
                        />
                        <div className="flex flex-col items-center gap-4 pt-4">
                            <span className="text-sub text-text-subtitle tracking-wide uppercase">
                                {t("welcomeFlow.step", {
                                    current: setupIndex + 1,
                                    total: setupCount,
                                })}
                            </span>
                            <RadixDialog.Title className="text-h4 text-text text-center font-medium">
                                <T keyName={STEP_TITLE_KEYS[step]} />
                            </RadixDialog.Title>
                        </div>
                    </>
                )}

                <div
                    key={step}
                    // The welcome page's photo bleeds over the padding, so
                    // that page can't clip its overflow.
                    className={clsx(
                        "animate-fade-in min-h-0 flex-1",
                        step === "welcome" ? "" : "overflow-y-auto px-4",
                    )}
                >
                    {step === "welcome" && <WelcomeStep />}
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
                        <ModeStep value={chosenMode} onChange={setChosenMode} />
                    )}
                    {step === "analytics" && <AnalyticsStep />}
                </div>

                <div className="flex w-full justify-between gap-8 pt-8">
                    <div>
                        {!isFirst && (
                            <Button
                                variant="secondary"
                                onClick={() => setStepIndex(stepIndex - 1)}
                                data-testid="welcome-back"
                            >
                                <T keyName="welcomeFlow.back" />
                            </Button>
                        )}
                    </div>
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
                                        isFirst
                                            ? "welcomeFlow.getStarted"
                                            : isLast
                                              ? "welcomeFlow.finish"
                                              : "welcomeFlow.continue"
                                    }
                                />
                            </Button>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
