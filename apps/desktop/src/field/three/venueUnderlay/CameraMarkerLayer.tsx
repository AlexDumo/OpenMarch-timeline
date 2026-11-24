import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import {
    BufferAttribute,
    BufferGeometry,
    DoubleSide,
    Group,
    LineBasicMaterial,
    LineSegments,
    Mesh,
    MeshBasicMaterial,
} from "three";
import type { FieldProperties } from "@openmarch/core";
import { parseCameraPose } from "@/view3d/sync/protocol";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { cameraWedge } from "./cameraWedge";
import { useFieldCameraStore } from "./fieldCameraStore";

/** Over the field's lines and text, under props, paths and marchers. */
const ORDER = 1.2;
/** The app's accent purple (#6442ff); the field's canvas writes colors as given (`linear`). */
const ACCENT = [100 / 255, 66 / 255, 1] as const;
/** A pose this old means the 3D View stopped sending (closed, or its show changed). */
const STALE_MS = 3000;
/** The wedge's fill and edges fade from the camera to the far end of its view. */
const FILL_ALPHA = [0.3, 0.02] as const;
const EDGE_ALPHA = [0.75, 0.05] as const;

/** RGBA per vertex: the camera's corner, then the two far corners. */
function fadingColors(near: number, far: number, vertices: number) {
    const colors = new Float32Array(vertices * 4);
    for (let i = 0; i < vertices; i++) {
        colors.set([...ACCENT, i === 0 ? near : far], i * 4);
    }
    return colors;
}

/**
 * Feeds the field's camera store from the 3D View while the View setting is
 * on and the window is open (`view3d:camera`); clears it when the window
 * closes, stops sending or the setting turns off.
 */
function useFieldCameraFeed(shown: boolean) {
    useEffect(() => {
        const electron = window.electron;
        const clear = () => useFieldCameraStore.setState({ pose: null });
        if (!shown || !electron?.onView3dCamera) {
            clear();
            return;
        }
        let stale = 0;
        const stopCamera = electron.onView3dCamera((payload) => {
            const pose = parseCameraPose(payload);
            window.clearTimeout(stale);
            stale = window.setTimeout(clear, STALE_MS);
            // A drag on the field leads; the window catches up
            if (useFieldCameraStore.getState().dragging) return;
            useFieldCameraStore.setState({ pose });
        });
        const stopState = electron.onView3dWindowState?.((open) => {
            if (!open) clear();
        });
        return () => {
            window.clearTimeout(stale);
            stopCamera();
            stopState?.();
            clear();
        };
    }, [shown]);
}

/**
 * The 3D View's camera on the 2D field (fork #1207), when the View setting is
 * on and the 3D View is open: a wedge over the ground it sees, strongest at
 * the camera and fading with distance. The camera itself, and the handles that
 * move and aim it, are `CameraHandle` over the canvas.
 */
export default function CameraMarkerLayer({
    fieldProperties,
}: {
    fieldProperties: FieldProperties;
}) {
    const shown = useUiSettingsStore(
        (s) => s.uiSettings.view3dCameraOnField === true,
    );
    useFieldCameraFeed(shown);
    const invalidate = useThree((s) => s.invalidate);
    const { group, fill, edges } = useMemo(() => {
        const fillGeometry = new BufferGeometry();
        fillGeometry.setAttribute(
            "position",
            new BufferAttribute(new Float32Array(9), 3),
        );
        fillGeometry.setAttribute(
            "color",
            new BufferAttribute(fadingColors(...FILL_ALPHA, 3), 4),
        );
        // Two edges, each from the camera out: camera, left, camera, right
        const edgeGeometry = new BufferGeometry();
        edgeGeometry.setAttribute(
            "position",
            new BufferAttribute(new Float32Array(12), 3),
        );
        const edgeColors = fadingColors(...EDGE_ALPHA, 4);
        edgeColors[2 * 4 + 3] = EDGE_ALPHA[0]; // the second edge starts at the camera too
        edgeGeometry.setAttribute("color", new BufferAttribute(edgeColors, 4));
        const style = {
            vertexColors: true,
            transparent: true,
            depthTest: false,
            depthWrite: false,
        } as const;
        // The camera's y runs down the screen, so meshes face away from it
        const fill = new Mesh(
            fillGeometry,
            new MeshBasicMaterial({ ...style, side: DoubleSide }),
        );
        const edges = new LineSegments(
            edgeGeometry,
            new LineBasicMaterial(style),
        );
        const group = new Group();
        group.visible = false;
        [fill, edges].forEach((object, i) => {
            object.frustumCulled = false;
            object.renderOrder = ORDER + i * 0.01;
            group.add(object);
        });
        return { group, fill, edges };
    }, []);

    useEffect(() => {
        const draw = (pose: ReturnType<typeof parseCameraPose>) => {
            const w = pose && cameraWedge(pose, fieldProperties);
            if (!w) {
                if (group.visible) invalidate();
                group.visible = false;
                return;
            }
            const corners = fill.geometry.getAttribute(
                "position",
            ) as BufferAttribute;
            corners.setXYZ(0, w.apex.x, w.apex.y, 0);
            corners.setXYZ(1, w.left.x, w.left.y, 0);
            corners.setXYZ(2, w.right.x, w.right.y, 0);
            corners.needsUpdate = true;
            const lines = edges.geometry.getAttribute(
                "position",
            ) as BufferAttribute;
            lines.setXYZ(0, w.apex.x, w.apex.y, 0);
            lines.setXYZ(1, w.left.x, w.left.y, 0);
            lines.setXYZ(2, w.apex.x, w.apex.y, 0);
            lines.setXYZ(3, w.right.x, w.right.y, 0);
            lines.needsUpdate = true;
            group.visible = true;
            invalidate();
        };
        draw(useFieldCameraStore.getState().pose);
        return useFieldCameraStore.subscribe((state, prev) => {
            if (state.pose !== prev.pose) draw(state.pose);
        });
    }, [fieldProperties, group, fill, edges, invalidate]);

    useEffect(
        () => () => {
            for (const object of [fill, edges]) {
                object.geometry.dispose();
                object.material.dispose();
            }
        },
        [fill, edges],
    );

    return <primitive object={group} />;
}
