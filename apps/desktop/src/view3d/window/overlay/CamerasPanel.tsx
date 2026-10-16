/**
 * The Cameras panel: the show's own camera list for this venue. Opened from
 * the camera menu ("Edit cameras…" or "Save current view"), it floats under
 * the camera menu so the viewer can move the view and save it.
 *
 * Each row is one camera, in menu order (the number is its key, and the
 * view opens on the first): go there, rename it, set it to the current
 * view, move it up or down, or remove it. "Add current view" saves where the
 * view is now. "Reset to defaults" puts the venue's own cameras back, after
 * asking.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslate } from "@tolgee/react";
import {
    ArrowCounterClockwiseIcon,
    ArrowDownIcon,
    ArrowUpIcon,
    CrosshairSimpleIcon,
    PlusIcon,
    TrashIcon,
    XIcon,
} from "@phosphor-icons/react";
import { Button, Input } from "@openmarch/ui";
import clsx from "clsx";
import { CAMERA_NAME_MAX, MAX_CAMERAS } from "@/view3d/core/cameraList";
import type { ViewCamera } from "@/view3d/core/cameraList";
import { useCameraStore } from "../camera/cameraStore";
import { ToggleButton } from "./Panel";
import { useCameraList, type CameraList } from "./useCameraList";

export function CamerasPanel({
    onClose,
    focusId,
    onFocused,
    className,
}: {
    onClose: () => void;
    /** A camera whose name field takes focus when it appears, to name it. */
    focusId: string | null;
    onFocused: () => void;
    className?: string;
}) {
    const { t } = useTranslate();
    const list = useCameraList();
    const activeCameraId = useCameraStore((s) => s.activeCameraId);
    const [confirmReset, setConfirmReset] = useState(false);
    useEffect(() => {
        if (!list.customized) setConfirmReset(false);
    }, [list.customized]);

    return (
        <section
            role="dialog"
            aria-label={t("view3d.cameras.title")}
            data-testid="view3d-cameras-panel"
            data-customized={list.customized}
            className={clsx(
                "border-stroke bg-modal backdrop-blur-32 rounded-6 shadow-modal text-text pointer-events-auto flex w-[22rem] max-w-full flex-col overflow-hidden border",
                className,
            )}
        >
            <header className="border-stroke flex items-center justify-between border-b py-6 pr-6 pl-12">
                <h2 className="text-body font-medium">
                    {t("view3d.cameras.title")}
                </h2>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={t("view3d.cameras.close")}
                    className="rounded-4 hover:bg-text/10 focus-visible:outline-accent flex size-28 items-center justify-center outline-hidden focus-visible:outline-2"
                >
                    <XIcon size={16} />
                </button>
            </header>
            <div className="flex min-h-0 flex-col gap-8 overflow-y-auto p-12">
                <p className="text-sub text-text/60">
                    {list.customized
                        ? t("view3d.cameras.hintCustomized")
                        : t("view3d.cameras.hintDefaults")}
                </p>
                {list.cameras.length === 0 ? (
                    <p
                        className="text-body text-text/60 py-8"
                        data-testid="view3d-cameras-empty"
                    >
                        {t("view3d.cameras.empty")}
                    </p>
                ) : (
                    <ol className="flex flex-col gap-2">
                        {list.cameras.map((camera, index) => (
                            <CameraRow
                                key={camera.id}
                                camera={camera}
                                index={index}
                                count={list.cameras.length}
                                active={camera.id === activeCameraId}
                                list={list}
                                focus={camera.id === focusId}
                                onFocused={onFocused}
                            />
                        ))}
                    </ol>
                )}
            </div>
            <footer className="border-stroke flex flex-col gap-8 border-t p-8">
                {confirmReset ? (
                    <div
                        className="flex flex-col gap-8 px-4"
                        data-testid="view3d-cameras-reset-confirm"
                    >
                        <p className="text-body">
                            {t("view3d.cameras.resetConfirm", {
                                count: list.defaultCount,
                            })}
                        </p>
                        <div className="flex justify-end gap-8">
                            <Button
                                variant="secondary"
                                size="compact"
                                onClick={() => setConfirmReset(false)}
                            >
                                {t("view3d.cameras.cancel")}
                            </Button>
                            <Button
                                variant="red"
                                size="compact"
                                data-testid="view3d-cameras-reset-yes"
                                onClick={() => {
                                    list.reset();
                                    setConfirmReset(false);
                                }}
                            >
                                {t("view3d.cameras.resetYes")}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-between gap-8">
                        <ToggleButton
                            onClick={() => list.addCurrentView()}
                            icon={<PlusIcon size={16} />}
                            label={t("view3d.cameras.addView")}
                            tooltip={
                                list.full
                                    ? t("view3d.cameras.full", {
                                          max: MAX_CAMERAS,
                                      })
                                    : t("view3d.cameras.addViewTooltip")
                            }
                            tooltipSide="top"
                            disabled={!list.ready || list.full}
                            testId="view3d-cameras-add"
                        />
                        <ToggleButton
                            onClick={() => setConfirmReset(true)}
                            icon={<ArrowCounterClockwiseIcon size={16} />}
                            label={t("view3d.cameras.reset")}
                            tooltip={
                                list.customized
                                    ? t("view3d.cameras.resetTooltip")
                                    : t("view3d.cameras.alreadyDefaults")
                            }
                            tooltipSide="top"
                            disabled={!list.ready || !list.customized}
                            testId="view3d-cameras-reset"
                        />
                    </div>
                )}
            </footer>
        </section>
    );
}

function CameraRow({
    camera,
    index,
    count,
    active,
    list,
    focus,
    onFocused,
}: {
    camera: ViewCamera;
    index: number;
    count: number;
    active: boolean;
    list: CameraList;
    focus: boolean;
    onFocused: () => void;
}) {
    const { t } = useTranslate();
    const selectCamera = useCameraStore((s) => s.selectCamera);
    const name = list.label(camera);
    const defaultName = camera.labelKey ? t(camera.labelKey) : undefined;

    return (
        <li
            className={clsx(
                "rounded-4 flex items-center gap-4 p-2",
                active && "bg-accent/10",
            )}
            data-testid="view3d-camera-row"
            data-value={camera.id}
            data-state={active ? "on" : "off"}
        >
            <button
                type="button"
                onClick={() => selectCamera(camera.id)}
                aria-label={t("view3d.cameras.goTo", { name })}
                title={t("view3d.cameras.goTo", { name })}
                className={clsx(
                    "rounded-4 border-stroke text-sub hover:bg-text/10 focus-visible:outline-accent flex size-28 shrink-0 items-center justify-center border font-mono outline-hidden focus-visible:outline-2",
                    active && "border-accent text-accent",
                )}
            >
                {index < 9 ? index + 1 : "·"}
            </button>
            <NameField
                value={name}
                placeholder={defaultName}
                focus={focus}
                onFocused={onFocused}
                onCommit={(next) =>
                    list.edit({ kind: "rename", id: camera.id, name: next })
                }
            />
            <ToggleButton
                onClick={() => list.setToCurrentView(camera.id)}
                icon={<CrosshairSimpleIcon size={16} />}
                label={t("view3d.cameras.setView")}
                tooltip={t("view3d.cameras.setViewTooltip")}
                iconOnly
                testId="view3d-camera-set-view"
            />
            <ToggleButton
                onClick={() =>
                    list.edit({ kind: "move", id: camera.id, by: -1 })
                }
                icon={<ArrowUpIcon size={14} />}
                label={t("view3d.cameras.moveUp")}
                tooltip={t("view3d.cameras.moveUp")}
                iconOnly
                disabled={index === 0}
                testId="view3d-camera-up"
            />
            <ToggleButton
                onClick={() =>
                    list.edit({ kind: "move", id: camera.id, by: 1 })
                }
                icon={<ArrowDownIcon size={14} />}
                label={t("view3d.cameras.moveDown")}
                tooltip={t("view3d.cameras.moveDown")}
                iconOnly
                disabled={index === count - 1}
                testId="view3d-camera-down"
            />
            <ToggleButton
                onClick={() => list.edit({ kind: "remove", id: camera.id })}
                icon={<TrashIcon size={16} />}
                label={t("view3d.cameras.remove")}
                tooltip={t("view3d.cameras.remove")}
                tooltipSide="left"
                iconOnly
                testId="view3d-camera-remove"
            />
        </li>
    );
}

/**
 * A camera's name. Saved on Enter or when focus leaves, so one rename is one
 * undo step; Esc puts the saved name back. Clearing a default camera's name
 * gives it back the venue's label.
 */
function NameField({
    value,
    placeholder,
    focus,
    onFocused,
    onCommit,
}: {
    value: string;
    placeholder?: string;
    focus: boolean;
    onFocused: () => void;
    onCommit: (name: string) => void;
}) {
    const { t } = useTranslate();
    const ref = useRef<HTMLInputElement>(null);
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    useEffect(() => {
        if (!focus || !ref.current) return;
        ref.current.focus();
        ref.current.select();
        onFocused();
    }, [focus, onFocused]);

    const commit = () => {
        const name = draft.trim();
        // A saved view always keeps a name.
        if (!name && !placeholder) setDraft(value);
        else if (name !== value) onCommit(name);
        else setDraft(value);
    };
    return (
        <Input
            ref={ref}
            compact
            value={draft}
            maxLength={CAMERA_NAME_MAX}
            placeholder={placeholder}
            aria-label={t("view3d.cameras.name")}
            data-testid="view3d-camera-name"
            className="hover:border-stroke focus:border-accent min-w-0 flex-1 border-transparent bg-transparent"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
                if (event.key === "Enter") {
                    event.currentTarget.blur();
                } else if (event.key === "Escape") {
                    setDraft(value);
                    event.preventDefault();
                }
            }}
        />
    );
}
