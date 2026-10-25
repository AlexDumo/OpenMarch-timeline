import tolgee from "@/global/singletons/Tolgee";

/**
 * The measure row's words (tempo E8), as Tolgee keys under `timeline.measureRow` with the English
 * text as the default, so a missing translation, or a story or test without the translations
 * loaded, still reads well (as `timelineErrorMessages` does).
 */
export const measureRowText = (
    key: string,
    defaultValue: string,
    params?: Record<string, string | number>,
): string => tolgee.t(`timeline.measureRow.${key}`, defaultValue, params);
