import { T } from "@tolgee/react";
import {
    BackspaceIcon,
    LineSegmentsIcon,
    WaveSineIcon,
    XIcon,
} from "@phosphor-icons/react";
import tolgee from "@/global/singletons/Tolgee";
import Shortcut from "@/components/ui/Shortcut";
import { runAction } from "@/shortcuts/registry";
import {
    Divider,
    EditorButton,
    IconButton,
} from "@/shapes/editor/EditorBarParts";
import { useDrawKindStore } from "./penKind";

/**
 * The pen's drawing bar and hint (shared pen, plan step 1): what a caller's bar shows while a line
 * is drawn, after its own choices. Every control runs a registered action (`usePenKeys`), so the
 * palette, the keys and a finger reach the same thing.
 */

/**
 * The hint's words for what a click places while drawing, by the Straight | Curve switch (owner,
 * 2026-11-17): the other kind with Alt, and a press-and-drag's smooth point
 */
export function PenClickHow() {
    const curve = useDrawKindStore((s) => s.kind === "curve");
    const alt = () => <Shortcut binding="Alt + Click" />;
    return curve ? (
        <T
            keyName="pathways.banner.clickCurve"
            defaultValue="click for a curve point, <alt></alt> for a corner, drag to set its roundness"
            params={{ alt }}
        />
    ) : (
        <T
            keyName="pathways.banner.clickStraight"
            defaultValue="click for a corner, <alt></alt> for a curve point, drag for a smooth point"
            params={{ alt }}
        />
    );
}

/**
 * The drawing bar's Straight | Curve (owner, 2026-11-17): what a click places in every drawing,
 * remembered between drawings. Alt places the other kind while it's held; a finger has the switch.
 * Icons, as the open path's Corner | Smooth (the same two), named in their tooltips: the bar keeps
 * to icons and one word (owner lab feedback on fork #674).
 */
export function PenKindSwitch() {
    const kind = useDrawKindStore((s) => s.kind);
    return (
        <span
            className="flex items-center gap-2"
            role="group"
            aria-label={tolgee.t(
                "pathways.editor.drawKind",
                "What a click places",
            )}
        >
            <IconButton
                label={tolgee.t(
                    "pathways.editor.straightTip",
                    "Straight: a click places a corner. For one curve point:",
                )}
                action="pathDrawStraight"
                shortcut="Alt + Click"
                pressed={kind === "straight"}
                onClick={() => runAction("pathDrawStraight")}
                testId="path-draw-straight"
            >
                <LineSegmentsIcon size={14} />
            </IconButton>
            <IconButton
                label={tolgee.t(
                    "pathways.editor.curveTip",
                    "Curve: a click places a smooth point. For one corner:",
                )}
                action="pathDrawCurve"
                shortcut="Alt + Click"
                pressed={kind === "curve"}
                onClick={() => runAction("pathDrawCurve")}
                testId="path-draw-curve"
            >
                <WaveSineIcon size={14} />
            </IconButton>
        </span>
    );
}

/**
 * The end of the drawing bar: Straight | Curve, Remove last point, Cancel and Finish (a finger
 * has no Enter key). `points`: whether the drawing places points (going round an outline doesn't,
 * so it has no switch and nothing to take back); `canRemoveLast`: a point is there to take back.
 */
export function PenBarActions({
    points,
    canRemoveLast,
}: {
    points: boolean;
    canRemoveLast: boolean;
}) {
    return (
        <>
            {points && (
                <>
                    <PenKindSwitch />
                    <Divider />
                </>
            )}
            <span className="flex items-center gap-2">
                {points && (
                    <IconButton
                        label={tolgee.t(
                            "pathways.editor.removeLastPoint",
                            "Remove last point",
                        )}
                        action="shapeRemoveLastPoint"
                        disabled={!canRemoveLast}
                        onClick={() => runAction("shapeRemoveLastPoint")}
                        testId="path-remove-last"
                    >
                        <BackspaceIcon size={14} />
                    </IconButton>
                )}
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
    );
}
