/**
 * The Cameras panel: the show's camera list for this venue. Opened from the
 * camera menu ("Edit cameras…"), it floats under the camera menu so the
 * viewer can move the view and save it.
 *
 * - Each row is one camera, in menu order (the number is its key, and the
 *   view opens on the first): go there, rename it, set it to the current
 *   view, move it up or down, or remove it (with Undo for a few seconds).
 * - A row's settings button opens its exact settings (`CameraSettings.tsx`):
 *   follow a performer, position and aim, lens.
 * - "Add current view" saves where the view is now (following whoever the
 *   view follows); "Reset to defaults" puts the venue's own cameras back.
 * - "Export…" saves the venue's cameras as a JSON file; "Import…" replaces
 *   them with a file's (asking first, with Undo after).
 *
 * Camera edits are saved with the show but aren't undoable from the editor,
 * so anything that would throw away a list not saved anywhere else asks
 * first.
 */
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { useTranslate } from "@tolgee/react";
import {
    ArrowCounterClockwiseIcon,
    ArrowDownIcon,
    ArrowUpIcon,
    CopyIcon,
    CrosshairSimpleIcon,
    DownloadSimpleIcon,
    PersonSimpleWalkIcon,
    EyeIcon,
    PlusIcon,
    SlidersHorizontalIcon,
    UploadSimpleIcon,
    TrashIcon,
    XIcon,
} from "@phosphor-icons/react";
import { Button, Input } from "@openmarch/ui";
import clsx from "clsx";
import {
    CAMERA_NAME_MAX,
    MAX_CAMERAS,
    type SavedCamera,
    type VenueCameras,
    type ViewCamera,
} from "@/view3d/core/cameraList";
import {
    camerasFile,
    camerasFileName,
    parseCamerasFile,
} from "@/view3d/core/cameraSettings";
import { SEAT_FOV_DEG, seatAim } from "../camera/rigMath";
import { CameraSettings } from "./CameraSettings";
import { useCameraStore } from "../camera/cameraStore";
import { ToggleButton } from "./Panel";
import { useCameraList, type CameraList } from "./useCameraList";

/** How long "Removed … Undo" stays. */
const UNDO_MS = 8000;

interface Pending {
    message: string;
    confirm: string;
    run: () => void;
}

// eslint-disable-next-line max-lines-per-function
export function CamerasPanel({
    onClose,
    className,
}: {
    onClose: () => void;
    className?: string;
}) {
    const { t } = useTranslate();
    const list = useCameraList();
    const activeCameraId = useCameraStore((s) => s.activeCameraId);
    const [pending, setPending] = useState<Pending | null>(null);
    // A camera just added, whose name field takes focus to name it
    const [focusId, setFocusId] = useState<string | null>(null);
    const onFocused = useCallback(() => setFocusId(null), []);
    // A change that Undo can take back: a remove or an import.
    const [removed, setRemoved] = useState<{
        message: string;
        previous: VenueCameras | undefined;
    } | null>(null);
    // The camera whose settings are open.
    const [openId, setOpenId] = useState<string | null>(null);
    const [importError, setImportError] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!removed) return;
        const timer = setTimeout(() => setRemoved(null), UNDO_MS);
        return () => clearTimeout(timer);
    }, [removed]);
    // A new venue starts clean.
    useEffect(() => {
        setPending(null);
        setRemoved(null);
        setOpenId(null);
        setImportError(null);
    }, [list.kitId]);

    /** Back to the venue's defaults, asking first when the show has its own list. */
    const resetToDefaults = () => {
        setRemoved(null);
        if (list.customized)
            setPending({
                message: t("view3d.cameras.resetConfirm", {
                    count: list.defaultCount,
                }),
                confirm: t("view3d.cameras.replace"),
                run: list.chooseDefaults,
            });
        else list.chooseDefaults();
    };
    const remove = (camera: ViewCamera) => {
        setRemoved({
            message: t("view3d.cameras.removed", { name: list.label(camera) }),
            previous: list.venueCameras,
        });
        list.edit({ kind: "remove", id: camera.id });
    };

    const exportCameras = () => {
        if (!list.kitId) return;
        const file = camerasFile(
            // Where each camera actually looks, as the view shows it.
            list.cameras.map((camera) => ({ ...camera, ...seatAim(camera) })),
            list.kitId,
            list.label,
            SEAT_FOV_DEG,
        );
        downloadJson(JSON.stringify(file, null, 2), camerasFileName(undefined));
    };

    const importCameras = async (file: File) => {
        setImportError(null);
        let text: string;
        try {
            text = await file.text();
        } catch {
            setImportError(t("view3d.cameras.importUnreadable"));
            return;
        }
        const result = parseCamerasFile(text);
        if (!result.ok) {
            setImportError(
                result.reason === "invalid"
                    ? t("view3d.cameras.importInvalid")
                    : t("view3d.cameras.importNotCameras"),
            );
            return;
        }
        const replace = (cameras: SavedCamera[]) => {
            setRemoved({
                message: t("view3d.cameras.imported", {
                    count: cameras.length,
                }),
                previous: list.venueCameras,
            });
            setOpenId(null);
            list.replaceAll(cameras);
        };
        setRemoved(null);
        if (list.customized)
            setPending({
                message: t("view3d.cameras.importConfirm", {
                    count: result.cameras.length,
                }),
                confirm: t("view3d.cameras.replace"),
                run: () => replace(result.cameras),
            });
        else replace(result.cameras);
    };

    return (
        <section
            role="dialog"
            aria-label={t("view3d.cameras.title")}
            data-testid="view3d-cameras-panel"
            data-customized={list.customized}
            className={clsx(
                "border-stroke bg-modal backdrop-blur-32 rounded-6 shadow-modal text-text pointer-events-auto flex w-[24rem] max-w-full flex-col overflow-hidden border",
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
                                onRemove={() => remove(camera)}
                                onDuplicate={() => {
                                    const copy = list.duplicate(camera.id);
                                    if (!copy) return;
                                    // Ready to rename, with its settings open if the original's were.
                                    setFocusId(copy);
                                    setOpenId((id) =>
                                        id === camera.id ? copy : id,
                                    );
                                }}
                                focus={camera.id === focusId}
                                onFocused={onFocused}
                                settingsOpen={camera.id === openId}
                                onToggleSettings={() =>
                                    setOpenId((id) =>
                                        id === camera.id ? null : camera.id,
                                    )
                                }
                            />
                        ))}
                    </ol>
                )}
                <p className="text-sub text-text/60">
                    {t("view3d.cameras.hint")}
                </p>
            </div>
            <footer className="border-stroke flex flex-col gap-8 border-t p-8">
                {pending ? (
                    <Confirm
                        message={pending.message}
                        confirm={pending.confirm}
                        onCancel={() => setPending(null)}
                        onConfirm={() => {
                            pending.run();
                            setPending(null);
                        }}
                    />
                ) : (
                    <>
                        {removed && (
                            <div
                                className="text-body flex items-center justify-between gap-8 px-4"
                                data-testid="view3d-cameras-removed"
                            >
                                <span className="truncate">
                                    {removed.message}
                                </span>
                                <LinkButton
                                    onClick={() => {
                                        list.restore(removed.previous);
                                        setRemoved(null);
                                    }}
                                    testId="view3d-cameras-undo-remove"
                                >
                                    {t("view3d.cameras.undo")}
                                </LinkButton>
                            </div>
                        )}
                        <div className="flex items-center justify-between gap-8">
                            <ToggleButton
                                onClick={() =>
                                    setFocusId(list.addCurrentView())
                                }
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
                                onClick={resetToDefaults}
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
                        {importError && (
                            <p
                                role="alert"
                                className="text-sub text-red px-4"
                                data-testid="view3d-cameras-import-error"
                            >
                                {importError}
                            </p>
                        )}
                        <div className="flex items-center justify-between gap-8">
                            <ToggleButton
                                onClick={exportCameras}
                                icon={<DownloadSimpleIcon size={16} />}
                                label={t("view3d.cameras.export")}
                                tooltip={
                                    list.cameras.length === 0
                                        ? t("view3d.cameras.exportEmpty")
                                        : t("view3d.cameras.exportTooltip")
                                }
                                tooltipSide="top"
                                disabled={
                                    !list.ready || list.cameras.length === 0
                                }
                                testId="view3d-cameras-export"
                            />
                            <ToggleButton
                                onClick={() => fileInput.current?.click()}
                                icon={<UploadSimpleIcon size={16} />}
                                label={t("view3d.cameras.import")}
                                tooltip={t("view3d.cameras.importTooltip")}
                                tooltipSide="top"
                                disabled={!list.ready}
                                testId="view3d-cameras-import"
                            />
                            <input
                                ref={fileInput}
                                type="file"
                                accept=".json,application/json"
                                className="hidden"
                                data-testid="view3d-cameras-import-file"
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    event.target.value = "";
                                    if (file) void importCameras(file);
                                }}
                            />
                        </div>
                    </>
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
    onRemove,
    onDuplicate,
    focus,
    onFocused,
    settingsOpen,
    onToggleSettings,
}: {
    camera: ViewCamera;
    index: number;
    count: number;
    active: boolean;
    list: CameraList;
    onRemove: () => void;
    onDuplicate: () => void;
    focus: boolean;
    onFocused: () => void;
    settingsOpen: boolean;
    onToggleSettings: () => void;
}) {
    const { t } = useTranslate();
    const selectCamera = useCameraStore((s) => s.selectCamera);
    const name = list.label(camera);
    const defaultName = camera.labelKey ? t(camera.labelKey) : undefined;

    return (
        <li
            className={clsx(
                "rounded-4 flex flex-col p-2",
                active && "bg-accent/10",
                settingsOpen && "bg-text/5",
            )}
            data-testid="view3d-camera-row"
            data-value={camera.id}
            data-state={active ? "on" : "off"}
            data-follow={camera.follow?.mode ?? ""}
        >
            <div className="flex items-center gap-4">
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
                {camera.follow && (
                    <span
                        className="text-text/60 shrink-0"
                        title={
                            camera.follow.mode === "pov"
                                ? t("view3d.cameras.followsEyes")
                                : t("view3d.cameras.followsBehind")
                        }
                    >
                        {camera.follow.mode === "pov" ? (
                            <EyeIcon size={14} />
                        ) : (
                            <PersonSimpleWalkIcon size={14} />
                        )}
                    </span>
                )}
                <NameField
                    value={name}
                    placeholder={defaultName}
                    focus={focus}
                    onFocused={onFocused}
                    maxLength={CAMERA_NAME_MAX}
                    label={t("view3d.cameras.name")}
                    testId="view3d-camera-name"
                    onCommit={(next) =>
                        list.edit({ kind: "rename", id: camera.id, name: next })
                    }
                />
                <ToggleButton
                    onClick={onToggleSettings}
                    icon={<SlidersHorizontalIcon size={16} />}
                    label={t("view3d.cameras.settings")}
                    tooltip={t("view3d.cameras.settingsTooltip")}
                    iconOnly
                    pressed={settingsOpen}
                    testId="view3d-camera-settings-toggle"
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
                    onClick={onDuplicate}
                    icon={<CopyIcon size={16} />}
                    label={t("view3d.cameras.duplicate")}
                    tooltip={
                        list.full
                            ? t("view3d.cameras.full", { max: MAX_CAMERAS })
                            : t("view3d.cameras.duplicateTooltip")
                    }
                    iconOnly
                    disabled={!list.ready || list.full}
                    testId="view3d-camera-duplicate"
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
                    onClick={onRemove}
                    icon={<TrashIcon size={16} />}
                    label={t("view3d.cameras.remove")}
                    tooltip={t("view3d.cameras.remove")}
                    tooltipSide="left"
                    iconOnly
                    testId="view3d-camera-remove"
                />
            </div>
            {settingsOpen && <CameraSettings camera={camera} list={list} />}
        </li>
    );
}

function Confirm({
    message,
    confirm,
    onCancel,
    onConfirm,
}: {
    message: string;
    confirm: string;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    const { t } = useTranslate();
    return (
        <div
            className="flex flex-col gap-8 px-4"
            data-testid="view3d-cameras-confirm"
        >
            <p className="text-body">{message}</p>
            <div className="flex justify-end gap-8">
                <Button variant="secondary" size="compact" onClick={onCancel}>
                    {t("view3d.cameras.cancel")}
                </Button>
                <Button
                    variant="red"
                    size="compact"
                    data-testid="view3d-cameras-confirm-yes"
                    onClick={onConfirm}
                >
                    {confirm}
                </Button>
            </div>
        </div>
    );
}

function LinkButton({
    onClick,
    testId,
    children,
}: {
    onClick: () => void;
    testId?: string;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            data-testid={testId}
            className="text-sub text-accent focus-visible:outline-accent rounded-4 shrink-0 font-medium outline-hidden hover:underline focus-visible:outline-2"
        >
            {children}
        </button>
    );
}

/**
 * A name saved on Enter or when focus leaves, so one rename is one change;
 * Esc puts the saved name back. With a placeholder (a default camera's own
 * label), clearing the name gives the label back; without one, an empty
 * name is ignored.
 */
function NameField({
    value,
    placeholder,
    focus = false,
    onFocused,
    maxLength,
    label,
    testId,
    onCommit,
}: {
    value: string;
    placeholder?: string;
    focus?: boolean;
    onFocused?: () => void;
    maxLength: number;
    label: string;
    testId: string;
    onCommit: (name: string) => void;
}) {
    const ref = useRef<HTMLInputElement>(null);
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    useEffect(() => {
        if (!focus || !ref.current) return;
        ref.current.focus();
        ref.current.select();
        onFocused?.();
    }, [focus, onFocused]);

    const commit = () => {
        const name = draft.trim();
        if (!name && !placeholder) setDraft(value);
        else if (name !== value) onCommit(name);
        else setDraft(value);
    };
    return (
        <Input
            ref={ref}
            compact
            value={draft}
            maxLength={maxLength}
            placeholder={placeholder}
            aria-label={label}
            data-testid={testId}
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

/** Hands the viewer a file to save (a download in the browser, a save dialog in the app). */
function downloadJson(json: string, fileName: string) {
    const url = URL.createObjectURL(
        new Blob([json], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
