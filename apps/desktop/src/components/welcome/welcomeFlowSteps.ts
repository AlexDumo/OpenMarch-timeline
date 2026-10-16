import type { EditorMode } from "@/stores/EditorModeStore";

/** The welcome flow's steps (UI-19), in order. */
export type WelcomeStepId =
    | "welcome"
    | "language"
    | "theme"
    | "mode"
    | "analytics";

/**
 * The steps to show. The analytics question is asked only when it hasn't been
 * answered (`optOutAnalytics` unset) and never in the web build, which has no
 * analytics.
 */
export function getWelcomeSteps({
    analyticsChoiceMade,
    isWeb,
}: {
    analyticsChoiceMade: boolean;
    isWeb: boolean;
}): readonly WelcomeStepId[] {
    const steps: WelcomeStepId[] = ["welcome", "language", "theme", "mode"];
    if (!analyticsChoiceMade && !isWeb) steps.push("analytics");
    return steps;
}

/** Whether Continue is enabled on a step: the mode step needs a choice. */
export function canContinueFrom(
    step: WelcomeStepId,
    chosenMode: EditorMode | null,
): boolean {
    if (step === "mode") return chosenMode !== null;
    return true;
}

/** Whether the flow should open: the stored mode was read and there is none. */
export function shouldShowWelcomeFlow(state: {
    loaded: boolean;
    mode: EditorMode | null;
}): boolean {
    return state.loaded && state.mode === null;
}

/** Whether the stored `optOutAnalytics` value means the person has answered. */
export function isAnalyticsChoiceMade(optOutAnalytics: unknown): boolean {
    return optOutAnalytics !== undefined && optOutAnalytics !== null;
}
