/**
 * The person's Discord status while OpenMarch runs: "Playing OpenMarch — Writing drill", the
 * show's name if they allow it, and how long the show has been open. Settings > Privacy turns
 * it off (`DISCORD_PRESENCE_SETTING`) or adds the name (`DISCORD_PRESENCE_SHOW_NAME_SETTING`).
 *
 * Discord need not be running: OpenMarch tries again every so often, and sets the status as
 * soon as Discord answers. If Discord quits, it waits for it to come back.
 */
import { basename, extname } from "node:path";
import type { DiscordActivity, DiscordIpcConnection } from "./discordIpc";

/**
 * The OpenMarch application in the Discord developer portal. Its name is what Discord shows
 * after "Playing", and its Rich Presence art holds the `openmarch` image. Not a secret.
 */
export const DISCORD_CLIENT_ID = "";

/** The Rich Presence art key of the OpenMarch logo in the developer portal */
export const DISCORD_LOGO_ASSET = "openmarch";

const RETRY_MS = 30_000;

/** What OpenMarch is showing right now, from the main process's point of view */
export interface PresenceScreen {
    /** The open show's file, or "" on the launch page */
    showPath: string;
    /** The open show is a new show that hasn't been saved anywhere yet */
    isNewShowDraft: boolean;
}

export interface PresenceSettings {
    enabled: boolean;
    showName: boolean;
}

/** "Fall Show 2026" for `/…/Fall Show 2026.dots` */
export function showNameFromPath(showPath: string): string {
    const file = basename(showPath);
    return file.slice(0, file.length - extname(file).length) || file;
}

/**
 * The status for what's on screen. `startedAt` is when the show opened, for the elapsed time.
 * `t` is main's translator, so the status follows the app language.
 */
export function presenceActivity(
    screen: PresenceScreen,
    showName: boolean,
    startedAt: number,
    t: (key: string) => string,
): DiscordActivity {
    const activity: DiscordActivity = {
        type: 0,
        assets: {
            large_image: DISCORD_LOGO_ASSET,
            large_text: "OpenMarch", // i18n-ignore: product name
        },
        buttons: [
            {
                label: t("discord.presence.getOpenMarch"),
                url: "https://openmarch.com",
            },
        ],
    };
    if (!screen.showPath) {
        activity.details = t("discord.presence.launchPage");
        return activity;
    }
    activity.timestamps = { start: startedAt };
    if (screen.isNewShowDraft) {
        activity.details = t("discord.presence.newShow");
        return activity;
    }
    activity.details = t("discord.presence.writingDrill");
    if (showName) activity.state = showNameFromPath(screen.showPath);
    return activity;
}

export interface DiscordPresenceDeps {
    clientId: string;
    connect: () => Promise<DiscordIpcConnection>;
    getSettings: () => PresenceSettings;
    t: (key: string) => string;
    now?: () => number;
    retryMs?: number;
}

export interface DiscordPresence {
    /** Call when the screen changes: a show opened or closed */
    setScreen(screen: PresenceScreen): void;
    /** Call when a setting or the app language changes */
    refresh(): void;
    /** Disconnects for good (the app is quitting); Discord clears the status */
    stop(): void;
}

export function createDiscordPresence({
    clientId,
    connect,
    getSettings,
    t,
    now = Date.now,
    retryMs = RETRY_MS,
}: DiscordPresenceDeps): DiscordPresence {
    let screen: PresenceScreen = { showPath: "", isNewShowDraft: false };
    let startedAt = now();
    let connection: DiscordIpcConnection | null = null;
    let connecting = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const wanted = () => !stopped && !!clientId && getSettings().enabled;

    const send = () => {
        connection?.setActivity(
            presenceActivity(screen, getSettings().showName, startedAt, t),
        );
    };

    const scheduleRetry = () => {
        if (retryTimer || !wanted()) return;
        retryTimer = setTimeout(() => {
            retryTimer = null;
            update();
        }, retryMs);
        // Waiting for Discord never keeps the app from quitting
        retryTimer.unref?.();
    };

    const update = () => {
        if (!wanted()) {
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = null;
            const open = connection;
            connection = null;
            open?.close();
            return;
        }
        if (connection) {
            send();
            return;
        }
        if (connecting) return;
        connecting = true;
        connect().then(
            (opened) => {
                connecting = false;
                if (!wanted()) {
                    opened.close();
                    return;
                }
                connection = opened;
                opened.onClose(() => {
                    if (connection !== opened) return;
                    // Discord quit or restarted: wait for it to come back
                    connection = null;
                    scheduleRetry();
                });
                send();
            },
            () => {
                // Discord isn't running (or isn't installed)
                connecting = false;
                scheduleRetry();
            },
        );
    };

    return {
        setScreen(next) {
            if (next.showPath !== screen.showPath) startedAt = now();
            screen = next;
            update();
        },
        refresh: update,
        stop() {
            stopped = true;
            update();
        },
    };
}
