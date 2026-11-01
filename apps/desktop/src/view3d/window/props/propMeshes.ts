/**
 * The 3D View's prop solids (C4.5): each prop's Outline raised to its height, a Floor prop a flat
 * sheet on the field, an open freehand path a thin wall. `Props.tsx` places them each frame from
 * `propsAt`; a mesh is rebuilt only when its shape changes.
 */
import * as THREE from "three";
import { FIELD_SURFACE_Y } from "@/view3d/core/field";
import type { GroundPoint, PropSolid } from "@/view3d/core/props/propLayout";
import type { SurfaceType } from "@/db-functions/items";

/** A Floor prop lies just over the field surface, so it doesn't z-fight with it. */
export const FLOOR_PROP_Y = FIELD_SURFACE_Y + 0.006;
/** How thick an open freehand path stands, in meters */
export const OPEN_PATH_THICKNESS = 0.1;

/** What a prop's mesh is built from: its Outline around its center, and its height. */
export function shapeKey(solid: PropSolid): string {
    const local = solid.outline.map(
        (p) =>
            `${(p.x - solid.center.x).toFixed(4)},${(p.z - solid.center.z).toFixed(4)}`,
    );
    return `${solid.closed ? "c" : "o"}|${solid.height.toFixed(4)}|${local.join(" ")}`;
}

/**
 * An open path as a closed strip `thickness` wide around it: one side out, the other back. Each
 * point steps out along its segments' averaged normal.
 */
export function thickenPath(
    points: readonly GroundPoint[],
    thickness: number,
): GroundPoint[] {
    const half = thickness / 2;
    const normals = points.map((_, i) => {
        const a = points[Math.max(0, i - 1)]!;
        const b = points[Math.min(points.length - 1, i + 1)]!;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const length = Math.hypot(dx, dz) || 1;
        return { x: -dz / length, z: dx / length };
    });
    const out = points.map((p, i) => ({
        x: p.x + normals[i]!.x * half,
        z: p.z + normals[i]!.z * half,
    }));
    const back = points.map((p, i) => ({
        x: p.x - normals[i]!.x * half,
        z: p.z - normals[i]!.z * half,
    }));
    return [...out, ...back.reverse()];
}

/**
 * The prop's geometry around its center, its underside at y = 0: an extruded Outline, or a flat
 * sheet for a Floor prop (height 0).
 */
export function propGeometry(solid: PropSolid): THREE.BufferGeometry {
    const local = solid.outline.map((p) => ({
        x: p.x - solid.center.x,
        z: p.z - solid.center.z,
    }));
    const ring = solid.closed ? local : thickenPath(local, OPEN_PATH_THICKNESS);
    // Drawn in the shape's x-y plane, then laid down: its y becomes the world's -z
    const shape = new THREE.Shape(
        ring.map((p) => new THREE.Vector2(p.x, -p.z)),
    );
    const geometry =
        solid.height > 0
            ? new THREE.ExtrudeGeometry(shape, {
                  depth: solid.height,
                  bevelEnabled: false,
              })
            : new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    geometry.computeVertexNormals();
    return geometry;
}

/** One plain material per surface type, until props carry Artwork (C5.5). */
export function propMaterials(): Record<SurfaceType, THREE.Material> {
    return {
        floor: new THREE.MeshStandardMaterial({
            color: "#d8d2c4",
            roughness: 0.9,
            polygonOffset: true,
            polygonOffsetFactor: -1,
        }),
        platform: new THREE.MeshStandardMaterial({
            color: "#8c8f96",
            roughness: 0.8,
        }),
        obstacle: new THREE.MeshStandardMaterial({
            color: "#6e6558",
            roughness: 0.85,
        }),
    };
}

/** Where a prop's mesh stands: on its platform, or flat on the field. */
export function propMeshY(solid: PropSolid): number {
    return solid.surface === "floor" ? FLOOR_PROP_Y : solid.base;
}
