import { useState } from "react";
import clsx from "clsx";
import * as Popover from "@radix-ui/react-popover";
import { CaretDownIcon, CopyIcon, ShuffleIcon } from "@phosphor-icons/react";
import { Tip } from "./Tip";
import tolgee from "@/global/singletons/Tolgee";
import {
    distributionOf,
    parseSeed,
    reshuffle,
    withSeed,
} from "../distribute/modes";
import type { ToolEnv } from "../tool/toolKind";
import type { ShapeEditTarget } from "./editTargets";
import { keepFocus } from "./keepFocus";
import { useMenuFocus } from "./menuFocus";

type Target = Pick<ShapeEditTarget, "kind" | "params" | "spots" | "apply">;

/**
 * Reshuffle (spec #385): a spread's next layout, on the floating editor's second row. Shown only
 * while the shape is an even spread. One change of the shape (one undo step, or one save for a
 * placed shape). A split button (#437): its caret opens the spread's seed, for people who want a
 * spread back exactly, to type or copy.
 */
export function ReshuffleButton({
    target,
    envFor,
    className,
    testId,
}: {
    target: Target;
    /** The field's tool environment when it's pressed; null with no field */
    envFor: () => ToolEnv | null;
    className?: string;
    testId: string;
}) {
    const d = distributionOf(target.kind, target.params, target.spots);
    if (d?.mode !== "spread") return null;
    return (
        <span className="flex items-center">
            <Tip
                label={tolgee.t(
                    "shapes.edit.reshuffle.title",
                    "Reshuffle: a new layout",
                )}
            >
                <button
                    type="button"
                    onPointerDown={keepFocus}
                    onClick={() => {
                        const env = envFor();
                        if (!env) return;
                        const next = reshuffle(
                            target.kind,
                            target.params,
                            target.spots,
                            env,
                        );
                        if (next !== null) target.apply(next);
                    }}
                    data-testid={testId}
                    data-seed={d.seed}
                    className={clsx("flex items-center gap-4", className)}
                >
                    <ShuffleIcon size={14} />
                    {tolgee.t("shapes.edit.reshuffle.label", "Reshuffle")}
                </button>
            </Tip>
            <SeedMenu
                target={target}
                envFor={envFor}
                seed={d.seed}
                testId={`${testId}-seed`}
            />
        </span>
    );
}

/** The spread's seed: typed to lay the spread out with it, or copied */
function SeedMenu({
    target,
    envFor,
    seed,
    testId,
}: {
    target: Target;
    envFor: () => ToolEnv | null;
    seed: number;
    testId: string;
}) {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    // Opened by keyboard, focus goes to the seed
    const focus = useMenuFocus((el) => el.querySelector<HTMLElement>("input"));
    const label = tolgee.t("shapes.edit.seed.label", "Seed");
    const copyLabel = tolgee.t("shapes.edit.seed.copy", "Copy the seed");
    /** Lays the spread out with the typed seed; false when it isn't one */
    const apply = (text: string) => {
        const typed = parseSeed(text);
        const env = envFor();
        if (typed === null || !env) return false;
        if (typed === seed) return true;
        const next = withSeed(
            target.kind,
            target.params,
            target.spots,
            typed,
            env,
        );
        if (next === null) return false;
        target.apply(next);
        return true;
    };
    return (
        <Popover.Root
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                setCopied(false);
            }}
        >
            <Tip label={`${label}: ${seed}`}>
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        aria-label={`${label}: ${seed}`}
                        {...focus.trigger}
                        data-testid={testId}
                        className="rounded-4 hover:text-accent hover:bg-fg-2 flex min-h-24 items-center px-2"
                    >
                        <CaretDownIcon size={10} />
                    </button>
                </Popover.Trigger>
            </Tip>
            <Popover.Portal>
                <Popover.Content
                    side="bottom"
                    align="end"
                    sideOffset={6}
                    {...focus.content}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="rounded-6 border-stroke bg-bg-1 bg-modal text-sub text-text shadow-modal z-50 flex flex-col gap-6 border p-8"
                    data-testid={`${testId}-menu`}
                >
                    <div className="flex items-center gap-8">
                        <span className="text-text/80">{label}</span>
                        <input
                            // A new seed from Reshuffle shows at once
                            key={seed}
                            defaultValue={String(seed)}
                            inputMode="numeric"
                            aria-label={label}
                            className="rounded-4 border-stroke bg-fg-1 w-80 border px-6 py-2 tabular-nums"
                            data-testid={`${testId}-input`}
                            onKeyDown={(e) => {
                                // Its keys are its own: Enter applies it rather than placing the
                                // shape, and digits don't reach the app's shortcuts. Escape still
                                // closes the menu
                                if (e.key !== "Escape") e.stopPropagation();
                                if (e.key !== "Enter") return;
                                e.preventDefault();
                                const input = e.currentTarget;
                                if (apply(input.value))
                                    input.removeAttribute("aria-invalid");
                                else input.setAttribute("aria-invalid", "true");
                            }}
                            onBlur={(e) => {
                                if (apply(e.currentTarget.value)) return;
                                // Not a seed: back to the one it has
                                e.currentTarget.value = String(seed);
                                e.currentTarget.removeAttribute("aria-invalid");
                            }}
                        />
                        <Tip
                            label={
                                copied
                                    ? tolgee.t(
                                          "shapes.edit.seed.copied",
                                          "Copied",
                                      )
                                    : copyLabel
                            }
                        >
                            <button
                                type="button"
                                aria-label={copyLabel}
                                onClick={() => {
                                    void navigator.clipboard
                                        ?.writeText(String(seed))
                                        .then(() => setCopied(true))
                                        .catch(() => undefined);
                                }}
                                data-testid={`${testId}-copy`}
                                data-copied={copied}
                                className="rounded-4 hover:text-accent flex min-h-24 min-w-24 items-center justify-center p-4"
                            >
                                <CopyIcon size={14} />
                            </button>
                        </Tip>
                    </div>
                    <p className="text-text/60 text-xs">
                        {tolgee.t(
                            "shapes.edit.seed.hint",
                            "Same seed, same spread",
                        )}
                    </p>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
