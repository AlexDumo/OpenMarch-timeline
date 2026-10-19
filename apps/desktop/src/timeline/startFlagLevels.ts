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

const rank = (level: StartFlagLevel): number =>
    START_FLAG_LEVEL_ORDER.indexOf(level);

const narrower = (a: StartFlagLevel, b: StartFlagLevel): StartFlagLevel =>
    rank(a) <= rank(b) ? a : b;

/** The levels with paths no wider than dots. */
export function clampStartFlagLevels(levels: StartFlagLevels): StartFlagLevels {
    const paths = narrower(levels.paths, levels.dots);
    return paths === levels.paths ? levels : { dots: levels.dots, paths };
}

/** Sets the dots level; dots below the paths level lower paths with them. */
export function setStartFlagDots(
    levels: StartFlagLevels,
    dots: StartFlagLevel,
): StartFlagLevels {
    return { dots, paths: narrower(levels.paths, dots) };
}

/** Sets the paths level; paths above the dots level raise dots with them. */
export function setStartFlagPaths(
    levels: StartFlagLevels,
    paths: StartFlagLevel,
): StartFlagLevels {
    return {
        dots: rank(paths) > rank(levels.dots) ? paths : levels.dots,
        paths,
    };
}

/** Whether these levels draw anything: they do unless dots (and so paths) are off. */
export const startFlagLevelsDrawAnything = (levels: StartFlagLevels): boolean =>
    clampStartFlagLevels(levels).dots !== "off";

/** What a new user gets: a gentle hint for the selection, and everything while N is held. */
export const DEFAULT_START_FLAG_POSITIONS: StartFlagPositionsSettings = {
    always: { dots: "selected", paths: "off" },
    hold: { dots: "all", paths: "all" },
};

const isStartFlagLevel = (value: unknown): value is StartFlagLevel =>
    START_FLAG_LEVEL_ORDER.includes(value as StartFlagLevel);

function parseLevels(raw: unknown, fallback: StartFlagLevels): StartFlagLevels {
    const saved = (raw ?? {}) as Partial<
        Record<keyof StartFlagLevels, unknown>
    >;
    return clampStartFlagLevels({
        dots: isStartFlagLevel(saved.dots) ? saved.dots : fallback.dots,
        paths: isStartFlagLevel(saved.paths) ? saved.paths : fallback.paths,
    });
}

/**
 * Reads saved start flag positions settings: unreadable or missing levels take the defaults,
 * and paths wider than dots are narrowed to the dots level.
 */
export function parseStartFlagPositions(
    raw: unknown,
): StartFlagPositionsSettings {
    const saved = (raw ?? {}) as Partial<
        Record<keyof StartFlagPositionsSettings, unknown>
    >;
    return {
        always: parseLevels(saved.always, DEFAULT_START_FLAG_POSITIONS.always),
        hold: parseLevels(saved.hold, DEFAULT_START_FLAG_POSITIONS.hold),
    };
}

/** Both states with paths no wider than dots; already-valid settings come back unchanged. */
export function clampStartFlagPositions(
    settings: StartFlagPositionsSettings,
): StartFlagPositionsSettings {
    const always = clampStartFlagLevels(settings.always);
    const hold = clampStartFlagLevels(settings.hold);
    return always === settings.always && hold === settings.hold
        ? settings
        : { always, hold };
}
