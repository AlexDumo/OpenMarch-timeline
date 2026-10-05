# OpenMarch humanoid rig

Legacy working file: `../openmarch-body-v4-rigged.blend`.
The shared-skeleton body family now lives under `../body-v4/`; see
`../body-v4/README.md` for profile generation, per-profile exports, and validation.
The original `../openmarch-body-v3.blend` is preserved.

## Controls

Select **OpenMarch_Rig**, enter **Pose Mode**, and animate the colored custom shapes.
The rig faces **−Y**, with **+Z up** and **+X character-left**.

| Purpose                           | Control                                                        |
| --------------------------------- | -------------------------------------------------------------- |
| World movement and heading        | `root` at ground level; use uniform scaling only               |
| Body translation / weight shift   | `torso`                                                        |
| Pelvis rotation                   | `hips`                                                         |
| Upper torso                       | `chest`, plus `spine_fk` controls                              |
| Neck / head                       | `neck`, `head`                                                 |
| Clavicles                         | `shoulder.L`, `shoulder.R`                                     |
| Arm FK                            | `upper_arm_fk`, `forearm_fk`, `hand_fk`, each with `.L` / `.R` |
| Hand IK                           | `hand_ik.L`, `hand_ik.R`                                       |
| Elbow poles                       | `upper_arm_ik_target.L`, `.R`                                  |
| Foot IK                           | `foot_ik.L`, `foot_ik.R`                                       |
| Knee poles                        | `thigh_ik_target.L`, `.R`                                      |
| Heel lift, heel pivot and banking | Rotate `foot_heel_ik.L` / `.R`; local X rolls, local Y banks   |
| Toe articulation                  | `toe_ik.L`, `toe_ik.R`                                         |

The default workflow is **FK arms and IK legs**. This suits marching arm swings,
walking, running, standing, and gestures. Hand IK is available for reaching or
holding a hand in place. Poles are enabled and IK stretch is disabled.

For each arm, `upper_arm_parent.L/R["IK_FK"]` is **1 = FK, 0 = IK**.
The equivalent leg property is on `thigh_parent.L/R`.
Select a limb control and open the 3D View sidebar (**N → Item → Rig Main Properties**)
for Rigify's IK-FK slider and matching tools. The same properties remain accessible
under the appropriate pose bone's Custom Properties.

Choose the arm mode in neutral before starting a clip. Keep the mode constant
within the clip unless you explicitly match both control sets and key the switch.
Rigify's matching buttons can require manual elbow-pole adjustment for strongly
twisted FK poses on this fitted A-pose skeleton; seamless switching in arbitrary
poses is not guaranteed. Its labels describe the controls being matched:
**IK→FK** matches IK controls to the current FK pose, then set the slider to 0;
**FK→IK** matches FK controls to IK, then set it to 1. Check the elbow before keying.

The embedded `OpenMarch_Rig_ui.py` supplies Rigify's panels. If Blender disables
saved Python scripts, the rig's constraints and animation still work. To restore
the panels, open that text in Blender's Text Editor and use **Run Script**.
No extension installation is needed. `OpenMarch_Metarig` is the hidden fitted
generation reference; animate the generated rig. Regenerating it would replace
the deliberate rigid-scale and selection adjustments, so do not regenerate for
ordinary animation.

## Deformation and limitations

The working rig has 22 deform bones and native Rigify controls/mechanisms.
`DEF-spine` is the pelvis, `.001` and `.002` are the lower/upper spine, `.003` is
the chest, `.004` is the neck, and `.006` is the head. The numbered gap is Rigify's
retained naming, not an extra or missing head bone. Limbs use one bone per section;
each mitten has one hand bone and no fingers.

DEF, ORG and MCH collections are hidden; deform/mechanism bones are unselectable.
Tweak collections and unused leg FK controls are hidden by default. Bone
Collections can expose them when needed. Controllers do not deform the mesh.

The body remains 530 vertices / 1,056 faces. Its coordinates, topology, flat
shading, materials, lack of UVs and lack of shape keys are preserved. One Armature
modifier targets `OpenMarch_Rig`. All 22 vertex groups target deform bones;
every vertex is normalized with at most four influences. Heat weights were
manually refined for chest/armpit isolation, localized elbows/wrists, rigid
mittens/head, hip-side separation, knees, ankles and toes, then mirrored wherever
the original vertices have an exact counterpart.

The sparse triangular topology still produces visible angular creases and some
volume loss at deep elbows, knees and high hip flexion. The raised-arm armpit
transition is intentionally faceted. These are not smooth anatomical deformations.
There are no corrective shapes or added topology. Non-root control scaling is
locked, and deform scale follows the root uniformly to avoid squash/stretch and
export shear. Joint parenting is retained without Connected flags, allowing the
small joint translations used by the native rig to bake accurately.

## Named test actions

**Rig_Test**, 24 fps, frames 1–121:

| Frame | Pose                                    |
| ----- | --------------------------------------- |
| 1     | Neutral                                 |
| 21    | Raised arms                             |
| 41    | Bent elbows and wrists                  |
| 61    | Lifted left knee, right foot planted    |
| 81    | Right leg stepping, left foot planted   |
| 101   | Head turn, neck bend and chest rotation |
| 121   | Neutral                                 |

**Rig_IK_Check**, frames 1–81: neutral, hand IK and elbow poles (21), higher knee
flexion (41), foot roll and toe articulation (61), neutral (81).
Both have fake users and named control channels. `Rig_Test` is active on opening.
Use the Action Editor to choose or duplicate a clip; do not add new animation to
the test action inadvertently. The tests demonstrate poses, not finished gait cycles.

## Bake and export new animation

The supplied helper uses native Blender visual baking and never saves over the
working file. It creates an export rig containing **root + 22 deform bones**,
reparents it into an ordinary humanoid hierarchy, copies evaluated controller
motion, then bakes location/rotation/scale on every frame and removes all
constraints. It verifies the baked mesh against the controller-driven mesh.

1. Animate `OpenMarch_Rig`, name each Action, and save the working `.blend`.
2. Run the following in Terminal from the project folder. This example rebuilds
   the supplied test exports; substitute your saved file and Action names as needed.

```sh
blender --background 'assets/blender/openmarch-body-v4-rigged.blend' \
  --python 'assets/blender/rigging/bake_export.py' \
  -- --profile neutral-average \
  --out-dir 'assets/blender/body-v4/exports/neutral-average' \
  --actions Rig_Test Rig_IK_Check
```

On macOS without `blender` on PATH, use
`/Applications/Blender.app/Contents/MacOS/Blender` instead.
For other clips, replace the final names with e.g. `Walk Run Stand`.
Use `--out-dir '/absolute/output/folder'` after the action names to choose a
different destination. Running again replaces those generated export files.

3. Collect the profile's named baked `.blend`, animation-free body `.glb`, and
   `validation.json` from `../body-v4/exports/<profile>/`. Shared animation-only
   GLBs are exported once to `../body-v4/animations/` by passing
   `--animation-actions`. The baked companion contains only the export scene,
   mesh, materials, clean skeleton and requested baked actions. It has no Rigify
   dependency or remaining constraints. Bone translations are part of the
   animation and must be retained by the receiving tool.

### Manual export from the baked companion

Open `exports/openmarch-body-v4-baked.blend`. Select `OpenMarch_Export` and
`OpenMarch_Body_Export`. Choose the desired `*_Baked` action in the Action Editor,
set the scene frame range to that action, and keep 24 fps.

**GLB:** File → Export → glTF 2.0. Choose GLB, Selected Objects, Skinning and
Animations. Use **Active Actions**, sampling enabled / frame step 1, Deformation
Bones Only, and give the merged animation the action's name. Leave Apply Modifiers,
cameras, lights and Draco compression off. Export. Flat normals can cause the
exporter to split vertex records; triangle count and silhouette remain unchanged.

**FBX:** File → Export → FBX. Use Selected Objects, Mesh and Armature only,
Scale 1, Forward −Z / Up Y. Disable Apply Modifiers and Add Leaf Bones; enable
Only Deform Bones. Under Bake Animation enable Key All Bones and Force Start/End
Keying; disable NLA Strips and All Actions; Sampling Rate 1 and Simplify 0. Export
one file per chosen action. Preserve bone translation channels in your importer.

**Blender FBX reimport detail:** Blender can reconnect coincident rest joints on
import, which blocks their animated local translations. After importing this FBX,
select its armature, enter Edit Mode, select all bones, and use **Alt-P → Disconnect
Bone** (retain the parent hierarchy). Return to Object/Pose Mode. Do not Clear
Parent. This was necessary for an accurate Blender FBX round-trip. GLB does not
need that adjustment. FBX's default Blender import also offsets the first key to
frame 2; use Animation Offset 0 to avoid the extra frame.

## Validation

All frames of both baked clips were compared to their controller-driven meshes:
maximum bake deviation was under 0.003 mm at one unit per meter. Named poses were
also checked after GLB and FBX reimport. GLB's maximum sampled difference was
under 0.072 mm; FBX after disconnecting imported joints was under 0.006 mm.
`exports/bake_validation.json` and `exports/roundtrip_validation.json` contain
the measured results. The GLB has one skin, 23 joints, one mesh, one named clip,
four-weight skinning attributes, and no UV attributes.

These numerical checks verify transfer fidelity; the supplied preview and visual
pose checks assess the limited topology's deformation. They are not a guarantee
for every possible pose or downstream engine.

Native references: [Rigify](https://docs.blender.org/manual/en/latest/addons/rigify/basics.html),
[Visual bake](https://docs.blender.org/api/current/bpy.ops.nla.html),
[glTF export](https://docs.blender.org/manual/en/latest/addons/scene_gltf2.html),
[FBX export](https://docs.blender.org/manual/en/latest/files/import_export/fbx_legacy.html).
