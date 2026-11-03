import { useLayoutEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { T } from "@tolgee/react";
import { PathIcon, XIcon } from "@phosphor-icons/react";
import { getButtonClassName } from "@openmarch/ui";
import { routePath, type FieldProperties } from "@openmarch/core";
import tolgee from "@/global/singletons/Tolgee";
import ActionButton from "@/shortcuts/ActionButton";
import Shortcut from "@/components/ui/Shortcut";
import { Tip } from "@/components/ui/Tip";
import { StepSize } from "@/global/classes/StepSize";
import { fieldToElement, useFieldViewStore } from "@/field/three/fieldView";
import { editorPlacement } from "@/shapes/editor/editorPlacement";
import type { XY } from "@/shapes/types";
import { usePathPenStore, type PathSession } from "./pathPenStore";

/**
 * The Big steps advice for a path (spec v0.9 Appendix I.2): one steady speed means every leg has
 * the same step size, the path's length over the move's counts, tested as straight moves are
 * (`StepSize`, the field's step-size warning). Null when the steps aren't big, or with the warning
 * off.
 */
export function bigSteps(
    session: Pick<PathSession, "target" | "corners">,
    fieldProperties: FieldProperties,
): { steps: string; inches: number } | null {
    const { target, corners } = session;
    const counts = target.end - target.start;
    const path = routePath(
        [target.from.x, target.from.y],
        corners.map((c) => [c.at.x, c.at.y] as const),
        [target.to.x, target.to.y],
    );
    const size = StepSize.fromDistance({
        marcher_id: target.marcherId,
        distance: path.L,
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

const BAR =
    "rounded-6 border-stroke bg-modal text-body text-text shadow-modal absolute z-10 flex items-center gap-8 border px-8 py-6";
const BUTTON = clsx(
    getButtonClassName({ variant: "secondary", size: "compact" }),
    "flex items-center gap-6",
);

/**
 * The path pen's banner and floating editor (pathways step 1; implementation plan, "Where a path is
 * edited"). While drawing, a banner over the field says who the pen draws for and how it works.
 * Beside the path, while drawing or with it open, a small editor holds who the path is for, the
 * amber Big steps advice and the path's commands: Finish, Remove last corner and Cancel while
 * drawing (a finger has no Enter key), Remove path once it's stored. Each is a registered command,
 * with its shortcut shown.
 */
export function PathEditor({
    fieldProperties,
}: {
    fieldProperties: FieldProperties;
}) {
    const session = usePathPenStore((s) => s.session);
    if (!session) return null;
    return (
        <>
            {session.phase === "drawing" && <PathPenBanner session={session} />}
            <PathEditorBar
                session={session}
                fieldProperties={fieldProperties}
            />
        </>
    );
}

function PathPenBanner({ session }: { session: PathSession }) {
    return (
        <div
            className="rounded-6 border-stroke bg-modal text-body text-text shadow-modal pointer-events-none absolute top-12 left-1/2 z-10 -translate-x-1/2 border px-12 py-6"
            data-testid="path-pen-banner"
        >
            <T
                keyName="pathways.banner.drawing"
                defaultValue="Path pen · {marcher}: click to place corners from where it starts to its end spot · <finish></finish> finishes · <undo></undo> takes back the last · <cancel></cancel> cancels"
                params={{
                    marcher: session.drill,
                    finish: () => <Shortcut action="applyShape" />,
                    undo: () => <Shortcut action="shapeRemoveLastPoint" />,
                    cancel: () => <Shortcut action="cancelAlignmentUpdates" />,
                }}
            />
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
        () => [
            session.target.from,
            ...session.corners.map((c) => c.at),
            session.target.to,
        ],
        [session.target, session.corners],
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

    return (
        <div
            ref={ref}
            className={BAR}
            style={{ left: place.left, top: place.top }}
            data-testid="path-editor"
            data-phase={session.phase}
        >
            <span
                className="text-text flex items-center gap-4 whitespace-nowrap"
                data-testid="path-editor-who"
            >
                <PathIcon size={16} weight="bold" aria-hidden />
                {tolgee.t("pathways.editor.for", "Path · {marcher}", {
                    marcher: session.drill,
                })}
            </span>
            {big && (
                <Tip
                    label={tolgee.t(
                        "pathways.editor.bigStepsTip",
                        "Every leg has this step size. Lengthen the move, or move or take out corners to shorten the path.",
                    )}
                >
                    <span
                        className="border-yellow bg-yellow/20 text-text rounded-full border px-8 py-1 text-[12px] whitespace-nowrap"
                        data-testid="path-big-steps"
                    >
                        {tolgee.t(
                            "pathways.editor.bigSteps",
                            "Big steps · {steps} ({inches} in)",
                            { steps: big.steps, inches: big.inches },
                        )}
                    </span>
                </Tip>
            )}
            <span aria-hidden className="bg-stroke h-20 w-px" />
            {drawing ? (
                <>
                    <ActionButton
                        action="applyShape"
                        className={BUTTON}
                        data-testid="path-finish"
                    >
                        {tolgee.t("pathways.editor.finish", "Finish")}
                        <Shortcut action="applyShape" />
                    </ActionButton>
                    <ActionButton
                        action="shapeRemoveLastPoint"
                        className={BUTTON}
                        disabled={session.corners.length === 0}
                        data-testid="path-remove-last"
                    >
                        {tolgee.t(
                            "pathways.editor.removeLast",
                            "Remove last corner",
                        )}
                        <Shortcut action="shapeRemoveLastPoint" />
                    </ActionButton>
                    <ActionButton
                        action="cancelAlignmentUpdates"
                        className={BUTTON}
                        data-testid="path-cancel"
                    >
                        {tolgee.t("pathways.editor.cancel", "Cancel")}
                        <Shortcut action="cancelAlignmentUpdates" />
                    </ActionButton>
                </>
            ) : (
                <>
                    {session.selected !== null && (
                        <ActionButton
                            action="shapeRemoveLastPoint"
                            className={BUTTON}
                            data-testid="path-delete-corner"
                        >
                            {tolgee.t(
                                "pathways.editor.deleteCorner",
                                "Delete corner",
                            )}
                            <Shortcut action="shapeRemoveLastPoint" />
                        </ActionButton>
                    )}
                    {stored && (
                        <ActionButton
                            action="removePath"
                            className={BUTTON}
                            data-testid="path-remove"
                        >
                            {tolgee.t("actions.path.remove", "Remove path")}
                            <Shortcut action="removePath" />
                        </ActionButton>
                    )}
                    <ActionButton
                        action="cancelAlignmentUpdates"
                        className="text-text-subtitle hover:text-text flex items-center"
                        aria-label={tolgee.t(
                            "actions.path.close",
                            "Close path",
                        )}
                        data-testid="path-close"
                    >
                        <XIcon size={16} />
                    </ActionButton>
                </>
            )}
        </div>
    );
}
