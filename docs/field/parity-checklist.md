# Parity gate: the owner's hands-on checklist

Part 4 of the [parity gate](implementation-plan.md#parity-gate) (#208). Work
through it in the lab build of the `field-renderer` branch (draft PR #214):

- New field: <https://lab.openmarch.com/x/field-renderer/?field=three>
- Fabric, for comparison: <https://lab.openmarch.com/x/field-renderer/>
  (the same build without `?field=three`)
- Feedback page: <https://lab.openmarch.com/t/field-renderer>
- The same build without the lab's sign-in and feedback widget:
  <https://field-renderer-openmarch-fork-preview-build.alexdumo.workers.dev/?field=three>

Each item is one action and what should happen. **(change)** marks a decided
difference from Fabric: check that it happens and that you still want it.
Everything else should match Fabric; when in doubt, try the same thing in
the Fabric tab. Mouse items assume mouse mode (Settings, mouse/trackpad)
unless they say trackpad. On a Mac, read Ctrl as Cmd where an item says
Ctrl/Cmd.

The automated half (scenario counts, render and export diffs, benchmark
numbers) is in [parity-gate-results.md](parity-gate-results.md).

## Setup

1. Open the new-field link, open "Part 1 Demo" from the launch page, and check the URL keeps `?field=three` → the field draws; no error. (Checked headless on the preview build, 2026-10-15.)
2. Open "LHB '26 – Daft Punk pt. 2" too, for the larger show (385 marchers).
3. If the field shows a one-time note about software graphics, read it → it explains low-quality mode and how to turn graphics acceleration on, and doesn't show again after a reload.

## Viewing the field

4. Compare the field with the Fabric tab in the default theme → same grid, half lines, yard lines, hashes, yard numbers and checkpoint labels (story 1).
5. Switch through the field themes in Field settings → each looks as on Fabric (story 1).
6. Turn the grid lines and half lines settings off and on → the field follows at once.
7. Zoom all the way out → lines stay crisp, none shimmer or vanish unevenly (story 11).
8. Zoom far in on a marcher → its drill number stays sharp (story 12).
9. Zoom out slowly → labels shrink with the field, then fade out when too small to read, instead of turning into a smear (story 13).
10. Look at a dot sitting on a grid line → it's centered on the line. **(change)** Fabric drew everything half a grid line down and right (story 16).
11. Look at the yard numbers → centered on their yard line. **(change)** Fabric put them 22 units left of it, so their place depended on the font.
12. Add a field image (Field settings), fit, then fill, then lower its opacity → it draws as on Fabric (story 14).
13. With the image on, zoom far in on a line → the image sits exactly on the lines. **(change)** Fabric drew it half a field unit up and left of its lines (about 12 px at the maximum zoom).
14. Make a dense spot (several marchers almost on top of each other) and look at their numbers → every dot covers the neighboring numbers, as on Fabric and in the drill chart export (owner decision 2026-10-15; fixed in #245).

## Navigating

15. Wheel over a marcher → zooms at the cursor; the marcher stays under it (story 2).
16. Trackpad mode: two-finger scroll → pans; pinch → zooms at the pointer (story 3).
17. Change the mouse/trackpad mode and its sensitivity settings → navigation follows them (story 4).
18. Right-drag (Ctrl-drag on a Mac) → pans one to one (story 5).
19. Middle-drag → pans. **(change)** Broken on Fabric (story 6).
20. Alt-drag on empty field → doesn't pan. **(change)** Alt panned on Fabric (story 7).
21. Zoom in and out to the limits → stops at 20% and 2500%, as Fabric (story 8).
22. Right-drag the field far off screen and let go → it stops about one screen past the edge. **(change)** Fabric skipped the pan limit for right-drag, the zoom buttons and pinch.
23. Use the zoom buttons, zoom reset and fit → as on Fabric (story 9).
24. Enter fullscreen → the whole field fits, the selection clears; leave it → the field centers again (story 9).
25. On a touchscreen: one-finger pan, two-finger pinch → as on Fabric (story 10).
26. Mac only: Ctrl+click a marcher without dragging → nothing is selected; it's a pan press. **(change)** Fabric selected.

## Marchers and timeline visuals

27. Give sections and tags different shapes, fills, outlines and hide one → every marcher looks as on Fabric (story 15).
28. Turn on previous and next paths and step-size warnings, and go to a page mid-show → pathways, midpoints, endpoints and warnings as on Fabric (story 17).
29. Double-click a page box to isolate its move → the focus layer and the dimmed marchers look as on Fabric (stories 18, 20).
30. Select every marcher and press K on a page where most follow → kept marks appear; hover one → its tooltip shows after a short delay (story 18).
31. Hover a kept mark, then move the pointer off the field over the grid → the tooltip goes. Fabric's stays up (a Fabric bug, fixed on the new field).
32. Try to click a dimmed marcher in isolation → nothing is selected (story 20).
33. Turn on collisions (View) and go to a page where marchers come within the collision distance → collision markers and the Collisions tab show; "Zoom to collisions" frames them (story 19; detection is back since #226).
34. Compare a collision marker with the Fabric tab → the new field draws it where the marchers meet. **(change)** Fabric draws every collision marker and label at the field's top-left corner (a Fabric bug, #201).
35. Play the whole Daft Punk demo → smooth, marchers where Fabric puts them (story 21).
36. Scrub the playhead quickly back and forth → the field follows at once (story 22).

## Selecting

37. Click a marcher → only it is selected; the inspector and timeline agree (stories 23, 32).
38. Select three marchers, then click one of them → only that one stays selected. **(change)** Fabric kept all three (story 23).
39. Shift+click marchers → each is added or removed (story 24).
40. Drag on empty field → a marquee; it replaces the selection (story 25).
41. Shift+drag on empty field → a marquee that adds. **(change)** Shift+drag started a lasso on Fabric (story 26).
42. Double-click on empty field and drag a loop back near the start → a lasso; the stroke turns green near the start; it replaces the selection (stories 27, 29).
43. Shift+double-click-drag a lasso → it adds to the selection (story 28).
44. Draw a lasso and let go more than 50 px from the start → nothing changes (story 29). At exactly 50 px it doesn't close.
45. Zoom in or out and draw a lasso → "close enough" is the same 50 screen px at every zoom. **(change)** Fabric used 50 field units.
46. Without Shift, double-click-drag a lasso that doesn't close → the selection is empty (the first click of the double-click cleared it).
47. With several selected, Shift+double-click-drag starting inside their box → the drag moves the selection; a lasso can't start there (owner decision: a drag inside the box moves it).
48. Click empty field → the selection clears (story 30).
49. With several selected, click empty field inside their box → the selection clears. **(change)** Fabric kept it (story 30).
50. Shift+click empty field → the selection stays. **(change)** Fabric cleared it.
51. Ctrl/Cmd+A, then Ctrl/Cmd+A again → everything stays selected. **(change)** Fabric's second press cleared it (story 31).
52. Hover a marcher → pointer cursor (story 33).

## Moving

53. Drag a marcher, then drag one of a selected group → the marcher or the whole group moves (story 34).
54. Press a marcher and move under 4 px, however long you hold → a click; nothing moves (story 35).
55. Quickly flick a marcher about 20 px and let go → it moves. **(change)** Fabric's "under 300 ms and 20 px" rule made that a click.
56. Rounding on: drag one marcher → it snaps to the rounding grid (story 36).
57. Rounding on: drag a group whose marchers are off the grid → it moves in whole steps and keeps its shape. **(change)** On Fabric each marcher snapped (story 37).
58. Rounding on: hold Shift while dragging → no snapping (story 38).
59. Hold Alt while dragging → a quarter speed, no snapping. **(change)** Alt panned on Fabric (story 39).
60. Press Alt mid-drag, then let go of it → slows down from where the marcher is, with no jump; full speed and snapping again after.
61. Lock X, then Lock Y, and drag → the locked axis doesn't change (story 40).
62. Shift+press an unselected marcher and drag → it's added and the whole selection moves (as Fabric).
63. Drop on a page with a timeline range selected → the drop creates or joins that range's move (story 41).
64. In isolation, drop a marcher → it edits the isolated move's end and the playhead moves to the end (story 41).
65. Drop where the timeline refuses it (Basic mode, past the last page) → a toast, and the marchers snap back (stories 41, 42).
66. Drop on a page with later pages → "Move them too" appears and works (story 43).
67. Arrow keys and WASD with their modifiers → nudges as on Fabric (story 44).
68. Undo a drag → one Ctrl/Cmd+Z undoes it all (story 45).

## Scaling and rotating

69. Select several marchers → a box with corner, middle and rotate handles (story 46).
70. Look at the handles → filled squares. **(change, look)** Fabric draws outlined squares. Keep?
71. Select one marcher → no box, no handles (story 47).
72. Drag a corner → scales uniformly from the opposite corner; with Shift, freely (story 48).
73. Drag a middle handle → one axis; hold Shift → still one axis. **(change)** Fabric cancelled the scale while Shift was down (story 49).
74. Rotate → snaps to 15°; with Shift, free (story 50).
75. Hold Alt on any handle → a quarter speed, no snapping. **(change)** Alt panned on Fabric (story 51).
76. Drag a handle far past the opposite side → no flip; the marchers stack about 1% of their spread apart, in order. Fabric held the last valid scale instead (story 52).
77. Press a handle, hold over 300 ms and move under 4 px → nothing changes. **(change)** Fabric transformed.
78. While scaling or rotating → dots and labels stay upright and the same size (story 53).
79. Type a rotation in the inspector, then leave the field → the selection rotates the same way; leaving it unchanged saves nothing (story 54).
80. After typing a rotation and leaving → the input shows 0 again. **(change)** Fabric showed the selection's angle since it was made.
81. Lock X / Lock Y on, then use the handles → the locks don't hold them (as Fabric).
82. After any transform → the box fits the marchers again (story 55).

## Tools

83. Select at least two marchers and press L → the line tool; the cursor is a crosshair (story 56).
84. Click to start the line, move, click to finish → the end follows the pointer; dashed previews and outlined marchers show (stories 56, 57).
85. Finish a line without Shift, then with Shift → whole steps, then free (story 56).
86. Draw lines in different directions → marchers order along the line and space evenly (story 56).
87. Shift+Enter → saves exactly where the previews are drawn. **(change)** Fabric saved the line half a unit right of and below where it drew it.
88. Escape → cancels the tool (story 56).
89. Right-click → clears the line, but the finished line's previews stay, and Shift+Enter still applies them until the next line (as Fabric).
90. Right-drag while drawing a line → pans and keeps the line. **(change)** Fabric cleared it on every right press.
91. After the line is finished, click a marcher → nothing is selected. **(change)** Fabric made marchers selectable again.
92. With the line tool on, Ctrl/Cmd+click a marcher → nothing. **(change)** Fabric selected.
93. With the line tool on in isolation, let a marcher stop being dimmed → it still can't be selected until the tool ends. **(change)** Fabric's known gap.
94. Escape in isolation → leaves isolation; with the line tool on, Escape only cancels the tool; with a dialog open, only closes the dialog (story 59).
95. Scrub over playback, let go to hold a preview frame, then click the field → the click only clears the preview (story 60).
96. Hold a preview frame, then right-drag or middle-drag → pans and leaves the preview held. **(change)** Fabric swallowed that press too.
97. Hold a preview frame and click a popover's outside → the popover closes (a press the field takes still reaches the app).
98. Hold a preview frame while a show's stored moves finish loading → the app drops the held frame (#202: found while testing; check it doesn't surprise).
99. Align, distribute, flip, swap, circle, keep, and set to previous or next page → as on Fabric (story 61).
100.  The box shape tool (story 58) is on hold (#204) and not in this gate. The inspector's spec-shape handles (P7.11) are dropped when Fabric is deleted (owner decision).

## Weak machines and reliability

101. On a machine with software graphics (or Chrome's acceleration off) → low-quality mode and its one-time note (story 63).
102. Settings, Appearance, Performance mode on → low-quality mode by hand (story 64).
103. Desktop app on a GPU that Chromium blocks but that works → the fast field; if the GPU process crashes, low-quality mode and a note (story 65).
104. Sleep the computer with a show open and wake it → the field draws again by itself (story 66).
105. Run "Run field benchmark" from the command palette (Ctrl/Cmd+K) on both fields → see [the benchmark steps](parity-gate-results.md#benchmark-on-real-hardware) (stories 21, 62, 74).

## Exports

106. Export coordinate sheets → same content and layout as Fabric's (story 67).
107. Export drill charts (full and individual) → same content; the listed export improvements show (centered labels, closed border, no half-pixel offset) (story 67).
108. Export a video → plays, marchers where they should be, quality as before or better; time it on real hardware (story 68).
109. Open a show with no WebGL → video export says it needs WebGL and Export is disabled. **(change)** It drew on Canvas2D before.
110. The new-show wizard's field step and the launch page → field previews show (story 69).

## Owner decisions

111. Settled: dots cover drill numbers, as on Fabric (item 14; owner 2026-10-15).
112. Open: the handle look, filled squares vs Fabric's outlines (item 70).
113. Settled: `ignore-gpu-blocklist` is app-wide, so it also affects Fabric (until #209) and the 3D View's compositing on drivers Chromium blocks (#205; owner confirmed 2026-10-15).
