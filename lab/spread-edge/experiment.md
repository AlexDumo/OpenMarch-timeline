---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: spread-edge
title: Spread with an edge
summary: A new Edge toggle in Spread stands marchers along the shape's outline, about 1½ spacings apart, and spreads the rest right up to them as one even spread, so the shape reads clearly. Reshuffle only changes the inside.
status: open
questions:
  - With Edge on, did the shape read more clearly than a plain spread?
  - Did the marchers along the edge look evenly spaced, and the ones inside evenly spread?
  - Did the edge and the inside read as one spread, or as two separate things?
  - Were there enough marchers on the edge to see the shape?
  - Did the box or circle stay put when you turned Edge on and off?
  - Was "Edge" a clear name? Was its tooltip (how many stand where) useful?
---

**Spread** has a new **Edge** toggle beside Reshuffle. With it on, some
marchers stand along the shape's outline, about 1½ spacings apart with a
spot on every corner of a box. The rest spread right up to them, with no
gap between, so the edge and the inside read as one spread. No two
marchers stand closer than the spacing. The box or circle stays where you
drew it.

**What to try**

- Open a demo show or start a new one, and select 20 to 60 marchers.
- Press **B** and drag out a box. On the second row under the shape,
  pick **Spread** from the mode menu, then press **Edge**.
- Hover **Edge** to see how many stand on the edge and how many inside.
- Press **Reshuffle** a few times: the edge stays, and the inside
  changes.
- Try a circle (**O**) in Spread with Edge.
- Try very few marchers (4 to 6). With too few for an inside, everyone
  stands on the edge, and the tooltip says so.

**Good to know**

- Turning Edge on or off keeps the box, so the spacing changes to fit.
- For now Edge works on boxes and circles. Other shapes come later.
