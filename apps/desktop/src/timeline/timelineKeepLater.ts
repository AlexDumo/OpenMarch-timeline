import type { SpanInfo } from "@openmarch/core";
import { keptStateOf, type KeptPageBox } from "./timelineKept";

/**
 * Keep later pages in timeline mode (docs/timeline/ui.md UI-18; defined-coordinates 10, owner
 * decision 2026-10-09): which page boxes the selected marchers follow into and where they were
 * kept, for the chains on the page boxes, the inspector line, the page box menu and **K**. Pure:
 * works over each marcher's resolver spans and the stored kept markers
 * (`readKeptAssignmentIds`); the commands are `keepMarchersOnPage` and `followAgainOnPage`.
 *
 * A marcher **follows** on a box where it has no move of its own (`KeptState` "follows") after
 * an earlier move: an edit of the page it last moved on carries into the box. Before its first
 * move it holds from the start, which nothing here offers to keep (lead default: there's no page
 * to stop following, and every box would show a chain). It is **kept** where its only move over
 * the box is a stored kept spot.
 */

/** A page with its flag and box (`pageFlags`), and its name as the app shows it. */
export interface KeepPage {
    readonly id: number;
    readonly name: string;
    /** The page's flag; 0 for home */
    readonly flag: number;
    /** The page's box; `null` for home */
    readonly range: KeptPageBox | null;
}

/** The selection's keep state on one page box. */
export interface PageKeepState {
    readonly pageId: number;
    readonly pageName: string;
    readonly box: KeptPageBox;
    /** The selected marchers that follow into the box after an earlier move, ascending */
    readonly follows: number[];
    /** The selected marchers with a kept spot over the box, ascending */
    readonly kept: number[];
    /**
     * The pages those marchers follow (or would follow again) into the box: where each last moved
     * before it, in page order. Empty when they'd hold from the start.
     */
    readonly from: string[];
    /** How many marchers are selected */
    readonly selected: number;
}

type Row = { id: number; marcher: number; start: number; end: number };

/** A marcher's moves (its spans that aren't holds), as the rows `keptStateOf` reads. */
export function movesFromSpans(spans: readonly SpanInfo[]): Row[] {
    return spans.flatMap((s) =>
        s.kind === "hold" || s.assignmentId === null
            ? []
            : [
                  {
                      id: s.assignmentId,
                      marcher: s.marcherId,
                      start: s.start,
                      end: s.end,
                  },
              ],
    );
}

/** The page whose box holds `beat` (start, flag], by index into `pages`; -1 for none. */
const pageAt = (pages: readonly KeepPage[], beat: number): number =>
    pages.findIndex((p) => p.range && beat > p.range.start && beat <= p.flag);

/**
 * The selection's keep state on every page box, in page order (home has none).
 *
 * @param spansOf a marcher's resolver spans (`resolverSpans`)
 * @param kept the kept assignments' ids
 */
export function pageKeepStates({
    pages,
    marcherIds,
    spansOf,
    kept,
}: {
    pages: readonly KeepPage[];
    marcherIds: readonly number[];
    spansOf: (marcherId: number) => readonly SpanInfo[];
    kept: ReadonlySet<number>;
}): PageKeepState[] {
    const ids = [...new Set(marcherIds)].sort((a, b) => a - b);
    const moves = new Map(ids.map((id) => [id, movesFromSpans(spansOf(id))]));
    const out: PageKeepState[] = [];
    for (const page of pages) {
        const box = page.range;
        if (!box) continue;
        const follows: number[] = [];
        const keptHere: number[] = [];
        const fromPages = new Set<number>();
        for (const id of ids) {
            const rows = moves.get(id)!;
            const state = keptStateOf(
                rows.filter((r) => r.start < box.end && r.end > box.start),
                box,
                kept,
            );
            if (state !== "follows" && state !== "kept") continue;
            const before = rows
                .filter((r) => r.end <= box.start)
                .reduce<Row | null>(
                    (last, r) => (last && last.end >= r.end ? last : r),
                    null,
                );
            if (state === "follows" && !before) continue;
            (state === "follows" ? follows : keptHere).push(id);
            const source = before ? pageAt(pages, before.end) : -1;
            if (source >= 0) fromPages.add(source);
        }
        out.push({
            pageId: page.id,
            pageName: page.name,
            box: { start: box.start, end: box.end },
            follows,
            kept: keptHere,
            from: [...fromPages]
                .sort((a, b) => a - b)
                .map((i) => pages[i]!.name),
            selected: ids.length,
        });
    }
    return out;
}

/** The index into `states` of the box after the page `pageId` (home's is the first box). */
const nextBoxIndex = (
    states: readonly PageKeepState[],
    pageId: number,
    homePageId: number | null,
): number => {
    const current = states.findIndex((s) => s.pageId === pageId);
    if (current >= 0) return current + 1;
    return pageId === homePageId ? 0 : -1;
};

/**
 * The later pages that follow the selection from the page `currentPageId` (an edit there carries
 * into them): for each marcher, the boxes right after it, in a row, that it follows into, in page
 * order. `all` says whether every selected marcher follows into every one of them. Null for none.
 */
export function followingPages(
    states: readonly PageKeepState[],
    currentPageId: number,
    homePageId: number | null = null,
): { names: string[]; all: boolean } | null {
    const first = nextBoxIndex(states, currentPageId, homePageId);
    if (first < 0 || first >= states.length) return null;
    const selected = states[first]!.selected;
    const names: string[] = [];
    let all = true;
    let still = new Set(states[first]!.follows);
    for (let i = first; i < states.length && still.size > 0; i++) {
        const here = new Set(states[i]!.follows);
        still = new Set([...still].filter((id) => here.has(id)));
        if (still.size === 0) break;
        names.push(states[i]!.pageName);
        if (still.size !== selected) all = false;
    }
    return names.length === 0 ? null : { names, all };
}

/** "Page 3" or "Pages 3–4" (first to last of `names`, in page order). */
export function pagesText(names: readonly string[]): string {
    if (names.length === 0) return "";
    if (names.length === 1) return `Page ${names[0]}`;
    return `Pages ${names[0]}–${names[names.length - 1]}`;
}

/** A translate function, as Tolgee's `t` with a default value. */
export type KeepTranslate = (
    key: string,
    defaultValue: string,
    params?: Record<string, string>,
) => string;

const english: KeepTranslate = (_key, defaultValue, params) =>
    defaultValue.replace(
        /\{(\w+)\}/g,
        (_, name: string) => params?.[name] ?? "",
    );

/** What a chain on a page box shows. */
export type PageChainKind = "follows" | "kept" | "mixed";

/** A page box's chain: how it looks, its words, and whom a click changes. */
export interface PageChainWords {
    readonly kind: PageChainKind;
    readonly label: string;
    readonly hint: string;
    /** A click keeps these marchers (follows, mixed) or lets them follow again (kept) */
    readonly action: "keep" | "follow";
    readonly marcherIds: readonly number[];
    /** How many are kept, for a mixed chain's badge */
    readonly keptCount: number;
}

/** A linked chain's words: whom a click keeps, and the page they stop following. */
const followsWords = (
    follows: readonly number[],
    page: string,
    fromPage: string | null,
    t: KeepTranslate,
): Pick<PageChainWords, "label" | "hint"> => {
    const one = follows.length === 1;
    const label = one
        ? t("timeline.keep.chain.keepOne", "Keep 1 marcher on Page {page}", {
              page,
          })
        : t(
              "timeline.keep.chain.keep",
              "Keep {count} marchers on Page {page}",
              {
                  page,
                  count: String(follows.length),
              },
          );
    if (!fromPage)
        return {
            label,
            hint: t(
                "timeline.keep.chain.keepHintEarlier",
                "They won't follow earlier pages any more",
            ),
        };
    return {
        label,
        hint: one
            ? t(
                  "timeline.keep.chain.keepHintOne",
                  "It won't follow Page {from} any more",
                  { from: fromPage },
              )
            : t(
                  "timeline.keep.chain.keepHint",
                  "They won't follow Page {from} any more",
                  { from: fromPage },
              ),
    };
};

/** A kept chain's words: how many were kept, and the page a click follows again. */
const keptWords = (
    kept: readonly number[],
    page: string,
    fromPage: string | null,
    t: KeepTranslate,
): Pick<PageChainWords, "label" | "hint"> => ({
    label:
        kept.length === 1
            ? t(
                  "timeline.keep.chain.keptOne",
                  "1 marcher kept on Page {page}",
                  {
                      page,
                  },
              )
            : t(
                  "timeline.keep.chain.kept",
                  "{count} marchers kept on Page {page}",
                  { page, count: String(kept.length) },
              ),
    hint: fromPage
        ? t(
              "timeline.keep.chain.followHint",
              "Click to follow Page {from} again",
              { from: fromPage },
          )
        : t(
              "timeline.keep.chain.followHintEarlier",
              "Click to follow earlier pages again",
          ),
});

/** A mixed chain's words: the count kept, and the rest a click keeps. */
const mixedWords = (
    follows: readonly number[],
    kept: readonly number[],
    page: string,
    t: KeepTranslate,
): Pick<PageChainWords, "label" | "hint"> => ({
    label: t(
        "timeline.keep.chain.mixed",
        "{kept} of {total} kept on Page {page}",
        {
            page,
            kept: String(kept.length),
            total: String(kept.length + follows.length),
        },
    ),
    hint:
        follows.length === 1
            ? t(
                  "timeline.keep.chain.mixedHintOne",
                  "Click to keep the other one too",
              )
            : t(
                  "timeline.keep.chain.mixedHint",
                  "Click to keep the other {count} too",
                  { count: String(follows.length) },
              ),
});

/**
 * A page box's chain for the selection, or null where none follows into it or was kept there:
 * linked where they follow (a click keeps them), broken where they were kept (a click lets them
 * follow again), and for a mix the count kept (a click keeps the rest). The words name the count
 * a click changes, so a click on a group's chain never surprises (the study's selection trap).
 */
export function pageChainWords(
    state: PageKeepState,
    t: KeepTranslate = english,
): PageChainWords | null {
    const { follows, kept, pageName: page, from } = state;
    if (follows.length === 0 && kept.length === 0) return null;
    const fromPage = from.length === 1 ? from[0]! : null;
    if (kept.length === 0)
        return {
            kind: "follows",
            ...followsWords(follows, page, fromPage, t),
            action: "keep",
            marcherIds: follows,
            keptCount: 0,
        };
    if (follows.length === 0)
        return {
            kind: "kept",
            ...keptWords(kept, page, fromPage, t),
            action: "follow",
            marcherIds: kept,
            keptCount: kept.length,
        };
    return {
        kind: "mixed",
        ...mixedWords(follows, kept, page, t),
        action: "keep",
        marcherIds: follows,
        keptCount: kept.length,
    };
}

/**
 * What **K** does on the page after `currentPageId`: keep the selected marchers that follow
 * there, or, when none does, let the kept ones follow again. Null when neither applies or
 * there's no next page.
 */
export function nextPageToggle(
    states: readonly PageKeepState[],
    currentPageId: number,
    homePageId: number | null,
): {
    action: "keep" | "follow";
    box: KeptPageBox;
    marcherIds: number[];
} | null {
    const next = states[nextBoxIndex(states, currentPageId, homePageId)];
    if (!next) return null;
    if (next.follows.length > 0)
        return { action: "keep", box: next.box, marcherIds: next.follows };
    if (next.kept.length > 0)
        return { action: "follow", box: next.box, marcherIds: next.kept };
    return null;
}
