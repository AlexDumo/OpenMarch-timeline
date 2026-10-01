import type { AssignmentRow, SpanInfo, TransitionRow } from "@openmarch/core";
import type { DbConnection } from "@/db-functions/types";
import {
    castMarchersIntoTransition,
    recastTransition,
    removeAssignment,
    setAssignmentSlot,
    updateAssignment,
} from "@/db-functions/timelineAssignmentEdits";
import { MAX_CAST_SLOTS } from "./timelineCasting";

/**
 * The inspector's assignments editor (P8.4): who is in a transition's slots, which slots are
 * vacant (D-13), each assignment's layer and beats, and where a higher layer steals it (R-2,
 * ui.md UI-1). Pure apart from `applyAssignmentEdit`, which runs the planned db-function.
 *
 * As in the transition editor, every change is planned against the target the inspector shows, a
 * change that would write nothing is planned as `null` and skipped, and the editor plans nothing
 * until the target is rebuilt after its last edit. Casting picks its slots inside the edit's own
 * transaction, from the positions the committed rows give.
 */

/** Part of an assignment's beats where another assignment of the marcher wins (R-2). */
export interface StolenRange {
    start: number;
    end: number;
    /** The transition of the winning assignment */
    byTransitionId: number | null;
}

/** One assignment, as the editor shows it. */
export interface AssignmentMember {
    assignmentId: number;
    marcherId: number;
    /** The drill number, such as "T3" */
    label: string;
    slot: number;
    start: number;
    end: number;
    layer: number;
    /** Where a higher layer steals this assignment, in beat order; empty when it never is */
    stolen: StolenRange[];
}

/** A transition's slots and assignments, as the editor shows them. */
export interface AssignmentEditTarget {
    transitionId: number;
    start: number;
    end: number;
    slotCount: number;
    /** In slot order */
    members: AssignmentMember[];
    /** The slots nobody is assigned to, in order (D-13, D-VACANT) */
    vacantSlots: number[];
}

/** One control's change. */
export type AssignmentEdit =
    | { kind: "cast"; marcherIds: readonly number[] }
    | { kind: "recast" }
    | { kind: "slot"; assignmentId: number; slot: number }
    | { kind: "layer"; assignmentId: number; layer: number }
    | { kind: "beats"; assignmentId: number; start: number; end: number }
    | { kind: "remove"; assignmentId: number };

/**
 * The parts of `row`'s beats where the marcher's winning span (R-2) belongs to another
 * assignment, merged where one transition steals several pieces in a row.
 */
export function stolenRanges(
    row: AssignmentRow,
    spans: readonly SpanInfo[],
): StolenRange[] {
    const out: StolenRange[] = [];
    for (const span of spans) {
        const start = Math.max(span.start, row.start);
        const end = Math.min(span.end, row.end);
        if (end <= start || span.assignmentId === row.id) continue;
        const last = out[out.length - 1];
        if (
            last &&
            last.end === start &&
            last.byTransitionId === span.transitionId
        )
            last.end = end;
        else out.push({ start, end, byTransitionId: span.transitionId });
    }
    return out;
}

/** The editor's view of `transition`'s slots, from the stored assignments and resolver spans. */
export function buildAssignmentEditTarget(
    transition: TransitionRow,
    sources: {
        assignments: readonly AssignmentRow[];
        labels: ReadonlyMap<number, string>;
        spansOf: (marcherId: number) => readonly SpanInfo[];
    },
): AssignmentEditTarget {
    const members = sources.assignments
        .filter((a) => a.transition === transition.id)
        .sort((a, b) => a.slot - b.slot)
        .map(
            (a): AssignmentMember => ({
                assignmentId: a.id,
                marcherId: a.marcher,
                label: sources.labels.get(a.marcher) ?? String(a.marcher),
                slot: a.slot,
                start: a.start,
                end: a.end,
                layer: a.layer,
                stolen: stolenRanges(a, sources.spansOf(a.marcher)),
            }),
        );
    const taken = new Set(members.map((m) => m.slot));
    const vacantSlots: number[] = [];
    for (let slot = 0; slot < transition.slots; slot++)
        if (!taken.has(slot)) vacantSlots.push(slot);
    return {
        transitionId: transition.id,
        start: transition.start,
        end: transition.end,
        slotCount: transition.slots,
        members,
        vacantSlots,
    };
}

/** The selected marchers that aren't in the transition yet, in the given order. */
export function castCandidates(
    target: AssignmentEditTarget,
    selectedMarcherIds: readonly number[],
): number[] {
    const members = new Set(target.members.map((m) => m.marcherId));
    return selectedMarcherIds.filter((id) => !members.has(id));
}

/** Why the selected marchers can't be cast into the transition, or null when they can. */
export function castBlocker(
    target: AssignmentEditTarget,
    candidates: readonly number[],
    selectedCount: number,
): "noneSelected" | "allCast" | "noVacancy" | "tooManySlots" | null {
    if (selectedCount === 0) return "noneSelected";
    if (candidates.length === 0) return "allCast";
    if (target.slotCount > MAX_CAST_SLOTS) return "tooManySlots";
    if (target.vacantSlots.length < candidates.length) return "noVacancy";
    return null;
}

/** Why the transition can't be recast by nearest slot, or null when it can. */
export function recastBlocker(
    target: AssignmentEditTarget,
): "noMembers" | "tooManySlots" | null {
    if (target.members.length === 0) return "noMembers";
    if (target.slotCount > MAX_CAST_SLOTS) return "tooManySlots";
    return null;
}

/**
 * The change to run, or null when it changes nothing. The values are planned as given: the
 * db-functions refuse anything out of range.
 */
export function planAssignmentEdit(
    target: AssignmentEditTarget,
    edit: AssignmentEdit,
): AssignmentEdit | null {
    if (edit.kind === "cast") return edit.marcherIds.length === 0 ? null : edit;
    if (edit.kind === "recast") return edit;
    const member = target.members.find(
        (m) => m.assignmentId === edit.assignmentId,
    );
    // An assignment the shown target doesn't have: let the db-function say why
    if (!member) return edit;
    switch (edit.kind) {
        case "slot":
            return edit.slot === member.slot ? null : edit;
        case "layer":
            return edit.layer === member.layer ? null : edit;
        case "beats":
            return edit.start === member.start && edit.end === member.end
                ? null
                : edit;
        case "remove":
            return edit;
    }
}

/** Runs a planned change as one undoable edit. */
export async function applyAssignmentEdit(
    db: DbConnection,
    plan: AssignmentEdit,
    transitionId: number,
): Promise<void> {
    switch (plan.kind) {
        case "cast":
            await castMarchersIntoTransition({
                db,
                transitionId,
                marcherIds: plan.marcherIds,
            });
            return;
        case "recast":
            await recastTransition({ db, transitionId });
            return;
        case "slot":
            await setAssignmentSlot({
                db,
                assignmentId: plan.assignmentId,
                slot: plan.slot,
            });
            return;
        case "layer":
            await updateAssignment({
                db,
                assignmentId: plan.assignmentId,
                change: { layer: plan.layer },
            });
            return;
        case "beats":
            await updateAssignment({
                db,
                assignmentId: plan.assignmentId,
                change: { startBeat: plan.start, endBeat: plan.end },
            });
            return;
        case "remove":
            await removeAssignment({ db, assignmentId: plan.assignmentId });
            return;
    }
}
