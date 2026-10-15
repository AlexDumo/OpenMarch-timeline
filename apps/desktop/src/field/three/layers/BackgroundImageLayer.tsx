import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import {
    DoubleSide,
    LinearFilter,
    LinearMipmapLinearFilter,
    Mesh,
    MeshBasicMaterial,
    PlaneGeometry,
    Texture,
} from "three";
import type { FieldProperties } from "@openmarch/core";
import { planFieldImage } from "@/field/fieldPlan";

/**
 * The show's field image, between the field's background and its lines
 * (render order -1), placed with its fit or fill setting and drawn at its
 * opacity, as `planFieldImage` (and so the export) places it. Like Fabric,
 * a filled image isn't cropped to the field.
 */
export default function BackgroundImageLayer({
    fieldProperties,
    image,
}: {
    fieldProperties: FieldProperties;
    /** The decoded image (`useFieldImage`), or null when the show has none. */
    image: ImageBitmap | null;
}) {
    const invalidate = useThree((s) => s.invalidate);

    const texture = useMemo(() => {
        if (!image) return null;
        const texture = new Texture(image);
        // Uploaded top row first, so v = 0 is the image's top, where field y is smallest
        texture.flipY = false;
        texture.magFilter = LinearFilter;
        texture.minFilter = LinearMipmapLinearFilter;
        texture.generateMipmaps = true;
        texture.needsUpdate = true;
        return texture;
    }, [image]);

    const mesh = useMemo(() => {
        const placed = planFieldImage(
            fieldProperties,
            image && { width: image.width, height: image.height },
        );
        if (!placed || !texture) return null;
        const mesh = new Mesh(
            new PlaneGeometry(1, 1),
            new MeshBasicMaterial({
                map: texture,
                transparent: true,
                opacity: placed.opacity,
                depthTest: false,
                depthWrite: false,
                // The camera's y runs down the screen, so the plane faces away from it
                side: DoubleSide,
            }),
        );
        mesh.position.set(
            placed.x + placed.width / 2,
            placed.y + placed.height / 2,
            0,
        );
        mesh.scale.set(placed.width, placed.height, 1);
        mesh.frustumCulled = false;
        mesh.renderOrder = -1;
        return mesh;
    }, [fieldProperties, image, texture]);

    useEffect(() => {
        invalidate();
        return () => {
            mesh?.geometry.dispose();
            mesh?.material.dispose();
        };
    }, [mesh, invalidate]);

    useEffect(() => () => texture?.dispose(), [texture]);

    return mesh ? <primitive object={mesh} /> : null;
}
