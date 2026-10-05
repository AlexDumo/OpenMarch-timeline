"""Validate the complete body-v4 family and shared-animation GLBs."""

from __future__ import annotations

import argparse
import json
import os
import struct


PROFILE_IDS = (
    "neutral-slim",
    "neutral-average",
    "neutral-athletic",
    "neutral-broad",
    "neutral-full",
    "feminine-average",
    "masculine-average",
)


def read_glb_json(path):
    with open(path, "rb") as handle:
        magic, version, length = struct.unpack("<4sII", handle.read(12))
        if magic != b"glTF" or version != 2:
            raise ValueError(f"Not a glTF 2.0 binary: {path}")
        while handle.tell() < length:
            chunk_length, chunk_type = struct.unpack("<I4s", handle.read(8))
            payload = handle.read(chunk_length)
            if chunk_type == b"JSON":
                return json.loads(payload.decode("utf-8").rstrip(" \t\r\n\x00"))
    raise ValueError(f"No JSON chunk in {path}")


def node_names(document, indices):
    nodes = document.get("nodes", [])
    return [nodes[index].get("name") for index in indices]


def validate_body_glb(path):
    document = read_glb_json(path)
    skins = document.get("skins", [])
    animations = document.get("animations", [])
    meshes = document.get("meshes", [])
    joints = node_names(document, skins[0]["joints"]) if len(skins) == 1 else []
    result = {
        "file": os.path.abspath(path),
        "mesh_count": len(meshes),
        "skin_count": len(skins),
        "animation_count": len(animations),
        "joint_count": len(joints),
        "joint_names": sorted(joints),
    }
    result["passed"] = bool(
        result["mesh_count"] == 1
        and result["skin_count"] == 1
        and result["animation_count"] == 0
        and result["joint_count"] == 23
    )
    return result


def validate_animation_glb(path, canonical_joint_names):
    document = read_glb_json(path)
    animations = document.get("animations", [])
    meshes = document.get("meshes", [])
    nodes = document.get("nodes", [])
    node_name_by_index = {
        index: node.get("name") for index, node in enumerate(nodes)
    }
    target_names = sorted(
        {
            node_name_by_index[channel["target"]["node"]]
            for animation in animations
            for channel in animation.get("channels", [])
        }
    )
    skeleton_names = sorted(
        name for name in node_name_by_index.values() if name in canonical_joint_names
    )
    result = {
        "file": os.path.abspath(path),
        "mesh_count": len(meshes),
        "animation_count": len(animations),
        "skeleton_joint_count": len(skeleton_names),
        "target_names": target_names,
        "targets_are_canonical_joints": set(target_names).issubset(canonical_joint_names),
    }
    result["passed"] = bool(
        result["mesh_count"] == 0
        and result["animation_count"] == 1
        and result["skeleton_joint_count"] == 23
        and result["targets_are_canonical_joints"]
    )
    return result


def validate_family(root):
    manifest_path = os.path.join(root, "profile-manifest.json")
    with open(manifest_path, encoding="utf-8") as handle:
        manifest = json.load(handle)
    signature = manifest["skeleton_signature"]
    profiles = {}
    canonical_joint_names = None

    for profile_id in PROFILE_IDS:
        export_dir = os.path.join(root, "exports", profile_id)
        report_path = os.path.join(export_dir, "validation.json")
        with open(report_path, encoding="utf-8") as handle:
            profile_report = json.load(handle)
        body_path = os.path.join(export_dir, f"openmarch-body-v4-{profile_id}.glb")
        body_report = validate_body_glb(body_path)
        if canonical_joint_names is None:
            canonical_joint_names = set(body_report["joint_names"])
        source_path = os.path.join(
            root, "source", f"openmarch-body-v4-{profile_id}-rigged.blend"
        )
        baked_path = os.path.join(
            export_dir, f"openmarch-body-v4-{profile_id}-baked.blend"
        )
        record = {
            "profile_validation_passed": profile_report.get("passed") is True,
            "skeleton_signature_matches": profile_report.get("skeleton_signature") == signature,
            "body_glb": body_report,
            "source_exists": os.path.exists(source_path),
            "baked_exists": os.path.exists(baked_path),
        }
        record["passed"] = all(
            (
                record["profile_validation_passed"],
                record["skeleton_signature_matches"],
                record["body_glb"]["passed"],
                record["source_exists"],
                record["baked_exists"],
            )
        )
        profiles[profile_id] = record

    animation_dir = os.path.join(root, "animations")
    animations = {}
    for filename in sorted(os.listdir(animation_dir)):
        if not filename.endswith(".glb"):
            continue
        path = os.path.join(animation_dir, filename)
        animations[filename] = validate_animation_glb(path, canonical_joint_names)

    report = {
        "schema_version": 1,
        "skeleton_signature": signature,
        "runtime_height_scales": [0.9, 1.0, 1.1],
        "profiles": profiles,
        "animations": animations,
    }
    report["passed"] = bool(
        len(profiles) == 7
        and all(item["passed"] for item in profiles.values())
        and len(animations) > 0
        and all(item["passed"] for item in animations.values())
    )
    output_path = os.path.join(root, "family-validation.json")
    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print("OPENMARCH_FAMILY_RESULT " + json.dumps(report, sort_keys=True))
    if not report["passed"]:
        raise RuntimeError(f"Family validation failed; see {output_path}")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=os.path.dirname(os.path.abspath(__file__)))
    args = parser.parse_args()
    validate_family(os.path.abspath(args.root))
