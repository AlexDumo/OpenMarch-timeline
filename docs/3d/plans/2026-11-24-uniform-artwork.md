# Plan: uniform artwork (flats and the hybrid wrap)

- Design: [../uniform-artwork.md](../uniform-artwork.md)
- Epic: fork #971, work under #975
- Integration branch: `uniforms/host`. It ships to `main` as **one** pull request.
- Orchestrator: one T3 thread, which owns this file and the tracker.

## What "shipped" means

The integration pull request goes to `main` when all of these are true:

1. An artist downloads the uniform template, paints the front and back as a PNG, and uploads it.
   The band in the 3D View then wears it on all 7 body types.
2. Logos and numbers are placed in the app and keep their shape on every body.
3. A pack can hold modes, such as sash out, and a show can switch between them.
4. An agent turns uniform photos into a pack with the skill and its headless render command.
5. At least one real artist has finished a uniform on the template (#1259), and the pack format is
   then frozen.
6. The web build plays about 300 marchers in custom uniforms at an acceptable frame rate.
7. Every CI check is green, one full independent review has been done, and the owner has approved.

## Not in this pull request

- hats and plumes (#1229)
- hanging pieces (#1261, waiting for the owner to pick which pieces)
- rigged imported garments
- previewing assets on the web and opening them in OpenMarch (#1262)
- Uniform cues, unless the cue system (#775, #976) is ready. Without them, the mode is picked in the
  uniform settings.

## Rules

- Every step is its own pull request into `uniforms/host`, merged with a merge commit once a review
  passes and the fast checks are green.
- Push as soon as the code compiles. Send the preview link with steps to try:
  `https://<branch-with-dashes>-openmarch-fork-preview-build.alexdumo.workers.dev`
- Simulated users try a step before the owner sees it.
- At most two steps wait on the owner at once.
- Bring `main` into `uniforms/host` before each step starts, so the final merge stays small.
- Anything new that comes up becomes an issue and a row below, not a detour.

## Tracker

Owner verdicts are good, fix or rethink.

| Step | Issue | What you can try                                         | Branch / PR                          | Status          | Owner verdict |
| ---- | ----- | -------------------------------------------------------- | ------------------------------------ | --------------- | ------------- |
| 0    | #975  | The design and this plan                                 | `docs/uniform-artwork-flats` / #1254 | In review       |               |
| 1    | #1256 | Download the uniform template from the 3D View settings  |                                      | Started         |               |
| 2    | #1255 | A sample uniform in flats on the band, on all body types |                                      | Started         |               |
| 3    | #1257 | Import front/back PNG, SVG or PDF as the band's uniform  |                                      | Waiting on 1, 2 |               |
| 4    | #1258 | Place logos and numbers, and preview on all 7 bodies     |                                      | Waiting on 3    |               |
| 5    | #1257 | Modes (sash out, unzipped) and switching between them    |                                      | Waiting on 3    |               |
| 6    | #1260 | Agent skill: photos to a pack, plus headless render      |                                      | Waiting on 3, 4 |               |
| H    | #1259 | A real artist makes a uniform on the template            | needs a person                       | Waiting on 1    |               |

## Decisions log

- 2026-11-24: the owner chose one integration pull request into `main`, built from small step pull
  requests.
- 2026-11-24: the owner split asset preview and opening assets in OpenMarch into its own epic,
  #1262. The uniform pack is the first kind of portable file (comment on #1257).
