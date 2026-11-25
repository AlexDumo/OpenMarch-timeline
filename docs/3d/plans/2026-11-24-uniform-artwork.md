# Plan: uniform artwork (flats and the hybrid wrap)

- Design: [../uniform-artwork.md](../uniform-artwork.md)
- Epic: fork #971, work under #975
- Integration branch: `uniforms/host`. It ships to `main` as **one** pull request.
- Orchestrator: one T3 thread, which owns this file and keeps the tracker in the integration
  pull request (fork #1274) up to date.

## What "shipped" means

The owner decided on 2026-11-24 that custom uniforms reach `main` as an **opt-in preview**, behind
the **Custom uniforms (preview)** setting, off by default in releases, with a warning that the file
format isn't final. A show that already wears a custom uniform still draws it with the setting
off. The integration pull request goes to `main` when all of these are true:

1. An artist downloads the uniform template, paints the front and back as a PNG, and uploads it.
   The band in the 3D View then wears it on every body type.
2. Logos and numbers are placed in the app and keep their shape on every body.
3. A pack can hold modes, such as sash out, and a show can switch between them.
4. An agent turns uniform photos into a pack with the skill and its headless render command.
5. The feature is behind Custom uniforms (preview), hidden in releases (owner, 2026-11-25), and
   the user guide describes only a show that already has a custom uniform.
6. Every CI check is green, one full independent review has been done, and the owner has approved.

These used to be ship conditions. With the opt-in decision they are gates for **leaving preview**
(turning the setting on by default and dropping the label), tracked in #1310, not for merging into
`main`:

- At least one real artist has finished a uniform on the template (#1259), and the pack format is
  then frozen.
- The web build, and a computer with an integrated GPU, play about 300 marchers in custom uniforms
  at an acceptable frame rate. Measured so far only on an RTX 3060 Ti: 385 marchers at the same
  frame rate as palette uniforms.
- PDF import, if uniform companies need it. Today PDFs are refused with a message.

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
- Anything new that comes up becomes an issue and a line in the tracker (fork #1274), not a detour.

## Tracker

The live tracker is the integration pull request, **fork #1274** (`uniforms/host` into `main`). Its
checklist, the step issues and the project board (fork project 5) are where status lives. This file
holds what doesn't change much.

| Step | Issue | What you can try                                               | Needs |
| ---- | ----- | -------------------------------------------------------------- | ----- |
| 1    | #1256 | Download the uniform template from the 3D View settings        |       |
| 2    | #1255 | A sample uniform in flats on the band, on all body types       |       |
| 3    | #1257 | Import front/back PNG or SVG as the band's uniform             | 1, 2  |
| 4    | #1258 | Place logos and numbers, and preview on all 7 bodies           | 3     |
| 5    | #1257 | Modes (sash out, unzipped) and switching between them          | 3     |
| 6    | #1260 | Agent skill: photos to a pack, plus headless render            | 3, 4  |
| H    | #1259 | A real artist makes a uniform on the template (needs a person) | 1     |

## How to pick up a step

Anyone can pick up a step, with or without agents.

1. Check #1274 and the issue. If someone is assigned and the issue is In progress, talk to them
   first.
2. Claim the issue: `scripts/om-claim <n> --branch uniforms/step-<n>-<name>`. See
   [docs/agents/work-tracking.md](../../agents/work-tracking.md).
3. Branch from `uniforms/host`, after `main` has been merged into it, and open the pull request
   **into `uniforms/host`**, never into `main`.
4. Read [../uniform-artwork.md](../uniform-artwork.md) and the issue. The study's prototype and
   evidence are on the owner's dev box under `/mnt/ssd/uniform-wrap/`. If you can't reach it, the
   design doc and issue are enough.
5. Push as soon as the code compiles, then post the preview link and 3 to 5 "try this" steps on the
   pull request. Tests come after that, before the merge.
6. When it merges, tick the step in #1274.

## Decisions log

- 2026-11-24: the owner chose one integration pull request into `main`, built from small step pull
  requests.
- 2026-11-24: the owner split asset preview and opening assets in OpenMarch into its own epic,
  #1262. The uniform pack is the first kind of portable file (comment on #1257).
- 2026-11-24: the owner chose to merge into `main` with custom uniforms as an opt-in preview
  (step 7, #1306): off by default in releases, with a warning that the format isn't final. The
  artist test, the format freeze, the speed check on an integrated GPU and on the web, and PDF
  import moved from "shipped" to the gates for leaving preview, #1310. Measured so far: 385
  marchers on an RTX 3060 Ti at the same frame rate as palette uniforms.
- 2026-11-25: the owner chose to merge with custom uniforms hidden in releases: no Custom uniforms
  switch, the built-in uniforms only, nothing to import. Dev, examples and lab builds keep it for
  testing. Turning it on for releases is part of leaving preview, #1310.
