import { useRef } from "react";
import { toast } from "sonner";
import { Button } from "@openmarch/ui";
import { T, useTolgee } from "@tolgee/react";
import { useTimingObjects } from "@/hooks";
import { useImportMusicXml } from "./MusicXmlImport";
import { useMusicXmlChecksStore } from "@/stores/MusicXmlChecksStore";

export default function MusicXmlSelector() {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { t } = useTolgee();
    const { measures, pages: allPages, beats: allBeats } = useTimingObjects();

    const importMusicXmlMutation = useImportMusicXml();

    // XML import handler
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!allPages || !allBeats) {
            toast.error("Failed to fetch required data");
            return;
        }

        const result = await importMusicXmlMutation.mutateAsync({
            file,
            allPages,
            measures,
            allBeats,
        });

        if (result.success) {
            const { checks } = result;
            useMusicXmlChecksStore.getState().setChecks(file.name, checks);
            if (checks.length === 0) toast.success(result.message);
            else
                // Kept until dismissed: the list says what to check in the score
                toast.warning(result.message, {
                    description: t("music.importChecksCount", {
                        count: checks.length,
                    }),
                    duration: Infinity,
                    action: {
                        label: t("music.importChecksShow"),
                        onClick: () =>
                            useMusicXmlChecksStore.getState().setOpen(true),
                    },
                });
        }

        // Clear the file input
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    return (
        <div className="mt-8 flex items-center gap-8 px-12">
            <label className="text-body text-text/80 w-full">
                <T keyName="music.importLabel" />
            </label>
            <input
                ref={fileInputRef}
                type="file"
                accept=".xml,.musicxml,.mxl"
                className="hidden"
                onChange={handleFileChange}
            />
            <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={importMusicXmlMutation.isPending}
                className="whitespace-nowrap"
            >
                {importMusicXmlMutation.isPending
                    ? t("music.importing")
                    : t("music.importButton")}
            </Button>
        </div>
    );
}
