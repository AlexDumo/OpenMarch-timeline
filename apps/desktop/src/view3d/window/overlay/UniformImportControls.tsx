/**
 * Importing the band's own uniform from flats, beside the uniform template download (fork #1257;
 * docs/3d/uniform-artwork.md, "Ways in"): a page-size PNG, an SVG, or a uniform file saved from a
 * show. The import is checked and turned into a uniform pack here (images decode in the uniform
 * pack worker), then sent to the editor, which stores it in the show and dresses the band in it
 * with undo. Save uniform file writes the pack the band wears back out as its portable file.
 *
 * A preview, like the sample flats: only with Custom uniforms (preview) on (`useCustomUniforms`).
 * A line under the buttons says uniform files may change, and the first import or save on a
 * computer says it once more as a note.
 */
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { Button } from "@openmarch/ui";
import { touchSafeAccept } from "@/utilities/fileAccept";
import {
    uniformPackQueryOptions,
    keepSameUniform,
    uniformPacksQueryOptions,
} from "@/hooks/queries/useUniformPack";
import {
    UNIFORM_PRESETS,
    uniformPresetOf,
    type UniformPresetId,
} from "@/view3d/core/marchers/uniformPresets";
import {
    flatsArtworkOf,
    isUniformPackValue,
} from "@/view3d/core/marchers/uniformArtwork";
import {
    ASSET_FILE_EXTENSION,
    ASSET_FILE_MIME,
    FLATS_PAGE_PX,
    uniformPackFileName,
} from "@/view3d/core/uniformPack/format";
import { useCustomUniforms } from "@/view3d/window/uniformArtworkPreview";
import { PreviewWarningLine, useFirstUseWarning } from "./UniformPreview";
import { loadFlatsGeometry } from "@/view3d/window/performers/marchers/flatsAtlas";
import {
    UniformImportError,
    importUniformFile,
    type UniformImport,
} from "@/view3d/window/uniformPack/importUniform";
import {
    UniformPackStoreError,
    storeUniformPack,
} from "@/view3d/window/uniformPack/storeUniformPack";
import { saveFile } from "./saveFile";
import { useVenueRequest } from "./VenueControls";

const ACCEPT = `image/png,image/svg+xml,.png,.svg,${ASSET_FILE_EXTENSION}`;

export function UniformImportControls() {
    const { t } = useTranslate();
    const { settings } = useVenueRequest();
    const customUniforms = useCustomUniforms();
    const firstUse = useFirstUseWarning();
    const input = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const [done, setDone] = useState<{
        result: UniformImport;
        /** The band preset whose colors the clear parts take */
        preset: UniformPresetId;
    } | null>(null);

    const worn = flatsArtworkOf(settings?.uniformArtwork);
    const wornPack = worn && isUniformPackValue(worn) ? worn : null;
    const { data: pack } = useQuery({
        ...uniformPackQueryOptions(wornPack),
        // an item edit's save moves the band to a new version: keep Save uniform file meanwhile
        placeholderData: keepSameUniform(wornPack),
    });
    const { data: packs } = useQuery(uniformPacksQueryOptions());

    if (!customUniforms) return null;

    const refusal = (error: unknown): string => {
        const code =
            error instanceof UniformImportError ? error.code : "unreadable";
        return t(`view3d.uniformImport.refused.${code}`);
    };

    const onPick = async (file: File | undefined) => {
        if (!file || !settings) return;
        setBusy(true);
        setProblem(null);
        setDone(null);
        try {
            const { regions } = await loadFlatsGeometry();
            const preset = uniformPresetOf(settings.uniforms);
            const look = UNIFORM_PRESETS[preset].band;
            const result = await importUniformFile(file, look, regions);
            // the band wears it once the editor has stored it
            await storeUniformPack(result.pack);
            setDone({ result, preset });
            firstUse.notice();
        } catch (error) {
            console.warn("3D View: couldn't import the uniform", error);
            setProblem(
                error instanceof UniformPackStoreError
                    ? t("view3d.uniformImport.storeFailed")
                    : refusal(error),
            );
        } finally {
            setBusy(false);
        }
    };

    const noteText = ({ result, preset }: NonNullable<typeof done>): string[] =>
        result.notes.map((note) =>
            note === "scaled"
                ? t("view3d.uniformImport.note.scaled", {
                      width: result.scaledFrom?.width ?? 0,
                      height: result.scaledFrom?.height ?? 0,
                      templateWidth: FLATS_PAGE_PX.width,
                      templateHeight: FLATS_PAGE_PX.height,
                  })
                : note === "palette"
                  ? t("view3d.uniformImport.note.palette", {
                        preset: t(`view3d.uniformPreset.${preset}`),
                    })
                  : t(`view3d.uniformImport.note.${note}`),
        );

    // greyed out only until the show's settings have loaded; it says so
    const importReason = settings
        ? null
        : t("view3d.uniformImport.importNeedsSettings");
    // nothing to save yet, or one to pick first: each says so
    const saveReason = pack
        ? null
        : packs && packs.length > 0
          ? t("view3d.uniformImport.saveNeedsImported")
          : t("view3d.uniformImport.saveNeedsImport");
    const save = () => {
        if (!pack) {
            setProblem(saveReason);
            return;
        }
        saveFile(uniformPackFileName(pack.name), ASSET_FILE_MIME, pack.bytes);
        firstUse.notice();
    };

    return (
        <div
            className="flex flex-col gap-6"
            data-testid="view3d-uniform-import"
        >
            <div className="flex flex-wrap items-center gap-6">
                <Button
                    variant="secondary"
                    size="compact"
                    disabled={busy}
                    aria-disabled={!settings || undefined}
                    tooltipText={importReason ?? undefined}
                    className={
                        settings ? undefined : "cursor-not-allowed opacity-50"
                    }
                    data-testid="view3d-uniform-import-button"
                    onClick={() => {
                        if (importReason) setProblem(importReason);
                        else input.current?.click();
                    }}
                >
                    {busy
                        ? t("view3d.uniformImport.importing")
                        : t("view3d.uniformImport.import")}
                </Button>
                <Button
                    variant="secondary"
                    size="compact"
                    aria-disabled={!pack || undefined}
                    tooltipText={saveReason ?? undefined}
                    className={
                        pack ? undefined : "cursor-not-allowed opacity-50"
                    }
                    data-testid="view3d-uniform-save"
                    onClick={save}
                >
                    {t("view3d.uniformImport.save")}
                </Button>
                <input
                    ref={input}
                    type="file"
                    accept={touchSafeAccept(ACCEPT)}
                    className="hidden"
                    aria-hidden
                    data-testid="view3d-uniform-import-file"
                    onChange={(e) => {
                        void onPick(e.target.files?.[0]);
                        e.target.value = "";
                    }}
                />
            </div>
            <p className="text-sub text-text/60">
                {t("view3d.uniformImport.hint")}
            </p>
            <PreviewWarningLine />
            {firstUse.note}
            {done && (
                <div
                    className="text-sub flex flex-col gap-2"
                    role="status"
                    data-testid="view3d-uniform-import-notes"
                >
                    <span>
                        {t("view3d.uniformImport.imported", {
                            name: done.result.name,
                        })}
                    </span>
                    {noteText(done).map((note) => (
                        <span key={note} className="text-text/60">
                            {note}
                        </span>
                    ))}
                </div>
            )}
            {problem && (
                <p className="text-sub text-red" role="alert">
                    {problem}
                </p>
            )}
        </div>
    );
}
