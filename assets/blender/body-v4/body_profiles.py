"""Build the v4 body family from the canonical rigged source.

Every profile is reopened from the frozen master before its mesh is reshaped.
Armatures, actions, topology, materials, and vertex weights are never edited.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from copy import deepcopy

import bpy
from mathutils import Vector


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RIGGING_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "rigging"))
if RIGGING_DIR not in sys.path:
    sys.path.insert(0, RIGGING_DIR)

from contract import (  # noqa: E402
    EXPORT_BODY,
    EXPORT_RIG,
    PROFILE_IDS,
    SOURCE_BODY,
    SOURCE_METARIG,
    SOURCE_RIG,
    create_export_contract,
    skeleton_signature,
    validate_contract,
)


AVERAGE = {
    "pelvis": (1.0, 1.0, 0.0),
    "waist": (1.0, 1.0, 0.0),
    "rib": (1.0, 1.0, 0.0),
    "chest": (1.0, 1.0, 0.0),
    "neck": (1.0, 1.0, 0.0),
    "head": (1.0, 1.0, 0.0),
    "shoulder": 1.0,
    "upper_arm": 1.0,
    "forearm": 1.0,
    "hand": 1.0,
    "thigh": 1.0,
    "shin": 1.0,
    "foot": 1.0,
    "toe": 1.0,
}


def profile(**overrides):
    result = deepcopy(AVERAGE)
    result.update(overrides)
    return result


PROFILES = {
    "neutral-slim": profile(
        pelvis=(0.92, 0.91, 0.0), waist=(0.88, 0.88, 0.0),
        rib=(0.91, 0.90, 0.0), chest=(0.91, 0.90, 0.0), neck=(0.94, 0.94, 0.0),
        shoulder=0.92, upper_arm=0.88, forearm=0.89, hand=0.94,
        thigh=0.90, shin=0.89,
    ),
    "neutral-average": profile(),
    "neutral-athletic": profile(
        pelvis=(1.02, 1.01, 0.0), waist=(0.97, 0.98, 0.0),
        rib=(1.06, 1.04, 0.0), chest=(1.11, 1.07, 0.0), neck=(1.04, 1.04, 0.0),
        shoulder=1.10, upper_arm=1.11, forearm=1.08, hand=1.02,
        thigh=1.11, shin=1.08,
    ),
    "neutral-broad": profile(
        pelvis=(1.08, 1.06, 0.0), waist=(1.08, 1.07, 0.0),
        rib=(1.12, 1.09, 0.0), chest=(1.15, 1.11, 0.0), neck=(1.08, 1.08, 0.0),
        shoulder=1.13, upper_arm=1.12, forearm=1.11, hand=1.05,
        thigh=1.12, shin=1.10,
    ),
    "neutral-full": profile(
        pelvis=(1.17, 1.17, 0.0), waist=(1.16, 1.19, 0.0),
        rib=(1.14, 1.17, 0.0), chest=(1.13, 1.16, 0.0), neck=(1.08, 1.08, 0.0),
        shoulder=1.10, upper_arm=1.14, forearm=1.13, hand=1.05,
        thigh=1.15, shin=1.13,
    ),
    "feminine-average": profile(
        pelvis=(1.19, 1.12, 0.0), waist=(0.84, 0.89, 0.0),
        rib=(0.93, 1.02, 0.04), chest=(1.02, 1.11, 0.09), neck=(0.94, 0.94, 0.0),
        shoulder=0.92, upper_arm=0.96, forearm=0.95, hand=0.96,
        thigh=1.10, shin=1.01,
    ),
    "masculine-average": profile(
        pelvis=(0.96, 0.99, 0.0), waist=(1.02, 1.02, 0.0),
        rib=(1.12, 1.07, 0.0), chest=(1.19, 1.11, 0.0), neck=(1.08, 1.08, 0.0),
        shoulder=1.17, upper_arm=1.10, forearm=1.07, hand=1.04,
        thigh=1.06, shin=1.04,
    ),
}

SPINE_REGIONS = {
    "DEF-spine": "pelvis",
    "DEF-spine.001": "waist",
    "DEF-spine.002": "rib",
    "DEF-spine.003": "chest",
    "DEF-spine.004": "neck",
    "DEF-spine.006": "head",
}


def limb_region(group_name):
    base = group_name.rsplit(".", 1)[0]
    return {
        "DEF-shoulder": "shoulder",
        "DEF-upper_arm": "upper_arm",
        "DEF-forearm": "forearm",
        "DEF-hand": "hand",
        "DEF-thigh": "thigh",
        "DEF-shin": "shin",
        "DEF-foot": "foot",
        "DEF-toe": "toe",
    }.get(base)


def closest_point_on_bone(co, bone):
    head = Vector(bone.head_local)
    tail = Vector(bone.tail_local)
    axis = tail - head
    length_squared = axis.length_squared
    if length_squared == 0.0:
        return head
    amount = max(0.0, min(1.0, (co - head).dot(axis) / length_squared))
    return head + axis * amount


def group_transform(co, group_name, rig, settings):
    if group_name in SPINE_REGIONS:
        width, depth, front_bias = settings[SPINE_REGIONS[group_name]]
        center_y = 0.005
        x = co.x * width
        y_delta = co.y - center_y
        if y_delta < 0.0:
            depth *= 1.0 + front_bias
        return Vector((x, center_y + y_delta * depth, co.z))

    region = limb_region(group_name)
    if region is None:
        return co.copy()
    factor = settings[region]
    center = closest_point_on_bone(co, rig.data.bones[group_name])
    return center + (co - center) * factor


def reshape_body(body, rig, profile_id):
    settings = PROFILES[profile_id]
    original = [vertex.co.copy() for vertex in body.data.vertices]
    group_names = {group.index: group.name for group in body.vertex_groups}
    maximum_displacement = 0.0

    for vertex, source_co in zip(body.data.vertices, original):
        result = Vector((0.0, 0.0, 0.0))
        total = 0.0
        for membership in vertex.groups:
            if membership.weight <= 0.0:
                continue
            group_name = group_names[membership.group]
            transformed = group_transform(source_co, group_name, rig, settings)
            result += transformed * membership.weight
            total += membership.weight
        if total < 1.0:
            result += source_co * (1.0 - total)
        elif total > 0.0:
            result /= total
        vertex.co = result
        maximum_displacement = max(maximum_displacement, (result - source_co).length)

    body.data.update()
    return maximum_displacement


def bounding_box(body):
    return {
        "min": [min(vertex.co[i] for vertex in body.data.vertices) for i in range(3)],
        "max": [max(vertex.co[i] for vertex in body.data.vertices) for i in range(3)],
    }


def render_preview(body, output_path):
    scene = bpy.context.scene
    rig = bpy.data.objects[SOURCE_RIG]
    if rig.animation_data:
        rig.animation_data.action = None
    scene.frame_set(1)
    scene.camera = bpy.data.objects.get("Body_Preview_Camera") or scene.camera
    if scene.camera is None:
        return False

    for obj in scene.objects:
        if obj.type == "MESH":
            obj.hide_render = obj != body
    body.hide_render = False
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.filepath = output_path
    scene.render.image_settings.color_mode = "RGBA"
    bpy.ops.render.render(write_still=True)
    return os.path.exists(output_path)


def require_source_contract():
    missing = [
        name for name in (SOURCE_BODY, SOURCE_RIG, SOURCE_METARIG)
        if bpy.data.objects.get(name) is None
    ]
    if missing:
        raise RuntimeError(f"Missing canonical objects: {missing}")


def build_family(output_root, *, render_previews=False):
    require_source_contract()
    bpy.context.preferences.filepaths.save_version = 0
    os.makedirs(output_root, exist_ok=True)
    master_dir = os.path.join(output_root, "master")
    source_dir = os.path.join(output_root, "source")
    export_dir = os.path.join(output_root, "exports")
    animation_dir = os.path.join(output_root, "animations")
    preview_dir = os.path.join(output_root, "previews")
    for directory in (master_dir, source_dir, export_dir, animation_dir, preview_dir):
        os.makedirs(directory, exist_ok=True)

    source_rig = bpy.data.objects[SOURCE_RIG]
    source_body = bpy.data.objects[SOURCE_BODY]
    export_rig, export_body = create_export_contract(source_rig, source_body)
    export_rig.hide_viewport = True
    export_rig.hide_render = True
    export_body.hide_viewport = True
    export_body.hide_render = True
    source_body["openmarch_profile"] = "neutral-average"
    source_rig["openmarch_skeleton_contract"] = "body-v4"
    validate_contract(source_rig, source_body, export_rig, export_body)

    master_path = os.path.join(master_dir, "openmarch-body-v4-base-rigged.blend")
    bpy.ops.wm.save_as_mainfile(filepath=master_path, compress=True)
    motion_path = os.path.join(master_dir, "openmarch-motion-v4.blend")
    shutil.copy2(master_path, motion_path)
    canonical_signature = skeleton_signature(bpy.data.objects[EXPORT_RIG])

    manifest = {
        "schema_version": 1,
        "master": os.path.relpath(master_path, output_root),
        "motion_source": os.path.relpath(motion_path, output_root),
        "fps": bpy.context.scene.render.fps,
        "skeleton_signature": canonical_signature,
        "profiles": {},
    }

    for profile_id in PROFILE_IDS:
        bpy.ops.wm.open_mainfile(filepath=master_path, load_ui=False)
        source_rig = bpy.data.objects[SOURCE_RIG]
        source_body = bpy.data.objects[SOURCE_BODY]
        displacement = reshape_body(source_body, source_rig, profile_id)
        export_rig, export_body = create_export_contract(source_rig, source_body)
        export_rig.hide_viewport = True
        export_rig.hide_render = True
        export_body.hide_viewport = True
        export_body.hide_render = True
        source_body["openmarch_profile"] = profile_id
        source_rig["openmarch_skeleton_contract"] = "body-v4"
        export_rig["openmarch_profile"] = profile_id
        export_body["openmarch_profile"] = profile_id
        report = validate_contract(source_rig, source_body, export_rig, export_body)
        if report["skeleton_signature"] != canonical_signature:
            raise RuntimeError(f"Skeleton changed while building {profile_id}")

        source_path = os.path.join(
            source_dir, f"openmarch-body-v4-{profile_id}-rigged.blend"
        )
        bpy.ops.wm.save_as_mainfile(filepath=source_path, compress=True)
        preview_path = os.path.join(preview_dir, f"openmarch-body-v4-{profile_id}.png")
        preview_written = render_preview(source_body, preview_path) if render_previews else False
        manifest["profiles"][profile_id] = {
            "source": os.path.relpath(source_path, output_root),
            "preview": os.path.relpath(preview_path, output_root) if preview_written else None,
            "maximum_vertex_displacement": displacement,
            "bounding_box": bounding_box(source_body),
            "parameters": PROFILES[profile_id],
            "skeleton_signature": report["skeleton_signature"],
        }
        print("OPENMARCH_PROFILE " + json.dumps({"profile": profile_id, **manifest["profiles"][profile_id]}))

    manifest_path = os.path.join(output_root, "profile-manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print("OPENMARCH_PROFILE_RESULT " + json.dumps(manifest, sort_keys=True))
    return manifest


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--out-root",
        default=SCRIPT_DIR,
        help="Body-v4 output root containing master/source/exports/animations.",
    )
    parser.add_argument("--render-previews", action="store_true")
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return parser.parse_args(values)


if __name__ == "__main__":
    if not bpy.app.background:
        raise RuntimeError("Run body_profiles.py with Blender --background.")
    arguments = parse_args()
    build_family(os.path.abspath(arguments.out_root), render_previews=arguments.render_previews)
