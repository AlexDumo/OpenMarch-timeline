# OpenMarch body v4 family

This directory contains seven mesh profiles driven by one immutable v4 skeleton
and one motion source. Profile files are generated from the master; no profile is
modeled from another profile and no armature rest data is changed.

## Contract

- Forward: -Y; up: +Z; 24 fps.
- `OpenMarch_Rig` remains the authoring/control rig.
- `OpenMarch_Export` is the clean 23-bone runtime skeleton (`root` plus 22 deform
  bones).
- Every body has the same 22 non-empty deform vertex groups, no unweighted
  vertices, and at most four influences.
- Runtime height is a uniform root scale: `0.90`, `1.00`, or `1.10`.
- Body GLBs contain mesh, material, skin, and skeleton with zero animation clips.
- Animation GLBs contain the canonical skeleton and one clip with no mesh.

The canonical skeleton signature for this release is recorded in
`profile-manifest.json` and `family-validation.json`.

## Profiles

`neutral-slim`, `neutral-average`, `neutral-athletic`, `neutral-broad`,
`neutral-full`, `feminine-average`, and `masculine-average`.

## Rebuild

From the repository root:

```sh
blender --background 'assets/blender/openmarch-body-v4-rigged.blend' \
  --python 'assets/blender/body-v4/body_profiles.py' -- \
  --out-root 'assets/blender/body-v4' --render-previews
```

The generator freezes `master/openmarch-body-v4-base-rigged.blend`, copies it to
`master/openmarch-motion-v4.blend`, then reopens the master before generating each
profile. It changes mesh coordinates only. Profile parameters and bounding boxes
are recorded in `profile-manifest.json`.

## Bake and export a profile

```sh
blender --background \
  'assets/blender/body-v4/source/openmarch-body-v4-neutral-athletic-rigged.blend' \
  --python 'assets/blender/rigging/bake_export.py' -- \
  --profile neutral-athletic \
  --body-object OpenMarch_Body \
  --out-dir 'assets/blender/body-v4/exports/neutral-athletic' \
  --actions Rig_Test Rig_IK_Check
```

Each profile directory receives a baked companion, animation-free body GLB, and
`validation.json` with skeleton signature, group/influence checks, per-action bake
deviation, GLB/FBX round-trip results, hashes, and sizes.

To export the canonical motion library once, run the neutral-average source and
add:

```text
--animation-actions Attention HornCarry March Walk_InPlace
--animation-out-dir assets/blender/body-v4/animations
```

The current authoring file contains those four production actions. `Rig_Test` and
`Rig_IK_Check` remain regression actions. Names such as `march_8to5`, `run`,
`horn_up`, and `horn_down` are intentionally not emitted until authored on the
canonical control rig.

## Acceptance checks

Render the required neutral, raised-arm, high-knee, stride, deep-bend, torso-turn,
and foot-roll poses:

```sh
blender --background --factory-startup \
  --python 'assets/blender/body-v4/render_pose_qa.py' -- \
  --body-root 'assets/blender/body-v4' \
  --out-dir 'assets/blender/body-v4/qa'
```

Then validate the complete family and shared-animation compatibility:

```sh
python3 assets/blender/body-v4/validate_family.py \
  --root assets/blender/body-v4
```

All seven profile reports and `family-validation.json` must have `"passed": true`.
