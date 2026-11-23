import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera, Vector3 } from "three";
import type { View3dCameraPose } from "@/view3d/sync/protocol";

/** Fastest the pose goes out while the camera moves, and how often while it stands still. */
const MOVING_MS = 100;
const STILL_MS = 1000;

/**
 * Tells the editor where the camera is (`view3d:camera`, ADR 0010 D-4), so
 * the 2D field can show it (fork #1207): on drawn frames while it moves, and
 * once a second from a timer, since the window draws only when something
 * changes.
 */
export default function CameraPosePublisher() {
    const camera = useThree((s) => s.camera);
    const direction = useMemo(() => new Vector3(), []);
    const last = useRef<{ key: string; at: number; pose: View3dCameraPose }>(
        null,
    );
    const send = window.view3d?.sendCamera;

    useEffect(() => {
        if (!send) return;
        const timer = window.setInterval(() => {
            if (last.current) send(last.current.pose);
        }, STILL_MS);
        return () => window.clearInterval(timer);
    }, [send]);

    useFrame(() => {
        if (!send) return;
        const now = performance.now();
        if (last.current && now - last.current.at < MOVING_MS) return;
        camera.getWorldDirection(direction);
        const perspective = camera as PerspectiveCamera;
        const pose: View3dCameraPose = {
            position: [camera.position.x, camera.position.y, camera.position.z],
            direction: [direction.x, direction.y, direction.z],
            fov: perspective.fov ?? 50,
            aspect: perspective.aspect ?? 1.6,
        };
        const key = [...pose.position, ...pose.direction, pose.fov]
            .map((n) => n.toFixed(2))
            .join(",");
        if (key === last.current?.key) return;
        last.current = { key, at: now, pose };
        send(pose);
    });
    return null;
}
