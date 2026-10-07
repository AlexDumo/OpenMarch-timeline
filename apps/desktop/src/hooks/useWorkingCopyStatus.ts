import { useEffect, useState } from "react";
import type { WorkingCopyStatus } from "@om-electron/database/workingCopy/WorkingCopySession";

/**
 * The save state of the open show when it's edited through a working copy
 * (docs/adr/0001), or null when the show is edited directly.
 */
export function useWorkingCopyStatus(): WorkingCopyStatus | null {
    const [status, setStatus] = useState<WorkingCopyStatus | null>(null);

    useEffect(() => {
        const api = window.electron.workingCopy;
        if (!api) return;
        let active = true;
        api.getStatus()
            .then((current) => {
                if (active) setStatus(current);
            })
            .catch(() => {
                // Hosts without working-copy support report nothing.
            });
        const unsubscribe = api.onStatus((next) => {
            if (active) setStatus(next.state === "closed" ? null : next);
        });
        return () => {
            active = false;
            unsubscribe();
        };
    }, []);

    return status;
}

/** The file name from a path, on any platform. */
export function fileNameOf(filePath: string): string {
    return filePath.split(/[/\\]/).filter(Boolean).pop() ?? filePath;
}
