"""Shared v4 skeleton and skinning contract utilities.

This module is deliberately Blender-only.  It is imported by the profile builder
and the bake/export helper so both tools construct and validate the same clean
23-bone export skeleton.
"""

from __future__ import annotations

import hashlib
import json

import bpy
from mathutils import Matrix


PROFILE_IDS = (
    "neutral-slim",
    "neutral-average",
    "neutral-athletic",
    "neutral-broad",
    "neutral-full",
    "feminine-average",
    "masculine-average",
)

SOURCE_BODY = "OpenMarch_Body"
SOURCE_RIG = "OpenMarch_Rig"
SOURCE_METARIG = "OpenMarch_Metarig"
EXPORT_BODY = "OpenMarch_Body_Export"
EXPORT_RIG = "OpenMarch_Export"

EXPORT_PARENTS = {
    "root": None,
    "DEF-spine": "root",
    "DEF-spine.001": "DEF-spine",
    "DEF-spine.002": "DEF-spine.001",
    "DEF-spine.003": "DEF-spine.002",
    "DEF-spine.004": "DEF-spine.003",
    "DEF-spine.006": "DEF-spine.004",
    "DEF-thigh.L": "DEF-spine",
    "DEF-shin.L": "DEF-thigh.L",
    "DEF-foot.L": "DEF-shin.L",
    "DEF-toe.L": "DEF-foot.L",
    "DEF-thigh.R": "DEF-spine",
    "DEF-shin.R": "DEF-thigh.R",
    "DEF-foot.R": "DEF-shin.R",
    "DEF-toe.R": "DEF-foot.R",
    "DEF-shoulder.L": "DEF-spine.003",
    "DEF-upper_arm.L": "DEF-shoulder.L",
    "DEF-forearm.L": "DEF-upper_arm.L",
    "DEF-hand.L": "DEF-forearm.L",
    "DEF-shoulder.R": "DEF-spine.003",
    "DEF-upper_arm.R": "DEF-shoulder.R",
    "DEF-forearm.R": "DEF-upper_arm.R",
    "DEF-hand.R": "DEF-forearm.R",
}


def deform_bone_names(source_rig):
    return [bone.name for bone in source_rig.data.bones if bone.use_deform]


def export_bone_names(source_rig):
    return ["root", *deform_bone_names(source_rig)]


def remove_object(name):
    obj = bpy.data.objects.get(name)
    if obj is not None:
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if data is not None and data.users == 0:
            if isinstance(data, bpy.types.Armature):
                bpy.data.armatures.remove(data)
            elif isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)


def create_export_contract(source_rig, source_body, scene=None, *, replace=True):
    """Create the clean export rig and a mesh copy without touching the controller rig."""

    scene = scene or bpy.context.scene
    if replace:
        remove_object(EXPORT_BODY)
        remove_object(EXPORT_RIG)

    armature = bpy.data.armatures.new("OpenMarch_Export_Skeleton")
    export_rig = bpy.data.objects.new(EXPORT_RIG, armature)
    scene.collection.objects.link(export_rig)

    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    export_rig.select_set(True)
    bpy.context.view_layer.objects.active = export_rig
    bpy.ops.object.mode_set(mode="EDIT")

    names = export_bone_names(source_rig)
    for name in names:
        old = source_rig.data.bones[name]
        new = armature.edit_bones.new(name)
        new.head = old.head_local
        new.tail = old.tail_local
        new.matrix = old.matrix_local
        new.length = old.length
        new.use_deform = True
        new.use_connect = False

    for name, parent in EXPORT_PARENTS.items():
        if parent:
            armature.edit_bones[name].parent = armature.edit_bones[parent]

    bpy.ops.object.mode_set(mode="OBJECT")
    export_rig.matrix_world = source_rig.matrix_world.copy()
    export_rig["openmarch_contract"] = "body-v4"

    export_body = source_body.copy()
    export_body.data = source_body.data.copy()
    export_body.name = EXPORT_BODY
    scene.collection.objects.link(export_body)
    export_body.parent = export_rig
    export_body.matrix_parent_inverse = Matrix.Identity(4)
    export_body.matrix_basis = source_body.matrix_basis.copy()
    for modifier in export_body.modifiers:
        if modifier.type == "ARMATURE":
            modifier.object = export_rig

    for pose_bone in export_rig.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"

    return export_rig, export_body


def _matrix_values(matrix):
    return [[round(float(value), 8) for value in row] for row in matrix]


def skeleton_payload(rig):
    bones = []
    for bone in sorted(rig.data.bones, key=lambda item: item.name):
        bones.append(
            {
                "name": bone.name,
                "parent": bone.parent.name if bone.parent else None,
                "matrix_local": _matrix_values(bone.matrix_local),
            }
        )
    return bones


def skeleton_signature(rig):
    payload = skeleton_payload(rig)
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def skinning_report(body, expected_groups):
    unweighted = 0
    maximum = 0
    weight_error = 0.0
    for vertex in body.data.vertices:
        influences = [item for item in vertex.groups if item.weight > 0.0]
        if not influences:
            unweighted += 1
        maximum = max(maximum, len(influences))
        weight_error = max(weight_error, abs(1.0 - sum(item.weight for item in influences)))
    actual_groups = [group.name for group in body.vertex_groups]
    used_indices = {
        membership.group
        for vertex in body.data.vertices
        for membership in vertex.groups
        if membership.weight > 0.0
    }
    nonempty_groups = [
        group.name for group in body.vertex_groups if group.index in used_indices
    ]
    return {
        "vertex_groups": actual_groups,
        "nonempty_vertex_groups": nonempty_groups,
        "vertex_groups_exact": set(nonempty_groups) == set(expected_groups),
        "vertex_group_order_matches": nonempty_groups == list(expected_groups),
        "unweighted_vertices": unweighted,
        "maximum_influence_count": maximum,
        "maximum_weight_sum_error": weight_error,
    }


def validate_contract(source_rig, source_body, export_rig=None, export_body=None):
    deform = deform_bone_names(source_rig)
    skin = skinning_report(source_body, deform)
    result = {
        "exported_bone_count": len(export_bone_names(source_rig)),
        "deform_bones": deform,
        **skin,
        "source_armature_object": source_rig.name,
        "source_body_object": source_body.name,
    }
    if export_rig is not None:
        result.update(
            {
                "skeleton_signature": skeleton_signature(export_rig),
                "skeleton": skeleton_payload(export_rig),
                "export_rig_object": export_rig.name,
            }
        )
    if export_body is not None:
        modifier_targets = [
            modifier.object.name if modifier.object else None
            for modifier in export_body.modifiers
            if modifier.type == "ARMATURE"
        ]
        result["export_body_object"] = export_body.name
        result["export_body_armature_targets"] = modifier_targets

    assert result["exported_bone_count"] == 23
    assert len(deform) == 22
    assert result["vertex_groups_exact"]
    assert result["unweighted_vertices"] == 0
    assert result["maximum_influence_count"] <= 4
    if export_rig is not None:
        assert {bone.name for bone in export_rig.data.bones} == set(export_bone_names(source_rig))
    if export_body is not None:
        assert result["export_body_armature_targets"] == [EXPORT_RIG]
    return result
