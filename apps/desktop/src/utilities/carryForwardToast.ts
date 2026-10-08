import { asc, eq } from "drizzle-orm";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { db, schema } from "@/global/database/db";
import tolgee from "@/global/singletons/Tolgee";
import { generatePageNames } from "@/global/classes/Page";
import {
    restoreCarriedRuns,
    type MarcherPagesWriteResult,
} from "@/db-functions/marcherPage";
import { invalidateAfterMarcherPagesWrite } from "@/hooks/queries/sharedInvalidators";
import { workspaceSettingsQueryOptions } from "@/hooks/queries/useWorkspaceSettings";
import { conToastError } from "./utils";

/**
 * What page mode says after an edit carried forward to later pages (defined coordinates, 07b):
 * "Also moved on Pages 3–7", with **Only Page 2**, which puts those pages back as a second
 * undoable edit (`restoreCarriedRuns`).
 */

/** Translates with ICU parameters; the Tolgee singleton by default, anything in tests. */
export type CarryForwardTranslate = (
    key: string,
    defaultMessage: string,
    params?: Record<string, string>,
) => string;

const defaultTranslate: CarryForwardTranslate = (key, defaultMessage, params) =>
    tolgee.t(key, defaultMessage, params);

/**
 * The toast's text and action label. `followed` and `edited` are page names in page order;
 * `followed` is aggregated over every marcher as its first to last page.
 */
export function carryForwardMessage(
    followed: readonly string[],
    edited: readonly string[],
    translate: CarryForwardTranslate = defaultTranslate,
): { message: string; actionLabel: string } {
    const first = followed[0] ?? "";
    const last = followed[followed.length - 1] ?? first;
    const message =
        first === last
            ? translate(
                  "marcherPages.carryForward.onePage",
                  "Also moved on Page {page}",
                  { page: first },
              )
            : translate(
                  "marcherPages.carryForward.pages",
                  "Also moved on Pages {first}–{last}",
                  { first, last },
              );
    const actionLabel =
        edited.length === 1
            ? translate("marcherPages.carryForward.only", "Only Page {page}", {
                  page: edited[0],
              })
            : translate(
                  "marcherPages.carryForward.onlyEdited",
                  "Only the edited pages",
              );
    return { message, actionLabel };
}

/** Every page's name, as the app shows it (with the file's page number offset). */
async function pageNamesById(qc: QueryClient): Promise<Map<number, string>> {
    const pages = await db
        .select({ id: schema.pages.id, is_subset: schema.pages.is_subset })
        .from(schema.pages)
        .innerJoin(schema.beats, eq(schema.beats.id, schema.pages.start_beat))
        .orderBy(asc(schema.beats.position))
        .all();
    const offset = await qc
        .fetchQuery(workspaceSettingsQueryOptions())
        .then((settings) => settings.pageNumberOffset ?? 0)
        .catch(() => 0);
    const names = generatePageNames(
        pages.map((p) => Boolean(p.is_subset)),
        offset,
    );
    return new Map(pages.map((p, i) => [p.id, names[i]]));
}

/**
 * After a page-mode write: when it carried forward to later pages, says which, and offers
 * **Only Page N**. Says nothing when nothing was carried.
 */
export async function toastCarryForward(
    qc: QueryClient,
    result: MarcherPagesWriteResult | undefined,
): Promise<void> {
    if (!result || result.followedPageIds.length === 0) return;
    const names = await pageNamesById(qc);
    const order = [...names.keys()];
    const editedPageIds = [
        ...new Set(result.carried.map((r) => r.pageId)),
    ].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const name = (id: number) => names.get(id) ?? "?";
    const { message, actionLabel } = carryForwardMessage(
        result.followedPageIds.map(name),
        editedPageIds.map(name),
    );
    toast.message(message, {
        duration: 10000,
        action: {
            label: actionLabel,
            onClick: () => {
                restoreCarriedRuns({ db, carried: result.carried })
                    .then((pageIds) =>
                        invalidateAfterMarcherPagesWrite(qc, pageIds),
                    )
                    .catch((e: unknown) =>
                        conToastError("Error moving marchers back", e),
                    );
            },
        },
    });
}
