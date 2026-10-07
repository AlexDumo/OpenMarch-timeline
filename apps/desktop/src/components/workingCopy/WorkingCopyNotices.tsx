import { useEffect, useRef, useState } from "react";
import { T, useTolgee } from "@tolgee/react";
import { toast } from "sonner";
import { WarningIcon } from "@phosphor-icons/react";
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogTitle,
    Button,
} from "@openmarch/ui";
import type { WorkingCopyConflictChoice } from "@om-electron/database/workingCopy/WorkingCopySession";
import { fileNameOf, useWorkingCopyStatus } from "@/hooks/useWorkingCopyStatus";

/**
 * Tells the user when a save to the show file didn't happen, and asks what
 * to do when the show changed on disk (docs/adr/0001).
 */
export default function WorkingCopyNotices() {
    const { t } = useTolgee();
    const status = useWorkingCopyStatus();
    const [busy, setBusy] = useState(false);
    const lastState = useRef<string | null>(null);

    const name = status ? fileNameOf(status.showPath) : "";
    const state = status?.state ?? null;

    useEffect(() => {
        if (!status || state === lastState.current) return;
        lastState.current = state;
        if (state === "deferred") {
            toast.warning(t("workingCopy.deferred", { name }), {
                id: "working-copy-save",
                description: status.message,
            });
        } else if (state === "readOnly") {
            toast.warning(t("workingCopy.readOnly", { name }), {
                id: "working-copy-save",
                duration: Infinity,
                action: {
                    label: t("workingCopy.saveAs"),
                    onClick: () => void window.electron.workingCopy.saveAs(),
                },
            });
        } else if (state === "saved") {
            toast.dismiss("working-copy-save");
        }
    }, [status, state, name, t]);

    const resolve = async (choice: WorkingCopyConflictChoice) => {
        setBusy(true);
        try {
            const outcome =
                await window.electron.workingCopy.resolveConflict(choice);
            if (!outcome.ok && !("cancelled" in outcome))
                toast.error(outcome.message);
        } catch (error) {
            toast.error(String(error));
        } finally {
            setBusy(false);
        }
    };

    const conflict = state === "conflict" ? status?.conflict : undefined;
    const missing = conflict?.reason === "missing";

    return (
        <AlertDialog open={!!conflict}>
            <AlertDialogContent>
                <div
                    className="flex flex-col gap-12"
                    data-testid="working-copy-conflict"
                >
                    <div className="flex items-center gap-8">
                        <WarningIcon size={24} className="text-yellow" />
                        <AlertDialogTitle>
                            {missing ? (
                                <T keyName="workingCopy.missing.title" />
                            ) : (
                                <T keyName="workingCopy.conflict.title" />
                            )}
                        </AlertDialogTitle>
                    </div>
                    <AlertDialogDescription>
                        {missing ? (
                            <T
                                keyName="workingCopy.missing.description"
                                params={{ name }}
                            />
                        ) : (
                            <T
                                keyName="workingCopy.conflict.description"
                                params={{ name }}
                            />
                        )}
                    </AlertDialogDescription>
                    <div className="flex flex-wrap justify-end gap-8">
                        {!missing && (
                            <Button
                                variant="secondary"
                                disabled={busy}
                                onClick={() => void resolve("keepTheirs")}
                            >
                                <T keyName="workingCopy.conflict.keepTheirs" />
                            </Button>
                        )}
                        <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => void resolve("saveCopy")}
                        >
                            <T keyName="workingCopy.conflict.saveCopy" />
                        </Button>
                        <Button
                            variant="primary"
                            disabled={busy}
                            onClick={() => void resolve("keepMine")}
                        >
                            {missing ? (
                                <T keyName="workingCopy.missing.saveHere" />
                            ) : (
                                <T keyName="workingCopy.conflict.keepMine" />
                            )}
                        </Button>
                    </div>
                </div>
            </AlertDialogContent>
        </AlertDialog>
    );
}
