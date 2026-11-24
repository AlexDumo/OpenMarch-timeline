import { useLayoutEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { toast } from "sonner";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { T } from "@tolgee/react";
import {
    ArrowClockwiseIcon,
    ArrowCounterClockwiseIcon,
    ArrowsMergeIcon,
    ArrowsOutLineHorizontalIcon,
    ArrowsSplitIcon,
    BackspaceIcon,
    BezierCurveIcon,
    CheckIcon,
    ColumnsIcon,
    DotsThreeIcon,
    PlayIcon,
    LineSegmentsIcon,
    PathIcon,
    PencilSimpleIcon,
    PenNibIcon,
    RowsIcon,
    ShapesIcon,
    TrashIcon,
    UsersThreeIcon,
    WarningIcon,
    WaveSineIcon,
} from "@phosphor-icons/react";
import type { FieldProperties } from "@openmarch/core";
import tolgee from "@/global/singletons/Tolgee";
import Shortcut from "@/components/ui/Shortcut";
import { RichTips, Tip } from "@/components/ui/Tip";
import { ScrubNumber } from "@/shapes/editor/ScrubNumber";
import { scrubValue, spacingRate } from "@/shapes/editor/scrub";
import { formatSteps, parseSteps } from "@/shapes/editor/format";
import { runAction } from "@/shortcuts/registry";
import { useShortcutOverridesStore } from "@/stores/ShortcutOverridesStore";
import { getActionShortcutKeys } from "@/shortcuts/labels";
import { fieldToElement, useFieldViewStore } from "@/field/three/fieldView";
import { stackedPlacement } from "@/shapes/editor/editorPlacement";
import { useShapeEditorRect } from "@/shapes/editor/shapeEditorRect";
import {
    KEEP_MENU_EVENTS,
    MenuItemWithReason,
} from "@/components/timeline/TimelineRangeMenu";
import {
    MENU_CONTENT_CLASS,
    MENU_ITEM_CLASS,
    MENU_SEPARATOR_CLASS,
} from "@/components/ui/popupClasses";
import {
    Divider,
    EDITOR_BAR,
    IconButton,
} from "@/shapes/editor/EditorBarParts";
import type { XY } from "@/shapes/types";
import { prefersReducedMotion } from "@/components/timeline/reducedMotion";
import { refitNeeded } from "./pathTarget";
import { PenBarActions, PenClickHow } from "@/shapes/pen/PenBar";
import { useShapeToolStore } from "@/shapes/tool/shapeToolStore";
import { selectOnField } from "@/shapes/placed/boxSelection";
import { setInsideBox } from "@/shapes/placed/boxSelectionStore";
import {
    CornerSummary,
    OffCountWarning,
    TrailCornerCounts,
} from "./TrailCornerCounts";
import { useTrailEndShape, useTrailShapeControls } from "./trailShape";
import { trailOffReason, useFollowTheLeader } from "./followTheLeader";
import { isFollowing } from "./FollowStatus";
import { useIsTouchMode } from "@/stores/InputModeStore";
import { offCountTally, trailCornersOf } from "./trailCorners";
import {
    EVEN_FIRST,
    EVEN_STEP,
    evenLimitOf,
    evenStepsWithin,
    followFootprint,
    followMarchersOf,
    followPlanOf,
    followSpacingOf,
    rippleDrawnPlanOf,
    ripplesIn,
    setFollowSpacing,
    lineOf,
    snakeByOf,
    snakesThroughBox,
} from "./followDrag";
import {
    aroundPlanOf,
    goingRound,
    roundMaxOf,
    setRoundAmount,
} from "./followAround";
import { rippleArrivalCount } from "@/db-functions/timelineTrailRipplePlan";
import {
    detachAllIdsOf,
    detachAllLabel,
    detachAllNote,
    detachIdsOf,
    isLoose,
    detachLabel,
    detachNote,
    editGroupPathLabel,
    editLineLabel,
    laneFocusOf,
    pathSlotsOf,
    memberOf,
    groupViewOf,
    shapeOf,
    usePathPenStore,
    ownLinesDrawn,
    type OwnLine,
    type PathSession,
} from "./pathPenStore";
import { drawingOf, ownLineDrawingOf } from "./pathPenMode";
import {
    besideArc,
    besideArcReason,
    isSmooth,
    pathOutline,
    pointOf,
} from "@/shapes/pen/penPath";

// Big steps lives with the inspector's line, which mustn't load the field mode (pathways round 2)
export { bigSteps, trailDistances, type BigSteps } from "./pathBigSteps";

/** Under a marcher: the field's note there (offset and pill), which the path bar leaves room for */
const FIELD_NOTE_ROOM_PX = 40;
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
    const hidden = usePathPenStore((s) => s.hidden);
    const ownable = usePathPenStore((s) => s.ownable);
    const shapeToolOpen = useShapeToolStore((s) => s.tool !== null);
    const ownLines = usePathPenStore((s) => s.ownLines);
    // A trail's leader mark and corner counts only with Follow-the-leader on (#1095)
    const followTheLeader = useFollowTheLeader();
    const touch = useIsTouchMode();
    const trailMarks = !!session?.target.trail && followTheLeader;
    if (!session) {
        // Several marchers each on their own path (after Detach all, sim round 3): the bar
        // stays, saying so, instead of going away as if the selection had lost its paths
        const lines = ownLinesDrawn(ownLines, null, hidden, shapeToolOpen);
        return lines.length > 1 ? (
            <RichTips>
                <OwnPathsBar lines={lines} />
            </RichTips>
        ) : null;
    }
    // Edit group path, or the whole group selected (round 4): its line is named, so it reads as
    // the line the whole group follows, not as one more marcher's path
    const view = groupViewOf(session, ownable);
    // With some of its marchers picked (sim round 3), the label is how to pick the whole group again
    const groupLabel =
        view === "edit" ||
        ((view === "whole" || view === "selected") && !hidden) ? (
            <GroupPathLabel
                session={session}
                picksGroup={view === "selected" && !isLoose(session)}
            />
        ) : null;
    // A quiet path (closed, interaction system rule 4) has the compact bar: Edit path, the member
    // commands and Remove path, so they're found without its menu. A trail's band says who leads
    // (it darkens toward the leader, with an arrow at the head), so no mark names the leader
    // (owner, 2026-11-18). Not drawn, nothing shows
    if (session.phase === "closed")
        return hidden || shapeToolOpen ? null : (
            <RichTips>
                {groupLabel}
                {trailMarks && <TrailCornerCounts session={session} />}
                {session.target.routeId !== null && (
                    <PathEditorBar
                        session={session}
                        fieldProperties={fieldProperties}
                    />
                )}
            </RichTips>
        );
    // A trail's head dragged on or back (AP-T16): the hand is busy, so no banner or bar; the
    // corners' counts follow the drag, as they do the Follow tool's. Drawn on with clicks, the
    // pen's banner and bar show, Finish for a finger (owner, 2026-11-17)
    if (session.follow?.head && !session.follow.head.clicks)
        return (
            <RichTips>
                <TrailCornerCounts session={session} />
            </RichTips>
        );
    return (
        <>
            {groupLabel}
            {/* Following says what's happening in the top bar's Paths tab (owner, 2026-11-23); the
                touch layout keeps the note over the field, its tab panel being closed most of the time */}
            {session.phase === "drawing" &&
                !(isFollowing(session) && !touch) && (
                    <PathPenBanner session={session} />
                )}
            {trailMarks && <TrailCornerCounts session={session} />}
            <RichTips>
                <PathEditorBar
                    session={session}
                    fieldProperties={fieldProperties}
                />
            </RichTips>
        </>
    );
}

/**
 * The bar for several selected marchers each on their own path (sim round 3): how many there are,
 * and the Path pen, which draws one path for all of them
 */
function OwnPathsBar({ lines }: { lines: readonly OwnLine[] }) {
    const ref = useRef<HTMLDivElement>(null);
    const size = useBarSize(ref);
    const view = useFieldViewStore();
    const shapeBar = useShapeEditorRect((s) => s.rect);
    const outline = useMemo(
        () =>
            lines.flatMap((line) => {
                const drawn = ownLineDrawingOf(line);
                return [...(drawn.outline ?? []), ...drawn.spots];
            }),
        [lines],
    );
    const place = stackedPlacement(
        {
            outline: outline.map((p) => fieldToElement(view, p.x, p.y)),
            width: size.width,
            height: size.height,
            fieldWidth: size.fw,
            fieldHeight: size.fh,
        },
        shapeBar,
    );
    return (
        <div
            ref={ref}
            className={clsx(
                EDITOR_BAR,
                "text-sub text-text absolute z-10 gap-6 whitespace-nowrap",
            )}
            style={{ left: place.left, top: place.top }}
            data-testid="path-own-paths"
            onPointerDown={(e) => e.stopPropagation()}
        >
            <span className="text-text-subtitle px-4">
                {tolgee.t("pathways.editor.ownPaths", "{count} own paths", {
                    count: lines.length,
                })}
            </span>
            <Divider />
            <IconButton
                label={tolgee.t(
                    "pathways.editor.drawOneTip",
                    "Draw one path for the selected marchers, in place of their own",
                )}
                action="pathPen"
                onClick={() => runAction("pathPen")}
                testId="path-own-draw"
            >
                <PenNibIcon size={14} />
                {tolgee.t("pathways.editor.drawPath", "Draw path")}
            </IconButton>
        </div>
    );
}

/**
 * The bar's size and the field's, measured as they change; `measuredWhile` is the `phase` it was
 * last measured in, as the bar's contents change with it
 */
function useBarSize(
    ref: React.RefObject<HTMLDivElement | null>,
    phase?: string,
) {
    const [size, setSize] = useState({
        width: 0,
        height: 0,
        fw: Infinity,
        fh: Infinity,
        measuredWhile: undefined as string | undefined,
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
                measuredWhile: phase,
            });
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        observer.observe(field);
        return () => observer.disconnect();
    }, [ref, phase]);
    return size;
}

/**
 * The group path's name by its line (interaction round 2): "Group path · 16", over the line's
 * highest point, so the line reads as the middle the members' lanes follow, not as one more
 * marcher's path. With only some of its marchers picked (`picksGroup`, sim round 3) it's a button
 * that picks everyone on it; otherwise it takes no presses.
 */
function GroupPathLabel({
    session,
    picksGroup,
}: {
    session: PathSession;
    picksGroup: boolean;
}) {
    const view = useFieldViewStore();
    const outline = pathOutline(shapeOf(session));
    if (outline.length === 0) return null;
    const top = outline
        .map((p) => fieldToElement(view, p.x, p.y))
        .reduce((a, b) => (b.y < a.y ? b : a));
    const count = session.target.group?.members.length ?? 0;
    const text = isLoose(session)
        ? // A loose path's marchers each have their own copy (round 7): no group path, and the
          // label says so (sim round 3 read "Path · 4" as one shared path)
          tolgee.t("pathways.editor.looseLabel", "{count} paths", { count })
        : tolgee.t("pathways.editor.groupLabel", "Group path · {count}", {
              count,
          });
    const className =
        "rounded-6 border-stroke bg-modal text-sub text-text shadow-modal absolute z-10 -translate-x-1/2 border px-6 py-2 whitespace-nowrap";
    const style = { left: top.x, top: top.y - 32 };
    if (!picksGroup)
        return (
            <div
                className={clsx(className, "pointer-events-none")}
                style={style}
                data-testid="path-group-label"
            >
                {text}
            </div>
        );
    return (
        <Tip
            label={tolgee.t(
                "pathways.editor.groupLabelTip",
                "Select everyone on this group path",
            )}
        >
            <button
                type="button"
                className={clsx(
                    className,
                    "hover:border-accent hover:text-accent cursor-pointer",
                )}
                style={style}
                data-testid="path-group-label"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => selectWholeGroup(session)}
            >
                {text}
            </button>
        </Tip>
    );
}

/** Picks everyone on the group path, and leaves the shape you were inside (sim round 3) */
function selectWholeGroup(session: PathSession): void {
    const members = session.target.group?.members ?? [];
    if (members.length === 0) return;
    setInsideBox(null);
    selectOnField(members.map((m) => m.marcherId));
}

/** While drawing: who it's for and the Line's ways to go on, the keys as keycaps */
function PathPenBanner({ session }: { session: PathSession }) {
    const overrides = useShortcutOverridesStore((s) => s.overrides);
    const keys = getActionShortcutKeys("shapeRemoveLastPoint", { overrides });
    const esc = () => <Shortcut action="cancelAlignmentUpdates" />;
    const how = () => <PenClickHow />;
    return (
        <div
            className="rounded-6 border-stroke bg-bg-1 bg-modal text-body text-text shadow-modal pointer-events-none absolute top-12 left-1/2 z-10 -translate-x-1/2 border px-12 py-6"
            data-testid="path-pen-banner"
        >
            {/* With the key unbound, only the right-click is said */}
            {session.follow?.head?.clicks ? (
                <T
                    keyName="pathways.banner.headDrawing"
                    defaultValue="Drawing on the trail, {marcher} leading: <how></how> · Back along it to shorten · <enter></enter> or double-click to finish · <esc></esc> to cancel"
                    params={{
                        marcher:
                            session.target.trail?.members.at(-1)?.drill ?? "",
                        how,
                        enter: () => <Shortcut action="applyShape" />,
                        esc,
                    }}
                />
            ) : goingRound(session.follow) ? (
                <T
                    keyName="pathways.banner.followOutline"
                    defaultValue="Follow: click or drag any marcher around the {shape}, or out of it to lead a trail, and the rest follow · or type how far · <enter></enter> to finish · <esc></esc> to leave"
                    params={{
                        shape:
                            session.follow!.around!.outline.kind === "circle"
                                ? tolgee.t("pathways.banner.circle", "circle")
                                : tolgee.t(
                                      "pathways.banner.boxOutline",
                                      "box outline",
                                  ),
                        enter: () => <Shortcut action="applyShape" />,
                        esc,
                    }}
                />
            ) : session.follow &&
              session.follow.grabbed === null &&
              lineOf(session.follow).box ? (
                <T
                    keyName="pathways.banner.followGrabBox"
                    defaultValue="Follow: drag a trail out of a corner of the box, and the box snakes out after it · <esc></esc> to leave"
                    params={{ esc }}
                />
            ) : session.follow && session.follow.grabbed === null ? (
                <T
                    keyName="pathways.banner.followGrab"
                    defaultValue="Follow: drag a trail out of either end of the line · <esc></esc> to leave"
                    params={{ esc }}
                />
            ) : session.follow && ripplesIn(session.follow) ? (
                <T
                    keyName="pathways.banner.rippleDrawing"
                    defaultValue="Ripple in, {marcher} leading: click an end of the form to go straight in, or click for corners first · Double-click to finish · <esc></esc> to cancel"
                    params={{
                        marcher:
                            session.target.trail?.members.at(-1)?.drill ?? "",
                        esc,
                    }}
                />
            ) : session.target.trail ? (
                <T
                    keyName="pathways.banner.trailDrawing"
                    defaultValue="Trail for {count} marchers, {marcher} leading: <how></how> · Right-click removes the last · Double-click to finish · <esc></esc> to cancel"
                    params={{
                        count: session.target.trail.members.length,
                        marcher:
                            session.target.trail.members.at(-1)?.drill ?? "",
                        how,
                        esc,
                    }}
                />
            ) : session.target.group &&
              !(
                  session.target.lane &&
                  session.target.group.members.length === 1
              ) ? (
                <T
                    keyName="pathways.banner.groupDrawing"
                    defaultValue="Group path for {count} marchers: <how></how> · Right-click removes the last · Double-click to finish · <esc></esc> to cancel"
                    params={{
                        count: session.target.group.members.length,
                        how,
                        esc,
                    }}
                />
            ) : keys ? (
                <T
                    keyName="pathways.banner.drawingPoints"
                    defaultValue="{marcher}'s path: <how></how> · Right-click or <keys></keys> removes the last · Double-click to finish · <esc></esc> to cancel"
                    params={{
                        marcher: session.drill,
                        keys: () => <Shortcut action="shapeRemoveLastPoint" />,
                        how,
                        esc,
                    }}
                />
            ) : (
                <T
                    keyName="pathways.banner.drawingPointsClick"
                    defaultValue="{marcher}'s path: <how></how> · Right-click removes the last · Double-click to finish · <esc></esc> to cancel"
                    params={{ marcher: session.drill, how, esc }}
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
    const size = useBarSize(ref, session.phase);
    // Beside the lines drawn: under them, above when there's no room, as the shape editor sits. A
    // quiet group path draws only its selected marchers' lines, so the bar goes by those; the
    // group line alone (the whole group selected, or edited) doesn't reach its marchers' starts
    // and end spots, so those count too, and the bar stays put from one to the other (round 4)
    const view = useFieldViewStore();
    const ownableNow = usePathPenStore((s) => s.ownable);
    const outline: XY[] = useMemo(() => {
        const drawn = drawingOf(session, ownableNow);
        const lines = drawn?.outline
            ? [
                  ...drawn.outline,
                  // A trail's whole way, through the box it left too
                  ...(drawn.walked ?? []),
                  ...(drawn.lanes?.flat() ?? []),
                  ...(session.target.group && !session.target.trail
                      ? [...(drawn.rings ?? []), ...drawn.spots]
                      : []),
              ]
            : (drawn?.lanes?.flat() ?? []);
        return lines.length > 0 ? lines : pathOutline(shapeOf(session));
    }, [session, ownableNow]);
    // A selected placed shape's bar is on the field too: the path bar stacks clear of it
    const shapeBar = useShapeEditorRect((s) => s.rect);
    // The Follow tool's line, its end spots and the pointer stay clear too, with room under each
    // for the field's note (the hover note, the step readout), so the bar never covers the work
    const footprint = useMemo(() => followFootprint(session), [session]);
    const followTheLeader = useFollowTheLeader();
    const place = stackedPlacement(
        {
            outline: outline.map((p) => fieldToElement(view, p.x, p.y)),
            handles: footprint.flatMap((p) => {
                const e = fieldToElement(view, p.x, p.y);
                return [e, { x: e.x, y: e.y + FIELD_NOTE_ROOM_PX }];
            }),
            width: size.width,
            height: size.height,
            fieldWidth: size.fw,
            fieldHeight: size.fh,
        },
        shapeBar,
    );
    const drawing = session.phase === "drawing";
    // While drawing, the bar stays where it first appeared, beside the marchers (sim round 3: it
    // re-placed itself as the line grew, so a click meant for Finish landed on the field and
    // added a corner). It fades while a point is dragged, as the shape editor's bar does
    const pinned = useRef<{ left: number; top: number } | null>(null);
    if (!drawing) pinned.current = null;
    // Pinned only once the drawing bar itself was measured: the closed bar's size came first
    // (review of #900)
    else if (
        !pinned.current &&
        size.measuredWhile === session.phase &&
        size.width > 0 &&
        Number.isFinite(size.fw)
    )
        pinned.current = { left: place.left, top: place.top };
    const { left, top } = (drawing && pinned.current) || place;
    // It also steps back while the line is held or carried round an outline (owner, 2026-11-23):
    // the marchers and the note by the pointer show through it, and it can't take the drop's click
    const faded =
        drawing && (session.dragging !== null || !!session.follow?.roundSlide);
    const quiet = session.phase === "closed";
    // Step 6 (TC-7): a trail's turns that fall between counts. Selected (closed), the bar sums
    // them up after Edit path, and the chips wait for a hover or a click on it (owner, 2026-11-17).
    // Follow-the-leader off (#1095): none
    const offCount =
        (quiet && !session.target.trail) || !followTheLeader
            ? { turns: 0, corners: 0 }
            : offCountTally(trailCornersOf(session));
    const stored = session.target.routeId !== null;
    // The open path's selected point: Corner | Smooth for it, as its menu has (step 2)
    const shape = shapeOf(session);
    const picked = drawing ? -1 : pointOf(shape, session.selected);
    const smooth = picked >= 0 && isSmooth(shape, picked);
    // R-14″: a point at an end of an arc stays a corner, and Smooth says why
    const cornerOnly = picked >= 0 && !smooth && besideArc(shape, picked);
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
    // While a new path is drawn for two or more marchers: Together (a group path) or Follow (a
    // trail), switched without losing the points placed (pathways step 4)
    // Drawing on from a trail's head (AP-T16): its spacing and ends are the trail's own
    const headClicks = drawing && !!session.follow?.head?.clicks;
    const kindChoice =
        followTheLeader &&
        drawing &&
        !session.byRoute &&
        !session.follow &&
        (!!session.target.trail ||
            (!!session.target.group && session.target.routeId === null));
    return (
        <div
            ref={ref}
            className={clsx(
                EDITOR_BAR,
                "text-sub text-text absolute z-10 gap-6 whitespace-nowrap transition-opacity",
                faded && "pointer-events-none opacity-25",
            )}
            style={{ left, top }}
            data-testid="path-editor"
            data-faded={faded ? "true" : undefined}
            data-phase={session.phase}
            onPointerDown={(e) => e.stopPropagation()}
        >
            {!quiet && offCount.turns > 0 && (
                <OffCountWarning tally={offCount} />
            )}
            {!quiet && offCount.turns > 0 && controls && <Divider />}
            {drawing ? (
                <>
                    {kindChoice && (
                        <>
                            <span
                                className="flex items-center gap-2"
                                role="group"
                                aria-label={tolgee.t(
                                    "pathways.editor.pathKind",
                                    "How the marchers take the path",
                                )}
                            >
                                <IconButton
                                    label={tolgee.t(
                                        "pathways.editor.togetherTip",
                                        "Together: the group slides along the path and keeps its shape",
                                    )}
                                    action="pathPen"
                                    pressed={!session.target.trail}
                                    onClick={() => runAction("pathPen")}
                                    testId="path-kind-together"
                                >
                                    <UsersThreeIcon size={14} />
                                    {tolgee.t(
                                        "pathways.editor.together",
                                        "Together",
                                    )}
                                </IconButton>
                                <IconButton
                                    label={tolgee.t(
                                        "pathways.editor.followTip",
                                        "Follow: the line follows its leader along the trail into its end spots",
                                    )}
                                    action="followTrail"
                                    pressed={!!session.target.trail}
                                    onClick={() => runAction("followTrail")}
                                    testId="path-kind-follow"
                                >
                                    <PathIcon size={14} />
                                    {tolgee.t("actions.path.follow", "Follow")}
                                </IconButton>
                            </span>
                            <Divider />
                        </>
                    )}
                    {goingRound(session.follow) && (
                        <GoRoundControls session={session} />
                    )}
                    {session.follow &&
                        !headClicks &&
                        !goingRound(session.follow) &&
                        snakesThroughBox(session.follow) && (
                            <SnakeChoice session={session} />
                        )}
                    {session.follow &&
                        !headClicks &&
                        session.follow.grabbed !== null && (
                            <FollowControls session={session} />
                        )}
                    {/* Going around ends where the outline takes them, so Ends has no say */}
                    {session.follow &&
                        !headClicks &&
                        !goingRound(session.follow) && (
                            <FollowEndsControls session={session} />
                        )}
                    {/* Going around draws nothing, so no click places a point, and there's none
                        to take back */}
                    <PenBarActions
                        points={!goingRound(session.follow)}
                        canRemoveLast={
                            headClicks
                                ? !!session.follow?.head?.history?.length
                                : session.points.length > 0
                        }
                    />
                </>
            ) : (
                <>
                    <PathSlots session={session} />
                    {quiet && offCount.turns > 0 && (
                        <>
                            <Divider />
                            <CornerSummary session={session} tally={offCount} />
                        </>
                    )}
                    {picked >= 0 && (
                        <>
                            <Divider />
                            <PointTypeButtons
                                smooth={smooth}
                                cornerOnly={cornerOnly}
                            />
                        </>
                    )}
                    {/* Sim round 3: the lane's "Spot 15 · T15" chip read as noise; a picked bend
                        point keeps its Remove */}
                    {laneMember && session.lane?.key !== null && (
                        <>
                            <Divider />
                            <span
                                className="flex items-center gap-2 px-4"
                                data-testid="path-lane-picked"
                            >
                                <IconButton
                                    label={tolgee.t(
                                        "actions.path.adjustRemoveKey",
                                        "Remove bend point",
                                    )}
                                    action="adjustRemoveKey"
                                    onClick={() => runAction("adjustRemoveKey")}
                                    testId="path-adjust-remove-key"
                                >
                                    <BackspaceIcon size={14} />
                                </IconButton>
                            </span>
                        </>
                    )}
                    {rehomed && (
                        <>
                            <Divider />
                            <Tip
                                label={tolgee.t(
                                    "pathways.editor.rehomedTip",
                                    "A point a bend was attached to changed, so the bend moved to the nearest points left. Check it still does what you meant.",
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
                                        "Bend moved",
                                    )}
                                </button>
                            </Tip>
                        </>
                    )}
                    {/* A stored trail's Reverse is the leader's mark's ⇆, selected or open: one place
                        for it (owner, 2026-11-17) */}
                    {stored && (
                        <>
                            <Divider />
                            <PathMoreMenu session={session} />
                        </>
                    )}
                </>
            )}
        </div>
    );
}

/**
 * The path bar's fixed slots (interaction round 2): Edit group path (Edit path for a path of one) ·
 * Edit <name>'s line · Match group or Rejoin (round 6: Detach moved to ···, like a design tool's
 * Detach instance), in the same places for every marcher, so a press after the selection changes
 * lands on what it did before. A slot that can't act stays, greyed out, its tooltip saying why (a press on
 * it says so too, for a finger). A trail has only Edit path: its members have no lanes.
 */
function PathSlots({ session }: { session: PathSession }) {
    const ownable = usePathPenStore((s) => s.ownable);
    const rejoin = usePathPenStore((s) => s.rejoin);
    const slots = pathSlotsOf(session, ownable, rejoin);
    const editing = session.phase === "open" && !session.lane;
    const lineId = laneFocusOf(session);
    const sayWhy = (why: string | null) => () => {
        if (why !== null) toast.info(why, { id: "path-slot-why" });
    };
    const lineReason = "reason" in slots.line ? slots.line.reason : null;
    const lineDrill = "drill" in slots.line ? slots.line.drill : null;
    // On a group path, Edit path edits the line every member follows: named so (round 3). A
    // loose path (round 7) is the marchers' own paths edited together: Edit path
    const group =
        !!session.target.group && !session.target.lane && !isLoose(session);
    // A trail can't be edited with Follow-the-leader off (#1095): Edit path stays, saying why
    const followTheLeader = useFollowTheLeader();
    const locked = !!session.target.trail && !followTheLeader;
    return (
        <>
            {/* The tooltip is the command's name, its shortcut and one short line (owner,
                2026-11-17: a sentence across the field was too much) */}
            <IconButton
                label={
                    group
                        ? editGroupPathLabel()
                        : tolgee.t("actions.path.edit", "Edit path")
                }
                hint={
                    locked
                        ? trailOffReason()
                        : group
                          ? tolgee.t(
                                "pathways.editor.editGroupHint",
                                "Every marcher on it follows",
                            )
                          : session.target.trail
                            ? tolgee.t(
                                  "pathways.editor.editTrailHint",
                                  "Drag its points, or its head to draw on",
                              )
                            : tolgee.t(
                                  "pathways.editor.editHint",
                                  "A click on its line does it too",
                              )
                }
                action="editPath"
                disabled={locked}
                pressed={editing}
                onClick={() => runAction("editPath")}
                onDisabledClick={sayWhy(locked ? trailOffReason() : null)}
                testId="path-edit"
                className={EDIT_SLOT_WIDTH}
            >
                <PencilSimpleIcon size={14} />
                {group
                    ? editGroupPathLabel()
                    : tolgee.t("actions.path.edit", "Edit path")}
            </IconButton>
            {slots.shown && (
                <>
                    <Divider />
                    <IconButton
                        label={editLineLabel(lineDrill)}
                        hint={
                            lineReason ??
                            tolgee.t(
                                "pathways.editor.editLineHint",
                                "Bend this line only. It still follows the group path",
                            )
                        }
                        action="editLine"
                        disabled={lineReason !== null}
                        pressed={lineId !== null}
                        onClick={() => runAction("editLine")}
                        onDisabledClick={sayWhy(lineReason)}
                        testId="path-edit-line"
                        className={LINE_SLOT_WIDTH}
                    >
                        <BezierCurveIcon size={14} />
                        {editLineLabel(lineDrill)}
                    </IconButton>
                    {/* Back to the group (round 6): Rejoin for detached marchers, else Match group.
                        A loose path, or a marcher's own path, has no group to go back to: the slot
                        holds its place (rounds 7 and sim 3) */}
                    {slots.backIsRejoin ? (
                        <IconButton
                            label={tolgee.t("actions.path.rejoin", "Rejoin")}
                            hint={tolgee.t(
                                "pathways.editor.rejoinHint",
                                "Back on the group path. Copies and bends go",
                            )}
                            action="rejoinPath"
                            onClick={() => runAction("rejoinPath")}
                            testId="path-rejoin"
                            className={SLOT_WIDTH}
                        >
                            <ArrowsMergeIcon size={14} />
                            {rejoin!.marcherIds.length > 1
                                ? tolgee.t(
                                      "pathways.editor.rejoinCount",
                                      "Rejoin {count}",
                                      { count: rejoin!.marcherIds.length },
                                  )
                                : tolgee.t("actions.path.rejoin", "Rejoin")}
                        </IconButton>
                    ) : slots.loose || slots.ownPath ? (
                        <span
                            aria-hidden
                            className={clsx("inline-flex", SLOT_WIDTH)}
                            data-testid="path-slot-empty"
                        />
                    ) : (
                        <IconButton
                            label={tolgee.t(
                                "actions.path.adjustResetSpot",
                                "Match group",
                            )}
                            hint={
                                slots.matchReason ??
                                tolgee.t(
                                    "pathways.editor.resetHint",
                                    "Takes this marcher's bends off",
                                )
                            }
                            action="adjustResetSpot"
                            disabled={slots.matchReason !== null}
                            onClick={() => runAction("adjustResetSpot")}
                            onDisabledClick={sayWhy(slots.matchReason)}
                            testId="path-adjust-reset"
                            className={SLOT_WIDTH}
                        >
                            <ArrowCounterClockwiseIcon size={14} />
                            {tolgee.t(
                                "actions.path.adjustResetSpot",
                                "Match group",
                            )}
                        </IconButton>
                    )}
                </>
            )}
        </>
    );
}

/**
 * The first slot fits "Edit group path", so the bar keeps its width (and place) when it says
 * "Edit path" instead (round 8)
 */
const EDIT_SLOT_WIDTH = "min-w-[116px] justify-start";

/** Edit <name>'s line's slot fits a long drill number, so the slots after it never move */
const LINE_SLOT_WIDTH = "min-w-[124px] justify-start";

/** The third slot holds Match group or Rejoin 12 at one width, so ··· never moves */
const SLOT_WIDTH = "min-w-[104px] justify-start";

/** The open path's selected point: Corner | Smooth, as its menu has (step 2) */
function PointTypeButtons({
    smooth,
    cornerOnly,
}: {
    smooth: boolean;
    cornerOnly: boolean;
}) {
    return (
        <span
            className="flex items-center gap-2"
            role="group"
            aria-label={tolgee.t("pathways.editor.pointType", "Point type")}
        >
            <IconButton
                label={tolgee.t("actions.path.pointCorner", "Corner point")}
                action="pathPointCorner"
                pressed={!smooth}
                onClick={() => runAction("pathPointCorner")}
                testId="path-point-corner"
            >
                <LineSegmentsIcon size={14} />
            </IconButton>
            <IconButton
                label={
                    cornerOnly
                        ? besideArcReason()
                        : tolgee.t("actions.path.pointSmooth", "Smooth point")
                }
                action="pathPointSmooth"
                disabled={cornerOnly}
                pressed={smooth}
                onClick={() => runAction("pathPointSmooth")}
                testId="path-point-smooth"
            >
                <WaveSineIcon size={14} />
            </IconButton>
        </span>
    );
}

/**
 * The bar's ··· (interaction round 2): what's rarer, kept off the bar so the slots stay few and
 * still: Rejoin when Match group holds its slot (a mixed selection), Re-center group path (Re-fit),
 * then after a line Detach from group path (some of the group selected, round 6: it left the bar),
 * Detach all (the whole group) and Remove path. The same commands, in the same order, as the Path
 * menus, Re-fit greyed out with the reason where it can't act.
 */
function PathMoreMenu({ session }: { session: PathSession }) {
    const ownable = usePathPenStore((s) => s.ownable);
    const rejoin = usePathPenStore((s) => s.rejoin);
    const [open, setOpen] = useState(false);
    const trail = !!session.target.trail;
    const loose = isLoose(session);
    const group = !!session.target.group && !session.target.lane && !loose;
    const rejoinHere =
        rejoin !== null && detachIdsOf(ownable, session).length > 0;
    const detachAll = detachAllIdsOf(ownable, session);
    // Detach (round 6): only while it can act; the whole group selected gets Detach all instead
    const detachIds =
        detachAll.length === 0 && session.phase !== "drawing"
            ? detachIdsOf(ownable, session)
            : [];
    const refitReason = refitNeeded(session.target)
        ? null
        : group
          ? tolgee.t(
                "pathways.slots.centered",
                "The group path already runs through the middle of its marchers",
            )
          : loose
            ? tolgee.t(
                  "pathways.slots.centeredLoose",
                  "The path already runs through the middle of these marchers",
              )
            : tolgee.t(
                  "pathways.slots.fits",
                  "The path already fits where its marcher stands",
              );
    const more = tolgee.t("pathways.editor.more", "More path commands");
    // A trail's end shape (owner, 2026-11-17): its controls, tucked away while the trail is shown.
    // They edit a trail: gone with Follow-the-leader off (#1095), as the switch takes their
    // command away
    const followTheLeader = useFollowTheLeader();
    const endShape = useTrailEndShape();
    const shapeControls = useTrailShapeControls();
    return (
        <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
            <Tip label={more}>
                <DropdownMenu.Trigger asChild>
                    <button
                        type="button"
                        aria-label={more}
                        className={clsx(
                            "rounded-4 flex min-h-24 min-w-24 items-center justify-center p-4",
                            open
                                ? "bg-accent/15 text-accent"
                                : "hover:text-accent",
                        )}
                        data-testid="path-more"
                    >
                        <DotsThreeIcon size={16} weight="bold" />
                    </button>
                </DropdownMenu.Trigger>
            </Tip>
            <DropdownMenu.Portal>
                <DropdownMenu.Content
                    align="end"
                    side="bottom"
                    sideOffset={6}
                    collisionPadding={8}
                    onCloseAutoFocus={(event) => event.preventDefault()}
                    {...KEEP_MENU_EVENTS}
                    className={MENU_CONTENT_CLASS}
                    data-testid="path-more-menu"
                >
                    {rejoinHere && (
                        <DropdownMenu.Item
                            className={MENU_ITEM_CLASS}
                            onSelect={() => runAction("rejoinPath")}
                            data-testid="path-more-rejoin"
                        >
                            <ArrowsMergeIcon size={14} aria-hidden />
                            {tolgee.t(
                                "actions.path.rejoinGroup",
                                "Rejoin group path",
                            )}
                        </DropdownMenu.Item>
                    )}
                    {!trail && (
                        <MenuItemWithReason
                            testId="path-refit"
                            reason={refitReason}
                            reasonTestId="path-refit-reason"
                            onSelect={() => runAction("refitPath")}
                        >
                            <ArrowsOutLineHorizontalIcon
                                size={14}
                                aria-hidden
                            />
                            {group
                                ? tolgee.t(
                                      "actions.path.recenter",
                                      "Re-center group path",
                                  )
                                : loose
                                  ? tolgee.t(
                                        "actions.path.recenterLoose",
                                        "Re-center path",
                                    )
                                  : tolgee.t(
                                        "actions.path.refit",
                                        "Re-fit path",
                                    )}
                        </MenuItemWithReason>
                    )}
                    {trail && endShape && followTheLeader && (
                        <>
                            <DropdownMenu.CheckboxItem
                                className={clsx(MENU_ITEM_CLASS, "items-start")}
                                checked={shapeControls}
                                onSelect={() => runAction("trailShapeControls")}
                                data-testid="path-shape-controls"
                            >
                                <ShapesIcon
                                    size={14}
                                    aria-hidden
                                    className="mt-2 shrink-0"
                                />
                                <span className="flex flex-col">
                                    {tolgee.t(
                                        "actions.path.shapeControls",
                                        "Shape controls",
                                    )}
                                    <span className="text-sub text-text-subtitle">
                                        {tolgee.t(
                                            "pathways.editor.shapeControlsNote",
                                            "The end shape's spacing, size, turn and handles",
                                        )}
                                    </span>
                                </span>
                                <DropdownMenu.ItemIndicator className="mt-2 ml-auto shrink-0">
                                    <CheckIcon size={14} aria-hidden />
                                </DropdownMenu.ItemIndicator>
                            </DropdownMenu.CheckboxItem>
                            <DropdownMenu.Separator
                                className={MENU_SEPARATOR_CLASS}
                            />
                        </>
                    )}
                    {(rejoinHere || !trail) && (
                        <DropdownMenu.Separator
                            className={MENU_SEPARATOR_CLASS}
                        />
                    )}
                    {detachIds.length > 0 && (
                        // Off the bar (round 6), as a design tool keeps Detach instance in a menu:
                        // Edit <name>'s line is how a member's line is changed and kept following
                        <DropdownMenu.Item
                            className={clsx(MENU_ITEM_CLASS, "items-start")}
                            onSelect={() => runAction("detachPath")}
                            data-testid="path-more-detach"
                        >
                            <ArrowsSplitIcon
                                size={14}
                                aria-hidden
                                className="mt-2 shrink-0"
                            />
                            <span className="flex flex-col">
                                {detachLabel(detachIds.length)}
                                <span className="text-sub text-text-subtitle">
                                    {detachNote()}
                                </span>
                            </span>
                        </DropdownMenu.Item>
                    )}
                    {detachAll.length > 0 && (
                        // Ends the group path (round 5): kept apart from the routine commands,
                        // beside Remove path, saying what it does
                        <DropdownMenu.Item
                            className={clsx(MENU_ITEM_CLASS, "items-start")}
                            onSelect={() => runAction("detachAllPath")}
                            data-testid="path-detach-all"
                        >
                            <ArrowsSplitIcon
                                size={14}
                                aria-hidden
                                className="mt-2 shrink-0"
                            />
                            <span className="flex flex-col">
                                {detachAllLabel(detachAll.length)}
                                <span className="text-sub text-text-subtitle">
                                    {detachAllNote()}
                                </span>
                            </span>
                        </DropdownMenu.Item>
                    )}
                    <DropdownMenu.Item
                        className={clsx(
                            MENU_ITEM_CLASS,
                            "data-[highlighted]:text-red",
                        )}
                        onSelect={() => runAction("removePath")}
                        data-testid="path-remove"
                    >
                        <TrashIcon size={14} aria-hidden />
                        {trail
                            ? tolgee.t(
                                  "actions.path.removeTrail",
                                  "Remove trail",
                              )
                            : tolgee.t("actions.path.remove", "Remove path")}
                    </DropdownMenu.Item>
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}

/**
 * The Follow tool's Ends on the path bar (DL-8, AP-T9, RP-1), when the line already has end spots
 * here: From trail, Keep end spots, or Ripple in (disabled with the reason when those spots don't
 * stand in a form). Shown before an end is grabbed too, so the choice comes first (step 9).
 */
function FollowEndsControls({ session }: { session: PathSession }) {
    const follow = session.follow!;
    const fromTrail = follow.ends === "trail";
    const ripple = ripplesIn(follow);
    // A finger gets no tooltip: a press on the greyed-out choice says why (step 9 review)
    const sayWhy = (why: string) => () =>
        toast.info(why, { id: "follow-ends-why" });
    const needSpots = tolgee.t(
        "pathways.editor.endsNeedSpots",
        "Ripple in and Keep end spots follow into end spots the line already has on this page. Place them first (a shape tool, or move the marchers), then choose Follow",
    );
    if (!follow.keep)
        // No end spots here: Ripple in shows greyed out, saying what would make it work
        return (
            <>
                <IconButton
                    label={needSpots}
                    action="followEndsRipple"
                    disabled
                    onClick={() => undefined}
                    onDisabledClick={sayWhy(needSpots)}
                    testId="follow-ends-ripple"
                >
                    {tolgee.t("pathways.editor.endsRipple", "Ripple in")}
                </IconButton>
                <Divider />
            </>
        );
    const rippleWhy =
        follow.formWhy ??
        tolgee.t(
            "pathways.editor.endsRippleOff",
            "Ripple in: their end spots don't stand in a line, curve or arc",
        );
    return (
        <>
            <span
                className="flex items-center gap-2"
                role="group"
                aria-label={tolgee.t("pathways.editor.ends", "Ends")}
                data-testid="follow-ends"
            >
                <IconButton
                    label={tolgee.t(
                        "pathways.editor.endsFromTrailTip",
                        "From trail: the line stops along the trail, and those become its end spots",
                    )}
                    action="followEndsTrail"
                    pressed={fromTrail}
                    onClick={() => runAction("followEndsTrail")}
                    testId="follow-ends-trail"
                >
                    {tolgee.t("pathways.editor.endsFromTrail", "From trail")}
                </IconButton>
                <IconButton
                    label={tolgee.t(
                        "pathways.editor.endsKeepTip",
                        "Keep end spots: the line follows the trail into the end spots it already has",
                    )}
                    action="followEndsKeep"
                    pressed={follow.ends === "keep"}
                    onClick={() => runAction("followEndsKeep")}
                    testId="follow-ends-keep"
                >
                    {tolgee.t("pathways.editor.endsKeep", "Keep end spots")}
                </IconButton>
                <IconButton
                    label={
                        follow.form
                            ? tolgee.t(
                                  "pathways.editor.endsRippleTip",
                                  "Ripple in: the line follows its leader straight to the near end of the form its end spots make, then along it. The leader takes the far end",
                              )
                            : rippleWhy
                    }
                    action="followEndsRipple"
                    disabled={!follow.form}
                    pressed={ripple}
                    onClick={() => runAction("followEndsRipple")}
                    onDisabledClick={sayWhy(rippleWhy)}
                    testId="follow-ends-ripple"
                >
                    {tolgee.t("pathways.editor.endsRipple", "Ripple in")}
                </IconButton>
            </span>
            <Divider />
        </>
    );
}

/** A count to the nearest half, as a drill book writes it: 6, 6½ */
function countText(count: number): string {
    const whole = Math.floor(count);
    return count - whole >= 0.5 ? `${whole === 0 ? "" : whole}½` : `${whole}`;
}

/**
 * The loop's choices on the path bar (step 10, DO-3 to DO-5): how far (a number of the outline's
 * spots or of steps; − and +, Spots and Steps are commands; the field can be cleared while typing,
 * and goes no further than Finish allows), which way around (Reverse leader turns it, as a drag
 * along the outline does), ▶ Preview,
 * a readout from a whole time around, and a note when marchers stand off the outline and step
 * onto it first.
 */
function GoRoundControls({ session }: { session: PathSession }) {
    const follow = session.follow!;
    const around = follow.around!;
    const plan = aroundPlanOf(follow);
    const max = roundMaxOf(follow);
    const reducedMotion = prefersReducedMotion();
    const turns = plan?.turns ?? 0;
    const clockwise = !around.reversed;
    // What's typed, kept while it isn't a number yet (an empty field), applied once it is
    const [typed, setTyped] = useState<string | null>(null);
    return (
        <>
            <span
                className="flex items-center gap-2"
                role="group"
                aria-label={tolgee.t(
                    "pathways.editor.roundHowFar",
                    "How far around",
                )}
                data-testid="follow-round"
            >
                <IconButton
                    label={tolgee.t(
                        "actions.path.roundLess",
                        "Go around less far",
                    )}
                    action="followRoundLess"
                    disabled={around.amount <= 0}
                    onClick={() => runAction("followRoundLess")}
                    testId="follow-round-less"
                >
                    −
                </IconButton>
                <input
                    className="rounded-6 border-stroke bg-fg-2 text-sub text-text w-[3.5em] border px-4 py-2 text-center"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={max}
                    value={typed ?? String(around.amount)}
                    aria-label={tolgee.t(
                        "pathways.editor.roundAmount",
                        "How many spots or steps around",
                    )}
                    onChange={(e) => {
                        const n = Number(e.target.value);
                        if (
                            e.target.value !== "" &&
                            Number.isFinite(n) &&
                            n >= 0
                        ) {
                            setTyped(null);
                            setRoundAmount(n);
                        } else setTyped(e.target.value);
                    }}
                    onBlur={() => setTyped(null)}
                    // Enter keeps what's typed and leaves the field, so it finishes as the bar's
                    // Enter does; Escape only leaves the field (it doesn't leave the tool)
                    onKeyDown={(e) => {
                        if (e.key === "Escape") {
                            e.preventDefault();
                            setTyped(null);
                        }
                        if (e.key === "Enter" || e.key === "Escape")
                            e.currentTarget.blur();
                    }}
                    data-testid="follow-round-amount"
                />
                <IconButton
                    label={tolgee.t(
                        "actions.path.roundMore",
                        "Go around farther",
                    )}
                    action="followRoundMore"
                    disabled={around.amount >= max}
                    onClick={() => runAction("followRoundMore")}
                    testId="follow-round-more"
                >
                    +
                </IconButton>
                <IconButton
                    label={tolgee.t(
                        "pathways.editor.roundSpotsTip",
                        "Spots: each marcher moves on this many places around the outline",
                    )}
                    action="followRoundSpots"
                    pressed={around.unit === "spots"}
                    onClick={() => runAction("followRoundSpots")}
                    testId="follow-round-spots"
                >
                    {tolgee.t("pathways.editor.roundSpots", "spots")}
                </IconButton>
                <IconButton
                    label={tolgee.t(
                        "pathways.editor.roundStepsTip",
                        "Steps: each marcher goes this many steps around the outline, ending between spots if it must",
                    )}
                    action="followRoundSteps"
                    pressed={around.unit === "steps"}
                    onClick={() => runAction("followRoundSteps")}
                    testId="follow-round-steps"
                >
                    {tolgee.t("pathways.editor.roundSteps", "steps")}
                </IconButton>
                {turns >= 1 - 1e-9 && (
                    <span
                        className="text-text-subtitle"
                        data-testid="follow-round-turns"
                    >
                        {tolgee.t(
                            "pathways.editor.roundTurns",
                            "{turns} × around",
                            { turns: Math.round(turns * 100) / 100 },
                        )}
                    </span>
                )}
            </span>
            <Divider />
            {/* Which way around: a drag along the outline sets it too (owner, 2026-11-22) */}
            <IconButton
                label={
                    clockwise
                        ? tolgee.t(
                              "pathways.editor.roundClockwiseTip",
                              "Going clockwise around. Press to go the other way around (Reverse leader), or drag a marcher the way you want",
                          )
                        : tolgee.t(
                              "pathways.editor.roundCounterTip",
                              "Going counterclockwise around. Press to go the other way around (Reverse leader), or drag a marcher the way you want",
                          )
                }
                action="reverseTrail"
                onClick={() => runAction("reverseTrail")}
                testId="follow-round-way"
            >
                {clockwise ? (
                    <ArrowClockwiseIcon size={14} />
                ) : (
                    <ArrowCounterClockwiseIcon size={14} />
                )}
                {clockwise
                    ? tolgee.t(
                          "pathways.editor.roundClockwise",
                          "Clockwise around",
                      )
                    : tolgee.t(
                          "pathways.editor.roundCounter",
                          "Counterclockwise around",
                      )}
            </IconButton>
            <Divider />
            <IconButton
                label={
                    reducedMotion
                        ? tolgee.t(
                              "pathways.editor.previewReduced",
                              "Preview is off while your system asks for less motion",
                          )
                        : tolgee.t(
                              "pathways.editor.previewRoundTip",
                              "Preview: the marchers go around from start to end, again and again",
                          )
                }
                action="followPreview"
                disabled={reducedMotion}
                pressed={!!follow.preview && !reducedMotion}
                onClick={() => runAction("followPreview")}
                testId="follow-preview"
            >
                <PlayIcon size={14} />
                {tolgee.t("pathways.editor.preview", "Preview")}
            </IconButton>
            <Divider />
            {plan && plan.offOutline > 0 && (
                <>
                    <span
                        className="text-yellow flex items-center gap-4 px-4"
                        data-testid="follow-round-off"
                    >
                        <WarningIcon size={14} weight="bold" aria-hidden />
                        {tolgee.t(
                            "pathways.editor.roundOffOutline",
                            "{count, plural, one {# marcher stands off the outline and steps onto it first} other {# marchers stand off the outline and step onto it first}}",
                            { count: plan.offOutline },
                        )}
                    </span>
                    <Divider />
                </>
            )}
        </>
    );
}

/**
 * Snake order on the path bar (step 11, SN-2): a box with no remembered order snakes row by row
 * (the default) or column by column from the corner dragged out of, and Ripple in deals into a
 * box the same way (SN-4). Each a registered command. Set order (Shift+O) sets any other order.
 */
function SnakeChoice({ session }: { session: PathSession }) {
    const by = snakeByOf(session.follow!);
    return (
        <>
            <span
                className="flex items-center gap-2"
                role="group"
                aria-label={tolgee.t("pathways.editor.snake", "Snake order")}
                data-testid="follow-snake"
            >
                <IconButton
                    label={tolgee.t(
                        "actions.path.snakeRows",
                        "Snake row by row",
                    )}
                    hint={tolgee.t(
                        "pathways.editor.snakeRowsHint",
                        "Along the corner's row, then back along the next",
                    )}
                    action="followSnakeRows"
                    pressed={by === "rows"}
                    onClick={() => runAction("followSnakeRows")}
                    testId="follow-snake-rows"
                >
                    <RowsIcon size={14} />
                    {tolgee.t("pathways.editor.snakeRows", "Rows")}
                </IconButton>
                <IconButton
                    label={tolgee.t(
                        "actions.path.snakeColumns",
                        "Snake column by column",
                    )}
                    hint={tolgee.t(
                        "pathways.editor.snakeColumnsHint",
                        "Along the corner's column, then back along the next",
                    )}
                    action="followSnakeColumns"
                    pressed={by === "columns"}
                    onClick={() => runAction("followSnakeColumns")}
                    testId="follow-snake-columns"
                >
                    <ColumnsIcon size={14} />
                    {tolgee.t("pathways.editor.snakeColumns", "Columns")}
                </IconButton>
            </span>
            <Divider />
        </>
    );
}

/**
 * The Follow tool's choices on the path bar (pathways step 4b): Spacing, Keep spacing or Even N
 * steps, Even held to the largest N that keeps everyone walking forward (DL-7, AP-T8); ▶ Preview,
 * the line looping its walk (step 4c, DL-17); and, when the line already has end spots here, Ends:
 * From trail or Keep end spots (DL-8, AP-T9).
 */
function FollowControls({ session }: { session: PathSession }) {
    const follow = session.follow!;
    const plan = followPlanOf(session);
    const limit = evenLimitOf(plan);
    // The spacing in use: Even held to its limit, Keep spacing while the limit is under one step
    const spacing = followSpacingOf(session);
    const even = spacing.kind === "even" ? spacing.steps : null;
    const evenOff = limit !== null && limit < EVEN_STEP;
    const fromTrail = follow.ends === "trail";
    const ripple = ripplesIn(follow);
    // ▶ Preview (step 4c, DL-17): once there's a walk to show; Ripple in has one once grabbed
    const canPreview =
        (ripple || session.points.length > 0) &&
        followMarchersOf(session) !== null;
    // RP-5: the count the leader reaches the next form on
    const ripplePlan = ripple ? rippleDrawnPlanOf(session) : null;
    const arrival = ripplePlan
        ? rippleArrivalCount(
              ripplePlan,
              session.target.end - session.target.start,
          )
        : null;
    const reducedMotion = prefersReducedMotion();
    // −/+, typing and a drag on the number all write the same spacing (owner, 2026-11-17: "could I
    // not type it like I can with the step size input")
    const setEven = (steps: number) =>
        setFollowSpacing({
            kind: "even",
            steps: evenStepsWithin(steps, limit),
        });
    // Where a drag on the number started, so letting go off it puts it back
    const scrubFrom = useRef<number | null>(null);
    return (
        <>
            {fromTrail && (
                <>
                    <span
                        className="flex items-center gap-2"
                        role="group"
                        aria-label={tolgee.t(
                            "pathways.editor.spacing",
                            "Spacing",
                        )}
                        data-testid="follow-spacing"
                    >
                        <IconButton
                            label={tolgee.t(
                                "pathways.editor.keepSpacingTip",
                                "Keep spacing: each marcher keeps its distance to the next along the way",
                            )}
                            pressed={even === null}
                            onClick={() => setFollowSpacing({ kind: "keep" })}
                            testId="follow-keep-spacing"
                        >
                            {tolgee.t(
                                "pathways.editor.keepSpacing",
                                "Keep spacing",
                            )}
                        </IconButton>
                        <IconButton
                            label={
                                evenOff
                                    ? tolgee.t(
                                          "pathways.editor.evenOff",
                                          "Even: the trail is too short for even steps, or someone would walk backward. Draw it longer",
                                      )
                                    : tolgee.t(
                                          "pathways.editor.evenTip",
                                          "Even: every marcher ends the same number of steps from the next",
                                      )
                            }
                            disabled={evenOff}
                            pressed={even !== null}
                            onClick={() =>
                                setEven(
                                    even ??
                                        Math.min(
                                            EVEN_FIRST,
                                            limit ?? EVEN_FIRST,
                                        ),
                                )
                            }
                            testId="follow-even"
                        >
                            {tolgee.t("pathways.editor.even", "Even")}
                        </IconButton>
                        {even !== null && (
                            <>
                                <IconButton
                                    label={tolgee.t(
                                        "pathways.editor.evenCloser",
                                        "Closer together",
                                    )}
                                    disabled={even <= EVEN_STEP}
                                    onClick={() => setEven(even - EVEN_STEP)}
                                    testId="follow-even-less"
                                >
                                    −
                                </IconButton>
                                {/* The shape tool's step number: click to type (Enter or
                                    clicking away applies, Esc cancels), drag to change */}
                                <ScrubNumber
                                    display={formatSteps(even)}
                                    axis="x"
                                    label={tolgee.t(
                                        "pathways.editor.evenSpacing",
                                        "Even spacing, in steps",
                                    )}
                                    testId="follow-even-steps"
                                    onScrubStart={() => {
                                        scrubFrom.current = even;
                                    }}
                                    onScrub={(move) =>
                                        setEven(
                                            scrubValue(
                                                scrubFrom.current ?? even,
                                                move.dx,
                                                move.dy,
                                                spacingRate(
                                                    !move.roles.fine,
                                                    "x",
                                                ),
                                            ),
                                        )
                                    }
                                    onScrubEnd={(keep) => {
                                        if (!keep && scrubFrom.current !== null)
                                            setEven(scrubFrom.current);
                                        scrubFrom.current = null;
                                    }}
                                    onType={(text) => {
                                        const steps = parseSteps(text);
                                        if (steps === null) return false;
                                        setEven(steps);
                                        return true;
                                    }}
                                />
                                <span className="text-text-subtitle">
                                    {tolgee.t(
                                        "pathways.editor.evenStepsUnit",
                                        "{steps, plural, one {step} other {steps}}",
                                        { steps: even },
                                    )}
                                </span>
                                <IconButton
                                    label={tolgee.t(
                                        "pathways.editor.evenFarther",
                                        "Farther apart",
                                    )}
                                    disabled={
                                        limit !== null &&
                                        even + EVEN_STEP > limit
                                    }
                                    onClick={() => setEven(even + EVEN_STEP)}
                                    testId="follow-even-more"
                                >
                                    +
                                </IconButton>
                                {limit !== null && (
                                    <span
                                        className="text-text-subtitle"
                                        data-testid="follow-even-limit"
                                    >
                                        {tolgee.t(
                                            "pathways.editor.evenLimit",
                                            "up to {limit}",
                                            { limit },
                                        )}
                                    </span>
                                )}
                            </>
                        )}
                    </span>
                    <Divider />
                </>
            )}
            {ripple && arrival !== null && (
                <>
                    <span
                        className="text-text-subtitle"
                        data-testid="follow-ripple-arrival"
                    >
                        {arrival === 0
                            ? tolgee.t(
                                  "pathways.editor.rippleArrivalStart",
                                  "Leader starts at the form",
                              )
                            : tolgee.t(
                                  "pathways.editor.rippleArrival",
                                  "Leader reaches the form on count {count}",
                                  { count: countText(arrival) },
                              )}
                    </span>
                    <Divider />
                </>
            )}
            {(fromTrail || ripple) && (
                <>
                    <IconButton
                        label={
                            reducedMotion
                                ? tolgee.t(
                                      "pathways.editor.previewReduced",
                                      "Preview is off while your system asks for less motion",
                                  )
                                : canPreview
                                  ? tolgee.t(
                                        "pathways.editor.previewTip",
                                        "Preview: the marchers walk the trail from start to end, again and again",
                                    )
                                  : tolgee.t(
                                        "pathways.editor.previewNothing",
                                        "Preview: place a point first",
                                    )
                        }
                        action="followPreview"
                        disabled={!canPreview || reducedMotion}
                        pressed={!!follow.preview && !reducedMotion}
                        onClick={() => runAction("followPreview")}
                        testId="follow-preview"
                    >
                        <PlayIcon size={14} />
                        {tolgee.t("pathways.editor.preview", "Preview")}
                    </IconButton>
                    <Divider />
                </>
            )}
        </>
    );
}
