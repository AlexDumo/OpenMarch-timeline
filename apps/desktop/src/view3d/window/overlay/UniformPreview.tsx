/**
 * The custom-uniform preview's labels and warnings (docs/3d/uniform-artwork.md, "Opt-in
 * preview"): the Custom uniforms (preview) switch in Preferences, the Preview badge on each
 * uniform section, the "uniform files may change" line under Import uniform… and Save uniform
 * file, and the same warning once as a note after the first import or save on this computer.
 */
import { useState, type ReactNode } from "react";
import { useTranslate } from "@tolgee/react";
import { Badge, Button, Switch } from "@openmarch/ui";
import {
    markPreviewWarningShown,
    previewWarningShown,
    useCustomUniformsStore,
} from "@/view3d/window/uniformArtworkPreview";

/** "Preview", beside a uniform section's name. */
export function PreviewBadge() {
    const { t } = useTranslate();
    return (
        <Badge
            variant="secondary"
            className="rounded-full"
            data-testid="view3d-uniform-preview-badge"
        >
            {t("view3d.uniformPreview.badge")}
        </Badge>
    );
}

/** A uniform section's name with the Preview badge. */
export function PreviewTitle({ children }: { children: ReactNode }) {
    return (
        <span className="text-body flex items-center gap-6">
            {children}
            <PreviewBadge />
        </span>
    );
}

/**
 * The Preferences switch, with what it shows and that the format may change; none in a build
 * without custom uniforms (a release, until the format is final).
 */
export function CustomUniformsRow() {
    const { t } = useTranslate();
    const available = useCustomUniformsStore((s) => s.available);
    const enabled = useCustomUniformsStore((s) => s.enabled);
    const setEnabled = useCustomUniformsStore((s) => s.setEnabled);
    const label = t("view3d.settings.customUniforms");
    if (!available) return null;
    return (
        <div className="flex flex-col gap-6">
            <div className="flex min-h-28 items-center justify-between gap-12">
                <span className="text-body">{label}</span>
                <Switch
                    checked={enabled}
                    onCheckedChange={setEnabled}
                    aria-label={label}
                    data-testid="view3d-custom-uniforms-toggle"
                />
            </div>
            <p className="text-sub text-text/60">
                {t("view3d.settings.customUniformsDescription")}
            </p>
        </div>
    );
}

/** The line under Import uniform… and Save uniform file. */
export function PreviewWarningLine() {
    const { t } = useTranslate();
    return (
        <p
            className="text-sub text-text/60"
            data-testid="view3d-uniform-preview-warning"
        >
            {t("view3d.uniformPreview.warning")}
        </p>
    );
}

/**
 * The warning once per computer, after the first import or save: `notice()` shows it if it
 * hasn't shown before (and records that it has), `note` is the note to render, if any.
 */
export function useFirstUseWarning(storage?: Storage) {
    const [open, setOpen] = useState(false);
    const notice = () => {
        if (previewWarningShown(storage)) return;
        markPreviewWarningShown(storage);
        setOpen(true);
    };
    const note = open ? (
        <FirstUseNote onDismiss={() => setOpen(false)} />
    ) : null;
    return { notice, note };
}

function FirstUseNote({ onDismiss }: { onDismiss: () => void }) {
    const { t } = useTranslate();
    return (
        <div
            role="status"
            className="border-stroke bg-fg-2 rounded-6 text-sub flex flex-col items-start gap-6 border p-8"
            data-testid="view3d-uniform-preview-note"
        >
            <span>{t("view3d.uniformPreview.warning")}</span>
            <Button
                variant="secondary"
                size="compact"
                onClick={onDismiss}
                data-testid="view3d-uniform-preview-note-dismiss"
            >
                {t("view3d.uniformPreview.dismiss")}
            </Button>
        </div>
    );
}
