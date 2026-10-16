/**
 * Playback controls (ui.md UI-4): previous page, play or pause, next page,
 * and the playback speed, as the editor's speed button has it.
 * The editor owns playback, so each button asks it to run the matching
 * action, exactly as its own timeline buttons do. The window follows the
 * clock the editor then sends.
 */
import { useTranslate } from "@tolgee/react";
import {
    PauseIcon,
    PlayIcon,
    SkipBackIcon,
    SkipForwardIcon,
} from "@phosphor-icons/react";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import { PlaybackSpeedButton } from "@/components/timeline/PlaybackSpeedButton";
import { TransportTooltipProvider } from "@/components/timeline/ShortcutTooltip";
import { useView3dSyncStore } from "@/view3d/sync/view3dSyncStore";
import { Panel, PanelSeparator, ToggleButton } from "./Panel";
import { transportState } from "./playback";

export function TransportBar() {
    const { t } = useTranslate();
    const { pages } = useTimingObjects();
    const selectedPageId = useView3dSyncStore(
        (s) => s.selection.selectedPageId,
    );
    const playing = useView3dSyncStore((s) => !!s.clock?.playing);
    const can = transportState(pages, selectedPageId, playing);
    const request = window.view3d.requestPlayback;

    const playLabel = t(
        playing ? "view3d.playback.pause" : "view3d.playback.play",
    );
    return (
        <Panel
            label={t("view3d.playback.label")}
            testId="view3d-transport"
            className="shrink-0"
        >
            <ToggleButton
                onClick={() => request("previousPage")}
                disabled={!can.previousPage}
                icon={<SkipBackIcon size={16} />}
                label={t("view3d.playback.previousPage")}
                tooltip={t("view3d.playback.previousPage")}
                tooltipSide="top"
                iconOnly
                testId="view3d-previous-page"
            />
            <ToggleButton
                onClick={() => request("playPause")}
                disabled={!can.playPause}
                icon={
                    playing ? (
                        <PauseIcon size={16} weight="fill" />
                    ) : (
                        <PlayIcon size={16} weight="fill" />
                    )
                }
                label={playLabel}
                tooltip={playLabel}
                tooltipSide="top"
                iconOnly
                testId="view3d-play-pause"
            />
            <ToggleButton
                onClick={() => request("nextPage")}
                disabled={!can.nextPage}
                icon={<SkipForwardIcon size={16} />}
                label={t("view3d.playback.nextPage")}
                tooltip={t("view3d.playback.nextPage")}
                tooltipSide="top"
                iconOnly
                testId="view3d-next-page"
            />
            <PanelSeparator />
            <SpeedButton />
        </Panel>
    );
}

/**
 * The editor's playback speed, with the editor's own speed button: its
 * tooltip, click and Shift+click steps, and right-click slider and chips.
 */
function SpeedButton() {
    const speed = useView3dSyncStore((s) => s.clock?.speed ?? 1);
    const chosen = useView3dSyncStore((s) => s.clock?.chosenSpeed ?? 1);
    return (
        <TransportTooltipProvider>
            <PlaybackSpeedButton
                speed={chosen}
                playing={speed}
                held={speed !== chosen}
                onStep={(back) =>
                    window.view3d.requestPlayback(
                        back ? "previousPlaybackSpeed" : "nextPlaybackSpeed",
                    )
                }
                onSetSpeed={(next) => window.view3d.requestPlaybackSpeed(next)}
                className="h-28 min-w-40"
                testId="view3d-speed"
            />
        </TransportTooltipProvider>
    );
}
