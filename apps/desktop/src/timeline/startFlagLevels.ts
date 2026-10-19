/**
 * Start flag positions (fork #331): dots where marchers are at the start flag, and the routes
 * they walk from there to the playhead. Dots and paths each have a level; paths are never shown
 * wider than dots.
 */

/** Who a part of start flag positions is drawn for: nobody, the selected marchers, or everyone. */
export type StartFlagLevel = "off" | "selected" | "all";

/** What start flag positions draw: the dots, and the paths (never wider than the dots). */
export interface StartFlagLevels {
    readonly dots: StartFlagLevel;
    readonly paths: StartFlagLevel;
}

/** The two saved states: what the field normally shows, and what it shows while N is held. */
export interface StartFlagPositionsSettings {
    readonly always: StartFlagLevels;
    readonly hold: StartFlagLevels;
}

/** Levels from narrowest to widest. */
export const START_FLAG_LEVEL_ORDER: readonly StartFlagLevel[] = [
    "off",
    "selected",
    "all",
];
