/**
 * Importing the band's own uniform from flats, beside the uniform template download (fork #1257;
 * docs/3d/uniform-artwork.md, "Ways in"): a page-size PNG, an SVG, or a uniform file saved from a
 * show. The import is checked and turned into a uniform pack here (images decode in the uniform
 * pack worker), then sent to the editor, which stores it in the show and dresses the band in it
 * with undo. Save uniform file writes the pack the band wears back out as its portable file.
 *
 * A preview, like the sample flats: only where `uniformArtworkAvailable()`.
 */
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { Button } from "@openmarch/ui";
import { touchSafeAccept } from "@/utilities/fileAccept";
import { uniformPackQueryOptions } from "@/hooks/queries/useUniformPack";
import {
    UNIFORM_PRESETS,
    uniformPresetOf,
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
import { uniformArtworkAvailable } from "@/view3d/window/uniformArtworkPreview";
import { loadFlatsGeometry } from "@/view3d/window/performers/marchers/flatsAtlas";
import {
    UniformImportError,
    importUniformFile,
    type UniformImport,
} from "@/view3d/window/uniformPack/importUniform";
import { saveFile } from "./saveFile";
import { useVenueRequest } from "./VenueControls";

const ACCEPT = `image/png,image/svg+xml,.png,.svg,${ASSET_FILE_EXTENSION}`;

export function UniformImportControls() {
    const { t } = useTranslate();
    const { settings } = useVenueRequest();
    const input = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const [done, setDone] = useState<UniformImport | null>(null);

    const worn = flatsArtworkOf(settings?.uniformArtwork);
    const wornPack = worn && isUniformPackValue(worn) ? worn : null;
    const { data: pack } = useQuery(uniformPackQueryOptions(wornPack));

    if (!uniformArtworkAvailable()) return null;

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
            const look =
                UNIFORM_PRESETS[uniformPresetOf(settings.uniforms)].band;
            const result = await importUniformFile(file, look, regions);
            window.view3d.requestUniformPack(result.pack);
            setDone(result);
        } catch (error) {
            console.warn("3D View: couldn't import the uniform", error);
            setProblem(refusal(error));
        } finally {
            setBusy(false);
        }
    };

    const noteText = (result: UniformImport): string[] =>
        result.notes.map((note) =>
            note === "scaled"
                ? t("view3d.uniformImport.note.scaled", {
                      width: result.scaledFrom?.width ?? 0,
                      height: result.scaledFrom?.height ?? 0,
                      templateWidth: FLATS_PAGE_PX.width,
                      templateHeight: FLATS_PAGE_PX.height,
                  })
                : t(`view3d.uniformImport.note.${note}`),
        );

    const saveReason = pack
        ? null
        : t("view3d.uniformImport.saveNeedsImported");
    const save = () => {
        if (!pack) {
            setProblem(saveReason);
            return;
        }
        saveFile(uniformPackFileName(pack.name), ASSET_FILE_MIME, pack.bytes);
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
                    disabled={busy || !settings}
                    data-testid="view3d-uniform-import-button"
                    onClick={() => input.current?.click()}
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
            {done && (
                <div
                    className="text-sub flex flex-col gap-2"
                    role="status"
                    data-testid="view3d-uniform-import-notes"
                >
                    <span>
                        {t("view3d.uniformImport.imported", {
                            name: done.name,
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
