---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: shapes-tab
title: Pick a shape from the Shapes tab
summary: The Shapes tab now shows each shape as a small picture of its own dots, with the name on hover, so many shapes fit.
status: open
questions:
  - Could you tell which shape each picture is without hovering? Which ones did you have to hover?
  - Does a saved shape's picture look like that shape (a wide box looking wide)?
  - When the shapes were greyed out, did you still understand why and what to do?
  - Do the pictures in the ring, the library and the command bar read as the same shapes as the tab's?
---

The Shapes tab used to show each shape as an icon and a name. It now shows
**pictures only**: each shape is drawn from its own dots, and from its
outline where it has one. The name is in the tooltip, and screen readers
read it out. Saved shapes get a picture of themselves too, at their own
spacing, so nobody has to draw an icon for a new shape.

The shape ring (hold **R** on the field), the shape library (the
**Library** button) and the command bar (**/** or **⌘K**, then
**Shape**) show the same pictures.

**What to try**

- Open a demo show or start a new one, and click the **Shapes** tab
  before selecting anyone. Hover a greyed-out shape.
- Select some marchers, hover **Box** in the tab, then click it and drag
  on the field.
- Change the box's spacing (for example 2½ across, 1½ deep), then save it
  from **⋯ › Save** with a name. Its starred picture appears after the
  divider in the tab: compare it with the plain Box.
- Hold **R** on the field, open the **Library**, and type **/ shape**, and
  look at the same pictures in each place.

**Good to know**

- Only the box exists for now, so there are just one or two pictures to
  tell apart. Lines, arcs and circles join it later, each with its own
  picture.
- The picture you picked is drawn bolder in the tab while it's open.
