import { useMemo } from "react";
import { useTranslate } from "@tolgee/react";
import { getButtonClassName } from "@openmarch/ui";
import { WarningIcon } from "@phosphor-icons/react";
import ActionButton from "@/shortcuts/ActionButton";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { performersOnly } from "@/global/classes/Marcher";
import { useQuery } from "@tanstack/react-query";
import { fieldPropertiesQueryOptions } from "@/hooks/queries/useFieldProperties";
import { frameCorners } from "../frame/frame";
import { placedOf } from "../placed/placedBox";
import {
    pictureFit,
    pictureSummary,
    type CopiedPicture,
    type PictureFit,
    type PictureSummary,
} from "./picture";
import { useCopiedPictureStore } from "./pictureStore";

/**
 * The inspector's Clipboard card (#961, owner 2026-11-15): what Copy kept, so it's plain before
 * pasting whether any number of marchers can take it or how many to select. A small picture of
 * it, what it is ("Box", "Positions") and how many marchers, a line saying how it fits the
 * selection now, and Paste and Paste in place. Shown once something is copied.
 */
export function ClipboardSection() {
    const { t } = useTranslate();
    const picture = useCopiedPictureStore((s) => s.picture);
    const { data: fieldProperties } = useQuery(fieldPropertiesQueryOptions());
    const selectedMarchers = useSelectedMarchers()?.selectedMarchers ?? [];
    const selected = performersOnly(selectedMarchers).length;
    const stepPx = fieldProperties?.pixelsPerStep;
    const summary = useMemo(
        () => (picture && stepPx ? pictureSummary(picture, stepPx) : null),
        [picture, stepPx],
    );
    if (!picture || !summary) return null;
    const fit = pictureFit(summary, selected);
    const name = summary.kind?.shape.label ?? t("shapes.clipboard.positions");
    return (
        <div className="flex flex-col gap-8" data-testid="clipboard-section">
            <h5 className="text-h5">{t("shapes.clipboard.title")}</h5>
            <div className="flex items-center gap-12">
                <PicturePreview picture={picture} summary={summary} />
                <div className="flex min-w-0 flex-col">
                    <span
                        className="text-body font-medium"
                        data-testid="clipboard-kind"
                    >
                        {name}
                    </span>
                    <span
                        className="text-sub text-text-subtitle"
                        data-testid="clipboard-count"
                    >
                        {t("shapes.clipboard.marchers", {
                            count: summary.count,
                        })}
                    </span>
                </div>
            </div>
            <p className="text-sub" data-testid="clipboard-rule">
                {summary.anyNumber
                    ? t("shapes.clipboard.anyNumber")
                    : t("shapes.clipboard.fixed", { count: summary.count })}
            </p>
            <FitLine fit={fit} />
            <div className="flex flex-wrap gap-8">
                <ActionButton
                    action="pasteFormation"
                    data-testid="clipboard-paste"
                    className={getButtonClassName({
                        variant: "secondary",
                        size: "compact",
                    })}
                >
                    <span className="text-body">{t("actions.edit.paste")}</span>
                </ActionButton>
                <ActionButton
                    action="pasteFormationInPlace"
                    data-testid="clipboard-paste-in-place"
                    className={getButtonClassName({
                        variant: "secondary",
                        size: "compact",
                    })}
                >
                    <span className="text-body">
                        {t("actions.edit.pasteInPlace")}
                    </span>
                </ActionButton>
            </div>
        </div>
    );
}

/** How the copied picture fits the marchers selected now; nothing with none selected */
function FitLine({ fit }: { fit: PictureFit }) {
    const { t } = useTranslate();
    if (fit.fit === "none") return null;
    const mismatch = fit.fit === "emptySpots" || fit.fit === "leftOut";
    const text =
        fit.fit === "laidOut"
            ? t("shapes.clipboard.fitLaidOut", { count: fit.selected })
            : fit.fit === "exact"
              ? t("shapes.clipboard.fitExact", { count: fit.selected })
              : fit.fit === "emptySpots"
                ? t("shapes.clipboard.fitEmptySpots", {
                      count: fit.empty,
                      selected: fit.selected,
                  })
                : t("shapes.clipboard.fitLeftOut", { count: fit.left });
    return (
        <p
            className="text-sub text-text-subtitle flex items-start gap-4"
            data-testid="clipboard-fit"
            data-fit={fit.fit}
        >
            {mismatch && (
                <WarningIcon
                    size={14}
                    weight="fill"
                    className="text-yellow mt-2 shrink-0"
                    aria-hidden
                />
            )}
            <span>{text}</span>
        </p>
    );
}

/** The picture's box, in CSS pixels */
const VIEW = { width: 72, height: 52 } as const;
/** Room kept clear inside the box */
const PAD = 6;

/**
 * The copied picture drawn small: its dots where they stood, and a shape's outline. North is the
 * back of the field, as on the field itself. Decoration: the words beside it say what it is.
 */
function PicturePreview({
    picture,
    summary,
}: {
    picture: CopiedPicture;
    summary: PictureSummary;
}) {
    const { t } = useTranslate();
    const drawn = useMemo(() => {
        const outline = shapeOutline(picture, summary);
        const points = [...picture.dots, ...(outline?.points ?? [])];
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        const left = Math.min(...xs);
        const top = Math.min(...ys);
        const width = Math.max(...xs) - left;
        const height = Math.max(...ys) - top;
        const scale = Math.min(
            width > 0 ? (VIEW.width - 2 * PAD) / width : Infinity,
            height > 0 ? (VIEW.height - 2 * PAD) / height : Infinity,
        );
        const k = Number.isFinite(scale) ? scale : 1;
        // Centered in the box
        const ox = (VIEW.width - width * k) / 2 - left * k;
        const oy = (VIEW.height - height * k) / 2 - top * k;
        const at = (p: { x: number; y: number }) => ({
            x: ox + p.x * k,
            y: oy + p.y * k,
        });
        return {
            dots: picture.dots.map(at),
            outline: outline && {
                open: outline.open,
                points: outline.points
                    .map(at)
                    .map((p) => `${p.x},${p.y}`)
                    .join(" "),
            },
        };
    }, [picture, summary]);
    // Smaller dots when there are many, so a block still reads as a block
    const r =
        picture.dots.length > 40
            ? 1.25
            : picture.dots.length > 16
              ? 1.75
              : 2.25;
    return (
        <svg
            width={VIEW.width}
            height={VIEW.height}
            viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
            role="img"
            aria-label={t("shapes.clipboard.pictureLabel")}
            className="rounded-6 bg-fg-2 text-text shrink-0"
            data-testid="clipboard-picture"
            data-dots={picture.dots.length}
        >
            {drawn.outline &&
                (drawn.outline.open ? (
                    <polyline
                        points={drawn.outline.points}
                        fill="none"
                        stroke="currentColor"
                        strokeOpacity={0.5}
                        strokeWidth={1.25}
                        strokeLinejoin="round"
                    />
                ) : (
                    <polygon
                        points={drawn.outline.points}
                        fill="currentColor"
                        fillOpacity={0.06}
                        stroke="currentColor"
                        strokeOpacity={0.5}
                        strokeWidth={1.25}
                        strokeLinejoin="round"
                    />
                ))}
            {drawn.dots.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={r} fill="currentColor" />
            ))}
        </svg>
    );
}

/** A copied shape's outline in field units, as its kind draws it; none for positions or a group */
function shapeOutline(
    picture: CopiedPicture,
    summary: PictureSummary,
): { points: { x: number; y: number }[]; open: boolean } | null {
    if (summary.type !== "shape" || !picture.shape) return null;
    const read = placedOf({ id: 0, ...picture.shape, members: [] });
    if (!read) return null;
    const n = picture.dots.length;
    const { kind, params } = read;
    try {
        const points = kind.outline
            ? [...kind.outline(params, n)]
            : frameCorners(kind.frameOf(params, n));
        return points.length > 1
            ? { points, open: kind.outlineOpen?.(params, n) ?? false }
            : null;
    } catch {
        return null;
    }
}
