import { asc, eq } from "drizzle-orm";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { db, schema } from "@/global/database/db";
import tolgee from "@/global/singletons/Tolgee";
import { generatePageNames } from "@/global/classes/Page";
import {
    moveLaterMovesToo,
    restoreCarriedRuns,
    type MarcherPagesWriteResult,
} from "@/db-functions/marcherPage";
import { invalidateAfterMarcherPagesWrite } from "@/hooks/queries/sharedInvalidators";
import { workspaceSettingsQueryOptions } from "@/hooks/queries/useWorkspaceSettings";
import { conToastError } from "./utils";
import {
    EDIT_SURPRISE_TOAST_ID,
    MOVE_THEM_TOO_TOAST_MS,
    inDrillOrder,
    marcherLabelsById,
    moveThemTooMessage,
} from "./moveThemToo";

/**
 * What page mode says after an edit carried forward to later pages (defined coordinates, 07b;
 * worded by 08): "Pages 3–7 followed (they were copies)", since those pages held copies of the
 * edited one, with **Only Page 2**, which puts those pages back as a second undoable edit
 * (`restoreCarriedRuns`).
 *
 * When the edit also moved marchers whose next page is their own move (they kept its spot), the
 * toast says that instead, with **Move them too** (`moveThemToo.ts`), and no **Only Page 2**:
 * one toast, and the one that explains why some marchers didn't follow.
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
                  "Page {page} followed (it was a copy)",
                  { page: first },
              )
            : translate(
                  "marcherPages.carryForward.pages",
                  "Pages {first}–{last} followed (they were copies)",
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
    if (!result) return;
    if (result.ownMoveStops.length > 0) {
        await toastMoveThemToo(qc, result);
        return;
    }
    if (result.followedPageIds.length === 0) return;
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
        id: EDIT_SURPRISE_TOAST_ID,
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

/**
 * Page mode's **Move them too** toast: names the marchers whose edit stopped at their own later
 * move (`OwnMoveStop`) and that move's page, and shifts those rows by the same offset on click
 * (`moveLaterMovesToo`, its own undoable edit, which carries forward to copies of those pages).
 */
async function toastMoveThemToo(
    qc: QueryClient,
    result: MarcherPagesWriteResult,
): Promise<void> {
    const stops = result.ownMoveStops;
    const [names, labels] = await Promise.all([
        pageNamesById(qc),
        marcherLabelsById(stops.map((s) => s.marcherId)),
    ]);
    const stopOf = new Map(stops.map((s) => [s.marcherId, s]));
    const kept = inDrillOrder([...stopOf.keys()], labels).map((id) => ({
        label: labels.get(id)!.label,
        page: names.get(stopOf.get(id)!.stopPageId) ?? "?",
    }));
    if (kept.length === 0) return;
    const { message, actionLabel } = moveThemTooMessage(kept);
    toast.info(message, {
        id: EDIT_SURPRISE_TOAST_ID,
        duration: MOVE_THEM_TOO_TOAST_MS,
        action: {
            label: actionLabel,
            onClick: () => {
                moveLaterMovesToo({ db, stops })
                    .then((write) =>
                        invalidateAfterMarcherPagesWrite(
                            qc,
                            stops.map((s) => s.stopPageId),
                            write,
                        ),
                    )
                    .catch((e: unknown) =>
                        conToastError("Error moving marchers", e),
                    );
            },
        },
    });
}
