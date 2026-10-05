# OpenMarch 3D transfer notes

This folder contains the local 3D asset project. Preserve its directory structure
when copying to another machine. The Blender sources, generated GLBs, scripts,
previews, manifests, and validation reports are all included.

## Where to start

- `assets/blender/body-v4/README.md`: current seven-body workflow, export commands,
  shared animation contract, and acceptance checks.
- `assets/blender/rigging/README.md`: rig controls, known deformation limits,
  bake/export process, and round-trip validation.
- `assets/blender/body-v4/master/`: canonical body and motion Blender files.
- `assets/blender/body-v4/source/`: seven rigged body-profile Blender files.
- `assets/blender/body-v4/exports/`: body GLBs, baked Blender companions, and
  validation reports for each profile.
- `assets/blender/body-v4/animations/`: shared animation-only GLBs.
- `assets/blender/body-v4/qa/` and `previews/`: pose checks and profile previews.
- `assets/blender/rigging/`: rig generation and validation scripts.
- `assets/blender/legacy-tools/`: generators for the earlier marcher and body
  v1–v3 iterations (originally `tools/blender/`).

The older model iterations and test exports remain in `assets/blender/`. The
sphere test files and empty `assets/models/` from the original transfer were
not brought into the repository.

## Body-family plan and current state

The seven target profiles are `neutral-slim`, `neutral-average`,
`neutral-athletic`, `neutral-broad`, `neutral-full`, `feminine-average`, and
`masculine-average`. These have been generated and exported. They share identical
topology, vertex groups, a 23-bone runtime skeleton, and one animation library.
Only body mesh coordinates vary. Height is handled by uniform root scaling at
0.90, 1.00, or 1.10. True limb-length variants would require a separate
retargeting effort.

The canonical control rig remains `OpenMarch_Rig`; `OpenMarch_Export` is the
constraint-free runtime rig. Production actions currently authored are
`Attention`, `HornCarry`, `March`, and `Walk_InPlace`. `Rig_Test` and
`Rig_IK_Check` are regression actions. Planned actions such as run, horn up/down,
mark time, and other pace-specific marches have not been authored yet. Continue
authoring animation once on the canonical motion file, then export shared clips
for all seven body profiles. Keep skeleton names, hierarchy, rest transforms,
forward/up axes, 24 fps, and four-influence skinning contract unchanged.

For every new profile or revised animation, run the pose render and family
validation commands in `assets/blender/body-v4/README.md`. Inspect neutral,
raised arms, high knee, stride, deep knee bend, torso/head turn, and foot roll.
Current `family-validation.json` and per-profile `validation.json` files capture
the latest generated results.

## Uniform and customization plan

The next proposed product layer is a modular uniform system fitted to this body
family. Author a master garment on `neutral-average`, transfer the 22 deform
weights, apply the existing body-profile deformation, maintain body clearance,
and generate an occlusion mask. Validate all seven fitted results against the
pose suite and skeleton signature, then export one garment GLB per profile.
Seven deterministic outputs are the simpler starting point; shared garment
morph targets are a possible later storage optimization.

Separate uniform content into material skins (colors, fabric panels, logos),
fitted garments (jacket, bibbers, skirt), rigid bone/socket attachments (shako,
buttons, medals), flexible attachments (plumes, cords, sashes), and genuinely
loose cloth (capes or skirts). Use skinned meshes for normal field view, limited
secondary motion for close views, and offline cloth baking for rendered scenes.
GLB does not carry a portable cloth solver, so any runtime physics settings
belong in an OpenMarch manifest.

Proposed user submission levels are: an instant designer assembled from approved
modules and supplied artwork; a verified partner upload with a Blender template
and automated validation; and a custom studio build from reference materials.
Each uniform package should record ID/version, skeleton signature, compatible
profiles, mesh category, occlusion mask, material zones, decal regions, sockets,
physics tier, LODs, ownership/license metadata, and validation results.

The recommended first pilot is one difficult uniform with a fitted jacket,
bibbers, sash, shako, plume, cords, and one loose cape or skirt. Prove that it
generates seven clean fits and passes the existing pose suite before broadening
the catalog. Blender is enough for the first automated fitting/validation pass;
specialized garment tools can be introduced for authoring as throughput grows.

These plans originated in the Codex chats titled "Plan body type model variants"
and "Assess scalable uniform customizer". This note is a portable summary of
their decisions; the project READMEs are the source of truth for current commands
and files.
