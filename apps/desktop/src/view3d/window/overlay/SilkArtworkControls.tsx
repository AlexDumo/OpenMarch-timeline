/**
 * The guard's flag silk Artwork in the settings panel (fork #973): download
 * the template for the show's silk shape, paint it, import the PNG. The
 * import goes to the editor (`window.view3d.requestSilkArtwork`), which
 * stores it in the show with undo; the relayed invalidation brings it back
 * here and onto the silks.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { Button } from "@openmarch/ui";
import { silkArtworkQueryOptions } from "@/hooks/queries/useSilkArtwork";
import {
    artworkTemplateFile,
    silkShapeSurface,
    type TemplateFormat,
} from "@/view3d/core/artworkTemplates";
import { deflate, readArtwork } from "@/showAssets/silkArtworkFile";
import { silkShape, silkShapeOf } from "@/view3d/core/sizes/silkShapes";
import { saveFile } from "./saveFile";
import { useVenueRequest } from "./VenueControls";

const FORMATS: readonly TemplateFormat[] = ["png", "svg", "pdf"];

/** An object URL for the stored PNG, revoked when it changes or unmounts. */
function usePngUrl(data: Uint8Array | undefined): string | null {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!data) {
            setUrl(null);
            return;
        }
        const next = URL.createObjectURL(
            new Blob([data as Uint8Array<ArrayBuffer>], { type: "image/png" }),
        );
        setUrl(next);
        return () => URL.revokeObjectURL(next);
    }, [data]);
    return url;
}

export function SilkArtworkControls() {
    const { t } = useTranslate();
    const { settings } = useVenueRequest();
    const shape = silkShapeOf(settings?.silkShape);
    const { data: artwork } = useQuery(
        silkArtworkQueryOptions(settings?.silkArtwork),
    );
    const input = useRef<HTMLInputElement>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [busy, setBusy] = useState<TemplateFormat | null>(null);

    // the stored PNG as a picture beside its name
    const preview = usePngUrl(artwork?.data);

    const onPick = async (file: File | undefined) => {
        if (!file) return;
        setProblem(null);
        try {
            const result = await readArtwork(file);
            if (result === "notPng") setProblem(t("view3d.silkArtwork.notPng"));
            else if (result === "tooLarge")
                setProblem(t("view3d.silkArtwork.tooLarge"));
            else window.view3d.requestSilkArtwork(result);
        } catch (error) {
            console.warn("3D View: couldn't read the picked PNG", error);
            setProblem(t("view3d.silkArtwork.unreadable"));
        }
    };

    const download = async (format: TemplateFormat) => {
        setBusy(format);
        // let the busy label paint before the PNG is drawn
        await new Promise((resolve) => setTimeout(resolve, 30));
        try {
            const file = await artworkTemplateFile(
                silkShapeSurface(silkShape(shape)),
                format,
                deflate,
            );
            saveFile(file.name, file.mimeType, file.data);
        } catch (error) {
            console.error("3D View: couldn't make the template", error);
            setProblem(t("view3d.silkArtwork.templateFailed"));
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="flex flex-col gap-8" data-testid="view3d-silk-artwork">
            {artwork && preview ? (
                <div className="flex items-center gap-8">
                    <img
                        src={preview}
                        alt=""
                        className="border-stroke rounded-4 h-40 max-w-80 border object-contain"
                    />
                    <span
                        className="text-sub min-w-0 truncate"
                        title={artwork.name}
                        data-testid="view3d-silk-artwork-name"
                    >
                        {artwork.name}
                    </span>
                </div>
            ) : (
                <p className="text-sub text-text/60">
                    {t("view3d.silkArtwork.none")}
                </p>
            )}
            <div className="flex flex-wrap gap-6">
                <Button
                    variant="secondary"
                    size="compact"
                    data-testid="view3d-silk-artwork-import"
                    onClick={() => input.current?.click()}
                >
                    {artwork
                        ? t("view3d.silkArtwork.replace")
                        : t("view3d.silkArtwork.import")}
                </Button>
                {artwork && (
                    <Button
                        variant="secondary"
                        size="compact"
                        data-testid="view3d-silk-artwork-remove"
                        onClick={() => window.view3d.requestSilkArtwork(null)}
                    >
                        {t("view3d.silkArtwork.remove")}
                    </Button>
                )}
                <input
                    ref={input}
                    type="file"
                    accept="image/png"
                    className="hidden"
                    data-testid="view3d-silk-artwork-file"
                    onChange={(e) => {
                        void onPick(e.target.files?.[0]);
                        e.target.value = "";
                    }}
                />
            </div>
            <div className="flex flex-wrap items-center gap-6">
                <span className="text-sub text-text/60">
                    {t("view3d.silkArtwork.template", {
                        shape: t(`view3d.silkShape.${shape}`),
                    })}
                </span>
                {FORMATS.map((format) => (
                    <Button
                        key={format}
                        variant="secondary"
                        size="compact"
                        disabled={busy !== null}
                        data-testid={`view3d-silk-template-${format}`}
                        onClick={() => void download(format)}
                    >
                        {busy === format
                            ? t("view3d.silkArtwork.preparing")
                            : format.toUpperCase()}
                    </Button>
                ))}
            </div>
            {problem && (
                <p className="text-sub text-red" role="alert">
                    {problem}
                </p>
            )}
        </div>
    );
}
