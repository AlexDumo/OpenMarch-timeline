import { useCallback, useSyncExternalStore } from "react";
import { T } from "@tolgee/react";
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
import { ArrangeButtons } from "./MarcherEditor";
import MarcherRotationInput from "./marcher/MarcherRotationInput";

/**
 * The tools that act on two or more selected marchers, at the top of the inspector: align and
 * flip, rotate around a pivot, distribute. On the field there are only the handles and the pivot
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
                <ArrangeButtons rotate={<RotateRow />} />
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
                <div className="min-w-0 flex-1">
                    <MarcherRotationInput />
                </div>
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
    const editor = useSyncExternalStore(
        subscribeActiveFieldEditor,
        activeFieldEditor,
    );
    return editor ? <EditorPivotGrid editor={editor} /> : null;
}

function EditorPivotGrid({ editor }: { editor: FieldEditor }) {
    const subscribe = useCallback(
        (listener: () => void) => editor.subscribe(listener),
        [editor],
    );
    // Null on a marcher or a free spot; the center with no pivot drawn
    const key = useSyncExternalStore(subscribe, () => {
        const pivot = editor.selectionPivot();
        return pivot ? pivot.key : "c";
    });
    return (
        <PivotGrid
            // A pivot on a marcher or a free spot: no cell is lit
            pivot={key ?? { x: 0, y: 0 }}
            onPick={(k) => editor.setSelectionPivot(k)}
            onPreview={(k) => editor.previewSelectionPivot(k)}
            testId="arrange-pivot"
        />
    );
}
