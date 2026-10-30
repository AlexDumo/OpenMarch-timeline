<!-- cspell:disable -->

# Prior art: how motion tools mark defined points on a drawn path

This page collects precedent for the look of OpenMarch's route squares (fork #479, PR #483). Sources are vendor manuals, API references and, for Blender, its open source code. Drill-design tools are deliberately excluded.

**Confidence tags**

- [doc]: I read the vendor page, manual source or code myself. Quoted text is verbatim.
- [snippet]: I only saw the vendor page through search-result text, because the site blocked direct fetching (Adobe help returns 403). Treat these quotes as close but not verified.
- [inferred]: my reading of the docs. The vendor does not state it.
- [unverified]: I looked and could not confirm it.

---

## 1. After Effects: boxes for keyframes, dots for frames

- "A motion path appears as a sequence of dots, where each dot marks the position of the layer at each frame. A box in the path marks the position of a keyframe." [snippet] https://helpx.adobe.com/after-effects/using/assorted-animation-tools.html
- "The density of dots between the boxes in a motion path indicates the relative speed of the layer or effect control point. Dots close together indicate a lower speed, and dots farther apart indicate a greater speed." [snippet] (same page)
- Keyframes that use Hold interpolation "display no dots because there is no intermediate transition between keyframe values." [snippet] https://helpx.adobe.com/after-effects/using/speed.html
- How many keyframes the path shows is set under Preferences > Appearance, in the Motion Path section. [snippet] (assorted-animation-tools page)
- "To view a Position motion path in the Composition panel, the Position property must be selected." The path only shows for a selected layer. [snippet] (same page)
- I could not confirm from Adobe's text how a selected keyframe box differs from an unselected one, or which color the path uses. [unverified]
- **Lesson.** The defined point is a box and the in-between is a much smaller dot. A hold is shown by what is missing (no dots), not by an extra mark. The path is a selection-only display.

## 2. Blender motion paths: a bigger, highlighted dot for keyframes, past and future in two colors

- "Each frame is displayed by a small dot on the paths." [doc] https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/animation/motion_paths.rst (source of docs.blender.org/manual/en/latest/animation/motion_paths.html)
- Keyframes: "When enabled, big yellow square dots are displayed on motion paths, showing the keyframes of their bones". [doc] (same page)
- Keyframe Numbers: "When enabled, you will see the numbers of the displayed keyframes, so this option is obviously only valid when _Show Keys_ is enabled." Frame Numbers: "a small number appears next to each frame dot on the path". Both are opt-in toggles. [doc] (same page)
- "The paths are shown in red for the section in the past and green for the section in the future. These colors follow the user preference options "Before Current Frame" and "After Current Frame"". [doc] (same page)
- "Remember that only selected bones and their paths are affected by these actions!" [doc] (same page)
- In the point shader, a keyframe point is drawn 5 px bigger than a frame dot in the theme's _selected vertex_ color (`theme.colors.vert_select`), and the current frame gets its own bigger dot (`pt_size + 8`) in the theme's current-frame color, biased to draw on top of keyframes. [doc] https://projects.blender.org/blender/blender/raw/branch/main/source/blender/draw/engines/overlay/shaders/overlay_motion_path_point_vert.glsl
- In the line shader, the segment before the current frame uses `before_frame` and the one after uses `after_frame`, unless the path has a custom color. [doc] https://projects.blender.org/blender/blender/raw/branch/main/source/blender/draw/engines/overlay/shaders/overlay_motion_path_line_vert.glsl
- Keyframe numbers are drawn in the keyframe color (`TH_VERTEX_SELECT`) and frame numbers in the highlighted text color. With frame numbers on, Blender skips a number when the point sits on the same spot as its neighbours ("Only draw frame number if several consecutive highlighted points don't occur on same point"). A hold therefore shows one label, not a pile of them. [doc] https://projects.blender.org/blender/blender/raw/branch/main/source/blender/draw/engines/overlay/overlay_motion_path.hh
- In the Dope Sheet (the timeline) keys use different shapes (diamond and others by handle type), gray when unselected, yellow when selected, and a held key is a "Gray bar between keys" ("the two keyframes are identical"). [doc] https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/editors/dope_sheet/introduction.rst
- **Lesson.** Keyframes are bigger and in an accent color. The current frame is a third mark that wins over keyframes. Past and future are different colors. The timeline glyph (diamond) and the path glyph (square dot) differ.

## 3. Maya editable motion trails: squares for keys, plus signs for frames

- Show Key: "Key markers show a square at the point in the animation where each frame occurs" and "Key numbers instead show frame numbers." [doc] https://help.autodesk.com/cloudhelp/2025/ENU/Maya-Animation/files/GUID-FD90FFDE-04AA-499D-A340-9ACA4872BDEA.htm
- Show Frame: "Markers, which are small plus signs (+) appearing at location of every frame" or "Numbers showing the corresponding frame number." [doc] (same page)
- Key Marker Size and Frame Marker Size are separate settings. [doc] (same page)
- "You can set the color of Keys, Selected Keys, Frames, and Velocity." [doc] (same page)
- Draw Mode Past/Future: "Lets you see the animation occurs before and after the current frame by differentiating them by colors defined by the Trail Color and Alternate Trail color settings." Pre Frames and Post Frames limit how far the trail draws around the current time, and Fade Frames "Creates a fade effect that lasts for the specified number of frames." [doc] (same page)
- **Lesson.** Again a square for a key and a lighter, different mark for a frame. Selected keys have their own color. The past can be a different color, limited in length, or faded.

## 4. Houdini motion paths: spheres for keys, ticks for frames, past bright and future shaded

- "Spheres on the path show keyframes." In the wide ribbon mode, "Keyframes appear as bars across the ribbon." [doc] https://www.sidefx.com/docs/houdini/basics/motionpath.html
- "Ticks (small lines perpendicular to the path) show where the motion path is at each frame." "Every fifth tick is slightly longer to make it easier to visually count frames." [doc] (same page)
- An option can "dynamically increase the size of ticks near the current frame, and decrease the size of ticks away from the current frame." [doc] (same page)
- Pre/Post mode: "Draw the path before the current frame bright and the path after the current frame using different shades." Timeline mode: "Draw the path in a solid color." [doc] (same page)
- With Limit number of frames on, Houdini draws only a set number of frames before and after the current frame. [doc] (same page)
- Houdini's ticks would bunch up on one spot during a hold, the way After Effects dots disappear. The page says nothing about holds. [inferred]
- **Lesson.** One tool uses a round mark for keys, so the square is a convention rather than a rule. Note that Houdini makes the _past_ bright and the future shaded, the opposite of a faded tail.

## 5. Unreal Engine Sequencer motion trails: key, selected key and current-frame colors

- `UMotionTrailToolOptions` has: `bShowKeys` ("Whether or not to show keys on the motion trail"), `bShowMarks` ("Whether or not to show marks along the motion trail"), `KeyColor` ("The color of the keys"), `SelectedKeyColor` ("The color of the selected keys"), `CurrentFrameMarkColor` ("The color of the Current Frame mark color"), `KeySize`, `MarkSize`, `TimePreColor` ("The color of the motion trail before current time if show alternating time colors"), `TimePostColor`, `FramesBefore`, `FramesAfter`, `DefaultColor`, `TrailThickness`. [doc] https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Editor/Sequencer/UMotionTrailToolOptions
- `bShowFrameNumber_DEPRECATED` is "Deprecated in 5.6". Epic removed the frame-number option from the trail. [doc] (same page)
- The API reference does not say which shapes or default colors keys use. [unverified]
- **Lesson.** The same four states as Maya: key, selected key, in-between mark, current frame. Before and after current time are separate colors. Frame numbers on the trail were dropped.

## 6. grandMA3 phaser editor (lighting console): filled vs hollow squares carry meaning

- "A green line describes the path of the fixtures." [doc] https://help.malighting.com/grandMA3/2.2/HTML/phaser_editor.html
- "The cyan-colored points show that the value is from a preset. Yellow-colored points are hard values from the programmer. Selected points have a yellow circle around them." [doc] (same page)
- In the Add Absolute and Add Relative tools, "A filled rectangle represents absolute values." and "An empty rectangle represents relative values." [doc] (same page)
- **Lesson.** A lighting console uses squares (rectangles) for defined steps on a path too. Fill means something (absolute vs relative), color means something (preset vs hard value), and selection is a ring around the point, not a recolor.

## 7. Tools I checked that gave no usable precedent

- **Cinema 4D.** The R21 Modes help says an object's animation path can be moved and its keys dragged in the viewport, but I found no Maxon page that describes how keys on the path look. [unverified] https://help.maxon.net/c4d/r21/us/html/5498.html
- **Unity.** The Animation window manual covers Dopesheet and Curves modes. I found no built-in Scene-view motion path. [unverified] https://docs.unity3d.com/Manual/animeditor-UsingAnimationEditor.html
- **Rive.** Motion paths shipped in Rive v0.8.477 (changelog, 2023-06-27). I found no doc that describes how keys look on them. [unverified] https://rive.app/changelog/motion-paths-and-interpolation-on-transitions
- **Figma, Principle.** No drawn motion path with key markers found. [unverified]
- **ETC Eos.** No position or effect path display with step markers found in the docs I searched. [unverified]

## 8. Summary table

| Tool            | Defined point                    | In-between             | Selected key | Current time                | Past vs future                   | Numbers                          |
| --------------- | -------------------------------- | ---------------------- | ------------ | --------------------------- | -------------------------------- | -------------------------------- |
| After Effects   | box [snippet]                    | dot per frame          | [unverified] | the layer itself [inferred] | [unverified]                     | none found                       |
| Blender         | big square dot, accent color     | small dot              | n/a on path  | biggest dot, own color      | red / green (themeable)          | opt-in, key numbers in key color |
| Maya            | square                           | plus sign              | own color    | via Past/Future colors      | two colors, pre/post range, fade | opt-in, replaces square          |
| Houdini         | sphere (bar in ribbon mode)      | tick, every 5th longer | [unverified] | ticks grow near it (opt.)   | past bright, future shaded       | none found                       |
| Unreal          | key (shape [unverified])         | mark                   | own color    | own mark color              | pre / post colors, frame limits  | removed in 5.6                   |
| grandMA3 phaser | filled or hollow square, by type | the path line          | yellow ring  | [unverified]                | [unverified]                     | [unverified]                     |
