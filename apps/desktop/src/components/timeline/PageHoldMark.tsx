import { useMemo } from "react";
import { useTranslate } from "@tolgee/react";
import { pageHoldMarkLabel, type PageHoldMark } from "@/timeline/pageHoldMarks";
import type { PageHoldMarks } from "@/timeline/usePageHoldMarks";

/** A page box's mark with its words. */
export type LabeledHoldMark = {
    readonly mark: PageHoldMark;
    readonly label: string;
};

/** A page box's mark with its words, by page id. */
export type LabeledHoldMarks = ReadonlyMap<string | number, LabeledHoldMark>;

/**
 * Where the selected marchers hold, drawn inside a page box (docs/timeline/ui.md UI-18; Eos's
 * "moved" and "tracked"): a page they move on gets a small key at its flag, and a page they hold
 * on a thin muted bar along its bottom, level with the key, so a run of held pages reads as one
 * line drawn back to the page they last moved on. Mixed is the same bar, dashed. Shared by the
 * timeline's page boxes and page mode's page strip; the box itself carries the words
 * (`useLabeledHoldMarks`) as its tooltip and accessible description. Kept to the bottom few pixels, clear of the label, the flag line and
 * the playhead's handle, and it never takes the pointer.
 */
export function PageHoldMarkView({
    hold,
    descriptionId,
}: {
    hold: { readonly mark: PageHoldMark; readonly label: string } | undefined;
    /** The id of the words, for the box's `aria-describedby` */
    descriptionId: string;
}) {
    if (!hold) return null;
    const { mark, label } = hold;
    return (
        <>
            <span id={descriptionId} className="sr-only">
                {label}
            </span>
            <span
                aria-hidden="true"
                data-testid="page-hold-mark"
                data-hold-mark={mark.kind}
                className="pointer-events-none absolute inset-0"
            >
                {mark.kind === "moves" ? (
                    <span className="bg-text-subtitle absolute right-[3px] bottom-[1.5px] size-[5px] rotate-45" />
                ) : (
                    <span
                        className={
                            mark.kind === "holds"
                                ? "bg-text-disabled absolute inset-x-0 bottom-[3px] h-[2px]"
                                : "absolute inset-x-0 bottom-[3px] h-[2px]"
                        }
                        style={
                            mark.kind === "mixed"
                                ? {
                                      backgroundImage:
                                          "repeating-linear-gradient(to right, var(--color-text-disabled) 0 4px, transparent 4px 7px)",
                                  }
                                : undefined
                        }
                    />
                )}
            </span>
        </>
    );
}

/** Each mark with its words, for the page box's tooltip and accessible description. */
export function useLabeledHoldMarks(marks: PageHoldMarks): LabeledHoldMarks {
    const { t } = useTranslate();
    return useMemo(
        () =>
            new Map<
                string | number,
                { readonly mark: PageHoldMark; readonly label: string }
            >(
                [...marks].map(([pageId, mark]) => [
                    pageId,
                    {
                        mark,
                        label: pageHoldMarkLabel(
                            mark,
                            (key, defaultValue, params) =>
                                t(key, { defaultValue, ...params }),
                        ),
                    },
                ]),
            ),
        [marks, t],
    );
}
