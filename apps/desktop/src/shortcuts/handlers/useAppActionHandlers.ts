import * as api from "@/api/api";
import { useDatabaseReady } from "@/hooks/useDatabaseReady";
import { useAppDialogStore, type ExportTab } from "@/stores/AppDialogStore";
import { EXPORT_ACTION_IDS } from "../definitions";
import { useActionHandler, useActionHandlerGroup } from "../useActionHandler";
import { isWebBuild } from "@/utilities/webBuild";

const WEB_EXPORT_ACTION_IDS = [
    "openExportDialog",
    "exportDrillCharts",
    "exportVideo",
] as const;

/** App-level commands: exporting and closing the show. */
export function useAppActionHandlers() {
    const databaseReady = useDatabaseReady();
    const openExport = useAppDialogStore((s) => s.openExport);

    useActionHandlerGroup(
        // On the web only drill charts and video work: coordinate sheets
        // need Electron's printToPDF, and mobile export needs sign-in.
        isWebBuild ? WEB_EXPORT_ACTION_IDS : EXPORT_ACTION_IDS,
        (id, args) =>
            openExport(
                isWebBuild
                    ? id === "exportDrillCharts"
                        ? "drill-charts"
                        : "video"
                    : (args?.tab as ExportTab | undefined),
            ),
        { enabled: databaseReady },
    );
    useActionHandler("closeFile", () => void api.closeCurrentFile(), {
        enabled: databaseReady,
    });
}
