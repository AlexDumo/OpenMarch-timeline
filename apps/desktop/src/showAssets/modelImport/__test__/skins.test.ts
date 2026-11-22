// @vitest-environment node
/** A rigged model, frozen standing still (#1168) */
import { describe, expect, it } from "vitest";
import { Document } from "@gltf-transform/core";
import { freezeSkins } from "../skins";

/** One triangle skinned to two joints, the first vertex half on each */
function rig(jointTranslation: [number, number, number]) {
    const doc = new Document();
    const buffer = doc.createBuffer();
    const scene = doc.createScene();
    const accessor = (
        type: "VEC3" | "VEC4",
        array: Float32Array | Uint8Array,
    ) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    const prim = doc
        .createPrimitive()
        .setAttribute(
            "POSITION",
            accessor("VEC3", new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])),
        )
        .setAttribute(
            "NORMAL",
            accessor("VEC3", new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])),
        )
        .setAttribute(
            "JOINTS_0",
            accessor(
                "VEC4",
                new Uint8Array([0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
            ),
        )
        .setAttribute(
            "WEIGHTS_0",
            accessor(
                "VEC4",
                new Float32Array([0.5, 0.5, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
            ),
        );
    const still = doc.createNode("still");
    const moved = doc.createNode("moved").setTranslation(jointTranslation);
    // The skinned node's own transform and parent are ignored, as glTF says
    const holder = doc.createNode("holder").setScale([10, 10, 10]);
    const skinned = doc
        .createNode("skinned")
        .setTranslation([5, 5, 5])
        .setMesh(doc.createMesh().addPrimitive(prim))
        .setSkin(doc.createSkin().addJoint(still).addJoint(moved));
    holder.addChild(skinned);
    scene.addChild(still).addChild(moved).addChild(holder);
    return { doc, scene, skinned };
}

const positions = (node: ReturnType<typeof rig>["skinned"]) =>
    Array.from(
        node
            .getMesh()!
            .listPrimitives()[0]
            .getAttribute("POSITION")!
            .getArray()!,
    );

describe("freezing a rig", () => {
    it("poses each vertex by its weighted joints and drops the rig", () => {
        const { doc, scene, skinned } = rig([0, 0, 2]);
        expect(freezeSkins(doc, scene)).toBe(1);
        // The first vertex half on the moved joint: 1 m forward; the others all on it: 2 m
        expect(positions(skinned)).toEqual([0, 0, 1, 1, 0, 2, 0, 1, 2]);
        const prim = skinned.getMesh()!.listPrimitives()[0];
        expect(prim.listSemantics().sort()).toEqual(["NORMAL", "POSITION"]);
        expect(doc.getRoot().listSkins()).toEqual([]);
        expect(skinned.getSkin()).toBeNull();
        // In world space, at the scene's root with no transform of its own
        expect(scene.listChildren()).toContain(skinned);
        expect(skinned.getWorldMatrix()).toEqual([
            1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
        ]);
    });

    it("can't freeze a rig whose weights are missing", () => {
        const { doc, scene, skinned } = rig([0, 0, 2]);
        skinned.getMesh()!.listPrimitives()[0].setAttribute("WEIGHTS_0", null);
        expect(freezeSkins(doc, scene)).toBeNull();
        expect(skinned.getSkin()).not.toBeNull();
    });

    it("leaves a model with no rig alone", () => {
        const doc = new Document();
        const scene = doc.createScene();
        scene.addChild(doc.createNode().setMesh(doc.createMesh()));
        expect(freezeSkins(doc, scene)).toBe(0);
    });
});
