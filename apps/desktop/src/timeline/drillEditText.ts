import tolgee from "@/global/singletons/Tolgee";
import type { CountSpan, DrillClipRef } from "@/db-functions/drillNames";
import type { TimelineRefusalSubject } from "@/db-functions/timelineErrors";
import type { DrillImpact, DrillMoveImpact } from "@/db-functions/drillEdits";

/**
 * Words for count edits and their refusals (tempo experiment E10): pages, counts, clip names and
 * marcher labels, never beat ordinals or timeline ids. Every string is a Tolgee key under
 * `timeline.drillEdits` with its English default, so a missing translation still reads well.
 */

type Params = Record<string, string | number>;

/** Looks a message up by key, default and ICU params; Tolgee by default, anything in tests */
export type DrillTranslate = (
    key: string,
    defaultMessage: string,
    params?: Params,
) => string;

export const tolgeeTranslate: DrillTranslate = (key, defaultMessage, params) =>
    params
        ? tolgee.t(key, defaultMessage, params)
        : tolgee.t(key, defaultMessage);

const K = "timeline.drillEdits";

/** "Pg 6 counts 3–9", "Pg 6 count 3" or "Pg 6 ct 3 – Pg 8 ct 4" */
export function spanText(span: CountSpan, t: DrillTranslate): string {
    if (span.startPage !== span.endPage)
        return t(
            `${K}.span.pages`,
            "Pg {startPage} ct {startCount} – Pg {endPage} ct {endCount}",
            { ...span },
        );
    if (span.startCount === span.endCount)
        return t(`${K}.span.count`, "Pg {page} count {count}", {
            page: span.startPage,
            count: span.startCount,
        });
    return t(`${K}.span.counts`, "Pg {page} counts {from}–{to}", {
        page: span.startPage,
        from: span.startCount,
        to: span.endCount,
    });
}

/** "Pg 6’s move", "“Rifle break”" or "the move of B1, B2 and 4 more" */
export function clipText(clip: DrillClipRef, t: DrillTranslate): string {
    if (clip.kind === "page")
        return t(`${K}.clip.page`, "Pg {page}’s move", { page: clip.page });
    if (clip.kind === "named")
        return t(`${K}.clip.named`, "“{name}”", { name: clip.name });
    const list = clip.marchers.join(", ");
    const more = clip.total - clip.marchers.length;
    return more > 0
        ? t(`${K}.clip.marchersMore`, "the move of {list} and {more} more", {
              list,
              more,
          })
        : t(`${K}.clip.marchers`, "the move of {list}", { list });
}

/** A step size as steps per five yards: "6 to 5", or "hold" */
export function stepText(stepsPerFiveYards: number, t: DrillTranslate): string {
    if (!Number.isFinite(stepsPerFiveYards)) return t(`${K}.step.hold`, "hold");
    const rounded = Math.round(stepsPerFiveYards * 10) / 10;
    if (rounded > 64) return t(`${K}.step.tiny`, "tiny");
    return t(`${K}.step.toFive`, "{steps} to 5", {
        steps: rounded.toLocaleString(),
    });
}

const capitalize = (text: string) =>
    text.length > 0 ? text[0]!.toUpperCase() + text.slice(1) : text;

/**
 * A refusal in drill words, for the toast and the edit dialogs: what is in the way, where, and
 * what to do about it.
 */
export function refusalText(
    subject: TimelineRefusalSubject,
    t: DrillTranslate,
): string {
    const clip = subject.clip
        ? clipText(subject.clip, t)
        : t(`${K}.clip.unknown`, "a move");
    const where = subject.span ? spanText(subject.span, t) : "";
    const marcher = subject.marcher ?? "";
    switch (subject.reason) {
        case "noCounts":
            return capitalize(
                t(
                    `${K}.refusal.noCounts`,
                    "{clip} ({where}) is only in the counts this removes, so it would have no counts left. Delete or shorten it first, or remove fewer counts.",
                    { clip, where },
                ),
            );
        case "outsideTimeline":
            return capitalize(
                t(
                    `${K}.refusal.outsideTimeline`,
                    "{clip} ({where}) can’t follow this change without coming apart. Move or shorten it first.",
                    { clip, where },
                ),
            );
        case "outsideMove":
            return t(
                `${K}.refusal.outsideMove`,
                "{marcher}’s part in {clip} ({where}) would end up outside that move. Shorten {marcher}’s part first.",
                { marcher, clip, where },
            );
        case "overlap":
            return t(
                `${K}.refusal.overlap`,
                "{marcher} would have two moves at once around {where} ({clip}). Move one of them first.",
                { marcher, clip, where },
            );
        case "offField":
            return t(
                `${K}.refusal.offField`,
                "{marcher} is off the field at {where}, so marchers can’t hold there. Move {marcher} onto the field first.",
                { marcher, where },
            );
    }
}

/** How a line of the report should read: plain, worth a look, or a loss */
export type DrillLineTone = "plain" | "notice" | "loss";

export interface DrillImpactLine {
    readonly tone: DrillLineTone;
    readonly text: string;
}

const countsText = (n: number, t: DrillTranslate) =>
    t(`${K}.counts`, "{n, plural, one {# count} other {# counts}}", { n });

const stepsChange = (move: DrillMoveImpact, t: DrillTranslate) =>
    move.stepBefore !== undefined &&
    move.stepAfter !== undefined &&
    stepText(move.stepBefore, t) !== stepText(move.stepAfter, t)
        ? t(`${K}.move.steps`, " · largest step {from} → {to}", {
              from: stepText(move.stepBefore, t),
              to: stepText(move.stepAfter, t),
          })
        : "";

/** One clip's line */
export function moveLine(
    move: DrillMoveImpact,
    t: DrillTranslate,
): DrillImpactLine {
    const clip = capitalize(clipText(move.clip, t));
    const before = move.before ? spanText(move.before, t) : "";
    const after = move.after ? spanText(move.after, t) : "";
    const counts = {
        clip,
        from: move.countsBefore ?? 0,
        to: move.countsAfter ?? 0,
    };
    switch (move.change) {
        case "deleted":
            return {
                tone: "loss",
                text:
                    move.note === "onlyInCut"
                        ? t(
                              `${K}.move.deletedInCut`,
                              "{clip} ({where}) is only in these counts and is deleted with them",
                              { clip, where: before },
                          )
                        : t(`${K}.move.deleted`, "{clip} ({where}) goes", {
                              clip,
                              where: before,
                          }),
            };
        case "squeezed":
            return {
                tone: "notice",
                text:
                    t(
                        `${K}.move.squeezed`,
                        "{clip}: squeezed from {from} to {to} counts, same set",
                        counts,
                    ) +
                    stepsChange(move, t) +
                    (move.note === "cantSkip"
                        ? t(
                              `${K}.move.cantSkip`,
                              " (it runs on past the cut, and marchers can’t jump)",
                          )
                        : ""),
            };
        case "stretched":
            return {
                tone: "notice",
                text:
                    t(
                        `${K}.move.stretched`,
                        "{clip}: stretched from {from} to {to} counts",
                        counts,
                    ) +
                    stepsChange(move, t) +
                    (move.note === "cantHold"
                        ? t(
                              `${K}.move.cantHold`,
                              " (marchers are partway through it there)",
                          )
                        : ""),
            };
        case "stopsEarly":
            return {
                tone: "notice",
                text: t(
                    `${K}.move.stopsEarly`,
                    "{clip}: stops where marchers are when the cut starts ({where}), so its set is skipped",
                    { clip, where: after },
                ),
            };
        case "holds":
            return {
                tone: "plain",
                text: t(`${K}.move.holds`, "Marchers hold on {where}", {
                    where: after,
                }),
            };
        case "shifted":
            return {
                tone: "plain",
                text: t(
                    `${K}.move.shifted`,
                    "{clip}: moves {n, plural, one {# count} other {# counts}} {direction}",
                    {
                        clip,
                        n: Math.abs(move.shiftBy ?? 0),
                        direction:
                            (move.shiftBy ?? 0) > 0
                                ? t(`${K}.later`, "later")
                                : t(`${K}.earlier`, "earlier"),
                    },
                ),
            };
    }
}

/**
 * The report as lines, most important first: what is lost, then what changes length, then the
 * pages, then a summary of moves that only shift, then tempo. `limit` caps the clip lines (the
 * rest are summed up in one line).
 */
export function impactLines(
    impact: DrillImpact,
    t: DrillTranslate,
    { limit = 8 }: { limit?: number } = {},
): DrillImpactLine[] {
    const lines: DrillImpactLine[] = [];
    const rank: Record<DrillMoveImpact["change"], number> = {
        deleted: 0,
        stopsEarly: 1,
        squeezed: 2,
        stretched: 3,
        holds: 4,
        shifted: 5,
    };
    // A removed page's own move goes with it; the page line says so
    const listed = impact.moves
        .filter((m) => m.change !== "shifted")
        .filter((m) => !(m.change === "deleted" && m.pageMove && !m.note))
        .sort((a, b) => rank[a.change] - rank[b.change]);
    for (const move of listed.slice(0, limit)) lines.push(moveLine(move, t));
    if (listed.length > limit)
        lines.push({
            tone: "plain",
            text: t(
                `${K}.moreMoves`,
                "{n, plural, one {# more move changes} other {# more moves change}}",
                { n: listed.length - limit },
            ),
        });

    for (const page of impact.pages)
        lines.push(
            page.countsAfter === undefined
                ? {
                      tone: "loss",
                      text: t(
                          `${K}.page.removed`,
                          "Pg {page} goes: all of its counts are cut",
                          { page: page.nameBefore },
                      ),
                  }
                : {
                      tone: "plain",
                      text: t(
                          `${K}.page.counts`,
                          "Pg {page}: {from} → {to} counts",
                          {
                              page: page.nameBefore,
                              from: page.countsBefore,
                              to: page.countsAfter,
                          },
                      ),
                  },
        );
    if (impact.renumbered)
        lines.push({
            tone: "notice",
            text: t(
                `${K}.renumbered`,
                "Later pages renumber: Pg {from} becomes Pg {to}",
                impact.renumbered,
            ),
        });

    const shifted = impact.moves.filter((m) => m.change === "shifted");
    if (shifted.length > 0) {
        const by = shifted[0]!.shiftBy ?? 0;
        const same = shifted.every((m) => m.shiftBy === by);
        lines.push({
            tone: "plain",
            text: same
                ? t(
                      `${K}.shiftedSummary`,
                      "{n, plural, one {# later move moves} other {# later moves move}} {counts} {direction}, unchanged",
                      {
                          n: shifted.length,
                          counts: countsText(Math.abs(by), t),
                          direction:
                              by > 0
                                  ? t(`${K}.later`, "later")
                                  : t(`${K}.earlier`, "earlier"),
                      },
                  )
                : t(
                      `${K}.shiftedMixed`,
                      "{n, plural, one {# other move moves} other {# other moves move}}, unchanged",
                      { n: shifted.length },
                  ),
        });
    }

    for (const timing of impact.timing)
        lines.push({
            tone: "notice",
            text: t(
                timing.bpmAfter > timing.bpmBefore
                    ? `${K}.timing.faster`
                    : `${K}.timing.slower`,
                timing.bpmAfter > timing.bpmBefore
                    ? "Pg {page} gets faster: {from} → {to} BPM"
                    : "Pg {page} gets slower: {from} → {to} BPM",
                {
                    page: timing.page,
                    from: Math.round(timing.bpmBefore),
                    to: Math.round(timing.bpmAfter),
                },
            ),
        });
    if (impact.countsAfter !== impact.countsBefore)
        lines.push({
            tone: "plain",
            text: t(`${K}.total`, "Show: {from} → {to} counts", {
                from: impact.countsBefore,
                to: impact.countsAfter,
            }),
        });
    if (lines.length === 0)
        lines.push({
            tone: "plain",
            text: t(`${K}.noDrillChange`, "No move changes."),
        });
    return lines;
}

/** A short summary for a toast after the edit: the page lines and the first clip lines */
export function impactSummary(impact: DrillImpact, t: DrillTranslate): string {
    return impactLines(impact, t, { limit: 2 })
        .slice(0, 4)
        .map((line) => line.text)
        .join(" · ");
}
