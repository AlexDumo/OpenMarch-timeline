# om-pose (vendored)

Plain ES modules from [om-pose](https://github.com/OpenMarch/om-pose) that draw and drive the 3D View's
marchers. Its `docs/openmarch-3d.md` is the specification they implement.

| File | om-pose path | Commit | Local changes |
|---|---|---|---|
| `instanced-marchers.js` | `render/instanced-marchers.js` | `87cc16e816f0d4a074098b9cb27fdb9431c95dac` | header comment only |
| `step-blend.js` | `render/step-blend.js` | `87cc16e816f0d4a074098b9cb27fdb9431c95dac` | header comment only |
| `uniform-shader.js` | `uniforms/uniform-shader.js` | `87cc16e816f0d4a074098b9cb27fdb9431c95dac` | header comment only |

The `.d.ts` files are hand-written for this app. Don't edit the `.js` files here: change them in om-pose
and copy them again, then update this table and list any change made here.

The shader patches were checked against three r186 (the app's version) with om-pose's own parity suite:
the instanced renderer differs from plain `SkinnedMesh` skinning on at most 0.003% of pixels for unblended
clips, the same as on r160.

TODO(license): om-pose has no license yet. These files and its assets must not ship, and no pull request
may go to OpenMarch/OpenMarch, until it has one compatible with AGPL-3.0.
