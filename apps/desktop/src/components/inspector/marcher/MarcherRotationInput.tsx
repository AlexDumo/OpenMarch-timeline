import {
    useState,
    useCallback,
    useEffect,
    useRef,
    useSyncExternalStore,
} from "react";
import { DragInput } from "@openmarch/ui";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import { rotateGroup } from "@/global/classes/canvasObjects/GroupUtils";
import { fabric } from "fabric";
import DefaultListeners from "@/components/canvas/listeners/DefaultListeners";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import {
    activeFieldEditor,
    subscribeActiveFieldEditor,
} from "@/field/editor/activeFieldEditor";
import type { FieldEditor } from "@/field/editor/fieldEditor";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";

/** Rotates the selection on the field on screen: the new field's editor, or Fabric's group. */
function MarcherRotationInput() {
    const editor = useSyncExternalStore(
        subscribeActiveFieldEditor,
        activeFieldEditor,
    );
    return editor ? (
        <FieldRotationInput editor={editor} />
    ) : (
        <FabricRotationInput />
    );
}

/**
 * The new field's rotation (#198, user story 54): typing or dragging turns
 * the selection about its box's center through the editor, as the rotate
 * handle does, and leaving the input saves it through the same drop. Left
 * unchanged, it saves nothing. It shows what's typed until the save, then 0
 * again, as Fabric's group does: the selection's box fits it again.
 */
function FieldRotationInput({ editor }: { editor: FieldEditor }) {
    // Each save starts the input over at 0. Its value isn't the editor's, so
    // typing "22." isn't rewritten as "22" mid-number
    const [saves, setSaves] = useState(0);
    // The context holds no hidden marchers, as the editor's handles skip them
    const canRotate = useSelectedMarchers()!.selectedMarchers.length >= 2;
    const save = () => {
        if (editor.typedRotation() !== 0) setSaves((count) => count + 1);
        editor.endRotation();
    };

    return (
        <div className="flex flex-col gap-8">
            <DragInput
                key={saves}
                dragSensitivity={0.5}
                dragSensitivityWithShift={0.1}
                value={0}
                roundToNearest={15}
                roundToNearestWithShift={1}
                onDragChange={(value) => editor.rotateSelection(value)}
                onChange={(value) => editor.rotateSelection(value)}
                icon={ArrowClockwiseIcon}
                aria-label="Rotation"
                onBlur={save}
                onDragEnd={save}
                disabled={!canRotate}
            />
        </div>
    );
}

function FabricRotationInput() {
    const [rotationAngle, setRotationAngle] = useState<number>(0);
    const [activeGroup, setActiveGroup] = useState<fabric.Group | null>(null);
    // Whether the group turned since the last save: tabbing through the field (a blur with no
    // change) mustn't write every selected marcher, which in timeline mode makes a new move
    const rotated = useRef(false);

    const handleRotationChange = useCallback(
        (newAngle: number) => {
            if (activeGroup) {
                rotated.current = true;
                rotateGroup({
                    group: activeGroup,
                    angle: newAngle,
                });
            }
        },
        [activeGroup],
    );

    useEffect(() => {
        const canvas: OpenMarchCanvas | undefined = window.canvas;
        if (!canvas) return;

        const handleGroupSelection = (e: fabric.IEvent) => {
            const group = (e as any).group as fabric.Group | null;
            setActiveGroup(group);
            setRotationAngle(group?.angle || 0);
        };

        canvas.on("group:selection", handleGroupSelection);

        // Set initial group
        if (canvas.activeGroup) {
            setActiveGroup(canvas.activeGroup);
            setRotationAngle(canvas.activeGroup.angle || 0);
        }

        return () => {
            canvas.off("group:selection", handleGroupSelection);
        };
    }, []);

    useEffect(() => {
        if (!activeGroup) return;

        const updateAngle = () => {
            setRotationAngle(activeGroup.angle || 0);
        };

        activeGroup.on("rotating", updateAngle);
        activeGroup.on("modified", updateAngle);

        return () => {
            activeGroup.off("rotating", updateAngle);
            activeGroup.off("modified", updateAngle);
        };
    }, [activeGroup]);

    function handleRotationDragEnd() {
        if (!activeGroup) {
            console.error("No group selected");
            return;
        }
        if (!rotated.current) return;
        rotated.current = false;
        const canvas = activeGroup.canvas as OpenMarchCanvas;
        if (canvas.listeners instanceof DefaultListeners) {
            canvas.listeners.handleObjectModified();
        }
        setRotationAngle(activeGroup.angle ?? 0);
    }

    return (
        <div className="flex flex-col gap-8">
            <DragInput
                dragSensitivity={0.5}
                dragSensitivityWithShift={0.1}
                value={Math.round(rotationAngle) % 360}
                roundToNearest={15}
                roundToNearestWithShift={1}
                onDragChange={(value) => {
                    handleRotationChange(value);
                }}
                onChange={(value) => {
                    handleRotationChange(value);
                }}
                icon={ArrowClockwiseIcon}
                aria-label="Rotation"
                onBlur={handleRotationDragEnd}
                onDragEnd={handleRotationDragEnd}
                disabled={!activeGroup}
            />
        </div>
    );
}

export default MarcherRotationInput;
