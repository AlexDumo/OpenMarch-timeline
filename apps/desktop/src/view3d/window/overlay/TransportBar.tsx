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
import { Button } from "@openmarch/ui";
import clsx from "clsx";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import { formatPlaybackSpeed } from "@/stores/PlaybackSpeedStore";
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
 * The editor's playback speed: a click steps to the next speed, Shift+click
 * back, as the editor's speed button does. Lit off 1×, held keys included.
 */
function SpeedButton() {
    const { t } = useTranslate();
    const speed = useView3dSyncStore((s) => s.clock?.speed ?? 1);
    const shown = formatPlaybackSpeed(speed);
    const label = t("view3d.playback.speed", { speed: shown });
    return (
        <Button
            variant="ghost"
            size="compact"
            content="text"
            aria-label={label}
            aria-keyshortcuts="BracketRight BracketLeft"
            tooltipText={`${label}. ${t("view3d.playback.speedHint")}`}
            tooltipSide="top"
            onClick={(event: React.MouseEvent) =>
                window.view3d.requestPlayback(
                    event.shiftKey
                        ? "previousPlaybackSpeed"
                        : "nextPlaybackSpeed",
                )
            }
            data-testid="view3d-speed"
            className={clsx(
                "rounded-4 enabled:hover:bg-text/10 h-28 min-w-40 shrink-0 border border-transparent px-6 font-mono text-[11px] tabular-nums",
                speed !== 1
                    ? "bg-accent/15 text-accent border-accent enabled:hover:bg-accent/20"
                    : "text-text",
            )}
        >
            {shown}
        </Button>
    );
}
