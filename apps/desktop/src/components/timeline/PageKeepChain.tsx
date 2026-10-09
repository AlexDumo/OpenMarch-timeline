import { useMemo } from "react";
import { useTranslate } from "@tolgee/react";
import {
    LinkSimpleHorizontalBreakIcon,
    LinkSimpleHorizontalIcon,
} from "@phosphor-icons/react";
import {
    pageChainWords,
    type KeepTranslate,
    type PageChainWords,
    type PageKeepState,
} from "@/timeline/timelineKeepLater";
import { followAgainOn, keepOnPage } from "@/timeline/timelineKeepCommands";
import { HintTooltip } from "./HintTooltip";
import {
    timelineRangeTargetProps,
    type TimelineKeepHereMenu,
} from "./TimelineRangeMenu";
import type { TimelineBeatRange } from "./TimelineViewModel";

/** A page box's chain (`pageChainWords`), with what a click does. */
export interface PageKeepChain extends PageChainWords {
    readonly onToggle: () => void;
}

/** Each page box's chain, by page id; boxes without one aren't in it. */
export type PageKeepChains = ReadonlyMap<string | number, PageKeepChain>;

/**
 * The page box menu's keep entries (`TimelineKeepHereMenu`) from the selection's keep states:
 * **Keep selected marchers here** for the ones that follow on the box, **Let selected marchers
 * follow again** for the kept ones. Neither shows without a selection.
 */
export function keepHereMenu(
    states: readonly PageKeepState[],
): TimelineKeepHereMenu {
    const of = (pageId: string | number) =>
        states.find((s) => String(s.pageId) === String(pageId));
    return {
        stateFor: (pageId) => {
            const state = of(pageId);
            return state
                ? {
                      canKeep: state.follows.length > 0,
                      canFollow: state.kept.length > 0,
                  }
                : null;
        },
        onKeep: (pageId) => {
            const state = of(pageId);
            if (state && state.follows.length > 0)
                void keepOnPage(state.box, state.follows);
        },
        onFollow: (pageId) => {
            const state = of(pageId);
            if (state && state.kept.length > 0)
                void followAgainOn(state.box, state.kept);
        },
    };
}

const NO_CHAINS: PageKeepChains = new Map();

/**
 * The chains on the page boxes for the selected marchers (UI-18 keep later pages): one per box
 * they follow into, or were kept on. None without a selection (owner, 2026-10-09). A click keeps
 * or lets follow again exactly the marchers its words count, as one undo step.
 *
 * @param states the selection's keep states (`usePageKeepStates`)
 */
export function usePageKeepChains(
    states: readonly PageKeepState[],
): PageKeepChains {
    const { t } = useTranslate();
    return useMemo(() => {
        if (states.length === 0) return NO_CHAINS;
        const translate: KeepTranslate = (key, defaultValue, params) =>
            t(key, { defaultValue, ...params });
        const chains = new Map<number, PageKeepChain>();
        for (const state of states) {
            const words = pageChainWords(state, translate);
            if (!words) continue;
            chains.set(state.pageId, {
                ...words,
                onToggle: () =>
                    void (words.action === "keep" ? keepOnPage : followAgainOn)(
                        state.box,
                        words.marcherIds,
                    ),
            });
        }
        return chains;
    }, [states, t]);
}

/** The chain's size: a 20px target in the 28px ruler */
export const CHAIN_SIZE = 20;
/** How far in from the box's left edge: clear of the flag's grip, the start flag and the playhead */
export const CHAIN_INSET = 22;

/**
 * Where a box's chain goes, from the box's left edge (px): in from the flag before it, so the
 * selected page's flag, the start flag and the playhead never cover it; centered in a box too
 * narrow for that and its label.
 */
export function chainOffset(boxWidth: number): number {
    if (boxWidth >= CHAIN_INSET + CHAIN_SIZE + 28) return CHAIN_INSET;
    return Math.max(0, Math.round((boxWidth - CHAIN_SIZE) / 2));
}

const BASE =
    "focus-visible:ring-accent rounded-6 absolute top-[4px] z-30 flex items-center justify-center outline-hidden focus-visible:ring-2";

const KIND_CLASS: Record<PageKeepChain["kind"], string> = {
    // Linked: plain ink, the accent on hover
    follows: "text-text hover:bg-accent/15 hover:text-accent",
    // Kept: broken, in the accent, filled, so it can't be read as linked
    kept: "bg-accent text-text-invert hover:opacity-80",
    // Some kept: linked, with the kept count
    mixed: "text-text hover:bg-accent/15 hover:text-accent",
};

/**
 * A page box's chain (UI-18 keep later pages), a sibling drawn over the box's top left: linked
 * where the selected marchers follow into the page, broken in the accent where they were kept,
 * and linked with the kept count for a mix. Its tooltip names whom a click changes. The press
 * never reaches the box, so it doesn't select, scrub or drag it; a right-click opens the box's
 * menu, which has the same commands.
 */
export function PageKeepChainButton({
    chain,
    pageId,
    pageLabel,
    range,
    left,
}: {
    chain: PageKeepChain;
    pageId: string | number;
    pageLabel: string;
    /** The box's range, for the right-click menu (view beats) */
    range: TimelineBeatRange;
    /** Where the chain goes in the ruler (px) */
    left: number;
}) {
    const Icon =
        chain.kind === "kept"
            ? LinkSimpleHorizontalBreakIcon
            : LinkSimpleHorizontalIcon;
    const stop = (event: { stopPropagation: () => void }) =>
        event.stopPropagation();
    return (
        <HintTooltip label={chain.label} hint={chain.hint} side="top">
            <button
                type="button"
                data-timeline-interactive="true"
                data-testid="page-keep-chain"
                data-chain={chain.kind}
                {...timelineRangeTargetProps(range, undefined, pageId)}
                aria-label={`Page ${pageLabel}: ${chain.label}. ${chain.hint}`}
                className={`${BASE} ${KIND_CLASS[chain.kind]}`}
                style={{ left, width: CHAIN_SIZE, height: CHAIN_SIZE }}
                onPointerDown={stop}
                onMouseDown={stop}
                onDoubleClick={stop}
                onClick={(event) => {
                    event.stopPropagation();
                    chain.onToggle();
                }}
            >
                <Icon size={16} weight="bold" aria-hidden />
                {chain.kind === "mixed" && (
                    <span
                        aria-hidden
                        data-testid="page-keep-chain-count"
                        className="bg-accent text-text-invert absolute -top-[3px] -right-[5px] flex h-[12px] min-w-[12px] items-center justify-center rounded-full px-[2px] text-[9px] leading-none font-bold"
                    >
                        {chain.keptCount}
                    </span>
                )}
            </button>
        </HintTooltip>
    );
}
