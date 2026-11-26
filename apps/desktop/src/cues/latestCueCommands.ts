/**
 * The cue commands as the editor's handlers last saw them (`useCueActionHandlers`), for the field
 * menu's entries that aren't actions of their own: the show's flags (fork #985), which change with
 * the show. Read when the menu draws; the menu draws again whenever a handler changes.
 */
import type { CueCommands } from "./useCueCommands";

let latest: CueCommands | null = null;

export function publishCueCommands(commands: CueCommands | null) {
    latest = commands;
}

/** The cue commands, or null before the editor's handlers have mounted */
export const latestCueCommands = (): CueCommands | null => latest;
