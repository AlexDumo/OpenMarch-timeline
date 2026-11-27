import clsx from "clsx";
import {
    ArrowsLeftRightIcon,
    HandPointingIcon,
    XIcon,
} from "@phosphor-icons/react";
import tolgee from "@/global/singletons/Tolgee";
import Shortcut from "@/components/ui/Shortcut";
import { Tip } from "@/components/ui/Tip";
import { currentShapeField, shapeContextFor } from "../field/shapeFieldContext";
import {
    stopPicking,
    switchPickSide,
    togglePicking,
    usePickStore,
    type PickSide,
} from "../tool/pickByHand";
import { updateTool, useShapeToolStore } from "../tool/shapeToolStore";
import { clearPins } from "../tool/toolMachine";
import type { ShapeEditTarget } from "./editTargets";
import { Divider } from "./EditorBarParts";
import { OrderMenu } from "./OrderMenu";

const BUTTON =
    "rounded-4 hover:bg-text/10 flex min-h-24 items-center gap-4 px-4 py-2";
const ON = "bg-fg-2 text-accent";

/**
 * Who goes where by hand on the open shape (09-who-goes-where.md), in the floating editor: Pick by
 * hand and Swap two, and Clear hand picks while there are any. While picking, `PickBar` says which
 * shape picks come from. None on a placed shape.
 */
export function PickControls() {
    const session = usePickStore((s) => s.session);
    const pins = useShapeToolStore((s) => s.tool?.pins?.length ?? 0);
    const picking = session?.kind === "pick";
    const swapping = session?.kind === "swap";
    return (
        <span className="flex items-center gap-4" data-testid="shape-pick">
            <Tip
                label={tolgee.t("shapes.edit.pick.button", "Pick by hand")}
                action="shapePickByHand"
                hint={tolgee.t(
                    "shapes.edit.pick.tip",
                    "Click or drag through marchers and spots. The 1st marcher you pick takes the 1st spot you pick.",
                )}
            >
                <button
                    type="button"
                    aria-pressed={picking}
                    onClick={() => togglePicking("pick")}
                    className={clsx(BUTTON, picking && ON)}
                    data-testid="shape-pick-by-hand"
                >
                    <HandPointingIcon size={14} />
                    <span>
                        {tolgee.t("shapes.edit.pick.button", "Pick by hand")}
                    </span>
                </button>
            </Tip>
            <Tip
                label={tolgee.t("shapes.edit.swap.button", "Swap two")}
                action="shapeSwapTwo"
                hint={tolgee.t(
                    "shapes.edit.swap.tip",
                    "Click two marchers to trade their spots.",
                )}
            >
                <button
                    type="button"
                    aria-pressed={swapping}
                    onClick={() => togglePicking("swap")}
                    className={clsx(BUTTON, swapping && ON)}
                    data-testid="shape-swap-two"
                >
                    <ArrowsLeftRightIcon size={14} />
                    <span>
                        {tolgee.t("shapes.edit.swap.button", "Swap two")}
                    </span>
                </button>
            </Tip>
            {pins > 0 && !session && (
                <Tip
                    label={tolgee.t(
                        "shapes.edit.pick.clear",
                        "Clear hand picks",
                    )}
                    hint={tolgee.t(
                        "shapes.edit.pick.clearTip",
                        "Everyone goes back to the spot Who goes where gives them.",
                    )}
                >
                    <button
                        type="button"
                        aria-label={tolgee.t(
                            "shapes.edit.pick.clear",
                            "Clear hand picks",
                        )}
                        onClick={() => {
                            const field = currentShapeField();
                            if (field)
                                updateTool((t) =>
                                    clearPins(t, shapeContextFor(field)),
                                );
                        }}
                        className={BUTTON}
                        data-testid="shape-pick-clear"
                    >
                        <XIcon size={12} />
                    </button>
                </Tip>
            )}
        </span>
    );
}

/**
 * While picking or swapping, its own bar in place of the floating editor's rows (owner): the Who
 * goes where option the rest follow, which shape is in front (the source, where the marchers
 * start, or the destination, the new shape's spots), what's paired and waiting, and Done
 */
export function PickBar({
    target,
}: {
    target: Pick<ShapeEditTarget, "order">;
}) {
    const session = usePickStore((s) => s.session);
    if (!session) return null;
    const side = (value: PickSide, label: string, tip: string) => (
        <Tip key={value} label={label} hint={tip} action="shapePickSwitchSide">
            <button
                type="button"
                aria-pressed={session.front === value}
                onClick={() => switchPickSide(value)}
                className={clsx(
                    "border-stroke min-h-24 border px-6 py-2",
                    value === "marchers"
                        ? "rounded-l-4"
                        : "rounded-r-4 border-l-0",
                    session.front === value ? ON : "hover:bg-text/10",
                )}
                data-testid={`shape-pick-${value}`}
            >
                {label}
            </button>
        </Tip>
    );
    const waitingMarchers = session.marchers.length;
    const waitingSpots = session.spots.length;
    return (
        <div
            className="rounded-6 border-stroke bg-bg-1 bg-modal shadow-modal flex items-center gap-6 border px-6 py-2"
            data-testid="shape-pick-bar"
        >
            {/* What everyone not picked by hand follows, and how many are */}
            {target.order && (
                <>
                    <OrderMenu target={target} />
                    <Divider />
                </>
            )}
            {session.kind === "pick" ? (
                <>
                    <span
                        role="group"
                        aria-label={tolgee.t(
                            "shapes.edit.pick.from",
                            "Pick from",
                        )}
                        className="flex items-center"
                    >
                        {side(
                            "marchers",
                            tolgee.t("shapes.edit.pick.source", "Source"),
                            tolgee.t(
                                "shapes.edit.pick.sourceTip",
                                "Clicks pick marchers where they start the move",
                            ),
                        )}
                        {side(
                            "spots",
                            tolgee.t(
                                "shapes.edit.pick.destination",
                                "Destination",
                            ),
                            tolgee.t(
                                "shapes.edit.pick.destinationTip",
                                "Clicks pick spots in the new shape",
                            ),
                        )}
                    </span>
                    <Shortcut action="shapePickSwitchSide" />
                    <span
                        className="text-text/60"
                        aria-live="polite"
                        data-testid="shape-pick-status"
                    >
                        {waitingMarchers > 0
                            ? tolgee.t(
                                  "shapes.edit.pick.waitingMarchers",
                                  "{count, plural, one {# marcher waits for a spot} other {# marchers wait for spots}}",
                                  { count: waitingMarchers },
                              )
                            : waitingSpots > 0
                              ? tolgee.t(
                                    "shapes.edit.pick.waitingSpots",
                                    "{count, plural, one {# spot waits for a marcher} other {# spots wait for marchers}}",
                                    { count: waitingSpots },
                                )
                              : tolgee.t(
                                    "shapes.edit.pick.ready",
                                    "Pick a marcher or a spot",
                                )}
                    </span>
                </>
            ) : (
                <span
                    className="text-text/60"
                    aria-live="polite"
                    data-testid="shape-pick-status"
                >
                    {session.first === null
                        ? tolgee.t("shapes.edit.swap.first", "Click a marcher")
                        : tolgee.t(
                              "shapes.edit.swap.second",
                              "Click the marcher to trade with",
                          )}
                </span>
            )}
            <button
                type="button"
                onClick={stopPicking}
                className={clsx(BUTTON, "text-accent")}
                data-testid="shape-pick-done"
            >
                {tolgee.t("shapes.edit.pick.done", "Done")}
                <Shortcut action="applyShape" />
            </button>
        </div>
    );
}
