# OpenMarch glossary

Terms the code, docs and issues use. Add a term when a design decision settles it.

## Shapes

- **Shape**: a way to place the selected marchers at one moment. Box, Circle and Line are shapes.
  _Avoid_: form, formation tool.
- **Kind**: one type of shape (Box, Circle, Line). A kind owns its parameters and geometry; the
  **shape host** owns drawing, gestures, history, who goes where and placing.
- **Recipe**: a placed shape's stored kind and parameters, kept beside the positions it wrote
  (ADR 0006).
- **Path**: a shape whose marchers stand along a line, open or closed. A code and docs word, not
  shown in the UI. Only a closed path can be filled.
- **Point**: a point a Line passes through. It has a **tension**: 0 is a **corner**, more makes
  the line pass smoothly through it.
- **Group**: a run of marchers at one interval in an interval list. `2*3` is a group of 2
  marchers at 3 steps.
- **The rest**: the one group in a list without a count. It takes every marcher the counted
  groups don't.
- **Seam**: the gap between two groups. It is the larger of their intervals.
- **Measured**: what an interval measures: the true distance between neighbors (the default),
  side to side (↔) or front to back (↕).
- **Fit / Keep interval / Interval on the path**: a path's spacing modes. Fit keeps the size
  drawn and works out the interval; Keep interval fixes the interval and the size follows; Interval
  on the path fixes both and anchors the run.
