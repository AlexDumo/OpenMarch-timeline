// cspell:ignore fstop
/**
 * A camera's exact settings, opened from its row in the Cameras panel.
 *
 * - Who it follows: nobody (it stays put), or a performer, from behind
 *   them or out of their eyes.
 * - Where it is: the camera and the point it looks at, in feet or meters by
 *   the field's measurement system, with where that is on the field in
 *   drill terms; then pan, tilt and roll.
 * - Lens: focal length (full-frame equivalent) and field of view, one
 *   setting shown both ways.
 * - Focus: off, or sharp at the look-at point, a performer, or a distance,
 *   with the f-number setting how soft the rest gets, and the range that
 *   looks sharp.
 *
 * Typing a number and pressing Enter (or leaving the field) saves it and
 * puts the view there. Dragging a field (or its label) left or right
 * changes the value and moves the view as it goes; letting go saves; a
 * click without a drag types in it. Arrow keys step it (Shift for ten
 * steps, Alt for a tenth). A default camera becomes the show's own once a
 * setting changes, as "Set to current view" does.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import type { Vector3Tuple } from "three";
import {
    SegmentedTextSwitch,
    Select,
    SelectContent,
    SelectItem,
    SelectTriggerCompact,
} from "@openmarch/ui";
import { worldToPixels } from "@openmarch/core";
import {
    MAX_F_STOP,
    MAX_FOV_DEG,
    MAX_ROLL_DEG,
    MIN_F_STOP,
    MIN_FOV_DEG,
    normalizeRoll,
    type CameraFocus,
    type CameraFollow,
    type ViewCamera,
    type ViewPose,
} from "@/view3d/core/cameraList";
import {
    aimOf,
    depthOfField,
    focalLengthFromFov,
    fovFromFocalLength,
    MAX_FOCAL_MM,
    MAX_TILT_DEG,
    MIN_FOCAL_MM,
    targetFromAim,
} from "@/view3d/core/cameraSettings";
import { fieldPropertiesQueryOptions } from "@/hooks/queries/useFieldProperties";
import { allMarchersQueryOptions } from "@/hooks/queries/useMarchers";
import { ReadableCoords } from "@/global/classes/ReadableCoords";
import { SEAT_FOV_DEG, seatAim } from "../camera/rigMath";
import { useCameraStore } from "../camera/cameraStore";
import { useFollowStore } from "../camera/followStore";
import type { CameraList } from "./useCameraList";

const METERS_PER_FOOT = 0.3048;

type FollowChoice = "fixed" | "third" | "pov";

/** The settings a camera has now, as numbers to edit. */
interface Settings {
    position: Vector3Tuple;
    target: Vector3Tuple;
    fovDeg: number;
    rollDeg: number;
    follow: CameraFollow | null;
    focus: CameraFocus | null;
}

type FocusChoice = "off" | CameraFocus["on"]["kind"];

/** A new focus starts at f/2.8, a fast lens's usual setting. */
const DEFAULT_F_STOP = 2.8;
/** A new set focus distance, meters. */
const DEFAULT_FOCUS_M = 10;

function settingsOf(camera: ViewCamera): Settings {
    const aim = seatAim(camera);
    return {
        position: aim.position,
        target: aim.target,
        fovDeg: camera.fovDeg ?? SEAT_FOV_DEG,
        rollDeg: camera.rollDeg ?? 0,
        follow: camera.follow ?? null,
        focus: camera.focus ?? null,
    };
}

function poseOf(settings: Settings): ViewPose {
    return {
        position: settings.position,
        target: settings.target,
        fovDeg: settings.fovDeg,
        rollDeg: settings.rollDeg,
    };
}

// eslint-disable-next-line max-lines-per-function
export function CameraSettings({
    camera,
    list,
}: {
    camera: ViewCamera;
    list: CameraList;
}) {
    const { t } = useTranslate();
    const { data: field } = useQuery(fieldPropertiesQueryOptions());
    const { data: marchers } = useQuery(allMarchersQueryOptions());
    const metric = field?.measurementSystem === "metric";
    const unit = metric
        ? t("view3d.cameraSettings.m")
        : t("view3d.cameraSettings.ft");
    const toShown = (m: number) => (metric ? m : m / METERS_PER_FOOT);
    const fromShown = (v: number) => (metric ? v : v * METERS_PER_FOOT);

    const saved = settingsOf(camera);
    const aim = aimOf(saved.position, saved.target);

    const save = (next: Settings) =>
        list.setExact(camera.id, poseOf(next), {
            follow: next.follow,
            focus: next.focus,
        });
    const show = (next: Settings) =>
        useCameraStore.getState().showPose(poseOf(next), next.focus);

    /** Settings with one axis of the camera or look-at point changed. */
    const withPoint =
        (which: "position" | "target", axis: 0 | 1 | 2) =>
        (shown: number): Settings => {
            const point = [...saved[which]] as Vector3Tuple;
            point[axis] = fromShown(shown);
            return { ...saved, [which]: point };
        };
    /** Settings with the aim changed: the camera stays, the look-at point moves. */
    const withAim =
        (key: "panDeg" | "tiltDeg") =>
        (value: number): Settings => ({
            ...saved,
            target: targetFromAim(saved.position, { ...aim, [key]: value }),
        });

    const followChoice: FollowChoice = saved.follow?.mode ?? "fixed";
    // A camera that starts following takes whoever the view follows, else the first performer.
    const followedNow = useFollowStore((s) => s.follow?.marcherId);
    const followedId =
        saved.follow?.marcherId ?? followedNow ?? marchers?.[0]?.id;
    const setFollow = (choice: FollowChoice, marcherId = followedId) => {
        if (choice === "fixed" || marcherId === undefined)
            save({ ...saved, follow: null });
        else save({ ...saved, follow: { marcherId, mode: choice } });
    };

    const focusChoice: FocusChoice = saved.focus?.on.kind ?? "off";
    const setFocus = (choice: FocusChoice) => {
        if (choice === "off") return save({ ...saved, focus: null });
        const fStop = saved.focus?.fStop ?? DEFAULT_F_STOP;
        const on: CameraFocus["on"] | null =
            choice === "lookAt"
                ? { kind: "lookAt" }
                : choice === "distance"
                  ? { kind: "distance", meters: DEFAULT_FOCUS_M }
                  : followedId === undefined
                    ? null
                    : { kind: "performer", marcherId: followedId };
        if (on) save({ ...saved, focus: { fStop, on } });
    };
    const withFocus = (focus: Partial<CameraFocus>): Settings =>
        saved.focus ? { ...saved, focus: { ...saved.focus, ...focus } } : saved;
    // The range that looks sharp, where the focus distance is known.
    const focusM =
        saved.focus?.on.kind === "distance"
            ? saved.focus.on.meters
            : saved.focus?.on.kind === "lookAt" && !saved.follow
              ? aim.distance
              : null;
    const sharp =
        saved.focus && focusM !== null
            ? depthOfField(
                  focalLengthFromFov(saved.fovDeg),
                  saved.focus.fStop,
                  focusM,
              )
            : null;
    const length = (m: number) => round(toShown(m), m < 10 ? 1 : 0);

    const fieldNumber = (
        key: string,
        options: Omit<NumberFieldProps, "testId" | "onCommit" | "onScrub"> & {
            build: (value: number) => Settings;
        },
    ) => {
        const { build, ...rest } = options;
        return (
            <NumberField
                {...rest}
                testId={`view3d-camera-setting-${key}`}
                onCommit={(v) => save(build(v))}
                onScrub={(v) => show(build(v))}
            />
        );
    };

    const where = describePosition(t, field, saved.position);

    return (
        <div
            className="border-stroke flex flex-col gap-12 border-t px-4 pt-8 pb-4"
            data-testid="view3d-camera-settings"
        >
            <Section title={t("view3d.cameraSettings.does")}>
                <Row label={t("view3d.cameraSettings.follows")}>
                    <PerformerSelect
                        label={t("view3d.cameraSettings.follows")}
                        value={saved.follow?.marcherId ?? null}
                        noneLabel={t("view3d.cameraSettings.nobody")}
                        marchers={marchers}
                        testId="view3d-camera-follow-performer"
                        onChange={(id) =>
                            id === null
                                ? setFollow("fixed")
                                : setFollow(
                                      followChoice === "fixed"
                                          ? "third"
                                          : followChoice,
                                      id,
                                  )
                        }
                    />
                </Row>
                {saved.follow && (
                    <Row label={t("view3d.cameraSettings.followView")}>
                        <SegmentedTextSwitch
                            ariaLabel={t("view3d.cameraSettings.followView")}
                            testId="view3d-camera-follow-mode"
                            className="self-start justify-self-start"
                            selected={followChoice}
                            setSelected={(value) =>
                                setFollow(value as FollowChoice)
                            }
                            options={[
                                {
                                    value: "third",
                                    label: t("view3d.cameraSettings.behind"),
                                },
                                {
                                    value: "pov",
                                    label: t("view3d.cameraSettings.eyes"),
                                },
                            ]}
                        />
                    </Row>
                )}
            </Section>

            {!saved.follow && (
                <Section title={t("view3d.cameraSettings.position")}>
                    <div className="grid grid-cols-[4.5rem_1fr_1fr_1fr] items-center gap-4">
                        <span />
                        <ColumnHead
                            label={t("view3d.cameraSettings.across")}
                            tooltip={t("view3d.cameraSettings.acrossTooltip")}
                        />
                        <ColumnHead
                            label={t("view3d.cameraSettings.height")}
                            tooltip={t("view3d.cameraSettings.heightTooltip")}
                        />
                        <ColumnHead
                            label={t("view3d.cameraSettings.front")}
                            tooltip={t("view3d.cameraSettings.frontTooltip")}
                        />
                        {(["position", "target"] as const).map((which) => (
                            <PointRow
                                key={which}
                                label={
                                    which === "position"
                                        ? t("view3d.cameraSettings.camera")
                                        : t("view3d.cameraSettings.lookAt")
                                }
                            >
                                {([0, 1, 2] as const).map((axis) =>
                                    fieldNumber(`${which}-${axis}`, {
                                        label: `${
                                            which === "position"
                                                ? t(
                                                      "view3d.cameraSettings.camera",
                                                  )
                                                : t(
                                                      "view3d.cameraSettings.lookAt",
                                                  )
                                        } ${
                                            [
                                                t(
                                                    "view3d.cameraSettings.across",
                                                ),
                                                t(
                                                    "view3d.cameraSettings.height",
                                                ),
                                                t(
                                                    "view3d.cameraSettings.front",
                                                ),
                                            ][axis]
                                        }`,
                                        hideLabel: true,
                                        value: toShown(saved[which][axis]),
                                        digits: 2,
                                        step: 1,
                                        scrubPerPx: 0.1,
                                        min:
                                            axis === 1 && which === "position"
                                                ? 0
                                                : undefined,
                                        build: withPoint(which, axis),
                                    }),
                                )}
                            </PointRow>
                        ))}
                    </div>
                    <p
                        className="text-sub text-text/60"
                        data-testid="view3d-camera-where"
                    >
                        {t("view3d.cameraSettings.units", { unit })}
                        {where && ` · ${where}`}
                    </p>
                    <div className="grid grid-cols-3 gap-8">
                        {fieldNumber("pan", {
                            label: t("view3d.cameraSettings.pan"),
                            tooltip: t("view3d.cameraSettings.panTooltip"),
                            unit: "°",
                            value: aim.panDeg,
                            digits: 1,
                            step: 1,
                            scrubPerPx: 0.25,
                            build: withAim("panDeg"),
                        })}
                        {fieldNumber("tilt", {
                            label: t("view3d.cameraSettings.tilt"),
                            tooltip: t("view3d.cameraSettings.tiltTooltip"),
                            unit: "°",
                            value: aim.tiltDeg,
                            digits: 1,
                            step: 1,
                            scrubPerPx: 0.25,
                            min: -MAX_TILT_DEG,
                            max: MAX_TILT_DEG,
                            build: withAim("tiltDeg"),
                        })}
                        {fieldNumber("roll", {
                            label: t("view3d.cameraSettings.roll"),
                            tooltip: t("view3d.cameraSettings.rollTooltip"),
                            unit: "°",
                            value: saved.rollDeg,
                            digits: 1,
                            step: 1,
                            scrubPerPx: 0.25,
                            min: -MAX_ROLL_DEG,
                            max: MAX_ROLL_DEG,
                            build: (v) => ({
                                ...saved,
                                rollDeg: normalizeRoll(v),
                            }),
                        })}
                    </div>
                </Section>
            )}

            <Section title={t("view3d.cameraSettings.lens")}>
                <div className="grid grid-cols-2 gap-8">
                    {fieldNumber("focal", {
                        label: t("view3d.cameraSettings.focalLength"),
                        tooltip: t("view3d.cameraSettings.focalLengthTooltip"),
                        unit: t("view3d.cameraSettings.mm"),
                        value: focalLengthFromFov(saved.fovDeg),
                        digits: 1,
                        step: 1,
                        scrubPerPx: 0.25,
                        min: MIN_FOCAL_MM,
                        max: MAX_FOCAL_MM,
                        build: (v) => ({
                            ...saved,
                            fovDeg: fovFromFocalLength(v),
                        }),
                    })}
                    {fieldNumber("fov", {
                        label: t("view3d.cameraSettings.fieldOfView"),
                        tooltip: t("view3d.cameraSettings.fieldOfViewTooltip"),
                        unit: "°",
                        value: saved.fovDeg,
                        digits: 1,
                        step: 1,
                        scrubPerPx: 0.1,
                        min: MIN_FOV_DEG,
                        max: MAX_FOV_DEG,
                        build: (v) => ({ ...saved, fovDeg: v }),
                    })}
                </div>
            </Section>

            <Section title={t("view3d.cameraSettings.focus")}>
                <SegmentedTextSwitch
                    ariaLabel={t("view3d.cameraSettings.focus")}
                    testId="view3d-camera-focus-mode"
                    className="self-start"
                    selected={focusChoice}
                    setSelected={(value) => setFocus(value as FocusChoice)}
                    options={[
                        {
                            value: "off",
                            label: t("view3d.cameraSettings.focusOff"),
                        },
                        {
                            value: "lookAt",
                            label: t("view3d.cameraSettings.focusLookAt"),
                        },
                        {
                            value: "performer",
                            label: t("view3d.cameraSettings.focusPerformer"),
                            disabled: followedId === undefined,
                        },
                        {
                            value: "distance",
                            label: t("view3d.cameraSettings.focusDistance"),
                        },
                    ]}
                />
                {saved.focus?.on.kind === "performer" && (
                    <Row label={t("view3d.cameraSettings.performer")}>
                        <PerformerSelect
                            label={t("view3d.cameraSettings.focusPerformer")}
                            value={saved.focus.on.marcherId}
                            marchers={marchers}
                            testId="view3d-camera-focus-performer"
                            onChange={(marcherId) =>
                                marcherId !== null &&
                                save(
                                    withFocus({
                                        on: { kind: "performer", marcherId },
                                    }),
                                )
                            }
                        />
                    </Row>
                )}
                {saved.focus && (
                    <div className="grid grid-cols-2 gap-8">
                        {fieldNumber("fstop", {
                            label: t("view3d.cameraSettings.fStop"),
                            tooltip: t("view3d.cameraSettings.fStopTooltip"),
                            value: saved.focus.fStop,
                            digits: 1,
                            step: 1,
                            scrubPerPx: 0.05,
                            min: MIN_F_STOP,
                            max: MAX_F_STOP,
                            build: (v) => withFocus({ fStop: v }),
                        })}
                        {saved.focus.on.kind === "distance" &&
                            fieldNumber("focus-distance", {
                                label: t(
                                    "view3d.cameraSettings.focusDistanceField",
                                ),
                                tooltip: t(
                                    "view3d.cameraSettings.focusDistanceTooltip",
                                ),
                                unit: metric ? "m" : "ft",
                                value: toShown(saved.focus.on.meters),
                                digits: 1,
                                step: 1,
                                scrubPerPx: 0.25,
                                min: toShown(0.1),
                                build: (v) =>
                                    withFocus({
                                        on: {
                                            kind: "distance",
                                            meters: fromShown(v),
                                        },
                                    }),
                            })}
                    </div>
                )}
                {sharp && (
                    <p
                        className="text-sub text-text/60"
                        data-testid="view3d-camera-sharp-range"
                    >
                        {Number.isFinite(sharp.far)
                            ? t("view3d.cameraSettings.sharpRange", {
                                  near: length(sharp.near),
                                  far: length(sharp.far),
                                  unit,
                              })
                            : t("view3d.cameraSettings.sharpBeyond", {
                                  near: length(sharp.near),
                                  unit,
                              })}
                    </p>
                )}
            </Section>
        </div>
    );
}

const NOBODY = "nobody";

/** Chooses a performer by drill number and name. */
function PerformerSelect({
    label,
    value,
    noneLabel,
    marchers,
    testId,
    onChange,
}: {
    label: string;
    /** Null for nobody (only with `noneLabel`). */
    value: number | null;
    /** Adds a first choice for nobody, with this name. */
    noneLabel?: string;
    marchers:
        | { id: number; drill_number: string; name?: string | null }[]
        | undefined;
    testId: string;
    onChange: (marcherId: number | null) => void;
}) {
    return (
        <div data-testid={testId} className="min-w-0">
            <Select
                value={value === null ? NOBODY : String(value)}
                onValueChange={(v) => onChange(v === NOBODY ? null : Number(v))}
            >
                <SelectTriggerCompact
                    label={label}
                    className="w-full justify-start"
                />
                <SelectContent>
                    {noneLabel && (
                        <SelectItem value={NOBODY}>{noneLabel}</SelectItem>
                    )}
                    {(marchers ?? []).map((m) => (
                        <SelectItem key={m.id} value={String(m.id)}>
                            {m.name
                                ? `${m.drill_number} ${m.name}`
                                : m.drill_number}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}

/** Where a point is over the field, in drill terms; empty when it can't be said. */
function describePosition(
    t: (key: string, params: Record<string, string>) => string,
    field: Parameters<typeof worldToPixels>[0] | undefined,
    position: Vector3Tuple,
): string {
    if (!field) return "";
    try {
        ReadableCoords.setFieldProperties(field);
        const { x, y } = worldToPixels(field, {
            x: position[0],
            z: position[2],
        });
        const coords = new ReadableCoords({ x, y, roundingDenominator: 4 });
        return t("coordinates.full", {
            x: coords.toVerboseStringX({ includeStepsString: true }),
            y: coords.toVerboseStringY({ includeStepsString: true }),
        });
    } catch {
        return "";
    }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-6">
            <h3 className="text-sub text-text/60 font-medium">{title}</h3>
            {children}
        </section>
    );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="grid grid-cols-[4.5rem_1fr] items-center gap-4">
            <span className="text-sub text-text/80 truncate">{label}</span>
            {children}
        </div>
    );
}

function PointRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <>
            <span className="text-sub text-text/80 truncate">{label}</span>
            {children}
        </>
    );
}

function ColumnHead({ label, tooltip }: { label: string; tooltip: string }) {
    return (
        <span className="text-sub text-text/60 truncate" title={tooltip}>
            {label}
        </span>
    );
}

interface NumberFieldProps {
    label: string;
    /** Shown on hover over the label. */
    tooltip?: string;
    /** Leaves the label to screen readers (a column heading names it). */
    hideLabel?: boolean;
    unit?: string;
    value: number;
    digits: number;
    /** What an arrow key adds. */
    step: number;
    /** What one pixel of dragging the label adds. */
    scrubPerPx: number;
    min?: number;
    max?: number;
    testId: string;
    onCommit: (value: number) => void;
    onScrub: (value: number) => void;
}

/**
 * A number typed and saved on Enter or blur (Esc puts it back), stepped
 * with the arrow keys, or changed by dragging the box or its label.
 */
function NumberField({
    label,
    tooltip,
    hideLabel = false,
    unit,
    value,
    digits,
    step,
    scrubPerPx,
    min,
    max,
    testId,
    onCommit,
    onScrub,
}: NumberFieldProps) {
    const shown = round(value, digits);
    const [draft, setDraft] = useState(String(shown));
    const scrub = useRef<{
        startX: number;
        start: number;
        last: number;
        /** Past the few pixels that tell a drag from a click. */
        moved: boolean;
        /** Started on the box itself: a click without a drag types in it. */
        onBox: boolean;
    } | null>(null);
    const box = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (!scrub.current) setDraft(String(shown));
    }, [shown]);

    const clamp = (v: number) =>
        Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    const commit = (v: number) => {
        const next = round(clamp(v), digits);
        setDraft(String(next));
        if (next !== shown) onCommit(next);
    };

    const input = (
        <input
            ref={box}
            type="text"
            inputMode="decimal"
            value={draft}
            aria-label={label}
            data-testid={testId}
            className={clsx(
                "rounded-6 border-stroke bg-fg-2 text-body text-text focus:border-accent h-26 w-full min-w-0 cursor-ew-resize touch-pan-y border pl-6 text-right tabular-nums outline-hidden focus:cursor-text",
                !unit ? "pr-6" : unit.length > 1 ? "pr-32" : "pr-20",
            )}
            onChange={(event) => setDraft(event.target.value)}
            {...dragHandlers(true)}
            onBlur={() => {
                const v = Number(draft.replace(",", "."));
                if (draft.trim() === "" || !Number.isFinite(v))
                    setDraft(String(shown));
                else commit(v);
            }}
            onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                else if (event.key === "Escape") {
                    setDraft(String(shown));
                    event.preventDefault();
                    event.stopPropagation();
                } else if (
                    event.key === "ArrowUp" ||
                    event.key === "ArrowDown"
                ) {
                    event.preventDefault();
                    const by =
                        (event.key === "ArrowUp" ? 1 : -1) *
                        step *
                        (event.shiftKey ? 10 : event.altKey ? 0.1 : 1);
                    const current = Number(draft.replace(",", "."));
                    commit((Number.isFinite(current) ? current : shown) + by);
                }
            }}
        />
    );
    /**
     * Dragging left or right changes the value and moves the view as it
     * goes; letting go saves. On the box, a click without a drag types in it
     * instead, and a box already being typed in keeps its own pointer.
     */
    // A declaration, so the box above can use it.
    function dragHandlers(onBox: boolean) {
        return {
            onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
                if (event.pointerType === "mouse" && event.button !== 0) return;
                if (onBox && document.activeElement === box.current) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture?.(event.pointerId);
                scrub.current = {
                    startX: event.clientX,
                    start: shown,
                    last: shown,
                    moved: false,
                    onBox,
                };
            },
            onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
                const s = scrub.current;
                if (!s) return;
                const dx = event.clientX - s.startX;
                if (!s.moved && Math.abs(dx) < DRAG_START_PX) return;
                s.moved = true;
                const k = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
                const v = round(clamp(s.start + dx * scrubPerPx * k), digits);
                if (v === s.last) return;
                s.last = v;
                setDraft(String(v));
                onScrub(v);
            },
            onPointerUp: () => {
                const s = scrub.current;
                scrub.current = null;
                if (!s) return;
                if (s.last !== s.start) onCommit(s.last);
                else if (!s.moved && s.onBox) {
                    box.current?.focus();
                    box.current?.select();
                }
            },
            onPointerCancel: () => {
                const s = scrub.current;
                scrub.current = null;
                if (s && s.last !== s.start) onCommit(s.last);
            },
        };
    }

    if (hideLabel)
        return (
            <div className="relative flex min-w-0 items-center">
                {input}
                {unit && <Unit unit={unit} />}
            </div>
        );
    return (
        <div className="flex min-w-0 flex-col gap-2">
            <span
                className="text-sub text-text/80 cursor-ew-resize truncate select-none"
                title={tooltip}
                data-testid={`${testId}-scrub`}
                {...dragHandlers(false)}
            >
                {label}
            </span>
            <span className="relative flex min-w-0 items-center">
                {input}
                {unit && <Unit unit={unit} />}
            </span>
        </div>
    );
}

function Unit({ unit }: { unit: string }) {
    return (
        <span className="text-sub text-text/50 pointer-events-none absolute right-6">
            {unit}
        </span>
    );
}

/** How far a press moves before it's a drag rather than a click, px. */
const DRAG_START_PX = 3;

function round(v: number, digits: number): number {
    const k = 10 ** digits;
    return Math.round(v * k) / k || 0;
}
