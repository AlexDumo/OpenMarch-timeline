import { inArray } from "drizzle-orm";
import { db, schema } from "@/global/database/db";
import tolgee from "@/global/singletons/Tolgee";

/**
 * **Move them too** (defined-coordinates 09, G4): after an edit splits the marchers it moved at a
 * later page, some following into it and some keeping their own move's absolute spot there, the
 * ones that kept it no longer travel with the rest. Only a split says anything: where every moved
 * marcher has its own later move (a written show), or every one follows, ordinary edits stay
 * silent (V-146). The surprise toast names them, "OT1 and OT8 have their own move on Page
 * 3, so they kept their spot", with **Move them too**, which shifts those later destinations by
 * the offset the edit moved each marcher, as its own undoable edit. Destinations stay absolute
 * (D-5); this only offers to repeat the edit there. The same in both modes: page mode's write
 * result says where each marcher stopped (`OwnMoveStop`), timeline mode reads it from the
 * resolver (`timelineMoveThemToo.ts`).
 */

/**
 * The one toast for an edit's surprises: a window passing a flag, page mode's carry-forward, and
 * **Move them too** all use it, so a later one replaces the earlier instead of stacking.
 */
export const EDIT_SURPRISE_TOAST_ID = "timeline-edit";

/** How long the toast stays: it has an action */
export const MOVE_THEM_TOO_TOAST_MS = 10000;

/** Translates with ICU parameters; the Tolgee singleton by default, anything in tests. */
export type MoveThemTooTranslate = (
    key: string,
    defaultMessage: string,
    params?: Record<string, string>,
) => string;

const defaultTranslate: MoveThemTooTranslate = (key, defaultMessage, params) =>
    tolgee.t(key, defaultMessage, params);

/** One marcher that kept its later own move's spot, by name, and that move's page. */
export interface KeptMarcher {
    label: string;
    page: string;
}

/**
 * "OT1", "OT1 and OT8", "OT1, OT2 and OT3", and past three, the first two and "and N others"
 * ("OT1, OT2 and 4 others"), so the toast never lists more than three things.
 */
export function marcherNamesList(
    labels: readonly string[],
    translate: MoveThemTooTranslate = defaultTranslate,
): string {
    if (labels.length <= 1) return labels[0] ?? "";
    if (labels.length <= 3)
        return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
    return translate(
        "marcherPages.moveThemToo.namesAndOthers",
        "{first}, {second} and {count} others",
        {
            first: labels[0]!,
            second: labels[1]!,
            count: String(labels.length - 2),
        },
    );
}

/**
 * The toast's text and action label. `kept` is in the order to name them; pages are named as the
 * app shows them ("3").
 */
export function moveThemTooMessage(
    kept: readonly KeptMarcher[],
    translate: MoveThemTooTranslate = defaultTranslate,
): { message: string; actionLabel: string } {
    const names = marcherNamesList(
        kept.map((k) => k.label),
        translate,
    );
    const pages = [...new Set(kept.map((k) => k.page))];
    const actionLabel = translate(
        "marcherPages.moveThemToo.action",
        "Move them too",
    );
    if (pages.length > 1)
        return {
            message: translate(
                "marcherPages.moveThemToo.laterMoves",
                "{names} have their own later moves, so they kept their spots",
                { names },
            ),
            actionLabel,
        };
    const page = pages[0] ?? "";
    return {
        message:
            kept.length === 1
                ? translate(
                      "marcherPages.moveThemToo.oneMarcher",
                      "{names} has its own move on Page {page}, so it kept its spot",
                      { names, page },
                  )
                : translate(
                      "marcherPages.moveThemToo.onePage",
                      "{names} have their own move on Page {page}, so they kept their spot",
                      { names, page },
                  ),
        actionLabel,
    };
}

/** Each marcher's drill number ("OT1"), as the app shows it, by id. */
export async function marcherLabelsById(
    marcherIds: readonly number[],
): Promise<Map<number, { label: string; prefix: string; order: number }>> {
    if (marcherIds.length === 0) return new Map();
    const rows = await db
        .select({
            id: schema.marchers.id,
            prefix: schema.marchers.drill_prefix,
            order: schema.marchers.drill_order,
        })
        .from(schema.marchers)
        .where(inArray(schema.marchers.id, [...new Set(marcherIds)]))
        .all();
    return new Map(
        rows.map((r) => [
            r.id,
            {
                label: `${r.prefix}${r.order}`,
                prefix: r.prefix,
                order: r.order,
            },
        ]),
    );
}

/**
 * `ids` in the order the toast names them: by drill prefix, then drill number, then id. Ids
 * without a marcher row are dropped.
 */
export function inDrillOrder(
    ids: readonly number[],
    labels: ReadonlyMap<number, { prefix: string; order: number }>,
): number[] {
    return ids
        .filter((id) => labels.has(id))
        .sort((a, b) => {
            const la = labels.get(a)!;
            const lb = labels.get(b)!;
            return (
                la.prefix.localeCompare(lb.prefix) ||
                la.order - lb.order ||
                a - b
            );
        });
}
