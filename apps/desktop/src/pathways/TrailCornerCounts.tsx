import { useState } from "react";
import clsx from "clsx";
import * as Popover from "@radix-ui/react-popover";
import { FlagPennantIcon, WarningIcon } from "@phosphor-icons/react";
import type { CornerCount } from "@openmarch/core";
import tolgee from "@/global/singletons/Tolgee";
import { fieldToElement, useFieldViewStore } from "@/field/three/fieldView";
import { POPOVER_CLASS } from "@/components/ui/popupClasses";
import type { PathSession } from "./pathPenStore";
import {
    cornerRange,
    formatCount,
    trailCornersOf,
    type TrailCornersView,
} from "./trailCorners";

/** How far outside its corner a chip's middle sits, in screen pixels (clear of the point handle) */
const CHIP_OFFSET_PX = 26;

/**
 * Corner counts on the field, pathways step 6 (spec L.9, TC-5 and TC-6): a chip just outside each
 * corner of the trail the session shows, with the first and last turning counts there, in the
 * warning color when a member turns between counts. A click or tap opens the corner's list: who
 * turns there, leader first, and on which count. While a trail is drawn the chips only show (a
 * click on the field places the next point), so the list opens once it's finished.
 */
export function TrailCornerCounts({ session }: { session: PathSession }) {
    const view = trailCornersOf(session);
    const field = useFieldViewStore();
    if (!view || view.corners.length === 0) return null;
    const drawing = session.phase === "drawing";
    return (
        <>
            {view.corners.map((corner, i) => {
                const at = fieldToElement(field, corner.at[0], corner.at[1]);
                // outside the turn: away from where the way bends to
                const ix = corner.dirOut[0] - corner.dirIn[0];
                const iy = corner.dirOut[1] - corner.dirIn[1];
                const il = Math.hypot(ix, iy) || 1;
                return (
                    <CornerChip
                        key={i}
                        view={view}
                        corner={corner}
                        left={at.x - (ix / il) * CHIP_OFFSET_PX}
                        top={at.y - (iy / il) * CHIP_OFFSET_PX}
                        inert={drawing}
                    />
                );
            })}
        </>
    );
}

function CornerChip({
    view,
    corner,
    left,
    top,
    inert,
}: {
    view: TrailCornersView;
    corner: CornerCount;
    left: number;
    top: number;
    inert: boolean;
}) {
    const [open, setOpen] = useState(false);
    const range = cornerRange(corner);
    const label = corner.offCount
        ? tolgee.t(
              "pathways.corners.chipOffLabel",
              "Turning counts {range} at this corner, some between counts. Show who turns when.",
              { range },
          )
        : tolgee.t(
              "pathways.corners.chipLabel",
              "Turning counts {range} at this corner. Show who turns when.",
              { range },
          );
    const chip = (
        <button
            type="button"
            className={clsx(
                "rounded-6 bg-modal text-sub shadow-modal absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 border px-4 leading-none whitespace-nowrap tabular-nums",
                "focus-visible:outline-accent py-2 focus-visible:outline-2",
                // a finger gets a target it can hit (touch layout), desktop stays compact
                "touch:min-h-32 touch:px-8",
                corner.offCount
                    ? "border-yellow text-yellow"
                    : "border-stroke text-text",
                inert && "pointer-events-none",
            )}
            style={{ left, top }}
            aria-label={label}
            tabIndex={inert ? -1 : undefined}
            data-testid="trail-corner-count"
            data-off={corner.offCount ? "true" : undefined}
            data-counts={corner.turns
                .map((t) => formatCount(t.count))
                .join(",")}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
        >
            {corner.offCount && (
                <WarningIcon size={12} weight="bold" aria-hidden />
            )}
            {range}
        </button>
    );
    if (inert) return chip;
    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>{chip}</Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    side="right"
                    align="start"
                    sideOffset={6}
                    collisionPadding={8}
                    className={clsx(
                        POPOVER_CLASS,
                        "text-sub z-50 flex max-h-384 min-w-160 flex-col gap-4 overflow-y-auto p-8",
                    )}
                    data-testid="trail-corner-list"
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    <CornerList view={view} corner={corner} />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

/** TC-6: who turns at the corner, leader first, each with its count */
function CornerList({
    view,
    corner,
}: {
    view: TrailCornersView;
    corner: CornerCount;
}) {
    const leaderQ = view.drills.length - 1;
    return (
        <>
            <div className="text-text-subtitle px-4">
                {tolgee.t("pathways.corners.listTitle", "Turns at this corner")}
            </div>
            <ul className="flex flex-col">
                {corner.turns.map((t) => (
                    <li
                        key={t.q}
                        className={clsx(
                            "rounded-4 flex items-center justify-between gap-12 px-4 py-2 tabular-nums",
                            !t.onCount && "text-yellow",
                        )}
                        data-testid="trail-corner-turn"
                        data-on-count={t.onCount ? "true" : "false"}
                    >
                        <span className="flex items-center gap-4">
                            {view.drills[t.q]}
                            {t.q === leaderQ && (
                                <FlagPennantIcon
                                    size={10}
                                    weight="fill"
                                    className="text-accent"
                                    aria-label={tolgee.t(
                                        "pathways.corners.leader",
                                        "Leader",
                                    )}
                                />
                            )}
                        </span>
                        <span className="flex items-center gap-4">
                            {!t.onCount && (
                                <WarningIcon
                                    size={12}
                                    weight="bold"
                                    aria-hidden
                                />
                            )}
                            {t.onCount
                                ? tolgee.t(
                                      "pathways.corners.onCount",
                                      "count {count}",
                                      { count: formatCount(t.count) },
                                  )
                                : tolgee.t(
                                      "pathways.corners.betweenCounts",
                                      "{count} · between {before} and {after}",
                                      {
                                          count: formatCount(t.count),
                                          before: Math.floor(t.count),
                                          after: Math.ceil(t.count),
                                      },
                                  )}
                        </span>
                    </li>
                ))}
            </ul>
            {corner.stopBefore > 0 && (
                <div className="text-text-subtitle px-4">
                    {tolgee.t(
                        "pathways.corners.stopBefore",
                        "{count, plural, one {# stops before turning here} other {# stop before turning here}}",
                        { count: corner.stopBefore },
                    )}
                </div>
            )}
        </>
    );
}
