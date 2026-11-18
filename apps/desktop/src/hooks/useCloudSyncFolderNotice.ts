/**
 * Warns when the show that just opened sits in a cloud-synced folder (OneDrive, iCloud Drive,
 * Dropbox, Google Drive, Box). Sync apps get in the way of saving, which can leave a file behind
 * that stops the show from opening (`electron/main/cloudSyncFolder.ts`). "Don't warn for this
 * show" remembers the show on this computer.
 */
import { useEffect } from "react";
import { toast } from "sonner";
import tolgee from "@/global/singletons/Tolgee";
import { siteUrl } from "@/global/siteUrl";

export const SYNC_FOLDER_GUIDE_URL = siteUrl(
    "/troubleshooting/file-errors/#a-show-in-a-synced-folder",
);

/** How long the warning stays: long enough to read two sentences and pick a button. */
const NOTICE_DURATION_MS = 20_000;

const DISMISSED_KEY = "openmarch:syncFolderNoticeDismissed";

function dismissedShows(): string[] {
    try {
        const stored: unknown = JSON.parse(
            localStorage.getItem(DISMISSED_KEY) ?? "[]",
        );
        return Array.isArray(stored)
            ? stored.filter((p): p is string => typeof p === "string")
            : [];
    } catch {
        return [];
    }
}

function dismissShow(filePath: string) {
    try {
        const shows = dismissedShows();
        if (!shows.includes(filePath))
            localStorage.setItem(
                DISMISSED_KEY,
                JSON.stringify([...shows, filePath]),
            );
    } catch {
        // Not remembered; it warns again next time.
    }
}

export function useCloudSyncFolderNotice(databaseIsReady: boolean) {
    useEffect(() => {
        if (!databaseIsReady) return;
        let unmounted = false;
        void window.electron
            .getCloudSyncFolder?.()
            .then((folder) => {
                if (unmounted || !folder) return;
                if (dismissedShows().includes(folder.filePath)) return;
                toast.warning(
                    tolgee.t("syncFolderNotice.title", {
                        service: folder.service,
                    }),
                    {
                        id: "sync-folder-notice",
                        description: tolgee.t("syncFolderNotice.description"),
                        duration: NOTICE_DURATION_MS,
                        action: {
                            label: tolgee.t("syncFolderNotice.learnMore"),
                            onClick: () =>
                                window.electron.openExternal(
                                    SYNC_FOLDER_GUIDE_URL,
                                ),
                        },
                        cancel: {
                            label: tolgee.t("syncFolderNotice.stopWarning"),
                            onClick: () => dismissShow(folder.filePath),
                        },
                    },
                );
            })
            .catch(() => {});
        return () => {
            unmounted = true;
        };
    }, [databaseIsReady]);
}
