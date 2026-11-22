/**
 * Settings for the Discord status (Discord Rich Presence), shared by Settings > Privacy and the
 * main process, which talks to the Discord app. Desktop only: a browser page can't reach it.
 */

/** Show "Using OpenMarch" in the person's Discord status. On unless they turn it off. */
export const DISCORD_PRESENCE_SETTING = "discordPresence";

/** Also show the open show's name there. Off unless they turn it on: show names can be private. */
export const DISCORD_PRESENCE_SHOW_NAME_SETTING = "discordPresenceShowName";

/** Never answered reads as on, so only an explicit `false` turns the status off. */
export const discordPresenceEnabled = (saved: unknown): boolean =>
    saved !== false;

/** Never answered reads as off, so only an explicit `true` shares the show's name. */
export const discordPresenceShowsName = (saved: unknown): boolean =>
    saved === true;
