/**
 * The show's props in the 3D View (C4.5, props-spec section 5): each prop's Outline at its real
 * size and height, where the timeline has it, on the platform under it, following playback.
 * Props are few, so each is its own mesh, rebuilt only when its shape changes.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { FieldProperties } from "@openmarch/core";
import { useShowProps } from "@/hooks/useShowProps";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import { useShowPositions } from "@/view3d/positions";
import { useView3dSyncStore } from "@/view3d/sync/view3dSyncStore";
import { requestDraw } from "../drawWake";
import { useView3dSceneStore } from "../sceneStore";
import { propSolidsAt } from "./performerLift";
import { propGeometry, propMaterials, propMeshY, shapeKey } from "./propMeshes";

/** How long to keep drawing after the props change, so the change shows. */
const DRAW_ON_CHANGE_MS = 100;

interface PropMesh {
    mesh: THREE.Mesh;
    key: string;
}

export default function Props({
    fieldProperties,
}: {
    fieldProperties: FieldProperties;
}) {
    const { props: showProps } = useShowProps();
    const { positions } = useShowPositions();
    const { countGrid } = useTimingObjects();
    const shadows = useView3dSceneStore((s) => s.quality === "high");

    const group = useMemo(() => new THREE.Group(), []);
    const materials = useMemo(() => propMaterials(), []);
    const meshes = useRef(new Map<number, PropMesh>());
    const lastMs = useRef(Number.NaN);

    // Anything but the clock changed: place them all again on the next frame
    useEffect(() => {
        lastMs.current = Number.NaN;
        requestDraw(DRAW_ON_CHANGE_MS);
    }, [showProps, positions, countGrid, fieldProperties, shadows]);

    // A deleted prop's mesh goes
    useEffect(() => {
        const ids = new Set(showProps.map((p) => p.id));
        for (const [id, { mesh }] of meshes.current) {
            if (ids.has(id)) continue;
            group.remove(mesh);
            mesh.geometry.dispose();
            meshes.current.delete(id);
        }
    }, [showProps, group]);

    useEffect(() => {
        const owned = meshes.current;
        return () => {
            for (const { mesh } of owned.values()) mesh.geometry.dispose();
            owned.clear();
            group.clear();
            for (const m of Object.values(materials)) m.dispose();
        };
    }, [group, materials]);

    useFrame(() => {
        const ms = useView3dSyncStore.getState().showMs();
        if (ms === lastMs.current) return;
        lastMs.current = ms;
        const solids = propSolidsAt({
            props: showProps,
            positions,
            countGrid,
            ms,
            fieldProperties,
        });
        const drawn = new Set<number>();
        for (const solid of solids) {
            drawn.add(solid.id);
            const key = shapeKey(solid);
            let entry = meshes.current.get(solid.id);
            if (!entry) {
                const mesh = new THREE.Mesh(
                    propGeometry(solid),
                    materials[solid.surface],
                );
                group.add(mesh);
                meshes.current.set(solid.id, (entry = { mesh, key }));
            } else if (entry.key !== key) {
                entry.mesh.geometry.dispose();
                entry.mesh.geometry = propGeometry(solid);
                entry.key = key;
            }
            const { mesh } = entry;
            mesh.material = materials[solid.surface];
            mesh.castShadow = shadows && solid.surface !== "floor";
            mesh.receiveShadow = shadows;
            mesh.position.set(solid.center.x, propMeshY(solid), solid.center.z);
            mesh.visible = true;
        }
        for (const [id, { mesh }] of meshes.current)
            if (!drawn.has(id)) mesh.visible = false;
    });

    return <primitive object={group} />;
}
