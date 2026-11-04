import { useLayoutEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { T } from "@tolgee/react";
import {
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
import { shapeOf, usePathPenStore, type PathSession } from "./pathPenStore";
import { curveOf, isSmooth, pathOutline, pointOf } from "./pathEdit";

/**
 * The Big steps advice for a path (spec v0.9 Appendix I.2, I.5): one steady speed means every leg
 * has the same step size, the path's length (curves included) over the move's counts, tested as
 * straight moves are (`StepSize`, the field's step-size warning). Null when the steps aren't big,
 * or with the warning off.
 */
export function bigSteps(
    session: PathSession,
    fieldProperties: FieldProperties,
): { steps: string; inches: number } | null {
    const { target } = session;
    const counts = target.end - target.start;
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
    };
}

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
            {keys ? (
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
                    label={tolgee.t(
                        "pathways.editor.bigStepsTipPoints",
                        "{inches} in a step, all along the path. Lengthen the move, or move or take out points to shorten the path.",
                        { inches: big.inches },
                    )}
                >
                    <span
                        className="text-yellow flex items-center gap-4 px-4"
                        data-testid="path-big-steps"
                    >
                        <WarningIcon size={14} weight="bold" aria-hidden />
                        {tolgee.t(
                            "pathways.editor.bigStepsShort",
                            "Big steps · {steps}",
                            { steps: big.steps },
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
