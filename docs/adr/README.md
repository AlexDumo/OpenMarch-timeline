# Architecture Decision Records

Name each record `NNNN-short-decision-name.md`, using the next available number.
When a decision changes, update its status and link the superseding record rather
than rewriting its history.

Use this template:

```markdown
# NNNN: Decision title

- Status: proposed | accepted | superseded
- Date: YYYY-MM-DD

## Context

## Decision

## Consequences

## Verification
```

## Records

Some numbers are used twice on this branch; they are renumbered when it is rebased on fork main.

- [0001: A tablet layout in the same app](0001-tablet-layout.md)
- [0001: Timelines replace pages as the motion model](0001-timeline-motion-model.md)
- [0002: 3D View window, venues and sync contract](0002-3d-view.md)
- [0002: The web editor keeps a library of shows in browser storage](0002-web-show-library.md)
- [0003: App menu items run renderer actions over one IPC channel](0003-menu-actions-ipc.md)
- [0004: Performer cues in the show file](0004-performer-cues.md)
- [0005: A three.js field behind a renderer-independent editor](0005-three-field-renderer.md)
- [0006: Shapes are stored as recipes beside the positions they place](0006-shape-recipes.md)
- [0009: Show issues: pure checks, a worker sweep, and dismissals in the show file](0009-show-issues.md)
- [0010: A move can follow a drawn path](0010-moves-follow-drawn-paths.md) (amended by 0011)
- [0011: A group path is one route; lanes bind slots to it](0011-lanes-on-slots.md)
