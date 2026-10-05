import { toast } from "sonner";
import { db } from "@/global/database/db";
import tolgee from "@/global/singletons/Tolgee";
import {
    moveMarchersFromFlagInstead,
    type TimelineMarcherMove,
    type TimelinePassThrough,
} from "@/db-functions/timelineMoves";
import type { BeatRange } from "@/db-functions/timelineMembership";
import {
    useTimelineSelectionStore,
    type PageBox,
} from "@/stores/TimelineSelectionStore";
import { toastTimelineError } from "./timelineErrorMessages";

/**
 * What the app says after a drag passed through pages (research/ownership/10-cross-page-windows.md
 * §4.1, §4.2): which marchers now move straight through which moves, which moves catch up after
 * it, and the one-click way back, **Only change Page N**, which moves them from the last flag
 * before the drag's end instead (`moveMarchersFromFlagInstead`).
 */

/** Translates with ICU parameters; the Tolgee singleton by default, anything in tests. */
export type PassThroughTranslate = (
    key: string,
    defaultMessage: string,
    params?: Record<string, string>,
) => string;

const defaultTranslate: PassThroughTranslate = (key, defaultMessage, params) =>
    tolgee.t(key, defaultMessage, params);

/** How many drill numbers a message names before it counts the rest. */
const MAX_NAMED_MARCHERS = 4;

/** "A", "A and B", "A, B and C". */
const joinList = (items: readonly string[]): string =>
    items.length <= 1
        ? (items[0] ?? "")
        : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** "T3", "T3 and T4", "T3, T4, T5, T6 and 2 others". */
export function marcherList(labels: readonly string[]): string {
    if (labels.length <= MAX_NAMED_MARCHERS) return joinList(labels);
    const rest = labels.length - MAX_NAMED_MARCHERS;
    return joinList([
        ...labels.slice(0, MAX_NAMED_MARCHERS),
        rest === 1 ? "1 other" : `${rest} others`,
    ]);
}

/** "Page 2" for a range that is a page's box, otherwise "the move over beats [16, 40)". */
export function moveName(range: BeatRange, boxes: readonly PageBox[]): string {
    const box = boxes.find(
        (b) => b.start === range.start && b.end === range.end,
    );
    return box?.name !== undefined
        ? `Page ${box.name}`
        : `the move over beats [${range.start}, ${range.end})`;
}

/**
 * The flag **Only change** narrows to: the last page flag strictly inside the drag's range, and
 * the page whose box starts there. `null` when no flag is inside (the range crossed only clips).
 */
export function narrowingFlag(
    range: BeatRange,
    boxes: readonly PageBox[],
): { beat: number; name?: string } | null {
    const inside = boxes
        .map((b) => b.start)
        .filter((beat) => range.start < beat && beat < range.end);
    if (inside.length === 0) return null;
    const beat = Math.max(...inside);
    return { beat, name: boxes.find((b) => b.start === beat)?.name };
}

/** The toast's text for `pass`, worded for one marcher or several. */
export function passThroughMessage(
    pass: TimelinePassThrough,
    boxes: readonly PageBox[],
    translate: PassThroughTranslate = defaultTranslate,
): string {
    const marchers = marcherList(pass.labels);
    const through = joinList(pass.overridden.map((r) => moveName(r, boxes)));
    const caughtUp = joinList(pass.caughtUp.map((r) => moveName(r, boxes)));
    const one = pass.labels.length === 1;
    const params = { marchers, through, caughtUp };
    if (through && caughtUp)
        return one
            ? translate(
                  "timeline.edit.passThrough.throughAndCatchUp.one",
                  "{marchers} now moves straight through {through}, then catches up to {caughtUp}'s set by its end.",
                  params,
              )
            : translate(
                  "timeline.edit.passThrough.throughAndCatchUp",
                  "{marchers} now move straight through {through}, then catch up to {caughtUp}'s set by its end.",
                  params,
              );
    if (through)
        return one
            ? translate(
                  "timeline.edit.passThrough.through.one",
                  "{marchers} now moves straight through {through}.",
                  params,
              )
            : translate(
                  "timeline.edit.passThrough.through",
                  "{marchers} now move straight through {through}.",
                  params,
              );
    return one
        ? translate(
              "timeline.edit.passThrough.catchUp.one",
              "{marchers} now catches up to {caughtUp}'s set by its end.",
              params,
          )
        : translate(
              "timeline.edit.passThrough.catchUp",
              "{marchers} now catch up to {caughtUp}'s set by its end.",
              params,
          );
}

/** The action's label: "Only change Page 3", or "Only change from beat 32" for an unnamed page. */
export function narrowingLabel(
    flag: { beat: number; name?: string },
    translate: PassThroughTranslate = defaultTranslate,
): string {
    return flag.name !== undefined
        ? translate(
              "timeline.edit.passThrough.onlyChangePage",
              "Only change Page {page}",
              { page: flag.name },
          )
        : translate(
              "timeline.edit.passThrough.onlyChangeFrom",
              "Only change from beat {beat}",
              { beat: String(flag.beat) },
          );
}

/**
 * Shows what a range move passed through, if anything, with **Only change Page N** when a page
 * flag lies inside the range. `moves` are the drag's moves; the action re-runs the passed
 * marchers' ones.
 */
export function toastPassThrough(
    pass: TimelinePassThrough | undefined,
    moves: readonly TimelineMarcherMove[],
): void {
    if (!pass) return;
    const boxes = useTimelineSelectionStore.getState().pageBoxes;
    const flag = narrowingFlag(pass.range, boxes);
    const passed = new Set(pass.marcherIds);
    const narrowed = moves.filter((m) => passed.has(m.marcherId));
    toast.info(passThroughMessage(pass, boxes), {
        duration: 10000,
        action:
            flag && narrowed.length > 0
                ? {
                      label: narrowingLabel(flag),
                      onClick: () => {
                          moveMarchersFromFlagInstead({
                              db,
                              range: pass.range,
                              from: flag.beat,
                              moves: narrowed,
                          }).catch((e: unknown) =>
                              toastTimelineError(e, "Error moving marchers"),
                          );
                      },
                  }
                : undefined,
    });
}
