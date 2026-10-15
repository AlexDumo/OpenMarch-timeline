import {
    MetronomeIcon,
    SpeakerSimpleHighIcon,
    SpeakerSimpleLowIcon,
    SpeakerSimpleXIcon,
    RowsIcon,
    RepeatIcon,
} from "@phosphor-icons/react";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { clsx } from "clsx";
import { T } from "@tolgee/react";
import { useMetronomeStore } from "@/stores/MetronomeStore";
import * as Popover from "@radix-ui/react-popover";
import { Slider } from "@openmarch/ui";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { toggleTimelineLoop } from "@/timeline/timelineTransport";
import { Keycaps, ShortcutTooltip } from "./ShortcutTooltip";
import { TRANSPORT_SHORTCUTS } from "./TimelinePrimitives";
import { START_INK } from "./startFlagInk";
import { useState } from "react";
import {
    MAX_PLAYBACK_SPEED,
    MIN_PLAYBACK_SPEED,
    clampPlaybackSpeed,
    effectivePlaybackSpeed,
    formatPlaybackSpeed,
    usePlaybackSpeedStore,
} from "@/stores/PlaybackSpeedStore";

export function TimelineMuteButton() {
    const audioVolume = useUiSettingsStore((s) => s.uiSettings.audioVolume);
    const setAudioVolume = useUiSettingsStore((s) => s.setAudioVolume);

    const handleSliderChange = (values: number[]) => {
        const nextVolume = values[0] ?? 0;
        setAudioVolume(nextVolume);
    };

    const sliderValue = audioVolume;
    const VolumeIcon =
        sliderValue === 0
            ? SpeakerSimpleXIcon
            : sliderValue < 50
              ? SpeakerSimpleLowIcon
              : SpeakerSimpleHighIcon;

    return (
        <Popover.Root>
            <Popover.Trigger asChild>
                <button
                    className={clsx(
                        { "text-red": sliderValue === 0 },
                        { "text-text": sliderValue > 0 },
                        "enabled:hover:text-accent outline-hidden duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50",
                    )}
                    aria-label="Timeline volume"
                >
                    <VolumeIcon size={24} />
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content className="border-stroke bg-modal text-text shadow-modal rounded-8 z-50 flex flex-col gap-6 border px-16 py-12 backdrop-blur-sm">
                    <div className="flex items-center justify-between gap-6">
                        <p className="text-body">
                            <T keyName="timeline.masterVolume" />
                        </p>
                        <span className="text-body font-mono">{`${sliderValue}%`}</span>
                    </div>
                    <Slider
                        min={0}
                        max={100}
                        step={1}
                        value={[sliderValue]}
                        onValueChange={handleSliderChange}
                        aria-label="Timeline volume slider"
                    />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

export function TimelineMetronomeButton() {
    const isMetronomeOn = useMetronomeStore((s) => s.isMetronomeOn);
    const toggleMetronome = useMetronomeStore((s) => s.toggleMetronome);

    return (
        <div className="flex gap-10" id="timelineMetronome">
            <button
                className={clsx(
                    "outline-hidden duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50",
                    {
                        "text-accent": isMetronomeOn,
                        "text-text enabled:hover:text-accent": !isMetronomeOn,
                    },
                )}
                onClick={toggleMetronome}
            >
                <MetronomeIcon size={24} />
            </button>
        </div>
    );
}

/**
 * Loop (UI-17, C): turns looping on over the page being edited, or off. Lit while on; the loop is
 * then a bar on the ruler whose ends drag.
 */
export function TimelineLoopButton() {
    const isolated = useTimelineSelectionStore((s) => s.isolation !== null);
    // An isolated move always loops (UI-17): lit, and it can't be turned off
    const looping = useTimelineSelectionStore(
        (s) => s.loop !== null || s.isolation !== null,
    );
    const shortcut = TRANSPORT_SHORTCUTS.loop;
    return (
        <ShortcutTooltip
            label={looping ? "Loop: on" : "Loop: off"}
            shortcut={isolated ? undefined : shortcut}
            hint={
                isolated
                    ? "Loop is always on for an isolated move"
                    : looping
                      ? "Space loops the bar on the ruler; drag its ends to change it"
                      : "Loops the page you're on"
            }
        >
            <button
                type="button"
                data-testid="timeline-loop"
                aria-label="Loop"
                aria-pressed={looping}
                aria-keyshortcuts={shortcut?.replace(/\s*\+\s*/g, "+")}
                // Not `disabled` in isolation, so the tooltip still says why it can't turn off
                aria-disabled={isolated || undefined}
                // Keeps keyboard focus off, so Space after a click is still Play
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                    if (!isolated) toggleTimelineLoop();
                }}
                className={clsx(
                    "rounded-4 focus-visible:ring-accent flex size-24 items-center justify-center outline-hidden duration-150 focus-visible:ring-2",
                    // In isolation: on (lit) but disabled (dimmed), and still takes the pointer for the
                    // tooltip that says why
                    isolated ? "cursor-default opacity-50" : "hover:bg-fg-2",
                    // Lit in the loop bar's color, so the button reads as the bar's (UI-17)
                    looping ? START_INK.text : "text-text hover:text-accent",
                )}
            >
                <RepeatIcon size={16} weight={looping ? "bold" : "regular"} />
            </button>
        </ShortcutTooltip>
    );
}

// The popover's chips: the click cycle's speeds and the ones between
const SPEED_CHIPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4] as const;
// The slider is logarithmic, so 0.5× and 2× sit as far either side of 1×: hundredths of an octave
const SLIDER_MIN = Math.round(Math.log2(MIN_PLAYBACK_SPEED) * 100);
const SLIDER_MAX = Math.round(Math.log2(MAX_PLAYBACK_SPEED) * 100);
const speedToSlider = (speed: number) => Math.round(Math.log2(speed) * 100);
function sliderToSpeed(value: number): number {
    const raw = 2 ** (value / 100);
    // Catches on the chips' speeds, otherwise twentieths
    const chip = SPEED_CHIPS.find((s) => Math.abs(Math.log2(raw / s)) < 0.03);
    return clampPlaybackSpeed(chip ?? Math.round(raw * 20) / 20);
}

/**
 * Playback speed, as a video player has it. A click steps through 0.25×, 0.5×, 1×, 1.5×, 2× and
 * 4× (Shift+click steps back); a right-click opens a slider from 0.1× to 4× with the common
 * speeds as chips. Held, `]` plays at double the speed and `[` at half. Lit off 1×; while a key
 * is held it shows the held speed. The music keeps its pitch (`timeStretch.ts`).
 */
export function TimelineSpeedButton() {
    const speed = usePlaybackSpeedStore((s) => s.speed);
    const held = usePlaybackSpeedStore((s) => s.hold !== null);
    const playing = usePlaybackSpeedStore(effectivePlaybackSpeed);
    const setSpeed = usePlaybackSpeedStore((s) => s.setSpeed);
    const stepSpeed = usePlaybackSpeedStore((s) => s.stepSpeed);
    const [open, setOpen] = useState(false);
    const shown = formatPlaybackSpeed(playing);
    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <ShortcutTooltip
                label={open ? undefined : `Playback speed: ${shown}`}
                hint="Click for the next speed, right-click for more. Hold ] for double speed, [ for half"
            >
                <Popover.Anchor asChild>
                    <button
                        type="button"
                        data-testid="timeline-speed"
                        aria-label={`Playback speed: ${shown}`}
                        aria-haspopup="dialog"
                        aria-keyshortcuts="BracketRight BracketLeft"
                        // Keeps keyboard focus off, so Space after a click is still Play
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(event) => stepSpeed(event.shiftKey)}
                        onContextMenu={(event) => {
                            event.preventDefault();
                            setOpen(true);
                        }}
                        className={clsx(
                            "rounded-4 hover:bg-fg-2 focus-visible:ring-accent flex h-24 min-w-36 items-center justify-center px-4 font-mono text-[11px] tabular-nums outline-hidden duration-150 focus-visible:ring-2",
                            playing !== 1 || held
                                ? "text-accent bg-accent/10"
                                : "text-text hover:text-accent",
                        )}
                    >
                        {shown}
                    </button>
                </Popover.Anchor>
            </ShortcutTooltip>
            <Popover.Portal>
                <Popover.Content
                    side="top"
                    sideOffset={6}
                    // The button keeps focus off itself; so does the popover, so Space still plays
                    onOpenAutoFocus={(event) => event.preventDefault()}
                    className="border-stroke bg-modal text-text shadow-modal rounded-8 z-50 flex w-256 flex-col gap-10 border px-16 py-12 backdrop-blur-sm"
                >
                    <div className="flex items-baseline justify-between">
                        <p className="text-body">Playback speed</p>
                        <span
                            data-testid="timeline-speed-value"
                            className="text-body font-mono tabular-nums"
                        >
                            {formatPlaybackSpeed(speed)}
                        </span>
                    </div>
                    <Slider
                        className="w-full"
                        min={SLIDER_MIN}
                        max={SLIDER_MAX}
                        step={1}
                        value={[speedToSlider(speed)]}
                        onValueChange={(values) =>
                            setSpeed(sliderToSpeed(values[0] ?? 0))
                        }
                        aria-label="Playback speed"
                    />
                    <div className="grid grid-cols-4 gap-4">
                        {SPEED_CHIPS.map((chip) => (
                            <button
                                key={chip}
                                type="button"
                                aria-pressed={speed === chip}
                                onClick={() => setSpeed(chip)}
                                className={clsx(
                                    "rounded-4 focus-visible:ring-accent h-22 px-4 font-mono text-[11px] tabular-nums outline-hidden focus-visible:ring-2",
                                    speed === chip
                                        ? "bg-accent text-text-invert"
                                        : "bg-fg-2 hover:text-accent",
                                )}
                            >
                                {formatPlaybackSpeed(chip)}
                            </button>
                        ))}
                    </div>
                    <p className="text-sub text-text-subtitle border-stroke flex items-center gap-4 border-t pt-8">
                        Hold <Keycaps shortcut="]" /> for double speed,
                        <Keycaps shortcut="[" /> for half
                    </p>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

/**
 * Sound (UI-12): one button for what was Volume and Metronome. Its popover mutes the music (the
 * metronome keeps counting, a rehearsal habit), sets the volume of both, and turns the metronome
 * on (Ctrl+M still does). The icon shows the music muted, and a dot shows the metronome is on.
 */
export function TimelineSoundButton() {
    const audioVolume = useUiSettingsStore((s) => s.uiSettings.audioVolume);
    const audioMuted = useUiSettingsStore((s) => s.uiSettings.audioMuted);
    const setAudioVolume = useUiSettingsStore((s) => s.setAudioVolume);
    const toggleAudioMute = useUiSettingsStore((s) => s.toggleAudioMute);
    const isMetronomeOn = useMetronomeStore((s) => s.isMetronomeOn);
    const toggleMetronome = useMetronomeStore((s) => s.toggleMetronome);
    const silent = audioMuted || audioVolume === 0;
    const VolumeIcon = silent
        ? SpeakerSimpleXIcon
        : audioVolume < 50
          ? SpeakerSimpleLowIcon
          : SpeakerSimpleHighIcon;
    const state = `${silent ? "music muted" : `volume ${audioVolume}%`}, metronome ${isMetronomeOn ? "on" : "off"}`;
    return (
        <Popover.Root>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    data-testid="timeline-sound"
                    className={clsx(
                        "rounded-4 enabled:hover:bg-fg-2 focus-visible:ring-accent relative flex size-24 items-center justify-center outline-hidden duration-150 ease-out focus-visible:ring-2",
                        silent
                            ? "text-red"
                            : "text-text enabled:hover:text-accent",
                    )}
                    aria-label={`Sound: ${state}`}
                    title={`Sound: ${state}`}
                >
                    <VolumeIcon size={18} />
                    {isMetronomeOn && (
                        <span className="bg-accent absolute top-1 right-1 size-5 rounded-full" />
                    )}
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    side="top"
                    className="border-stroke bg-modal text-text shadow-modal rounded-8 z-50 flex w-232 flex-col gap-10 border px-16 py-12 backdrop-blur-sm"
                >
                    <div className="flex items-center gap-8">
                        <button
                            type="button"
                            aria-label="Mute the music"
                            aria-pressed={audioMuted}
                            title={
                                audioMuted
                                    ? "Unmute the music"
                                    : "Mute the music (the metronome keeps counting)"
                            }
                            onClick={toggleAudioMute}
                            className={clsx(
                                "rounded-4 hover:bg-fg-2 focus-visible:ring-accent flex size-24 shrink-0 items-center justify-center outline-hidden focus-visible:ring-2",
                                silent ? "text-red" : "hover:text-accent",
                            )}
                        >
                            <VolumeIcon size={18} />
                        </button>
                        <Slider
                            min={0}
                            max={100}
                            step={1}
                            value={[audioVolume]}
                            onValueChange={(values) =>
                                setAudioVolume(values[0] ?? 0)
                            }
                            aria-label="Volume"
                        />
                        <span className="text-sub w-36 shrink-0 text-right font-mono">
                            {audioMuted ? "Muted" : `${audioVolume}%`}
                        </span>
                    </div>
                    <button
                        type="button"
                        aria-pressed={isMetronomeOn}
                        onClick={toggleMetronome}
                        className={clsx(
                            "border-stroke focus-visible:ring-accent flex items-center gap-6 border-t pt-8 outline-hidden focus-visible:ring-2",
                            isMetronomeOn ? "text-accent" : "hover:text-accent",
                        )}
                    >
                        <MetronomeIcon size={18} />
                        <span className="text-body">
                            Metronome {isMetronomeOn ? "on" : "off"}
                        </span>
                        <span className="text-sub text-text-subtitle ml-auto font-mono">
                            Ctrl+M
                        </span>
                    </button>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

/**
 * Compact (UI-12): the timeline as a thin strip, or full. Only this button switches it, and the
 * choice is remembered for every show. Lit while compact, like the other toggles.
 */
export function TimelineCompactButton() {
    const compact = useUiSettingsStore((s) => s.uiSettings.timelineCompact);
    const setCompact = useUiSettingsStore((s) => s.setTimelineCompact);
    return (
        <button
            type="button"
            data-testid="timeline-compact"
            className={clsx(
                "rounded-4 enabled:hover:bg-fg-2 focus-visible:ring-accent flex size-24 items-center justify-center outline-hidden duration-150 ease-out focus-visible:ring-2",
                compact
                    ? "text-accent bg-accent/10"
                    : "text-text enabled:hover:text-accent",
            )}
            aria-label="Compact timeline"
            aria-pressed={compact}
            title={
                compact
                    ? "Compact timeline: on. Click to show the full timeline"
                    : "Compact timeline"
            }
            onClick={() => setCompact()}
        >
            <RowsIcon size={16} weight={compact ? "fill" : "regular"} />
        </button>
    );
}
