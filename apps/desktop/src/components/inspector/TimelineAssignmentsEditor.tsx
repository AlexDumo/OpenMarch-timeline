import { useCallback, useRef, useState } from "react";
import { TrashIcon, WarningIcon } from "@phosphor-icons/react";
import {
    Button,
    Select,
    SelectContent,
    SelectItem,
    SelectTriggerButton,
} from "@openmarch/ui";
import type { DbConnection } from "@/db-functions/types";
import {
    applyAssignmentEdit,
    castBlocker,
    castCandidates,
    planAssignmentEdit,
    recastBlocker,
    type AssignmentEdit,
    type AssignmentEditTarget,
    type AssignmentMember,
} from "@/timeline/timelineAssignmentEditor";
import { MAX_CAST_SLOTS } from "@/timeline/timelineCasting";
import { toastTimelineError } from "@/timeline/timelineErrorMessages";
import { Field, Help, NumberField, shown } from "./TimelineTransitionEditor";
import type { TimelineInspectorStringKey } from "./timelineInspectorStrings";

type Translate = (
    key: TimelineInspectorStringKey,
    params?: Record<string, string | number>,
) => string;

/** The most slots listed one by one; the rest are counted. */
export const MAX_LISTED_SLOTS = 64;

function SlotPicker({
    member,
    target,
    disabled,
    onPick,
    t,
}: {
    member: AssignmentMember;
    target: AssignmentEditTarget;
    disabled: boolean;
    onPick: (slot: number) => void;
    t: Translate;
}) {
    // Every slot is an option, up to 10000 (I-N2), so they're mounted only while the list is open;
    // closed, the current slot alone names the value
    const [open, setOpen] = useState(false);
    const bySlot = new Map(target.members.map((m) => [m.slot, m]));
    const slots = open
        ? Array.from({ length: target.slotCount }, (_, slot) => slot)
        : [member.slot];
    return (
        <Select
            value={String(member.slot)}
            disabled={disabled}
            open={open}
            onOpenChange={setOpen}
            onValueChange={(value) => {
                if (value !== "") onPick(Number(value));
            }}
        >
            <SelectTriggerButton
                label={t("inspector.timeline.assign.slotFor", {
                    marcher: member.label,
                })}
            />
            <SelectContent>
                {slots.map((slot) => {
                    const occupant = bySlot.get(slot);
                    return (
                        <SelectItem key={slot} value={String(slot)}>
                            {occupant === undefined
                                ? t("inspector.timeline.assign.slotVacant", {
                                      slot,
                                  })
                                : occupant.assignmentId === member.assignmentId
                                  ? t("inspector.timeline.assign.slot", {
                                        slot,
                                    })
                                  : t("inspector.timeline.assign.slotTrade", {
                                        slot,
                                        marcher: occupant.label,
                                    })}
                        </SelectItem>
                    );
                })}
            </SelectContent>
        </Select>
    );
}

function MemberRow({
    member,
    target,
    disabled,
    edit,
    t,
}: {
    member: AssignmentMember;
    target: AssignmentEditTarget;
    disabled: boolean;
    edit: (change: AssignmentEdit) => void;
    t: Translate;
}) {
    const id = member.assignmentId;
    return (
        <li
            className="flex flex-col gap-6"
            data-testid={`timeline-slot-${member.slot}`}
        >
            <div className="flex items-center justify-between gap-8">
                <span className="text-sub font-medium">
                    {t("inspector.timeline.assign.slotMember", {
                        slot: member.slot,
                        marcher: member.label,
                    })}
                </span>
                <Button
                    size="compact"
                    variant="secondary"
                    content="icon"
                    aria-label={t("inspector.timeline.assign.remove", {
                        marcher: member.label,
                    })}
                    disabled={disabled}
                    onClick={() => edit({ kind: "remove", assignmentId: id })}
                >
                    <TrashIcon size={16} />
                </Button>
            </div>
            <SlotPicker
                member={member}
                target={target}
                disabled={disabled}
                onPick={(slot) =>
                    edit({ kind: "slot", assignmentId: id, slot })
                }
                t={t}
            />
            <div className="flex flex-wrap items-center gap-6">
                <span className="text-sub text-text/60">
                    {t("inspector.timeline.label.layer")}
                </span>
                <NumberField
                    label={t("inspector.timeline.assign.layerFor", {
                        marcher: member.label,
                    })}
                    testId={`timeline-assign-layer-${id}`}
                    value={member.layer}
                    step={1}
                    disabled={disabled}
                    onCommit={(layer) =>
                        edit({ kind: "layer", assignmentId: id, layer })
                    }
                />
                <span className="text-sub text-text/60">
                    {t("inspector.timeline.label.beats")}
                </span>
                <NumberField
                    label={t("inspector.timeline.assign.startFor", {
                        marcher: member.label,
                    })}
                    testId={`timeline-assign-start-${id}`}
                    value={member.start}
                    min={target.start}
                    max={target.end - 1}
                    step={1}
                    disabled={disabled}
                    onCommit={(start) =>
                        edit({
                            kind: "beats",
                            assignmentId: id,
                            start,
                            end: member.end,
                        })
                    }
                />
                <NumberField
                    label={t("inspector.timeline.assign.endFor", {
                        marcher: member.label,
                    })}
                    testId={`timeline-assign-end-${id}`}
                    value={member.end}
                    min={target.start + 1}
                    max={target.end}
                    step={1}
                    disabled={disabled}
                    onCommit={(end) =>
                        edit({
                            kind: "beats",
                            assignmentId: id,
                            start: member.start,
                            end,
                        })
                    }
                />
            </div>
            {member.stolen.length === 0 ? (
                <Help>{t("inspector.timeline.assign.notStolen")}</Help>
            ) : (
                member.stolen.map((s) => (
                    <Help
                        key={`${s.start}-${s.end}`}
                        testId={`timeline-assign-stolen-${id}`}
                    >
                        {s.byTransitionId === null
                            ? t("inspector.timeline.assign.stolen", {
                                  start: shown(s.start),
                                  end: shown(s.end),
                              })
                            : t("inspector.timeline.assign.stolenBy", {
                                  start: shown(s.start),
                                  end: shown(s.end),
                                  transition: s.byTransitionId,
                              })}
                    </Help>
                ))
            )}
        </li>
    );
}

/**
 * A transition's slots and assignments (P8.4): who is in each slot, which slots are vacant
 * (D-13), each assignment's layer and beats, and where a higher layer steals it (R-2). Casts the
 * selected marchers into vacant slots, or recasts everyone, by nearest slot. Each change is one
 * undoable edit, a change that writes nothing is skipped, and a refusal is a toast with its
 * friendly message.
 */
export function TimelineAssignmentsEditor({
    target,
    selectedMarcherIds,
    database,
    t,
}: {
    target: AssignmentEditTarget;
    selectedMarcherIds: readonly number[];
    database: DbConnection;
    t: Translate;
}) {
    /**
     * The target the last committed edit was planned from. The controls stay disabled until the
     * inspector rebuilds the target from the edit's rows, so a quick second edit (two slot trades,
     * say) is never planned from the slots before the first. The ref guards clicks before the
     * next render.
     */
    const plannedFrom = useRef<AssignmentEditTarget | null>(null);
    const [awaiting, setAwaiting] = useState<AssignmentEditTarget | null>(null);
    const pending = awaiting === target;
    const edit = useCallback(
        async (change: AssignmentEdit) => {
            if (plannedFrom.current === target) return;
            const plan = planAssignmentEdit(target, change);
            if (plan === null) return;
            plannedFrom.current = target;
            setAwaiting(target);
            try {
                await applyAssignmentEdit(database, plan, target.transitionId);
            } catch (error) {
                // Nothing was written, so the shown target is still current
                plannedFrom.current = null;
                setAwaiting(null);
                toastTimelineError(error);
            }
        },
        [target, database],
    );

    const candidates = castCandidates(target, selectedMarcherIds);
    const cannotCast = castBlocker(
        target,
        candidates,
        selectedMarcherIds.length,
    );
    const cannotRecast = recastBlocker(target);
    const bySlot = new Map(target.members.map((m) => [m.slot, m]));
    const listed = Math.min(target.slotCount, MAX_LISTED_SLOTS);

    return (
        <section
            className="flex flex-col gap-12"
            data-testid={`timeline-assignments-editor-${target.transitionId}`}
            aria-label={t("inspector.timeline.assign.title", {
                id: target.transitionId,
            })}
        >
            <div>
                <h5 className="text-body font-medium">
                    {t("inspector.timeline.assign.title", {
                        id: target.transitionId,
                    })}
                </h5>
                <p className="text-sub text-text/60">
                    {t("inspector.timeline.assign.filled", {
                        filled: target.members.length,
                        count: target.slotCount,
                    })}
                </p>
                {target.vacantSlots.length === 0 ? (
                    <p className="text-sub text-text/60">
                        {t("inspector.timeline.assign.noVacant")}
                    </p>
                ) : (
                    <p
                        className="text-sub flex items-start gap-6"
                        data-testid="timeline-assign-vacancies"
                    >
                        <WarningIcon
                            size={16}
                            className="text-yellow mt-2 shrink-0"
                            aria-hidden
                        />
                        {t("inspector.timeline.assign.vacantList", {
                            count: target.vacantSlots.length,
                            slots: target.vacantSlots.join(", "),
                        })}
                    </p>
                )}
            </div>

            <Field
                label={t("inspector.timeline.assign.casting")}
                help={
                    <>
                        <Help testId="timeline-assign-cast-help">
                            {cannotCast === null
                                ? t("inspector.timeline.assign.castHelp", {
                                      count: candidates.length,
                                  })
                                : cannotCast === "noVacancy"
                                  ? t(
                                        "inspector.timeline.assign.castNoVacancy",
                                        {
                                            count: candidates.length,
                                            vacant: target.vacantSlots.length,
                                        },
                                    )
                                  : cannotCast === "tooManySlots"
                                    ? t(
                                          "inspector.timeline.assign.tooManySlots",
                                          { max: MAX_CAST_SLOTS },
                                      )
                                    : cannotCast === "allCast"
                                      ? t(
                                            "inspector.timeline.assign.castAllCast",
                                        )
                                      : t(
                                            "inspector.timeline.assign.castNoneSelected",
                                        )}
                        </Help>
                        <Help testId="timeline-assign-recast-help">
                            {cannotRecast === null
                                ? t("inspector.timeline.assign.recastHelp")
                                : cannotRecast === "tooManySlots"
                                  ? t(
                                        "inspector.timeline.assign.tooManySlots",
                                        { max: MAX_CAST_SLOTS },
                                    )
                                  : t(
                                        "inspector.timeline.assign.recastNoMembers",
                                    )}
                        </Help>
                    </>
                }
            >
                <div className="flex flex-wrap gap-6">
                    <Button
                        size="compact"
                        variant="secondary"
                        disabled={pending || cannotCast !== null}
                        onClick={() =>
                            void edit({ kind: "cast", marcherIds: candidates })
                        }
                    >
                        {t("inspector.timeline.assign.cast")}
                    </Button>
                    <Button
                        size="compact"
                        variant="secondary"
                        disabled={pending || cannotRecast !== null}
                        onClick={() => void edit({ kind: "recast" })}
                    >
                        {t("inspector.timeline.assign.recast")}
                    </Button>
                </div>
            </Field>

            <Field
                label={t("inspector.timeline.assign.slots")}
                help={<Help>{t("inspector.timeline.assign.layerHelp")}</Help>}
            >
                <ol className="flex flex-col gap-8">
                    {Array.from({ length: listed }, (_, slot) => {
                        const member = bySlot.get(slot);
                        return member ? (
                            <MemberRow
                                key={slot}
                                member={member}
                                target={target}
                                disabled={pending}
                                edit={(change) => void edit(change)}
                                t={t}
                            />
                        ) : (
                            <li
                                key={slot}
                                className="text-sub flex items-center gap-6"
                                data-testid={`timeline-slot-${slot}`}
                            >
                                <WarningIcon
                                    size={16}
                                    className="text-yellow shrink-0"
                                    aria-hidden
                                />
                                {t("inspector.timeline.assign.vacantSlot", {
                                    slot,
                                })}
                            </li>
                        );
                    })}
                </ol>
                {target.slotCount > listed && (
                    <Help>
                        {t("inspector.timeline.assign.moreSlots", {
                            count: target.slotCount - listed,
                        })}
                    </Help>
                )}
            </Field>
        </section>
    );
}

export default TimelineAssignmentsEditor;
