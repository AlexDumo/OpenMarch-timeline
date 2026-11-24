/**
 * A camera's exact settings, opened from its row in the Cameras panel.
 *
 * - What it does: stays put, follows a performer from behind, or looks out
 *   of their eyes (with which performer).
 * - Where it is: the camera and the point it looks at, in feet or meters by
 *   the field's measurement system, with where that is on the field in
 *   drill terms; then pan, tilt and roll.
 * - Lens: focal length (full-frame equivalent) and field of view, one
 *   setting shown both ways.
 *
 * Typing a number and pressing Enter (or leaving the field) saves it and
 * puts the view there. Dragging a field's label scrubs the value and moves
 * the view as it goes; letting go saves. Arrow keys step it (Shift for ten
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
    MAX_FOV_DEG,
    MAX_ROLL_DEG,
    MIN_FOV_DEG,
    normalizeRoll,
    type CameraFollow,
    type ViewCamera,
    type ViewPose,
} from "@/view3d/core/cameraList";
import {
    aimOf,
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
}

function settingsOf(camera: ViewCamera): Settings {
    const aim = seatAim(camera);
    return {
        position: aim.position,
        target: aim.target,
        fovDeg: camera.fovDeg ?? SEAT_FOV_DEG,
        rollDeg: camera.rollDeg ?? 0,
        follow: camera.follow ?? null,
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
        list.setExact(camera.id, poseOf(next), next.follow);
    const show = (next: Settings) =>
        useCameraStore.getState().showPose(poseOf(next));

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
                <SegmentedTextSwitch
                    ariaLabel={t("view3d.cameraSettings.does")}
                    testId="view3d-camera-follow-mode"
                    selected={followChoice}
                    setSelected={(value) => setFollow(value as FollowChoice)}
                    options={[
                        {
                            value: "fixed",
                            label: t("view3d.cameraSettings.fixed"),
                        },
                        {
                            value: "third",
                            label: t("view3d.cameraSettings.behind"),
                            disabled: followedId === undefined,
                        },
                        {
                            value: "pov",
                            label: t("view3d.cameraSettings.eyes"),
                            disabled: followedId === undefined,
                        },
                    ]}
                />
                {saved.follow && (
                    <Row label={t("view3d.cameraSettings.performer")}>
                        <Select
                            value={String(saved.follow.marcherId)}
                            onValueChange={(value) =>
                                setFollow(followChoice, Number(value))
                            }
                        >
                            <SelectTriggerCompact
                                label={t("view3d.cameraSettings.performer")}
                                className="w-full justify-start"
                            />
                            <SelectContent>
                                {(marchers ?? []).map((m) => (
                                    <SelectItem key={m.id} value={String(m.id)}>
                                        {m.name
                                            ? `${m.drill_number} ${m.name}`
                                            : m.drill_number}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
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
 * with the arrow keys, or scrubbed by dragging its label.
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
    } | null>(null);
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
            type="text"
            inputMode="decimal"
            value={draft}
            aria-label={label}
            data-testid={testId}
            className={clsx(
                "rounded-6 border-stroke bg-fg-2 text-body text-text focus:border-accent h-26 w-full min-w-0 border pl-6 text-right tabular-nums outline-hidden",
                !unit ? "pr-6" : unit.length > 1 ? "pr-32" : "pr-20",
            )}
            onChange={(event) => setDraft(event.target.value)}
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
    const scrubHandlers = {
        onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
            if (event.pointerType === "mouse" && event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture?.(event.pointerId);
            scrub.current = {
                startX: event.clientX,
                start: shown,
                last: shown,
            };
        },
        onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
            const s = scrub.current;
            if (!s) return;
            const k = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
            const v = round(
                clamp(s.start + (event.clientX - s.startX) * scrubPerPx * k),
                digits,
            );
            if (v === s.last) return;
            s.last = v;
            setDraft(String(v));
            onScrub(v);
        },
        onPointerUp: () => {
            const s = scrub.current;
            scrub.current = null;
            if (s && s.last !== s.start) onCommit(s.last);
        },
        onPointerCancel: () => {
            const s = scrub.current;
            scrub.current = null;
            if (s && s.last !== s.start) onCommit(s.last);
        },
    };

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
                {...scrubHandlers}
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

function round(v: number, digits: number): number {
    const k = 10 ** digits;
    return Math.round(v * k) / k || 0;
}
