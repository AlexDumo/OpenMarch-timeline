import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import {
    BufferAttribute,
    BufferGeometry,
    CircleGeometry,
    DoubleSide,
    Group,
    Mesh,
    MeshBasicMaterial,
} from "three";
import { worldToPixels, type FieldProperties } from "@openmarch/core";
import { openPoseChannel, type CameraPose } from "./cameraPose";

/**
 * PROTOTYPE: where the 3D View's camera stands and what it sees, on the 2D
 * field: a dot at the camera's ground position and a wedge over the ground
 * it looks at. Hidden when no pose has arrived for 3 seconds (window closed).
 */
const ORDER = 1.2;
const ACCENT = 0x6442ff;

export default function CameraMarkerLayer({
    fieldProperties,
}: {
    fieldProperties: FieldProperties;
}) {
    const invalidate = useThree((s) => s.invalidate);
    const { group, wedge, dot, ring } = useMemo(() => {
        const group = new Group();
        group.visible = false;
        const geometry = new BufferGeometry();
        geometry.setAttribute(
            "position",
            new BufferAttribute(new Float32Array(9 * 2), 3),
        );
        const wedge = new Mesh(
            geometry,
            new MeshBasicMaterial({
                color: ACCENT,
                transparent: true,
                opacity: 0.12,
                depthTest: false,
                depthWrite: false,
                side: DoubleSide,
            }),
        );
        const dot = new Mesh(
            new CircleGeometry(1, 24),
            new MeshBasicMaterial({
                color: ACCENT,
                depthTest: false,
                depthWrite: false,
                side: DoubleSide,
            }),
        );
        const ring = new Mesh(
            new CircleGeometry(1, 24),
            new MeshBasicMaterial({
                color: 0xffffff,
                depthTest: false,
                depthWrite: false,
                side: DoubleSide,
            }),
        );
        for (const m of [wedge, ring, dot]) {
            m.frustumCulled = false;
            group.add(m);
        }
        wedge.renderOrder = ORDER;
        ring.renderOrder = ORDER + 0.01;
        dot.renderOrder = ORDER + 0.02;
        return { group, wedge, dot, ring };
    }, []);

    useEffect(() => {
        const channel = openPoseChannel();
        if (!channel) return;
        let stale = 0;
        const k = fieldProperties.pixelsPerStep; // dot size in field pixels
        const onPose = (event: MessageEvent<CameraPose>) => {
            const pose = event.data;
            const [px, py, pz] = pose.position;
            const [dx, dy, dz] = pose.direction;
            const horiz = Math.hypot(dx, dz);
            if (horiz < 1e-3) {
                group.visible = false;
                invalidate();
                return;
            }
            // How far along the ground the view reaches: to where the centre
            // ray meets the ground, or 60 m when it looks above the horizon
            const reach =
                dy < -1e-3
                    ? Math.min(160, Math.max(15, (py / -dy) * horiz * 1.35))
                    : 60;
            const yaw = Math.atan2(dz, dx);
            const half = Math.atan(
                Math.tan(((pose.fov * Math.PI) / 180) * 0.5) * pose.aspect,
            );
            const toPx = (x: number, z: number) =>
                worldToPixels(fieldProperties, { x, z });
            const c = toPx(px, pz);
            const a = toPx(
                px + Math.cos(yaw - half) * reach,
                pz + Math.sin(yaw - half) * reach,
            );
            const b = toPx(
                px + Math.cos(yaw + half) * reach,
                pz + Math.sin(yaw + half) * reach,
            );
            const pos = wedge.geometry.getAttribute(
                "position",
            ) as BufferAttribute;
            pos.setXYZ(0, c.x, c.y, 0);
            pos.setXYZ(1, a.x, a.y, 0);
            pos.setXYZ(2, b.x, b.y, 0);
            pos.needsUpdate = true;
            wedge.geometry.setDrawRange(0, 3);
            wedge.geometry.computeBoundingSphere();
            dot.position.set(c.x, c.y, 0);
            dot.scale.setScalar(k * 0.9);
            ring.position.set(c.x, c.y, 0);
            ring.scale.setScalar(k * 1.3);
            group.visible = true;
            invalidate();
            window.clearTimeout(stale);
            stale = window.setTimeout(() => {
                group.visible = false;
                invalidate();
            }, 3000);
        };
        channel.addEventListener("message", onPose);
        return () => {
            window.clearTimeout(stale);
            channel.removeEventListener("message", onPose);
            channel.close();
        };
    }, [fieldProperties, group, wedge, dot, ring, invalidate]);

    useEffect(
        () => () => {
            for (const m of [wedge, dot, ring]) {
                m.geometry.dispose();
                (m.material as MeshBasicMaterial).dispose();
            }
        },
        [wedge, dot, ring],
    );

    return <primitive object={group} />;
}
