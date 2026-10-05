"""Render the required v4 pose-QA frames for every body profile."""

from __future__ import annotations

import argparse
import json
import os
import sys

import bpy


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RIGGING_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "rigging"))
if RIGGING_DIR not in sys.path:
    sys.path.insert(0, RIGGING_DIR)

from contract import PROFILE_IDS, SOURCE_BODY, SOURCE_RIG  # noqa: E402


POSES = (
    ("Rig_Test", 1, "neutral"),
    ("Rig_Test", 21, "arms-raised"),
    ("Rig_Test", 61, "marching-high-knee"),
    ("Rig_Test", 81, "stride-opposing-arm"),
    ("Rig_Test", 101, "chest-head-turn"),
    ("Rig_IK_Check", 41, "deep-knee-bend"),
    ("Rig_IK_Check", 61, "foot-roll-toe-lift"),
)


def set_action(rig, action):
    rig.animation_data_create()
    rig.animation_data.action = action
    if action.slots:
        suitable = list(rig.animation_data.action_suitable_slots)
        rig.animation_data.action_slot = suitable[0] if suitable else action.slots[0]


def configure_render(body, output_path):
    scene = bpy.context.scene
    scene.camera = bpy.data.objects.get("Body_Preview_Camera") or scene.camera
    if scene.camera is None:
        raise RuntimeError("Body_Preview_Camera is missing")
    for obj in scene.objects:
        if obj.type == "MESH":
            obj.hide_render = obj != body
    body.hide_render = False
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 384
    scene.render.resolution_y = 384
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.render.filepath = output_path


def render_family(body_root, output_root):
    records = []
    for profile_id in PROFILE_IDS:
        source_path = os.path.join(
            body_root, "source", f"openmarch-body-v4-{profile_id}-rigged.blend"
        )
        bpy.ops.wm.open_mainfile(filepath=source_path, load_ui=False)
        body = bpy.data.objects[SOURCE_BODY]
        rig = bpy.data.objects[SOURCE_RIG]
        profile_dir = os.path.join(output_root, profile_id)
        os.makedirs(profile_dir, exist_ok=True)
        for action_name, frame, pose_id in POSES:
            action = bpy.data.actions[action_name]
            set_action(rig, action)
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            output_path = os.path.join(profile_dir, f"{frame:03d}-{pose_id}.png")
            configure_render(body, output_path)
            bpy.ops.render.render(write_still=True)
            records.append(
                {
                    "profile_id": profile_id,
                    "action": action_name,
                    "frame": frame,
                    "pose": pose_id,
                    "file": os.path.relpath(output_path, body_root),
                }
            )
            print("OPENMARCH_QA_POSE " + json.dumps(records[-1], sort_keys=True))

    manifest_path = os.path.join(output_root, "pose-qa.json")
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump({"poses": records}, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print("OPENMARCH_QA_RESULT " + json.dumps({"renders": len(records)}))


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--body-root", default=SCRIPT_DIR)
    parser.add_argument("--out-dir", default=os.path.join(SCRIPT_DIR, "qa"))
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return parser.parse_args(values)


if __name__ == "__main__":
    if not bpy.app.background:
        raise RuntimeError("Run render_pose_qa.py with Blender --background.")
    args = parse_args()
    render_family(os.path.abspath(args.body_root), os.path.abspath(args.out_dir))
