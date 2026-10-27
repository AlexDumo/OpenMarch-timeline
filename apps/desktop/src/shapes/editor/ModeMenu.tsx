import { useMemo, useState } from "react";
import clsx from "clsx";
import * as Popover from "@radix-ui/react-popover";
import { CaretDownIcon } from "@phosphor-icons/react";
import tolgee from "@/global/singletons/Tolgee";
import { MODE_LABELS, type DistributionMode } from "../distribute/distribution";
import { distributionOf, switchModes, withMode } from "../distribute/modes";
import { MODE_PREVIEW, modePreview } from "../preview/shapePreview";
import type { AnyToolKind, ToolEnv } from "../tool/toolKind";
import type { ShapeEditTarget } from "./editTargets";
import { arrowFocus, useMenuFocus } from "./menuFocus";
import { Tip } from "./Tip";

const modeLabel = (mode: DistributionMode) =>
    tolgee.t(`shapes.edit.mode.${mode}`, MODE_LABELS[mode]);

/**
 * How the shape is filled (spec #385): Grid, Outline or Spread, first on the floating editor's
 * second row (#435). A menu like the layout menu (owner): its button names the mode, and each row
 * shows this shape filled that way, drawn from its own geometry, beside the mode's name. Only the
 * kind's own modes show, and nothing while it has one. Picking one is one change of the shape
 * (one undo step, or one save for a placed shape).
 */
export function ModeMenu({
    target,
    envFor,
}: {
    target: Pick<ShapeEditTarget, "kind" | "params" | "spots" | "apply">;
    /** The field's tool environment when the mode is picked; null with no field */
    envFor: () => ToolEnv | null;
}) {
    const [open, setOpen] = useState(false);
    // Opened by keyboard, focus goes to the mode the shape is in now
    const focus = useMenuFocus((el) =>
        el.querySelector<HTMLElement>(
            '[role="menuitemradio"][aria-checked="true"]',
        ),
    );
    const modes = switchModes(target.kind);
    const current = distributionOf(target.kind, target.params, target.spots);
    if (modes.length === 0 || !current) return null;
    const pick = (mode: DistributionMode) => {
        setOpen(false);
        const env = envFor();
        if (!env) return;
        const next = withMode(
            target.kind,
            target.params,
            target.spots,
            mode,
            env,
        );
        if (next !== target.params) target.apply(next);
    };
    const label = tolgee.t("shapes.edit.mode.label", "Fill");
    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Tip label={label}>
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        aria-label={`${label}: ${modeLabel(current.mode)}`}
                        {...focus.trigger}
                        data-testid="shape-mode-menu"
                        data-mode={current.mode}
                        className="rounded-4 hover:bg-fg-2 flex min-h-24 items-center gap-4 px-4 py-2"
                    >
                        <span>{modeLabel(current.mode)}</span>
                        <CaretDownIcon size={10} />
                    </button>
                </Popover.Trigger>
            </Tip>
            <Popover.Portal>
                <Popover.Content
                    side="bottom"
                    align="start"
                    sideOffset={6}
                    {...focus.content}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="rounded-6 border-stroke bg-bg-1 bg-modal text-sub text-text shadow-modal z-50 border p-6"
                    data-testid="shape-mode-menu-content"
                >
                    <div
                        className="flex flex-col gap-1"
                        role="menu"
                        aria-label={label}
                        onKeyDown={(e) =>
                            arrowFocus(e, [
                                ...e.currentTarget.querySelectorAll<HTMLElement>(
                                    '[role="menuitemradio"]',
                                ),
                            ])
                        }
                    >
                        {modes.map((mode) => (
                            <button
                                key={mode}
                                type="button"
                                role="menuitemradio"
                                aria-checked={mode === current.mode}
                                onClick={() => pick(mode)}
                                data-testid={`shape-mode-${mode}`}
                                className={clsx(
                                    "rounded-4 flex min-h-24 items-center gap-8 px-4 py-2 text-left",
                                    mode === current.mode
                                        ? "bg-fg-2 text-accent"
                                        : "hover:text-accent",
                                )}
                            >
                                <ModePicture
                                    kind={target.kind}
                                    params={target.params}
                                    n={target.spots}
                                    mode={mode}
                                    envFor={envFor}
                                />
                                <span>{modeLabel(mode)}</span>
                            </button>
                        ))}
                    </div>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

/** This shape filled in `mode`, as small dots inside its outline (`modePreview`) */
function ModePicture({
    kind,
    params,
    n,
    mode,
    envFor,
}: {
    kind: AnyToolKind;
    params: unknown;
    n: number;
    mode: DistributionMode;
    envFor: () => ToolEnv | null;
}) {
    // envFor reads the field as it is now; the shape is what changes the picture
    const preview = useMemo(() => {
        const env = envFor();
        return env && modePreview(kind, params, n, mode, env);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kind, params, n, mode]);
    const { width, height } = MODE_PREVIEW;
    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-hidden
            focusable={false}
            className="shrink-0"
            data-testid={`shape-mode-preview-${mode}`}
            data-spots={preview?.spots.length ?? 0}
        >
            {preview?.outline && (
                <polygon
                    points={preview.outline
                        .map(({ x, y }) => `${x},${y}`)
                        .join(" ")}
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity={0.35}
                    strokeWidth={0.75}
                    strokeLinejoin="round"
                />
            )}
            {preview?.spots.map(({ x, y }, i) => (
                <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r={preview.radius}
                    fill="currentColor"
                />
            ))}
        </svg>
    );
}
