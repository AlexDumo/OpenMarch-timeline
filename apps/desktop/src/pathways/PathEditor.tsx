import { useLayoutEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { T } from "@tolgee/react";
import {
    ArrowCounterClockwiseIcon,
    ArrowsMergeIcon,
    ArrowsOutLineHorizontalIcon,
    ArrowsSplitIcon,
    BackspaceIcon,
    LineSegmentsIcon,
    TrashIcon,
    WarningIcon,
    WaveSineIcon,
    XIcon,
} from "@phosphor-icons/react";
import type { FieldProperties } from "@openmarch/core";
import tolgee from "@/global/singletons/Tolgee";
import Shortcut from "@/components/ui/Shortcut";
import { RichTips, Tip } from "@/components/ui/Tip";
import { runAction } from "@/shortcuts/registry";
import { useShortcutOverridesStore } from "@/stores/ShortcutOverridesStore";
import { getActionShortcutKeys } from "@/shortcuts/labels";
import { StepSize } from "@/global/classes/StepSize";
import { fieldToElement, useFieldViewStore } from "@/field/three/fieldView";
import { editorPlacement } from "@/shapes/editor/editorPlacement";
import {
    Divider,
    EDITOR_BAR,
    EditorButton,
    IconButton,
} from "@/shapes/editor/EditorBarParts";
import type { XY } from "@/shapes/types";
import { refitNeeded } from "./pathTarget";
import {
    memberNow,
    memberOf,
    shapeOf,
    usePathPenStore,
    type PathSession,
} from "./pathPenStore";
import {
    curveOf,
    groupLegDistances,
    isSmooth,
    memberWalkOf,
    pathOutline,
    pointOf,
    scheduleOf,
    type LegWhere,
} from "./pathEdit";

/**
 * The Big steps advice for a path (spec v0.9 Appendix I.2, I.5): one steady speed means every leg
 * has the same step size, the path's length (curves included) over the move's counts, tested as
 * straight moves are (`StepSize`, the field's step-size warning). Null when the steps aren't big,
 * or with the warning off.
 */
export function bigSteps(
    session: PathSession,
    fieldProperties: FieldProperties,
): BigSteps | null {
    const { target } = session;
    const counts = target.end - target.start;
    if (target.group) return groupBigSteps(session, fieldProperties);
    const size = StepSize.fromDistance({
        marcher_id: target.marcherId,
        distance: curveOf(shapeOf(session)).L,
        counts,
        fieldProperties,
    });
    if (!size.exceedsThreshold(fieldProperties.stepSizeWarningThresholdInches))
        return null;
    return {
        steps: size.displayString(),
        inches: Math.round(size.inchesPerStep),
        where: null,
        legs: [],
    };
}

/** Big steps' verdict: the worst big leg, and every big leg (a group path's, step 15) */
export interface BigSteps {
    steps: string;
    inches: number;
    /** Which leg of a group path is worst; null for one marcher's own path */
    where: LegWhere | null;
    /** The worst leg itself, for its words */
    worst?: BigSteps["legs"][number];
    legs: {
        where: LegWhere;
        drill: string | null;
        steps: string;
        /** An adjusted stretch (J.6): its spot and the counts it runs over */
        spot?: number;
        from?: number;
        to?: number;
    }[];
}

/**
 * Big steps on a group path (spec Appendix I.8): each member's first leg onto the path, the middle
 * along it (the same for every member, judged once) and each member's last leg off it, each with
 * the straight moves' test. A leg whose speed is unbounded (its time rounds to nothing) is big.
 */
function groupBigSteps(
    session: PathSession,
    fieldProperties: FieldProperties,
): BigSteps | null {
    const { target } = session;
    const group = target.group!;
    const counts = target.end - target.start;
    const schedule = scheduleOf(shapeOf(session));
    const points = shapeOf(session).points;
    const walks = group.members.map((m) => ({
        marcherId: m.marcherId,
        walk: memberWalkOf(schedule, memberNow(session, m), points),
    }));
    const drill = new Map(group.members.map((m) => [m.marcherId, m.drill]));
    const slots = new Map(group.members.map((m) => [m.marcherId, m.slot ?? 0]));
    const L = schedule.W.L;
    const tenth = (v: number) => Math.round(v * 10) / 10;
    const threshold = fieldProperties.stepSizeWarningThresholdInches;
    const big: (BigSteps["legs"][number] & { inches: number })[] = [];
    for (const leg of groupLegDistances(schedule, walks)) {
        const size = StepSize.fromDistance({
            marcher_id: leg.marcherId ?? target.marcherId,
            distance: Number.isFinite(leg.distance)
                ? leg.distance
                : Number.MAX_SAFE_INTEGER,
            counts,
            fieldProperties,
        });
        if (!size.exceedsThreshold(threshold)) continue;
        big.push({
            where: leg.where,
            drill:
                leg.marcherId === null
                    ? null
                    : (drill.get(leg.marcherId) ?? null),
            steps: size.displayString(),
            inches: size.inchesPerStep,
            ...(leg.x0 === undefined || leg.x1 === undefined
                ? {}
                : {
                      spot: (slots.get(leg.marcherId ?? -1) ?? 0) + 1,
                      from: tenth((leg.x0 / L) * counts),
                      to: tenth((leg.x1 / L) * counts),
                  }),
        });
    }
    if (big.length === 0) return null;
    const worst = big.reduce((a, b) => (b.inches > a.inches ? b : a));
    return {
        steps: worst.steps,
        inches: Math.round(worst.inches),
        where: worst.where,
        worst,
        legs: big.map(({ inches: _inches, ...leg }) => leg),
    };
}

/** How Big steps names a leg of a group path */
const legWords = (
    leg: Pick<BigSteps["legs"][number], "where" | "spot" | "from" | "to">,
) => {
    const { where } = leg;
    if (where === "adjusted")
        return tolgee.t(
            "pathways.editor.legAdjusted",
            "spot {spot}, counts {from} to {to} (adjusted)",
            { spot: leg.spot ?? 0, from: leg.from ?? 0, to: leg.to ?? 0 },
        );
    return where === "onto"
        ? tolgee.t("pathways.editor.legOnto", "onto the path")
        : where === "off"
          ? tolgee.t("pathways.editor.legOff", "off the path")
          : where === "straight"
            ? tolgee.t("pathways.editor.legStraight", "straight to the spot")
            : tolgee.t("pathways.editor.legAlong", "along the path");
};

/**
 * The path pen's hint and floating editor (pathways steps 1 and 2). While drawing, a hint over the field
 * says how the pen works, as the shape tool's hint does while a Line's points are clicked. Beside
 * the path, while drawing or with it open (not while it's only shown, closed), the editor: the shape editor's bar and controls
 * (`EditorBarParts`), holding only what a path needs. The Big steps advice when it applies;
 * Remove last point, Cancel and Finish while drawing (a finger has no Enter key); Corner | Smooth for
 * the selected point of an open path; Remove path once it's stored. Each control runs a registered command, its name and shortcut in its tooltip.
 */
export function PathEditor({
    fieldProperties,
}: {
    fieldProperties: FieldProperties;
}) {
    const session = usePathPenStore((s) => s.session);
    // A path only shown (closed) has no editor: a double-click or its menu opens it
    if (!session || session.phase === "closed") return null;
    return (
        <>
            {session.phase === "drawing" && <PathPenBanner session={session} />}
            <RichTips>
                <PathEditorBar
                    session={session}
                    fieldProperties={fieldProperties}
                />
            </RichTips>
        </>
    );
}

/** While drawing: who it's for and the Line's ways to go on, the keys as keycaps */
function PathPenBanner({ session }: { session: PathSession }) {
    const overrides = useShortcutOverridesStore((s) => s.overrides);
    const keys = getActionShortcutKeys("shapeRemoveLastPoint", { overrides });
    const esc = () => <Shortcut action="cancelAlignmentUpdates" />;
    return (
        <div
            className="rounded-6 border-stroke bg-bg-1 bg-modal text-body text-text shadow-modal pointer-events-none absolute top-12 left-1/2 z-10 -translate-x-1/2 border px-12 py-6"
            data-testid="path-pen-banner"
        >
            {/* With the key unbound, only the right-click is said */}
            {session.target.group ? (
                <T
                    keyName="pathways.banner.groupDrawing"
                    defaultValue="Group path for {count} marchers: click for a corner, drag for a smooth point · Right-click removes the last · Double-click to finish · <esc></esc> to cancel"
                    params={{
                        count: session.target.group.members.length,
                        esc,
                    }}
                />
            ) : keys ? (
                <T
                    keyName="pathways.banner.drawingPoints"
                    defaultValue="{marcher}'s path: click for a corner, drag for a smooth point · Right-click or <keys></keys> removes the last · Double-click to finish · <esc></esc> to cancel"
                    params={{
                        marcher: session.drill,
                        keys: () => <Shortcut action="shapeRemoveLastPoint" />,
                        esc,
                    }}
                />
            ) : (
                <T
                    keyName="pathways.banner.drawingPointsClick"
                    defaultValue="{marcher}'s path: click for a corner, drag for a smooth point · Right-click removes the last · Double-click to finish · <esc></esc> to cancel"
                    params={{ marcher: session.drill, esc }}
                />
            )}
        </div>
    );
}

function PathEditorBar({
    session,
    fieldProperties,
}: {
    session: PathSession;
    fieldProperties: FieldProperties;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({
        width: 0,
        height: 0,
        fw: Infinity,
        fh: Infinity,
    });
    useLayoutEffect(() => {
        const el = ref.current;
        const field = el?.offsetParent;
        if (!el || !field) return;
        const measure = () =>
            setSize({
                width: el.offsetWidth,
                height: el.offsetHeight,
                fw: field.clientWidth,
                fh: field.clientHeight,
            });
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        observer.observe(field);
        return () => observer.disconnect();
    }, []);
    // Beside the path: under it, above when there's no room, as the shape editor sits
    const view = useFieldViewStore();
    const outline: XY[] = useMemo(
        () => pathOutline(shapeOf(session)),
        [session],
    );
    const place = editorPlacement({
        outline: outline.map((p) => fieldToElement(view, p.x, p.y)),
        width: size.width,
        height: size.height,
        fieldWidth: size.fw,
        fieldHeight: size.fh,
    });
    const big = bigSteps(session, fieldProperties);
    const drawing = session.phase === "drawing";
    const stored = session.target.routeId !== null;
    // The open path's selected point: Corner | Smooth for it, as its menu has (step 2)
    const shape = shapeOf(session);
    const picked = drawing ? -1 : pointOf(shape, session.selected);
    const smooth = picked >= 0 && isSmooth(shape, picked);
    // Own path and Rejoin for a group path (step 15): who they act on comes from the selection
    const ownable = usePathPenStore((s) => s.ownable);
    const rejoin = usePathPenStore((s) => s.rejoin);
    const groupControls = !drawing && (ownable.length > 0 || rejoin !== null);
    // Re-fit shows only when the ends have moved, as Own path shows only when it can act (decision A)
    const refit = !drawing && refitNeeded(session.target);
    // The lane picked on the open group path (decision C), and any Adjust the app moved
    const laneMember =
        !drawing && session.lane
            ? memberOf(session, session.lane.marcherId)
            : undefined;
    const rehomed =
        !drawing &&
        (session.target.group?.members.some((m) => m.adjust?.rehomed) ?? false);
    // An open path is always a stored one, so the bar always holds a control
    const controls = drawing || stored;
    return (
        <div
            ref={ref}
            className={clsx(
                EDITOR_BAR,
                "text-sub text-text absolute z-10 gap-6 whitespace-nowrap",
            )}
            style={{ left: place.left, top: place.top }}
            data-testid="path-editor"
            data-phase={session.phase}
            onPointerDown={(e) => e.stopPropagation()}
        >
            {big && (
                <Tip
                    label={
                        big.where === null
                            ? tolgee.t(
                                  "pathways.editor.bigStepsTipPoints",
                                  "{inches} in a step, all along the path. Lengthen the move, or move or take out points to shorten the path.",
                                  { inches: big.inches },
                              )
                            : tolgee.t(
                                  "pathways.editor.bigStepsTipLegs",
                                  "Big steps on {legs}. Every marcher passes each point of the path at the same moment, so only the legs onto and off the path change speed. Lengthen the move, or move points to even out the legs.",
                                  {
                                      legs: big.legs
                                          .map((l) =>
                                              l.drill === null
                                                  ? `${legWords(l)} (${l.steps})`
                                                  : l.where === "adjusted"
                                                    ? `${legWords(l)} (${l.steps})`
                                                    : `${l.drill} ${legWords(l)} (${l.steps})`,
                                          )
                                          .join(", "),
                                  },
                              )
                    }
                >
                    <span
                        className="text-yellow flex items-center gap-4 px-4"
                        data-testid="path-big-steps"
                    >
                        <WarningIcon size={14} weight="bold" aria-hidden />
                        {big.where === null
                            ? tolgee.t(
                                  "pathways.editor.bigStepsShort",
                                  "Big steps · {steps}",
                                  { steps: big.steps },
                              )
                            : tolgee.t(
                                  "pathways.editor.bigStepsLeg",
                                  "Big steps · {steps} {where}",
                                  {
                                      steps: big.steps,
                                      where: legWords(big.worst!),
                                  },
                              )}
                    </span>
                </Tip>
            )}
            {big && controls && <Divider />}
            {drawing ? (
                <>
                    <span className="flex items-center gap-2">
                        <IconButton
                            label={tolgee.t(
                                "pathways.editor.removeLastPoint",
                                "Remove last point",
                            )}
                            action="shapeRemoveLastPoint"
                            disabled={session.points.length === 0}
                            onClick={() => runAction("shapeRemoveLastPoint")}
                            testId="path-remove-last"
                        >
                            <BackspaceIcon size={14} />
                        </IconButton>
                        <IconButton
                            label={tolgee.t("pathways.editor.cancel", "Cancel")}
                            action="cancelAlignmentUpdates"
                            onClick={() => runAction("cancelAlignmentUpdates")}
                            testId="path-cancel"
                        >
                            <XIcon size={14} />
                        </IconButton>
                    </span>
                    <Divider />
                    <EditorButton
                        onClick={() => runAction("applyShape")}
                        testId="path-finish"
                    >
                        {tolgee.t("pathways.editor.finish", "Finish")}
                    </EditorButton>
                </>
            ) : (
                <>
                    {picked >= 0 && (
                        <>
                            <span
                                className="flex items-center gap-2"
                                role="group"
                                aria-label={tolgee.t(
                                    "pathways.editor.pointType",
                                    "Point type",
                                )}
                            >
                                <IconButton
                                    label={tolgee.t(
                                        "actions.path.pointCorner",
                                        "Corner point",
                                    )}
                                    action="pathPointCorner"
                                    pressed={!smooth}
                                    onClick={() => runAction("pathPointCorner")}
                                    testId="path-point-corner"
                                >
                                    <LineSegmentsIcon size={14} />
                                </IconButton>
                                <IconButton
                                    label={tolgee.t(
                                        "actions.path.pointSmooth",
                                        "Smooth point",
                                    )}
                                    action="pathPointSmooth"
                                    pressed={smooth}
                                    onClick={() => runAction("pathPointSmooth")}
                                    testId="path-point-smooth"
                                >
                                    <WaveSineIcon size={14} />
                                </IconButton>
                            </span>
                            {stored && <Divider />}
                        </>
                    )}
                    {groupControls && (
                        <>
                            <span className="flex items-center gap-2">
                                {ownable.length > 0 && (
                                    <IconButton
                                        label={tolgee.t(
                                            "pathways.editor.ownPathTip",
                                            "Give the selected marchers their own copy of their part of the path",
                                        )}
                                        action="ownPath"
                                        onClick={() => runAction("ownPath")}
                                        testId="path-own"
                                    >
                                        <ArrowsSplitIcon size={14} />
                                        {tolgee.t(
                                            "actions.path.ownPath",
                                            "Own path",
                                        )}
                                    </IconButton>
                                )}
                                {rejoin !== null && (
                                    <IconButton
                                        label={tolgee.t(
                                            "pathways.editor.rejoinTip",
                                            "Put the selected marchers back on the group path, each from where it stands",
                                        )}
                                        action="rejoinPath"
                                        onClick={() => runAction("rejoinPath")}
                                        testId="path-rejoin"
                                    >
                                        <ArrowsMergeIcon size={14} />
                                        {tolgee.t(
                                            "actions.path.rejoin",
                                            "Rejoin",
                                        )}
                                    </IconButton>
                                )}
                            </span>
                            {stored && <Divider />}
                        </>
                    )}
                    {rehomed && (
                        <>
                            <Tip
                                label={tolgee.t(
                                    "pathways.editor.rehomedTip",
                                    "A point an adjustment was attached to changed, so the adjustment moved to the nearest points left. Check it still does what you meant.",
                                )}
                            >
                                <button
                                    type="button"
                                    className="text-yellow flex items-center gap-4 px-4"
                                    onClick={() =>
                                        runAction("adjustAcknowledge")
                                    }
                                    data-testid="path-rehomed-badge"
                                >
                                    <WarningIcon
                                        size={14}
                                        weight="bold"
                                        aria-hidden
                                    />
                                    {tolgee.t(
                                        "pathways.editor.rehomedBadge",
                                        "Adjustment re-homed",
                                    )}
                                </button>
                            </Tip>
                            <Divider />
                        </>
                    )}
                    {laneMember && (
                        <>
                            <span
                                className="flex items-center gap-2 px-4"
                                data-testid="path-lane-picked"
                            >
                                {tolgee.t(
                                    "pathways.editor.laneOf",
                                    "Spot {spot} · {marcher}",
                                    {
                                        spot: (laneMember.slot ?? 0) + 1,
                                        marcher: laneMember.drill,
                                    },
                                )}
                                {session.lane?.key !== null && (
                                    <IconButton
                                        label={tolgee.t(
                                            "actions.path.adjustRemoveKey",
                                            "Remove adjustment point",
                                        )}
                                        action="adjustRemoveKey"
                                        onClick={() =>
                                            runAction("adjustRemoveKey")
                                        }
                                        testId="path-adjust-remove-key"
                                    >
                                        <BackspaceIcon size={14} />
                                    </IconButton>
                                )}
                                {laneMember.adjust && (
                                    <IconButton
                                        label={tolgee.t(
                                            "actions.path.adjustResetSpot",
                                            "Reset this spot",
                                        )}
                                        action="adjustResetSpot"
                                        onClick={() =>
                                            runAction("adjustResetSpot")
                                        }
                                        testId="path-adjust-reset"
                                    >
                                        <ArrowCounterClockwiseIcon size={14} />
                                    </IconButton>
                                )}
                            </span>
                            <Divider />
                        </>
                    )}
                    {refit && (
                        <>
                            <IconButton
                                label={tolgee.t(
                                    "pathways.editor.refitTip",
                                    "Move this path's ends to where its marchers stand now and stretch its corners to match",
                                )}
                                action="refitPath"
                                onClick={() => runAction("refitPath")}
                                testId="path-refit"
                            >
                                <ArrowsOutLineHorizontalIcon size={14} />
                                {tolgee.t("actions.path.refit", "Re-fit path")}
                            </IconButton>
                            <Divider />
                        </>
                    )}
                    {stored && (
                        <IconButton
                            label={tolgee.t(
                                "actions.path.remove",
                                "Remove path",
                            )}
                            action="removePath"
                            onClick={() => runAction("removePath")}
                            testId="path-remove"
                        >
                            <TrashIcon size={14} />
                        </IconButton>
                    )}
                </>
            )}
        </div>
    );
}
