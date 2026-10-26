---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: edge-pull
title: Line a box up with yard lines and hashes
summary: While you stretch or draw a box, an edge that comes close to a yard line, a hash or a sideline lands on it, and the spacing becomes whatever that takes (2⅔, 1⅗, 7). Away from the lines, spacing still steps by half steps.
status: open
# The snap guide in five colors, switched with Version (bottom left). The first is the default.
variants:
  - id: pink
    label: Pink
    description: The guide, its name tags and the snapped edge in pink.
  - id: yellow
    label: Yellow
    description: The timeline's start flag yellow (ochre in the light app).
  - id: teal
    label: Teal
    description: The guide in teal.
  - id: orange
    label: Orange
    description: The guide in orange.
  - id: contrast
    label: Contrast
    description: Black on a light field, white on a dark field or turf.
questions:
  - Did the box's edge catch the yard line or hash when you wanted it to? Did you have to hunt for it?
  - Did it ever grab a line when you only wanted a half step? Where?
  - Try each Version (color). Which one tells you most clearly that the edge snapped? Which would you keep?
  - Did any color get lost on your field, or clash with selected marchers or other marks?
  - Did the line's name at the screen's edge ever get in your way, or get missed?
  - Did any spacing it gave you surprise you?
---

Designers line blocks up with the field: from the 40 to the 50, or ranks from
hash to hash. The spacing that does that often isn't a half step. 7 files
over 10 yards are **2⅔** apart, 11 files are **1⅗**.

**New in this build:**

- **Stretching a box:** drag one of its side or corner handles toward a yard
  line, a hash or a sideline. When the edge gets within a few pixels, it lands
  on the line. The box's edge turns **thick**, a solid line runs along the
  line, and the edge, the line, its name and the marchers on it all take the
  guide's color. The other side of the
  box doesn't move.
- The line runs **across the whole screen** at any zoom, with its **name**
  ("45 yd line", "HS front hash") in a tag at the screen's edge.
- **Five colors to try** (switch with **Version**, bottom left): pink, the
  timeline's yellow, teal, orange, and Contrast (black on a light field, white
  on a dark one).
- **Drawing a box:** the corner you drag toward a line catches it the same
  way. The corner you pressed stays put.
- Away from lines, spacing **steps by half steps**, as before.
- The spacing number shows exactly what you got: 2⅔, 1⅗ (as 1.6), 7.

**What to try**

- Select 7 marchers, press **B** and draw a box with its left edge on the 40.
  Drag the right handle to the 50: the spacing reads 2⅔. Try 11 marchers
  for 1⅗.
- Stretch a box's ranks from the front hash to the back hash.
- Drag a handle slowly between two yard lines. Spacing should keep stepping
  by halves until you're right at a line.
- Zoom in and out and try again. The pull is measured on screen, so it should
  feel the same at any zoom.

**Good to know**

- Holding **Alt** gives hundredths and no pull. **Shift** while drawing
  (equal spacing) doesn't pull either.
- A box turned at an angle doesn't pull. A box turned a quarter does.
- The pull is deliberately small (6 pixels). Tell us if it should be bigger
  or smaller.
