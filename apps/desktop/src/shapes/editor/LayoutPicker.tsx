import { useRef, useState } from "react";
import clsx from "clsx";
import { Tip } from "./Tip";
import * as Popover from "@radix-ui/react-popover";
import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react";
import { LAYOUT_LABELS, type LayoutFamily } from "../distribute/distribution";
import {
    hintText,
    isVersionAnyTurn,
    nearestVersion,
    versionDots,
    versionOf,
    type LayoutHint,
    type LayoutRow,
    type LayoutVersion,
    type ResolvedLayout,
} from "../distribute/layouts";
import { layoutOf, withLayout } from "../distribute/modes";
import { useLastLayoutStore } from "../tool/lastLayout";
import type { ToolEnv } from "../tool/toolKind";
import type { ShapeEditTarget } from "./editTargets";
import { keepFocus } from "./keepFocus";

/**
 * The box's layout picker (#387, spec #385) and the chip's layout menu (owner lab feedback,
 * 2026-10-23). Full · Stagger · Rounded · Short back · Notched always keep their places: a layout
 * the count can't make shows greyed, as a picture of it at the nearest count it makes, with what
 * it needs ("add 1 / remove 2"). Each version is a live thumbnail labelled by its block
 * ("5 × 5"), the counts in its tooltip. A shape and its quarter turn are one version: the chip's
 * turn button makes the other. Picking a version is one change of the shape and becomes the
 * layout a new box starts in.
 */

type Target = Pick<ShapeEditTarget, "kind" | "params" | "spots" | "apply">;

interface PickerProps {
    target: Target;
    /** The field's tool environment when a version is picked; null with no field */
    envFor: () => ToolEnv | null;
    /** The look of what holds it where it sits (the floating editor's pill) */
    className?: string;
}

/** Picks `version` for the shape, and remembers its layout for the next new box */
function usePick({ target, envFor }: PickerProps) {
    const remember = useLastLayoutStore((s) => s.remember);
    return (version: LayoutVersion) => {
        const env = envFor();
        if (!env) return;
        remember(version.layout.family);
        const next = withLayout(
            target.kind,
            target.params,
            target.spots,
            version.layout,
            env,
        );
        if (next !== target.params) target.apply(next);
    };
}

/** Whether `version` is the shape's own, as it is or turned a quarter */
const isOwn = (version: LayoutVersion, now: ResolvedLayout) =>
    isVersionAnyTurn(version, now.lines, now.layout.byFile);

/** "Full needs 24 or 21 marchers: add 1 / remove 2" */
function needsTitle(label: string, hint: LayoutHint, n: number): string {
    const counts = [
        hint.more !== null && n + hint.more,
        hint.fewer !== null && n - hint.fewer,
    ].filter((c): c is number => c !== false);
    return counts.length > 0
        ? `${label} needs ${counts.join(" or ")} marchers: ${hintText(hint)}`
        : `${label} can't make ${n}`;
}

/** The inspector's picker, in the shape section under the mode switch */
export function LayoutPicker(props: PickerProps) {
    const { target } = props;
    const pick = usePick(props);
    const now = layoutOf(target.kind, target.params, target.spots);
    const rows = target.kind.closed?.layouts?.catalogue(target.spots) ?? [];
    if (now === null || rows.length === 0) return null;
    return (
        <div
            className="flex flex-col gap-4"
            role="group"
            aria-label="Layout"
            data-testid="shape-layout-picker"
        >
            {rows.map((row) => (
                <div
                    key={row.family}
                    className="flex items-start gap-8"
                    data-testid={`shape-layout-row-${row.family}`}
                >
                    <span
                        className={clsx(
                            "text-sub w-[4.5rem] shrink-0 pt-6",
                            row.versions.length > 0
                                ? "text-text/70"
                                : "text-text/40",
                        )}
                    >
                        {row.label}
                    </span>
                    <div className="flex flex-wrap gap-2">
                        {row.versions.length > 0 ? (
                            row.versions.map((version, i) => (
                                <VersionButton
                                    key={i}
                                    name={`${row.label} ${version.label}`}
                                    version={version}
                                    on={isOwn(version, now)}
                                    onPick={() => pick(version)}
                                    testId={`shape-layout-${row.family}-${i}`}
                                    caption={version.label}
                                />
                            ))
                        ) : (
                            <MissingButton
                                row={row}
                                n={target.spots}
                                testId={`shape-layout-${row.family}-missing`}
                            />
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}

/** A layout the count can't make: its picture greyed, with what it needs, which can't be picked */
function MissingButton({
    row,
    n,
    testId,
}: {
    row: LayoutRow;
    n: number;
    testId: string;
}) {
    const hint = row.hint ?? { more: null, fewer: null };
    return (
        <Tip label={needsTitle(row.label, hint, n)}>
            <button
                type="button"
                // aria-disabled, not disabled: a disabled button gets no pointer, so the
                // tooltip saying why wouldn't show
                aria-disabled
                data-testid={testId}
                className="rounded-4 text-text/40 flex flex-col items-center gap-2 p-4"
            >
                {row.preview && (
                    <span className="opacity-40">
                        <Thumbnail version={row.preview.version} />
                    </span>
                )}
                <span className="text-xs">{hintText(hint)}</span>
            </button>
        </Tip>
    );
}

/**
 * The chip's layout menu: the layout on its button (and, when the count can't make the one
 * picked, that one greyed with what it needs). Open, it lists every layout, greyed where the count
 * can't make it; hovering a layout or clicking its arrow shows its versions beside the list.
 */
export function LayoutMenu(props: PickerProps) {
    const { target } = props;
    const pick = usePick(props);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState<LayoutFamily | null>(null);
    // Closed by a press (a layout picked, a click away): focus isn't handed back to the button,
    // or the floating editor would stay solid with the pointer away (#426). Escape still hands it.
    const pressed = useRef(false);
    const now = layoutOf(target.kind, target.params, target.spots);
    const rows = target.kind.closed?.layouts?.catalogue(target.spots) ?? [];
    if (now === null || rows.length === 0) return null;
    const n = target.spots;
    const aspect = now.across / now.deep;
    const showing = active ?? now.layout.family;
    const wanted = now.fellBack
        ? rows.find((r) => r.family === now.fellBack)
        : undefined;
    const choose = (version: LayoutVersion) => {
        pick(version);
        setOpen(false);
        setActive(null);
    };
    /** A layout's row picture: the shape's own version, or the one nearest its proportions */
    const pictureOf = (row: LayoutRow) =>
        row.versions.find((v) => isOwn(v, now)) ??
        nearestVersion(row.family, n, aspect) ??
        undefined;
    const shownRow = rows.find((r) => r.family === showing);
    return (
        <Popover.Root
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                if (!next) setActive(null);
                else pressed.current = false;
            }}
        >
            <span
                className={clsx("flex items-center gap-4", props.className)}
                data-testid="shape-layout-pill"
            >
                <Tip label="Layout">
                    <Popover.Trigger asChild>
                        <button
                            type="button"
                            aria-label={`Layout: ${LAYOUT_LABELS[now.layout.family]}`}
                            onPointerDown={keepFocus}
                            data-testid="shape-layout-menu"
                            className="rounded-4 hover:bg-fg-2 flex items-center gap-4 px-4 py-2"
                        >
                            <Thumbnail
                                version={versionOf(now.layout, now.lines)}
                                small
                            />
                            <span>{LAYOUT_LABELS[now.layout.family]}</span>
                            <CaretDownIcon size={10} />
                        </button>
                    </Popover.Trigger>
                </Tip>
                {wanted?.hint && (
                    <Tip label={needsTitle(wanted.label, wanted.hint, n)}>
                        <span
                            className="text-text/40 flex items-center gap-2"
                            data-testid="shape-layout-menu-wanted"
                        >
                            {wanted.preview && (
                                <span className="opacity-40">
                                    <Thumbnail
                                        version={wanted.preview.version}
                                        small
                                    />
                                </span>
                            )}
                            {wanted.label} · {hintText(wanted.hint)}
                        </span>
                    </Tip>
                )}
            </span>
            <Popover.Portal>
                <Popover.Content
                    side="bottom"
                    align="start"
                    sideOffset={6}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                    onCloseAutoFocus={(e) => {
                        if (pressed.current) e.preventDefault();
                    }}
                    onPointerDownOutside={() => {
                        pressed.current = true;
                    }}
                    onPointerDownCapture={() => {
                        pressed.current = true;
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="rounded-6 border-stroke bg-bg-1 bg-modal text-sub text-text shadow-modal z-50 flex gap-8 border p-6"
                    data-testid="shape-layout-menu-content"
                >
                    <div className="flex flex-col gap-1" role="menu">
                        {rows.map((row) => {
                            const missing = row.versions.length === 0;
                            const picture = missing
                                ? row.preview?.version
                                : pictureOf(row);
                            return (
                                <div
                                    key={row.family}
                                    className={clsx(
                                        "rounded-4 flex items-center",
                                        showing === row.family &&
                                            !missing &&
                                            "bg-fg-2",
                                    )}
                                >
                                    <Tip
                                        label={
                                            missing && row.hint
                                                ? needsTitle(
                                                      row.label,
                                                      row.hint,
                                                      n,
                                                  )
                                                : undefined
                                        }
                                    >
                                        <button
                                            type="button"
                                            role="menuitem"
                                            // aria-disabled, not disabled: the tooltip says why
                                            aria-disabled={missing || undefined}
                                            onPointerEnter={() => {
                                                if (!missing)
                                                    setActive(row.family);
                                            }}
                                            onClick={() => {
                                                if (picture && !missing)
                                                    choose(picture);
                                            }}
                                            data-testid={`shape-layout-menu-row-${row.family}`}
                                            className={clsx(
                                                "flex min-w-40 items-center gap-6 px-4 py-2 text-left",
                                                missing
                                                    ? "text-text/40"
                                                    : now.layout.family ===
                                                        row.family
                                                      ? "text-accent"
                                                      : "hover:text-accent",
                                            )}
                                        >
                                            <span
                                                className={clsx(
                                                    "flex w-24 justify-center",
                                                    missing && "opacity-40",
                                                )}
                                            >
                                                {picture && (
                                                    <Thumbnail
                                                        version={picture}
                                                        small
                                                    />
                                                )}
                                            </span>
                                            <span className="grow">
                                                {row.label}
                                            </span>
                                            {missing && row.hint && (
                                                <span className="text-xs">
                                                    {hintText(row.hint)}
                                                </span>
                                            )}
                                        </button>
                                    </Tip>
                                    {!missing && (
                                        <button
                                            type="button"
                                            aria-label={`Show the ${row.label} versions`}
                                            onPointerDown={keepFocus}
                                            onClick={() =>
                                                setActive(row.family)
                                            }
                                            data-testid={`shape-layout-menu-expand-${row.family}`}
                                            className="hover:text-accent px-4 py-2"
                                        >
                                            <CaretRightIcon size={10} />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    {shownRow && shownRow.versions.length > 0 && (
                        <div
                            className="border-stroke flex max-w-64 flex-wrap content-start gap-2 border-l pl-8"
                            data-testid="shape-layout-menu-versions"
                        >
                            {shownRow.versions.map((version, i) => (
                                <VersionButton
                                    key={i}
                                    name={`${shownRow.label} ${version.label}`}
                                    version={version}
                                    on={isOwn(version, now)}
                                    onPick={() => choose(version)}
                                    testId={`shape-layout-menu-version-${shownRow.family}-${i}`}
                                    caption={version.label}
                                />
                            ))}
                        </div>
                    )}
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

function VersionButton({
    name,
    version,
    on,
    onPick,
    testId,
    caption,
}: {
    /** "Stagger 5 × 5" */
    name: string;
    version: LayoutVersion;
    on: boolean;
    onPick: () => void;
    testId: string;
    caption?: string;
}) {
    return (
        <Tip label={`${name}: ${version.tooltip}`}>
            <button
                type="button"
                aria-label={name}
                aria-pressed={on}
                onPointerDown={keepFocus}
                onClick={onPick}
                data-testid={testId}
                className={clsx(
                    "rounded-4 flex flex-col items-center gap-2 border p-4",
                    on
                        ? "border-accent bg-accent/10 text-accent"
                        : "hover:bg-fg-2 text-text border-transparent",
                )}
            >
                <Thumbnail version={version} />
                {caption && (
                    <span className={clsx("text-xs", !on && "text-text/60")}>
                        {caption}
                    </span>
                )}
            </button>
        </Tip>
    );
}

/** The version's spots as dots, drawn from the layout itself */
function Thumbnail({
    version,
    small,
}: {
    version: LayoutVersion;
    small?: boolean;
}) {
    const dots = versionDots(version.lines, version.layout.byFile);
    // Half an interval per unit; big enough in the inspector to read a version at a glance
    const most = Math.max(version.across, version.deep);
    const unit = Math.min(small ? 1.75 : 4, (small ? 18 : 48) / (2 * most));
    const w = version.across * 2 * unit;
    const h = version.deep * 2 * unit;
    return (
        <svg
            width={w}
            height={h}
            viewBox={`${-w / 2} ${-h / 2} ${w} ${h}`}
            aria-hidden
        >
            {dots.map((d, i) => (
                <circle
                    key={i}
                    cx={d.x * unit}
                    cy={d.y * unit}
                    r={unit * 0.6}
                    fill="currentColor"
                />
            ))}
        </svg>
    );
}
