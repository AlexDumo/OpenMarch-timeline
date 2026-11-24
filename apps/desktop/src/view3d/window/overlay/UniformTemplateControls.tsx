/**
 * The uniform template download under the band's uniform in the settings
 * panel (docs/3d/uniform-artwork.md, "Flats template", fork #1256): the
 * front and back flats page as PNG, SVG or PDF, and its regions as JSON for
 * scripts and agents. Shaped like the flag silk template's buttons; an
 * InfoTip says what the JSON is for, so a tap reaches it too.
 */
import { useState } from "react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@openmarch/ui";
import InfoTip from "@/components/ui/InfoTip";
import {
    UNIFORM_TEMPLATE_FORMATS,
    uniformTemplateFile,
    type UniformCanvas,
    type UniformCanvasContext,
    type UniformTemplateFormat,
} from "@/view3d/core/artworkTemplates/uniform";
import { saveFile } from "./saveFile";

/** An `OffscreenCanvas` for the template PNG. */
function offscreenCanvas(width: number, height: number): UniformCanvas {
    const canvas = new OffscreenCanvas(width, height);
    return {
        getContext: () =>
            canvas.getContext("2d") as UniformCanvasContext | null,
        encodePng: async () =>
            new Uint8Array(
                await (
                    await canvas.convertToBlob({ type: "image/png" })
                ).arrayBuffer(),
            ),
    };
}

export function UniformTemplateControls() {
    const { t } = useTranslate();
    const [busy, setBusy] = useState<UniformTemplateFormat | null>(null);
    const [problem, setProblem] = useState<string | null>(null);

    const download = async (format: UniformTemplateFormat) => {
        setBusy(format);
        setProblem(null);
        // let the busy label paint before the PNG is drawn
        await new Promise((resolve) => setTimeout(resolve, 30));
        try {
            const file = await uniformTemplateFile(format, offscreenCanvas);
            saveFile(file.name, file.mimeType, file.data);
        } catch (error) {
            console.error("3D View: couldn't make the uniform template", error);
            setProblem(t("view3d.uniformTemplate.failed"));
        } finally {
            setBusy(null);
        }
    };

    return (
        <div
            className="flex flex-col gap-6"
            data-testid="view3d-uniform-template"
        >
            <div className="flex flex-wrap items-center gap-6">
                <span className="text-sub text-text/60">
                    {t("view3d.uniformTemplate.label")}
                </span>
                {UNIFORM_TEMPLATE_FORMATS.map((format) => (
                    <Button
                        key={format}
                        variant="secondary"
                        size="compact"
                        disabled={busy !== null}
                        data-testid={`view3d-uniform-template-${format}`}
                        onClick={() => void download(format)}
                    >
                        {busy === format
                            ? t("view3d.uniformTemplate.preparing")
                            : format.toUpperCase()}
                    </Button>
                ))}
                <InfoTip
                    content={t("view3d.uniformTemplate.jsonInfo")}
                    label={t("view3d.uniformTemplate.jsonInfoLabel")}
                    side="bottom"
                />
            </div>
            {problem && (
                <p className="text-sub text-red" role="alert">
                    {problem}
                </p>
            )}
        </div>
    );
}
