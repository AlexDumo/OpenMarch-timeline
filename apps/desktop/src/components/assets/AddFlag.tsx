import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { T, useTranslate } from "@tolgee/react";
import { FlagIcon } from "@phosphor-icons/react";
import {
    Button,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTriggerButton,
} from "@openmarch/ui";
import { addShowFlagMutationOptions } from "@/hooks/queries/useShowFlags";
import { drawFlagPicture } from "@/showAssets/flagPicture";
import { flagNameOfFile } from "@/showAssets/flags";
import { deflate, readArtwork } from "@/showAssets/silkArtworkFile";
import {
    artworkTemplateFile,
    silkShapeSurface,
    type TemplateFormat,
} from "@/view3d/core/artworkTemplates";
import type { SilkArtworkImport } from "@/view3d/core/silkArtwork";
import {
    DEFAULT_SILK_SHAPE,
    SILK_SHAPE_IDS,
    silkShape,
    type SilkShapeId,
} from "@/view3d/core/sizes/silkShapes";
import { saveFile } from "@/view3d/window/overlay/saveFile";
import { useBytesUrl } from "@/components/items/modelImport/ModelImportReview";

const FORMATS: readonly TemplateFormat[] = ["png", "svg", "pdf"];

/**
 * Adds a flag to the show (fork #985): pick its silk shape, download that shape's template to
 * paint, choose the painted PNG, name it, and add it. The picture shows the silk as it will look,
 * cut to the shape. A show may have as many flags as it likes; each is handed to performers as
 * Equipment (the field's right-click menu, Equipment › Guard equipment).
 */
export function AddFlag({ onDone }: { onDone: () => void }) {
    const { t } = useTranslate();
    const queryClient = useQueryClient();
    const add = useMutation(addShowFlagMutationOptions(queryClient));
    const nameId = useId();
    const shapeId = useId();
    const input = useRef<HTMLInputElement>(null);
    const [shape, setShape] = useState<SilkShapeId>(DEFAULT_SILK_SHAPE);
    const [artwork, setArtwork] = useState<SilkArtworkImport | null>(null);
    const [name, setName] = useState("");
    const [picture, setPicture] = useState<Uint8Array | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [busy, setBusy] = useState<TemplateFormat | null>(null);
    const pictureUrl = useBytesUrl(picture ?? undefined, "image/png");

    // The picture again whenever the Artwork or the shape changes
    useEffect(() => {
        if (!artwork) {
            setPicture(null);
            return;
        }
        let live = true;
        drawFlagPicture(artwork.data, shape)
            .then((bytes) => {
                if (live) setPicture(bytes);
            })
            .catch((error: unknown) => {
                console.warn("Couldn't draw the flag's picture", error);
                if (live) setProblem(t("assets.flags.unreadable"));
            });
        return () => {
            live = false;
        };
    }, [artwork, shape, t]);

    const onPick = async (file: File | undefined) => {
        if (!file) return;
        setProblem(null);
        try {
            const result = await readArtwork(file);
            if (result === "notPng") setProblem(t("assets.flags.notPng"));
            else if (result === "tooLarge")
                setProblem(t("assets.flags.tooLarge"));
            else {
                setArtwork(result);
                // a name typed before keeps; otherwise the file's
                setName((typed) => typed || flagNameOfFile(file.name));
            }
        } catch (error) {
            console.warn("Couldn't read the picked PNG", error);
            setProblem(t("assets.flags.unreadable"));
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
            console.error("Couldn't make the flag template", error);
            setProblem(t("assets.flags.templateFailed"));
        } finally {
            setBusy(null);
        }
    };

    const trimmed = name.trim();
    const canAdd =
        !!artwork && !!picture && trimmed.length > 0 && !add.isPending;
    const addFlag = () => {
        if (!artwork || !picture || !trimmed) return;
        add.mutate(
            {
                name: trimmed,
                shape,
                artwork: artwork.data,
                width: artwork.width,
                height: artwork.height,
                thumbnail: picture,
            },
            { onSuccess: onDone },
        );
    };

    return (
        <section
            className="border-stroke rounded-6 flex flex-col gap-12 border p-12"
            aria-label={t("assets.flags.addTitle")}
            data-testid="assets-add-flag"
        >
            <h3 className="text-body font-medium">
                <T keyName="assets.flags.addTitle" />
            </h3>
            <div className="flex items-start gap-12">
                <span className="rounded-4 border-stroke bg-fg-2 flex h-96 w-96 shrink-0 items-center justify-center overflow-hidden border">
                    {pictureUrl ? (
                        <img
                            src={pictureUrl}
                            alt=""
                            draggable={false}
                            className="h-full w-full object-contain"
                            data-testid="assets-add-flag-picture"
                        />
                    ) : (
                        <FlagIcon
                            size={32}
                            className="text-text-subtitle"
                            aria-hidden
                        />
                    )}
                </span>
                <div className="flex min-w-0 grow flex-col gap-8">
                    <label
                        htmlFor={shapeId}
                        className="text-sub text-text-subtitle"
                    >
                        <T keyName="assets.flags.shape" />
                    </label>
                    <Select
                        value={shape}
                        onValueChange={(next) => setShape(next as SilkShapeId)}
                    >
                        <SelectTriggerButton
                            id={shapeId}
                            label={t(`view3d.silkShape.${shape}`)}
                            data-testid="assets-add-flag-shape"
                        />
                        <SelectContent>
                            {SILK_SHAPE_IDS.map((id) => (
                                <SelectItem key={id} value={id}>
                                    {t(`view3d.silkShape.${id}`)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <div className="flex flex-wrap items-center gap-6">
                        <span className="text-sub text-text-subtitle">
                            <T keyName="assets.flags.template" />
                        </span>
                        {FORMATS.map((format) => (
                            <Button
                                key={format}
                                variant="secondary"
                                size="compact"
                                disabled={busy !== null}
                                data-testid={`assets-add-flag-template-${format}`}
                                onClick={() => void download(format)}
                            >
                                {busy === format
                                    ? t("assets.flags.preparing")
                                    : format.toUpperCase()}
                            </Button>
                        ))}
                    </div>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-8">
                <Button
                    variant="secondary"
                    size="compact"
                    data-testid="assets-add-flag-choose"
                    onClick={() => input.current?.click()}
                >
                    {artwork
                        ? t("assets.flags.chooseAnother")
                        : t("assets.flags.choose")}
                </Button>
                {artwork && (
                    <span
                        className="text-sub text-text-subtitle min-w-0 truncate"
                        title={artwork.name}
                    >
                        {artwork.name}
                    </span>
                )}
                <input
                    ref={input}
                    type="file"
                    accept="image/png"
                    className="hidden"
                    data-testid="assets-add-flag-file"
                    onChange={(e) => {
                        void onPick(e.target.files?.[0]);
                        e.target.value = "";
                    }}
                />
            </div>
            <div className="flex flex-col gap-4">
                <label htmlFor={nameId} className="text-sub text-text-subtitle">
                    <T keyName="assets.flags.name" />
                </label>
                <Input
                    id={nameId}
                    value={name}
                    maxLength={200}
                    placeholder={t("assets.flags.namePlaceholder")}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && canAdd) addFlag();
                    }}
                    data-testid="assets-add-flag-name"
                />
            </div>
            {problem && (
                <p className="text-sub text-red" role="alert">
                    {problem}
                </p>
            )}
            <div className="flex justify-end gap-8">
                <Button
                    variant="secondary"
                    size="compact"
                    onClick={onDone}
                    data-testid="assets-add-flag-cancel"
                >
                    <T keyName="assets.flags.cancel" />
                </Button>
                <Button
                    variant="primary"
                    size="compact"
                    disabled={!canAdd}
                    onClick={addFlag}
                    data-testid="assets-add-flag-confirm"
                    title={
                        canAdd
                            ? undefined
                            : !artwork
                              ? t("assets.flags.needPicture")
                              : t("assets.flags.needName")
                    }
                >
                    <T keyName="assets.flags.add" />
                </Button>
            </div>
        </section>
    );
}
