import {
    ArrowCounterClockwiseIcon,
    ArrowUUpLeftIcon,
    ArrowUUpRightIcon,
} from "@phosphor-icons/react";
import { useIsPreviewMode } from "@/stores/PreviewModeStore";
import { useQuery } from "@tanstack/react-query";
import {
    canRedoQueryOptions,
    canUndoQueryOptions,
    usePerformHistoryAction,
} from "@/hooks/queries/useHistory";
import { useDatabaseReady } from "@/hooks/useDatabaseReady";
import { isWebBuild } from "@/utilities/webBuild";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { LongPressBubble } from "@openmarch/ui";

/**
 * Undo or Redo with nothing to undo: greyed out, saying so on hover and when pressed, instead of
 * a button that does nothing (owner rule, 2026-11-16)
 */
function HistoryButton({
    can,
    label,
    reason,
    onRun,
    children,
}: {
    can: boolean | undefined;
    label: string;
    reason: string;
    onRun: () => void;
    children: React.ReactNode;
}) {
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
    const [open, setOpen] = useState(false);
    return (
        <>
            <button
                ref={setAnchor}
                aria-disabled={can ? undefined : true}
                onClick={() => (can ? onRun() : setOpen(true))}
                onPointerLeave={(e) => {
                    if (e.pointerType === "mouse") setOpen(false);
                }}
                aria-label={label}
                title={can ? label : `${label}: ${reason}`}
                className={`${buttonClassName} ${can ? "" : "cursor-not-allowed opacity-50 hover:text-inherit"}`}
            >
                {children}
            </button>
            <LongPressBubble
                anchor={anchor}
                open={open && !can}
                onClose={() => setOpen(false)}
            >
                {reason}
            </LongPressBubble>
        </>
    );
}

/** Icon buttons; a finger-sized hit area in touch mode, unchanged with a mouse. */
const buttonClassName =
    "hover:text-accent focus-visible:text-accent flex items-center justify-center outline-hidden duration-150 ease-out disabled:opacity-50 touch:size-44 touch:[&>svg]:size-24";

export default function FileControls() {
    const { t } = useTranslate();
    // Preview edits nothing, so it has nothing to undo
    const preview = useIsPreviewMode();
    const databaseReady = useDatabaseReady();
    const { data: canUndo } = useQuery(canUndoQueryOptions(databaseReady));
    const { data: canRedo } = useQuery(canRedoQueryOptions(databaseReady));
    const { mutate: performHistoryAction } = usePerformHistoryAction();

    return (
        <div className="titlebar-button touch:gap-0 flex w-fit items-center gap-8">
            {!preview && (
                <>
                    {/* The browser has its own reload. */}
                    {!isWebBuild && (
                        <button
                            onClick={() => window.location.reload()}
                            aria-label={t("titlebar.reload")}
                            title={t("titlebar.reload")}
                            className={buttonClassName}
                        >
                            <ArrowCounterClockwiseIcon size={18} />
                        </button>
                    )}
                    <HistoryButton
                        can={canUndo}
                        label={t("actions.edit.undo")}
                        reason={t("actions.edit.noUndoAvailable")}
                        onRun={() => performHistoryAction("undo")}
                    >
                        <ArrowUUpLeftIcon size={18} />
                    </HistoryButton>
                    <HistoryButton
                        can={canRedo}
                        label={t("actions.edit.redo")}
                        reason={t("actions.edit.noRedoAvailable")}
                        onRun={() => performHistoryAction("redo")}
                    >
                        <ArrowUUpRightIcon size={18} />
                    </HistoryButton>
                </>
            )}
        </div>
    );
}
