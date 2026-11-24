import type { PostHog } from "posthog-js";
import { version } from "../../package.json";
import { useEditorModeStore } from "@/stores/EditorModeStore";

/**
 * The release channel a version belongs to: the first word of its pre-release tag (`beta` for
 * `0.2.0-beta.6`, `nightly` for `0.2.0-nightly.20261122.268`), or `release` for a plain version.
 */
export function releaseChannelOf(appVersion: string): string {
    const dash = appVersion.split("+")[0].indexOf("-");
    if (dash < 0) return "release";
    return appVersion.slice(dash + 1).split(".")[0] || "release";
}

/**
 * Adds the app version, its release channel and Basic or Expert to every analytics event, so
 * events can be told apart by build and by kind of user. Keeps the mode current as it changes.
 */
export function registerAnalyticsContext(posthog: PostHog): void {
    posthog.register({
        app_version: version,
        release_channel: releaseChannelOf(version),
    });
    const registerMode = (mode: string | null) => {
        if (mode) posthog.register({ editor_mode: mode });
    };
    registerMode(useEditorModeStore.getState().mode);
    useEditorModeStore.subscribe((state, previous) => {
        if (state.mode !== previous.mode) registerMode(state.mode);
    });
}
