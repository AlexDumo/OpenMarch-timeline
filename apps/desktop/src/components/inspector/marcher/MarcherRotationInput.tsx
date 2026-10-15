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
 * unchanged, it saves nothing. It shows the turn not yet saved: after a save
 * the selection's box fits it again, at 0°, as Fabric's group does.
 */
function FieldRotationInput({ editor }: { editor: FieldEditor }) {
    const subscribe = useCallback(
        (listener: () => void) => editor.subscribe(listener),
        [editor],
    );
    const angle = useSyncExternalStore(subscribe, () => editor.typedRotation());
    // The selection comes from the app, which renders the inspector again when it changes
    const canRotate = editor.canTransform();
    const save = () => editor.endRotation();

    return (
        <div className="flex flex-col gap-8">
            <DragInput
                dragSensitivity={0.5}
                dragSensitivityWithShift={0.1}
                value={Math.round(angle) % 360}
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
