import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera, Vector3 } from "three";
import {
    openPoseChannel,
    type CameraPose,
} from "@/field/three/venueUnderlay/cameraPose";

/** PROTOTYPE: posts the camera's pose for the editor's 2D marker, ~10 times a second. */
export default function CameraPosePublisher() {
    const camera = useThree((s) => s.camera);
    const channel = useMemo(() => openPoseChannel(), []);
    const last = useRef({ key: "", at: 0 });
    const dir = useMemo(() => new Vector3(), []);
    const lastPose = useRef<CameraPose | null>(null);
    // The window draws only when something changes, so a still camera's pose
    // is repeated from a timer
    useEffect(() => {
        const timer = window.setInterval(() => {
            if (lastPose.current)
                channel?.postMessage({ ...lastPose.current, at: Date.now() });
        }, 1000);
        return () => {
            window.clearInterval(timer);
            channel?.close();
        };
    }, [channel]);
    useFrame(() => {
        if (!channel) return;
        const now = Date.now();
        if (now - last.current.at < 100) return;
        camera.getWorldDirection(dir);
        const p = camera.position;
        const perspective = camera as PerspectiveCamera;
        const pose: CameraPose = {
            position: [p.x, p.y, p.z],
            direction: [dir.x, dir.y, dir.z],
            fov: perspective.fov ?? 50,
            aspect: perspective.aspect ?? 1.6,
            at: now,
        };
        const key = [...pose.position, ...pose.direction, pose.fov]
            .map((n) => n.toFixed(2))
            .join(",");
        // Unchanged poses go out once a second, as a heartbeat
        if (key === last.current.key && now - last.current.at < 1000) return;
        last.current = { key, at: now };
        lastPose.current = pose;
        channel.postMessage(pose);
    });
    return null;
}
