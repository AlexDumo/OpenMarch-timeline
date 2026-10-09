import { Fragment, useMemo, type ReactNode } from "react";
import { useTranslate } from "@tolgee/react";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { useSelectedPage } from "@/context/SelectedPageContext";
import { useTimingObjects } from "@/hooks";
import { useTimelineMode } from "@/hooks/queries/useWorkspaceSettings";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import {
    marcherHoldState,
    sharedHoldState,
    type HoldState,
    type NamedFlag,
} from "@/timeline/timelineHoldState";
import { pageFlags } from "@/timeline/timelinePlayhead";
import {
    resolverSpans,
    useTimelineResolverStore,
} from "@/timeline/timelineStore";
import { followingPages } from "@/timeline/timelineKeepLater";
import { followAgainOn, keepOnPage } from "@/timeline/timelineKeepCommands";
import { usePageKeepStates } from "@/timeline/useKeepLaterPages";
import {
    HintTooltip,
    HintTooltipProvider,
} from "@/components/timeline/HintTooltip";

/**
 * The selection's state on the current page, in timeline mode (docs/timeline/ui.md UI-18):
 * "Moves on this page" or "Hold from Page X" ("Hold from the start" when they haven't moved since
 * their starting set), where the selected marchers agree; nothing when they
 * don't. The current page is the selected page, which follows the paused playhead
 * (`useTimelinePageBridge`).
 */
export function useSelectionHoldState(
    marcherIds: readonly number[],
): HoldState | null {
    const resolver = useTimelineResolverStore((s) => s.resolver);
    const version = useTimelineResolverStore((s) => s.version);
    const { pages } = useTimingObjects()!;
    const { selectedPage } = useSelectedPage()!;
    return useMemo(() => {
        void version; // a new version means new spans
        if (!resolver || !selectedPage || marcherIds.length === 0) return null;
        const all = pageFlags(pages);
        const current = all.find((f) => f.page.id === selectedPage.id);
        if (!current) return null;
        const flags: NamedFlag[] = all.map((f) => ({
            beat: f.flag,
            name: f.page.name,
        }));
        return sharedHoldState(
            marcherIds.map((id) =>
                marcherHoldState(
                    resolverSpans(resolver, id),
                    current.flag,
                    flags,
                ),
            ),
        );
    }, [resolver, version, pages, selectedPage, marcherIds]);
}

const LINK_CLASS =
    "text-body text-text decoration-text/40 hover:decoration-text focus-visible:ring-accent rounded-6 inline-flex items-center gap-4 leading-none underline underline-offset-4 focus-visible:ring focus-visible:outline-none";

/** "·" between the line's parts */
const DOT = (
    <span className="text-text-subtitle leading-none" aria-hidden>
        ·
    </span>
);

/**
 * **Keep here** or **Follow again** after the line (UI-18 keep later pages): a real button styled
 * as the line's link, with a tooltip that says what it changes.
 */
function KeepButton({
    testId,
    label,
    tooltip,
    onClick,
}: {
    testId: string;
    label: string;
    tooltip: string;
    onClick: () => void;
}) {
    return (
        <HintTooltip label={tooltip} side="bottom">
            <button
                type="button"
                className={LINK_CLASS}
                data-testid={testId}
                aria-description={tooltip}
                onClick={onClick}
            >
                {label}
            </button>
        </HintTooltip>
    );
}

/**
 * The selection's keep state on the selected page's box (`PageKeepState`), and which later pages
 * follow it from there (`followingPages`).
 */
function useSelectionKeepState(marcherIds: readonly number[]) {
    const { pages } = useTimingObjects()!;
    const { selectedPage } = useSelectedPage()!;
    const states = usePageKeepStates(pages, marcherIds);
    return useMemo(() => {
        if (!selectedPage || states.length === 0)
            return { here: null, following: null };
        return {
            here: states.find((s) => s.pageId === selectedPage.id) ?? null,
            following: followingPages(
                states,
                selectedPage.id,
                pages[0]?.id ?? null,
            ),
        };
    }, [states, selectedPage, pages]);
}

/**
 * The quiet line under the hold line (UI-18 keep later pages): which later pages follow the
 * selected marchers from this page, so an edit here carries into them.
 */
function FollowingPagesLine({
    following,
}: {
    following: { names: string[]; all: boolean } | null;
}) {
    const { t } = useTranslate();
    if (!following) return null;
    const { names, all } = following;
    const first = names[0]!;
    const last = names[names.length - 1]!;
    const one = names.length === 1;
    const text = all
        ? one
            ? t("inspector.marcher.timeline.pageFollows", {
                  defaultValue: "Page {page} follows these marchers",
                  page: first,
              })
            : t("inspector.marcher.timeline.pagesFollow", {
                  defaultValue: "Pages {first}–{last} follow these marchers",
                  first,
                  last,
              })
        : one
          ? t("inspector.marcher.timeline.pageFollowsSome", {
                defaultValue: "Page {page} follows some of these marchers",
                page: first,
            })
          : t("inspector.marcher.timeline.pagesFollowSome", {
                defaultValue:
                    "Pages {first}–{last} follow some of these marchers",
                first,
                last,
            });
    return (
        <p
            className="text-sub text-text-subtitle px-6 leading-none"
            data-testid="timeline-following-pages"
        >
            {text}
        </p>
    );
}

function TimelineHoldLineContent({
    marcherIds,
}: {
    marcherIds: readonly number[];
}) {
    const { t } = useTranslate();
    const state = useSelectionHoldState(marcherIds);
    const { here, following } = useSelectionKeepState(marcherIds);
    const selected = marcherIds.length;
    const follows = here?.follows ?? [];
    const kept = here?.kept ?? [];
    const page = here?.pageName ?? "";
    const from = here?.from.length === 1 ? here.from[0]! : null;

    const keepButton = here && follows.length > 0 && (
        <KeepButton
            testId="timeline-keep-here"
            label={t("inspector.marcher.timeline.keepHere", {
                defaultValue: "Keep here",
            })}
            tooltip={
                follows.length === selected
                    ? from
                        ? t("inspector.marcher.timeline.keepHereHint", {
                              defaultValue:
                                  "Keep these marchers on Page {page}, so editing Page {from} won't move them here",
                              page,
                              from,
                          })
                        : t("inspector.marcher.timeline.keepHereHintEarlier", {
                              defaultValue:
                                  "Keep these marchers on Page {page}, so editing earlier pages won't move them here",
                              page,
                          })
                    : from
                      ? t("inspector.marcher.timeline.keepSomeHint", {
                            defaultValue:
                                "Keep {count} of these marchers on Page {page}, so editing Page {from} won't move them here",
                            count: String(follows.length),
                            page,
                            from,
                        })
                      : t("inspector.marcher.timeline.keepSomeHintEarlier", {
                            defaultValue:
                                "Keep {count} of these marchers on Page {page}, so editing earlier pages won't move them here",
                            count: String(follows.length),
                            page,
                        })
            }
            onClick={() => void keepOnPage(here.box, follows)}
        />
    );
    const followButton = here && kept.length > 0 && (
        <KeepButton
            testId="timeline-follow-again"
            label={t("inspector.marcher.timeline.followAgain", {
                defaultValue: "Follow again",
            })}
            tooltip={
                kept.length === selected
                    ? from
                        ? t("inspector.marcher.timeline.followAgainHint", {
                              defaultValue:
                                  "Let these marchers follow Page {from} again, so editing Page {from} moves them here too",
                              from,
                          })
                        : t(
                              "inspector.marcher.timeline.followAgainHintEarlier",
                              {
                                  defaultValue:
                                      "Let these marchers follow earlier pages again",
                              },
                          )
                    : from
                      ? t("inspector.marcher.timeline.followSomeHint", {
                            defaultValue:
                                "Let {count} of these marchers follow Page {from} again, so editing Page {from} moves them here too",
                            count: String(kept.length),
                            from,
                        })
                      : t("inspector.marcher.timeline.followSomeHintEarlier", {
                            defaultValue:
                                "Let {count} of these marchers follow earlier pages again",
                            count: String(kept.length),
                        })
            }
            onClick={() => void followAgainOn(here.box, kept)}
        />
    );
    /** The buttons, a dot before each (or only between them, `leading` false) */
    const buttons = (
        leading: boolean,
        ...parts: (ReactNode | false | null | undefined)[]
    ) =>
        parts
            .filter(Boolean)
            .flatMap((part, i) => [
                ...(leading || i > 0
                    ? [<Fragment key={`dot-${i}`}>{DOT}</Fragment>]
                    : []),
                <Fragment key={`part-${i}`}>{part}</Fragment>,
            ]);
    /**
     * The line's words, then its buttons: after a dot for short words, on a line of their own
     * under long ones (the "some of these marchers" wordings), so a wrap never starts with a dot
     */
    const textLine = (
        text: string,
        long: boolean,
        ...parts: (ReactNode | false | null | undefined)[]
    ) => (
        <div className="text-body text-text flex flex-col gap-6 px-6 leading-none">
            <p className="flex flex-wrap items-center gap-6 leading-none">
                <span className="leading-none" data-testid="timeline-hold-line">
                    {text}
                </span>
                {!long && buttons(true, ...parts)}
            </p>
            {long && parts.some(Boolean) && (
                <p className="flex flex-wrap items-center gap-6 leading-none">
                    {buttons(false, ...parts)}
                </p>
            )}
        </div>
    );

    let line: ReactNode = null;
    if (kept.length > 0 && kept.length === selected)
        line = textLine(
            t("inspector.marcher.timeline.keptOnThisPage", {
                defaultValue: "Kept on this page",
            }),
            false,
            followButton,
        );
    else if (kept.length > 0)
        line = textLine(
            t("inspector.marcher.timeline.someKeptOnThisPage", {
                defaultValue: "Some of these marchers are kept on this page",
            }),
            true,
            keepButton,
            followButton,
        );
    else if (state?.kind === "movesHere")
        line = (
            <p
                className="text-body text-text px-6 leading-none"
                data-testid="timeline-hold-line"
            >
                {t("inspector.marcher.timeline.movesOnThisPage", {
                    defaultValue: "Moves on this page",
                })}
            </p>
        );
    else if (state) {
        const { page: holdPage, fromStart } = state;
        line = (
            <p className="flex flex-wrap items-center gap-6 px-6 leading-none">
                <button
                    type="button"
                    className={LINK_CLASS}
                    data-testid="timeline-hold-line"
                    title={
                        fromStart
                            ? t("inspector.marcher.timeline.goToStart", {
                                  defaultValue: "Go to the start",
                              })
                            : t("inspector.marcher.timeline.goToPage", {
                                  defaultValue: "Go to Page {page}",
                                  page: holdPage.name,
                              })
                    }
                    // The go-to-page navigation: the playhead to the page's flag
                    onClick={() =>
                        useTimelineSelectionStore.getState().seek(holdPage.beat)
                    }
                >
                    {fromStart
                        ? t("inspector.marcher.timeline.holdFromStart", {
                              defaultValue: "Hold from the start",
                          })
                        : t("inspector.marcher.timeline.holdFrom", {
                              defaultValue: "Hold from Page {page}",
                              page: holdPage.name,
                          })}
                    <ArrowRightIcon size={14} aria-hidden />
                </button>
                {buttons(true, keepButton)}
            </p>
        );
    } else if (follows.length > 0)
        line = textLine(
            follows.length === selected
                ? t("inspector.marcher.timeline.holdHere", {
                      defaultValue: "These marchers hold here",
                  })
                : t("inspector.marcher.timeline.someHoldHere", {
                      defaultValue: "Some of these marchers hold here",
                  }),
            follows.length !== selected,
            keepButton,
        );
    if (!line && !following) return null;
    return (
        <HintTooltipProvider>
            {line}
            <FollowingPagesLine following={following} />
        </HintTooltipProvider>
    );
}

/**
 * The marcher inspector's line for the selected marchers (UI-18), under Step Size: whether they
 * move on the current page or hold there, with a link to the page they hold from
 * (defined-coordinates 08: readable, and visibly a link). Only in timeline mode.
 */
export default function TimelineHoldLine({
    marcherIds,
}: {
    marcherIds: readonly number[];
}) {
    const timelineMode = useTimelineMode();
    if (!timelineMode) return null;
    return <TimelineHoldLineContent marcherIds={marcherIds} />;
}
