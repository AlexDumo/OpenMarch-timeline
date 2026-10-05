"""Bake v4 controller actions and export one shared-skeleton body profile.

Run in a separate Blender background process; the source file is never saved.

Example:
    blender --background character.blend --python bake_export.py -- \
      --profile neutral-athletic \
      --body-object OpenMarch_Body \
      --out-dir assets/blender/body-v4/exports/neutral-athletic \
      --actions Rig_Test Rig_IK_Check March Walk_InPlace

Body GLBs contain the skinned mesh and canonical skeleton but no animation.
Pass --animation-actions to additionally emit animation-only GLBs once from the
canonical motion source.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile

import bpy
from mathutils import Matrix


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from contract import (  # noqa: E402
    PROFILE_IDS,
    SOURCE_BODY,
    SOURCE_RIG,
    create_export_contract,
    skeleton_payload,
    skinning_report,
    validate_contract,
)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True, choices=PROFILE_IDS)
    parser.add_argument("--body-object", default=SOURCE_BODY)
    parser.add_argument(
        "--out-dir",
        help="Profile output directory. Defaults to body-v4/exports/<profile>.",
    )
    parser.add_argument(
        "--actions", nargs="+", default=["Rig_Test", "Rig_IK_Check"]
    )
    parser.add_argument(
        "--animation-actions",
        nargs="*",
        default=[],
        help="Actions also emitted as canonical skeleton-only GLBs.",
    )
    parser.add_argument(
        "--animation-out-dir",
        help="Defaults to assets/blender/body-v4/animations.",
    )
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return parser.parse_args(values)


def slugify(value):
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", value)
    value = re.sub(r"[^A-Za-z0-9]+", "-", value)
    return value.strip("-").lower()


def file_record(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return {
        "path": os.path.abspath(path),
        "size_bytes": os.path.getsize(path),
        "sha256": digest.hexdigest(),
    }


def choose_actions(names):
    missing = [name for name in names if bpy.data.actions.get(name) is None]
    if missing:
        available = sorted(action.name for action in bpy.data.actions)
        raise RuntimeError(f"Missing actions {missing}; available actions are {available}")
    return [bpy.data.actions[name] for name in names]


def set_action(owner, action):
    owner.animation_data_create()
    owner.animation_data.action = action
    if action is not None and action.slots:
        suitable = list(owner.animation_data.action_suitable_slots)
        owner.animation_data.action_slot = suitable[0] if suitable else action.slots[0]


def bake_action(scene, source_rig, source_body, export_rig, export_body, action):
    set_action(source_rig, action)
    start, end = (int(round(value)) for value in action.frame_range)
    scene.frame_set(start)

    set_action(export_rig, None)
    for pose_bone in export_rig.pose.bones:
        pose_bone.matrix_basis = Matrix.Identity(4)
        constraint = pose_bone.constraints.new("COPY_TRANSFORMS")
        constraint.target = source_rig
        constraint.subtarget = pose_bone.name
        constraint.target_space = "WORLD"
        constraint.owner_space = "WORLD"

    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    export_rig.hide_set(False)
    export_rig.select_set(True)
    bpy.context.view_layer.objects.active = export_rig
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.nla.bake(
        frame_start=start,
        frame_end=end,
        step=1,
        only_selected=False,
        visual_keying=True,
        clear_constraints=True,
        clear_parents=False,
        use_current_action=False,
        clean_curves=False,
        bake_types={"POSE"},
        channel_types={"LOCATION", "ROTATION", "SCALE"},
    )
    bpy.ops.object.mode_set(mode="OBJECT")
    clip = export_rig.animation_data.action
    clip.name = action.name + "_Baked"
    clip.use_fake_user = True

    maximum_error = 0.0
    worst_frame = start
    for frame in range(start, end + 1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        original = source_body.evaluated_get(depsgraph)
        exported = export_body.evaluated_get(depsgraph)
        error = max(
            (left.co - right.co).length
            for left, right in zip(original.data.vertices, exported.data.vertices)
        )
        if error > maximum_error:
            maximum_error = error
            worst_frame = frame

    result = {
        "source_action": action.name,
        "baked_action": clip.name,
        "frame_start": start,
        "frame_end": end,
        "maximum_vertex_bake_deviation": maximum_error,
        "worst_frame": worst_frame,
    }
    if maximum_error > 0.0001:
        raise RuntimeError(f"Bake validation exceeded 0.1 mm: {result}")
    return clip, result


def select_export_objects(export_rig, export_body, *, include_body):
    bpy.ops.object.select_all(action="DESELECT")
    export_rig.hide_set(False)
    export_rig.hide_viewport = False
    export_rig.hide_render = False
    export_rig.select_set(True)
    if include_body:
        export_body.hide_set(False)
        export_body.hide_viewport = False
        export_body.hide_render = False
        export_body.select_set(True)
    bpy.context.view_layer.objects.active = export_rig


def export_body_glb(path, export_rig, export_body):
    set_action(export_rig, None)
    select_export_objects(export_rig, export_body, include_body=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        use_active_scene=True,
        export_apply=False,
        export_animations=False,
        export_def_bones=True,
        export_skins=True,
        export_all_influences=False,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
        export_draco_mesh_compression_enable=False,
    )


def export_animation_glb(path, export_rig, clip, clip_name):
    set_action(export_rig, clip)
    clip.name = clip_name
    select_export_objects(export_rig, None, include_body=False)
    bpy.context.scene.frame_start = int(clip.frame_range[0])
    bpy.context.scene.frame_end = int(clip.frame_range[1])
    bpy.context.scene.frame_set(bpy.context.scene.frame_start)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        use_active_scene=True,
        export_apply=False,
        export_animations=True,
        export_animation_mode="ACTIVE_ACTIONS",
        export_nla_strips_merged_animation_name=clip_name,
        export_force_sampling=True,
        export_def_bones=True,
        export_skins=False,
        export_cameras=False,
        export_lights=False,
        export_draco_mesh_compression_enable=False,
    )


def export_body_fbx(path, export_rig, export_body):
    set_action(export_rig, None)
    select_export_objects(export_rig, export_body, include_body=True)
    bpy.ops.export_scene.fbx(
        filepath=path,
        use_selection=True,
        object_types={"ARMATURE", "MESH"},
        use_mesh_modifiers=False,
        add_leaf_bones=False,
        use_armature_deform_only=True,
        bake_anim=False,
        axis_forward="-Z",
        axis_up="Y",
    )


def maximum_matrix_error(actual_rig, expected_payload):
    expected = {item["name"]: item for item in expected_payload}
    error = 0.0
    for bone in actual_rig.data.bones:
        if bone.name not in expected:
            continue
        values = expected[bone.name]["matrix_local"]
        for row in range(4):
            for column in range(4):
                error = max(error, abs(float(bone.matrix_local[row][column]) - values[row][column]))
    return error


def inspect_roundtrip(path, kind, expected_skeleton, expected_groups, expected_faces):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if kind == "glb":
        bpy.ops.import_scene.gltf(filepath=path)
    elif kind == "fbx":
        bpy.ops.import_scene.fbx(filepath=path, anim_offset=0.0)
    else:
        raise ValueError(kind)

    rigs = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    candidates = [
        mesh for mesh in meshes
        if len(mesh.data.polygons) == expected_faces and len(mesh.vertex_groups) > 0
    ]
    if len(rigs) != 1 or len(candidates) != 1:
        return {
            "passed": False,
            "armature_objects": len(rigs),
            "mesh_objects": len(meshes),
            "candidate_mesh_objects": len(candidates),
        }

    rig = rigs[0]
    mesh = candidates[0]
    expected_names = [item["name"] for item in expected_skeleton]
    expected_parents = {item["name"]: item["parent"] for item in expected_skeleton}
    actual_names = sorted(bone.name for bone in rig.data.bones)
    hierarchy_matches = all(
        (bone.parent.name if bone.parent else None) == expected_parents.get(bone.name)
        for bone in rig.data.bones
        if bone.name in expected_parents
    )
    skin = skinning_report(mesh, expected_groups)
    matrix_error = maximum_matrix_error(rig, expected_skeleton)
    result = {
        "passed": False,
        "armature_objects": 1,
        "mesh_objects": len(meshes),
        "candidate_mesh_objects": 1,
        "bone_count": len(actual_names),
        "bone_names_match": actual_names == sorted(expected_names),
        "hierarchy_matches": hierarchy_matches,
        "maximum_rest_matrix_error": matrix_error,
        "faces": len(mesh.data.polygons),
        "faces_match": len(mesh.data.polygons) == expected_faces,
        "vertex_groups_exact": skin["vertex_groups_exact"],
        "unweighted_vertices": skin["unweighted_vertices"],
        "maximum_influence_count": skin["maximum_influence_count"],
    }
    result["passed"] = bool(
        result["bone_count"] == 23
        and result["bone_names_match"]
        and result["hierarchy_matches"]
        and result["faces_match"]
        and result["vertex_groups_exact"]
        and result["unweighted_vertices"] == 0
        and result["maximum_influence_count"] <= 4
        and result["maximum_rest_matrix_error"] <= 0.0001
    )
    return result


def main(args):
    if not bpy.app.background:
        raise RuntimeError("Run bake_export.py with Blender --background.")

    source_file = os.path.abspath(bpy.data.filepath)
    source_rig = bpy.data.objects.get(SOURCE_RIG)
    source_body = bpy.data.objects.get(args.body_object)
    if source_rig is None or source_body is None:
        raise RuntimeError(f"Expected {SOURCE_RIG!r} and {args.body_object!r}")
    profile_property = source_body.get("openmarch_profile")
    if profile_property and profile_property != args.profile:
        raise RuntimeError(
            f"Profile mismatch: file says {profile_property!r}, CLI says {args.profile!r}"
        )

    body_v4_dir = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "body-v4"))
    out_dir = os.path.abspath(
        args.out_dir or os.path.join(body_v4_dir, "exports", args.profile)
    )
    animation_out_dir = os.path.abspath(
        args.animation_out_dir or os.path.join(body_v4_dir, "animations")
    )
    os.makedirs(out_dir, exist_ok=True)
    if args.animation_actions:
        os.makedirs(animation_out_dir, exist_ok=True)

    requested_names = list(dict.fromkeys([*args.actions, *args.animation_actions]))
    actions = choose_actions(requested_names)
    scene = bpy.context.scene
    scene.render.fps = 24
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")

    export_rig, export_body = create_export_contract(source_rig, source_body, scene)
    export_rig.hide_set(False)
    export_body.hide_set(False)
    contract = validate_contract(source_rig, source_body, export_rig, export_body)
    baked_by_source = {}
    deviations = []
    for action in actions:
        clip, result = bake_action(
            scene, source_rig, source_body, export_rig, export_body, action
        )
        baked_by_source[action.name] = clip
        deviations.append(result)
        print("OPENMARCH_BAKE_CLIP " + json.dumps(result, sort_keys=True))

    baked_actions = list(baked_by_source.values())
    output_scene = bpy.data.scenes.new("OpenMarch_Baked_Export")
    output_scene.collection.objects.link(export_rig)
    output_scene.collection.objects.link(export_body)
    output_scene.render.fps = 24
    output_scene.frame_start = 1
    output_scene.frame_end = int(max(clip.frame_range[1] for clip in baked_actions))
    for obj in (export_rig, export_body):
        for collection in list(obj.users_collection):
            if collection != output_scene.collection:
                collection.objects.unlink(obj)
    bpy.context.window.scene = output_scene
    set_action(export_rig, baked_actions[0])
    output_scene.frame_set(1)

    baked_path = os.path.join(
        out_dir, f"openmarch-body-v4-{args.profile}-baked.blend"
    )
    bpy.data.libraries.write(
        baked_path, {output_scene, *baked_actions}, fake_user=True, compress=True
    )

    body_glb = os.path.join(out_dir, f"openmarch-body-v4-{args.profile}.glb")
    export_body_glb(body_glb, export_rig, export_body)

    animation_files = []
    for action_name in args.animation_actions:
        clip = baked_by_source[action_name]
        action_id = slugify(action_name)
        path = os.path.join(animation_out_dir, f"openmarch-v4-{action_id}.glb")
        export_animation_glb(path, export_rig, clip, action_id)
        animation_files.append(path)

    expected_skeleton = skeleton_payload(export_rig)
    expected_groups = contract["deform_bones"]
    expected_faces = len(export_body.data.polygons)
    constraints_remaining = sum(
        len(pose_bone.constraints) for pose_bone in export_rig.pose.bones
    )
    with tempfile.TemporaryDirectory(prefix="openmarch-v4-roundtrip-") as temp_dir:
        body_fbx = os.path.join(temp_dir, f"openmarch-body-v4-{args.profile}.fbx")
        export_body_fbx(body_fbx, export_rig, export_body)
        glb_roundtrip = inspect_roundtrip(
            body_glb, "glb", expected_skeleton, expected_groups, expected_faces
        )
        fbx_roundtrip = inspect_roundtrip(
            body_fbx, "fbx", expected_skeleton, expected_groups, expected_faces
        )

    outputs = [baked_path, body_glb, *animation_files]
    report = {
        "schema_version": 1,
        "profile_id": args.profile,
        "source_file": file_record(source_file),
        "fps": 24,
        "skeleton_signature": contract["skeleton_signature"],
        "exported_bone_count": contract["exported_bone_count"],
        "deform_bones": contract["deform_bones"],
        "vertex_groups": contract["vertex_groups"],
        "unweighted_vertex_count": contract["unweighted_vertices"],
        "maximum_influence_count": contract["maximum_influence_count"],
        "maximum_weight_sum_error": contract["maximum_weight_sum_error"],
        "per_action_bake_deviation": deviations,
        "roundtrip": {"glb": glb_roundtrip, "fbx": fbx_roundtrip},
        "constraints_remaining": constraints_remaining,
        "outputs": [file_record(path) for path in outputs],
    }
    report["passed"] = bool(
        report["exported_bone_count"] == 23
        and report["unweighted_vertex_count"] == 0
        and report["maximum_influence_count"] <= 4
        and report["constraints_remaining"] == 0
        and all(
            item["maximum_vertex_bake_deviation"] <= 0.0001
            for item in report["per_action_bake_deviation"]
        )
        and report["roundtrip"]["glb"]["passed"]
        and report["roundtrip"]["fbx"]["passed"]
    )
    report_path = os.path.join(out_dir, "validation.json")
    with open(report_path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print("OPENMARCH_BAKE_RESULT " + json.dumps(report, sort_keys=True))
    if not report["passed"]:
        raise RuntimeError(f"Export validation failed; see {report_path}")


if __name__ == "__main__":
    main(parse_args())
