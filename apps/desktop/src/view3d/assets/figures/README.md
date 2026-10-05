# Performer figure models

The 3D View draws performers with these models (`window/performers/figureModel.ts`).
They are exports of the body-v4 family in `assets/blender/body-v4` at the repository
root; see its README for the skeleton contract and how to rebuild them.

| File                       | Source                                                          |
| -------------------------- | --------------------------------------------------------------- |
| `body-neutral-average.glb` | `exports/neutral-average/openmarch-body-v4-neutral-average.glb` |
| `clip-attention.glb`       | `animations/openmarch-v4-attention.glb` (held pose)             |
| `clip-walk-in-place.glb`   | `animations/openmarch-v4-walk-in-place.glb` (marching loop)     |

They ship inside the bundle as data URLs, so the window loads them without a file or
network request. Replace a file with a re-export from the same skeleton and the bake
picks it up; `core/figures/__test__/bake.test.ts` checks the result against three.js
skinning.
