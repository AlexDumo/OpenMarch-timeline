import { useCallback, useEffect, useSyncExternalStore } from "react";
import clsx from "clsx";
import { T, useTranslate } from "@tolgee/react";
import { CrosshairSimpleIcon, LinkSimpleIcon } from "@phosphor-icons/react";
import { Button, getButtonClassName } from "@openmarch/ui";
import ActionButton from "@/shortcuts/ActionButton";
import { useShowShortcutHints } from "@/stores/KeyboardSeenStore";
import { useShapeEditorStore } from "@/shapes/frame/shapeEditorStore";
import { Tip } from "@/components/ui/Tip";
import { isMacPlatform } from "@/shortcuts/platform";
import { InspectorCollapsible } from "@/components/inspector/InspectorCollapsible";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useIsPlaying } from "@/context/IsPlayingContext";
import { performersOnly } from "@/global/classes/Marcher";
import {
    activeFieldEditor,
    subscribeActiveFieldEditor,
} from "@/field/editor/activeFieldEditor";
import type { FieldEditor } from "@/field/editor/fieldEditor";
import { PivotGrid } from "@/shapes/editor/PivotGrid";
import { keepFocus } from "@/shapes/editor/keepFocus";
import { ArrangeButtons } from "./MarcherEditor";
import MarcherRotationInput from "./marcher/MarcherRotationInput";

/**
 * The tools that act on two or more selected marchers, at the top of the inspector: align and
 * flip, rotate around a pivot, the resize ratio lock, distribute. On the field there are only the handles and the pivot
 * you drag; the commands live here (owner, 2026-11-14: a plain selection has no recipe, so no
 * floating editor; a shape keeps its own). Hidden while the show plays.
 */
export function ArrangeSection() {
    const { selectedMarchers } = useSelectedMarchers()!;
    const { isPlaying } = useIsPlaying()!;
    if (performersOnly(selectedMarchers).length < 2 || isPlaying) return null;
    return (
        <InspectorCollapsible
            defaultOpen
            translatableTitle={{ keyName: "inspector.arrange.title" }}
            className="mt-12 flex flex-col gap-16"
        >
            <div className="flex flex-col gap-16" data-testid="arrange-section">
                <ArrangeButtons
                    rotate={
                        <>
                            <RotateRow />
                            <ResizeRow />
                        </>
                    }
                />
            </div>
        </InspectorCollapsible>
    );
}

/** The rotation, and the pivot grid picking what it turns around */
function RotateRow() {
    return (
        <div className="flex flex-col gap-8">
            <h5 className="text-h5">
                <T keyName="inspector.marcher.rotateHeading" />
            </h5>
            <div className="flex items-start gap-12">
                <SelectionPivotGrid />
                <div className="flex min-w-0 flex-1 flex-col items-start gap-8">
                    <div className="w-full">
                        <MarcherRotationInput />
                    </div>
                    <SelectionPivotPick />
                </div>
            </div>
        </div>
    );
}

/**
 * The ratio lock for the selection's scale handles (#586): on, a corner or side handle keeps the
 * width-to-depth ratio and Cmd/Ctrl frees it for one drag; off, the other way round. The same
 * lock as the box editor's chain button (`toggleRatioLock`), for the session. It runs the
 * action, so the palette and the touch layout reach the same thing.
 */
function ResizeRow() {
    const { t } = useTranslate();
    const locked = useShapeEditorStore((s) => s.ratioLocked);
    const showHints = useShowShortcutHints();
    const key = isMacPlatform() ? "⌘" : "Ctrl";
    return (
        <div className="flex flex-col gap-8">
            <h5 className="text-h5">
                <T keyName="inspector.arrange.resizeHeading" />
            </h5>
            <div>
                <ActionButton
                    action="toggleRatioLock"
                    // The label says what pressing does: lock while off, unlock while on
                    toggleState={locked ? "off" : "on"}
                    hint={
                        showHints
                            ? t(
                                  locked
                                      ? "inspector.arrange.ratioLockHintOn"
                                      : "inspector.arrange.ratioLockHintOff",
                                  { key },
                              )
                            : undefined
                    }
                    aria-pressed={locked}
                    onPointerDown={keepFocus}
                    data-testid="arrange-ratio-lock"
                    className={getButtonClassName({
                        variant: locked ? "primary" : "secondary",
                        size: "compact",
                        // Pressed, the accent fill stays readable on hover
                        className: clsx(
                            "flex items-center gap-6",
                            locked && "enabled:hover:text-text-invert",
                        ),
                    })}
                >
                    <LinkSimpleIcon size={14} weight="bold" />
                    {/* The size on the text, not the button: tailwind-merge reads text-body as a
                        color and would drop the variant's (ui-styling.md) */}
                    <span className="text-body">
                        <T keyName="inspector.arrange.keepRatioButton" />
                    </span>
                </ActionButton>
            </div>
        </div>
    );
}

/**
 * The selection's pivot as a 3 × 3 grid: a cell sets it on that point of the selection's box,
 * and pointing at one shows where on the field. A pivot dragged onto a marcher or a free spot
 * lights none.
 */
function SelectionPivotGrid() {
    const editor = useActiveEditor();
    return editor ? <EditorPivotGrid editor={editor} /> : null;
}

/**
 * "Pick on field": the next click on the field sets the pivot, on a marcher or any spot. The way
 * there without a modifier key (taste: every action reachable without one); its tooltip names
 * the fast path, $mod-dragging the dot on the field.
 */
function SelectionPivotPick() {
    const editor = useActiveEditor();
    return editor ? <EditorPivotPick editor={editor} /> : null;
}

function EditorPivotPick({ editor }: { editor: FieldEditor }) {
    const { t } = useTranslate();
    const subscribe = useCallback(
        (listener: () => void) => editor.subscribe(listener),
        [editor],
    );
    const picking = useSyncExternalStore(subscribe, () =>
        editor.pickingPivot(),
    );
    const available = useSyncExternalStore(
        subscribe,
        () => editor.selectionPivot() !== null,
    );
    // Escape stops picking, before it reaches anything else (deselecting)
    useEffect(() => {
        if (!picking) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopImmediatePropagation();
            editor.cancelPickingPivot();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [editor, picking]);
    // Folded away (or gone), nothing here hears Escape any more: stop picking with it
    useEffect(() => () => editor.cancelPickingPivot(), [editor]);
    return (
        <Tip
            label={t("inspector.arrange.pickPivot")}
            hint={t("inspector.arrange.pickPivotHint", {
                key: isMacPlatform() ? "⌘" : "Ctrl",
            })}
        >
            <Button
                variant={picking ? "primary" : "secondary"}
                size="compact"
                aria-pressed={picking}
                disabled={!available}
                onPointerDown={keepFocus}
                onClick={() =>
                    picking
                        ? editor.cancelPickingPivot()
                        : editor.startPickingPivot()
                }
                data-testid="arrange-pick-pivot"
                className="flex items-center gap-6"
            >
                <CrosshairSimpleIcon size={14} weight="bold" />
                <T keyName="inspector.arrange.pickPivotButton" />
            </Button>
        </Tip>
    );
}

function useActiveEditor(): FieldEditor | null {
    return useSyncExternalStore(subscribeActiveFieldEditor, activeFieldEditor);
}

function EditorPivotGrid({ editor }: { editor: FieldEditor }) {
    const { t } = useTranslate();
    const subscribe = useCallback(
        (listener: () => void) => editor.subscribe(listener),
        [editor],
    );
    // Null on a marcher or a free spot; the center with no pivot drawn
    const key = useSyncExternalStore(subscribe, () => {
        const pivot = editor.selectionPivot();
        return pivot ? pivot.key : "c";
    });
    // No pivot while a shape owns the selection: the Rotation box and Pick are off too
    const available = useSyncExternalStore(
        subscribe,
        () => editor.selectionPivot() !== null,
    );
    return (
        <PivotGrid
            // A pivot on a marcher or a free spot: no cell is lit
            pivot={key ?? { x: 0, y: 0 }}
            onPick={(k) => editor.setSelectionPivot(k)}
            onPreview={(k) => editor.previewSelectionPivot(k)}
            tip={(name) => t("inspector.arrange.pivotTip", { pivot: name })}
            disabled={!available}
            testId="arrange-pivot"
        />
    );
}
