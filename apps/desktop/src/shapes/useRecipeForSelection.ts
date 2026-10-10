import { useQuery } from "@tanstack/react-query";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/global/database/db";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useTimelineMode } from "@/hooks/queries/useWorkspaceSettings";
import {
    readShapeRecipes,
    type StoredShapeRecipe,
} from "@/db-functions/shapeRecipes";
import { planCanvasEdit } from "@/timeline/timelineCoordinateWrites";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { shapeKind } from "./registry";

/**
 * The placed shape (ADR 0004) whose marchers are exactly the selection, at the moment the
 * canvas edits (the end of the move being edited, or the homes), so the Shape panel can offer
 * to edit it. Null in page mode, with nothing selected, or when the selection isn't one shape.
 * Shapes of kinds this app doesn't know (a newer file) aren't offered.
 */
export function useRecipeForSelection(): StoredShapeRecipe | null {
    const timelineMode = useTimelineMode();
    const selected = useSelectedMarchers()?.selectedMarchers ?? [];
    // Re-plan when the edit window or isolation changes
    const selection = useTimelineSelectionStore((s) => s.selection);
    const isolation = useTimelineSelectionStore((s) => s.isolation);
    const plan = planCanvasEdit({ selection, isolation });
    const ids = selected.map((m) => m.id).sort((a, b) => a - b);
    // Where the canvas edits, as plain data: the query key and the query read the same thing
    const target = !plan.ok
        ? null
        : plan.target.kind === "timeline"
          ? { kind: "timeline" as const, id: plan.target.timelineId }
          : plan.target.kind === "range"
            ? {
                  kind: "range" as const,
                  start: plan.target.start,
                  end: plan.target.end,
              }
            : { kind: "home" as const };

    const { data } = useQuery({
        queryKey: ["timeline_shape_recipes", target, ids],
        enabled: timelineMode && target !== null && ids.length > 0,
        queryFn: async () => {
            if (!target) return null;
            let timelineId: number | null = null;
            if (target.kind === "timeline") timelineId = target.id;
            else if (target.kind === "range") {
                const row = await db
                    .select({ id: schema.timelines.id })
                    .from(schema.timelines)
                    .where(
                        and(
                            eq(schema.timelines.start_beat, target.start),
                            eq(schema.timelines.end_beat, target.end),
                        ),
                    )
                    .get();
                if (!row) return null;
                timelineId = row.id;
            }
            const recipes = await readShapeRecipes({
                db,
                timelineId,
                marcherIds: ids,
            });
            const wanted = new Set(ids);
            return (
                recipes.find(
                    (r) =>
                        shapeKind(r.kind) !== undefined &&
                        r.members.length === wanted.size &&
                        r.members.every((m) => wanted.has(m.marcherId)),
                ) ?? null
            );
        },
    });
    return timelineMode && ids.length > 0 ? (data ?? null) : null;
}
