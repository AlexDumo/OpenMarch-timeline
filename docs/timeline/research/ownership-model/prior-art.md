<!-- cspell:disable -->

# Prior art: who, where, how and when in motion tools

This page collects precedent for the OpenMarch ownership model. In that model:

- A **shape** is an equation that places N performers into spots, with no timing.
- A **transition** is a block of motion logic on a track, over a time range.
- **Keyframes** (where each performer arrives) are derived from shapes and transitions, not stored.

Sources are vendor manuals only: MA Lighting, ETC, Ableton, Bitwig, REAPER, Apple, Avid, Adobe, Blender, SideFX, Maxon, Autodesk and Blackmagic. Drill-design tools are deliberately excluded.

**Confidence tags**

- [doc]: I read the vendor page or PDF myself. Quoted text is verbatim.
- [snippet]: I only saw the vendor page through search-result text, because the site blocked direct fetching (Adobe help and some Autodesk pages). Treat these quotes as close but not verified.
- [inferred]: my reading of the docs. The vendor does not state it.
- [unverified]: I looked and could not confirm it.

---

## 1. Separating WHEN, HOW, WHERE and WHO

### Blender NLA: a strip (WHEN) references an action (HOW and WHERE)

- "A strip tells the animation when something happens and for how long." [doc] https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/editors/nla/strips.rst (source of docs.blender.org/manual/en/latest/editors/nla/strips.html)
- "Multiple strips can reference the same action, so that you can potentially change multiple parts of the animation by editing a single set of keyframes." [doc] (same page)
- A strip can be cropped, sped up or slowed down without changing the action it references. [doc] (same page)
- A track sets layering: "A track plays one or more actions in sequence. You can create multiple tracks to play several actions at the same time." [doc] https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/editors/nla/tracks.rst
- **Lesson.** Timing lives on the strip. Content lives in a shared action that the strip only points to. This matches the split between a transition block and a shape.

### grandMA3 recipes: WHO, WHERE and HOW as separate references

- "A recipe line can contain information about a selection of fixtures, group, preset, MAtricks". A MAtricks entry is "a reference to an existing MAtricks pool object." [doc] https://help.malighting.com/grandMA3/2.2/HTML/recipes.html
- The parts map to our four concerns:
  - The **group** is WHO.
  - The **preset** is WHERE (a value).
  - The **MAtricks** is the distribution across members.
  - The **cue** and its timing are WHEN.
- Recipe data is "cooked" into the cue part, and "cooked data can easily be removed again if needed." [doc] (same page)
- The Recipe Editor shows a red group name "If the group is empty". [doc] https://help.malighting.com/grandMA3/2.4/HTML/recipe-sheet.html
- **Lesson.** A console keeps membership, target values and spread as separate, named, reusable objects. A cue then combines them.

### Cinema 4D MoGraph: the Cloner (WHERE), Effectors (HOW) and Selections (WHO)

- The Cloner's mode (Linear, Radial, Grid, Object) and its Count set the layout. [doc] https://help.maxon.net/c4d/s22/us/html/OMOGRAPH_CLONER-ID_OBJECTPROPERTIES.html
- A MoGraph Selection tag picks the clones an Effector affects: "Selections are saved to a MoGraph Selection tag and can be used in conjunction with most Effectors to restrict their effect to selected Clones." [doc] https://help.maxon.net/c4d/en-us/Content/html/TOOL_MGSELECT.html
- **Lesson.** Membership in an operation is a separate tag, not a property of the elements themselves.

### Houdini: template points (WHERE) are separate from the copied geometry

- In Copy to Points, "Houdini looks for specific attributes on the destination points to customize each copy/instance". [doc] https://www.sidefx.com/docs/houdini/nodes/sop/copytopoints.html
- **Lesson.** The layout is just a point cloud, and per-point attributes carry the per-member variation.

### Logic Pro, Ableton and Bitwig: automation owned by a region, or by the track

- Logic: "Track automation can be applied to the entire track, from the beginning to the end of your project. Region automation applies only to the specific region the automation parameters are connected to." [doc] https://support.apple.com/guide/logicpro/track-automation-vs-region-automation-lgcp967649d0/mac
- Ableton and Bitwig make the same split. Their details are in section 4.

---

## 2. When a member leaves a distributed group: re-spread or leave a gap?

### Cinema 4D Cloner: Per Step vs Endpoint is an explicit setting

- Linear mode: "If Per Step is selected, the values will reflect the difference to the previous or next clone. If Endpoint is selected, the values will reflect the difference between the first and last clone, and the values in-between will be interpolated." [doc] https://help.maxon.net/c4d/s22/us/html/OMOGRAPH_CLONER-ID_OBJECTPROPERTIES.html
- Grid mode makes the effect on count changes explicit:
  - Per Step uses "the clone intervals as a reference". It is the right choice when "their intervals are constant and the clone count changes".
  - Endpoint uses "the entire clone conglomeration's scale as a reference (the typical Cinema 4D behavior...)".
  - "If the mode is switched, the values will be converted automatically." [doc] (same page)
- Spline distribution offers Count, Step and Even. "Even: ... The clones will be arranged with equal intervals along the spline." "Step: ... define the interval between clones along the spline." [doc] (same page)
- With any of these modes, lowering Count re-spreads the remaining clones over the line (Endpoint or Even) or shortens the line (Per Step). Neither option leaves a hole. [inferred]
- A hole comes from a different tool: a MoGraph Selection plus an Effector that hides one clone keeps every other clone where it was. [inferred from the Selection-tag docs above]

### Blender Array (Geometry Nodes): the same two choices

- Line "Offset Method":
  - "Offset: Offsets copies by a fixed world-space distance."
  - "Endpoint: Distributes copies evenly between start and end points." [doc] https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/modeling/geometry_nodes/generate/array.rst
- Circle and Curve "Count Method":
  - "Count: Sets a fixed number of copies."
  - "Distance: Sets copies based on distance between them."
  - A full circle means "Copies are evenly spaced around a full 360° circle." [doc] (same page)
- **Lesson.** Both major 3D tools expose "keep spacing" and "fit between ends" as one user-facing switch, and neither is the only option.

### grandMA3: phase spread, Adaptive Measure, and grid gaps

- A phaser is spread across the selection: "In the 'Specials' section, click 0 thru 360. Now the fixtures are spread out equally over the entire loop." [doc] https://help.malighting.com/grandMA3/2.0/HTML/qsg_phasers.html
- The resulting phase is stored per fixture. The Phaser Editor's Change Phase tool "Opens an overlay with yellow dots that symbolize the value of the phase for each fixture." [doc] https://help.malighting.com/grandMA3/2.2/HTML/phaser_editor.html
- So once the phases are stored, removing one fixture leaves the others' phases alone, and the loop has a gap. [inferred]
- Recipes can make the spread follow the count instead: "Adaptive Measure: If set to Yes, the measure is adapted to the number of grid positions on an axis." [doc] https://help.malighting.com/grandMA3/2.4/HTML/recipe-sheet.html
- Spread follows grid positions, and gaps in the grid are a choice:
  - The Selection Grid "establishes the spatial relationships between fixtures for use with MAtricks, phasers, selection order, and effects." [doc] https://help.malighting.com/grandMA3/2.4/HTML/operate_selection.html
  - With Preserve GridPositions disabled, "all gaps and offsets to the origin will be removed." [doc] (same page)
  - The toolbar has "Remove Gaps: Removes gaps between fixtures." [doc] https://help.malighting.com/grandMA3/2.0/HTML/selection-grid-tool-bar.html
- **Lesson.** MA offers both behaviours:
  - Keep the gap: stored per-fixture phases, or preserved grid positions.
  - Re-spread: Adaptive Measure, Remove Gaps, or re-applying 0 thru 360.
- Which one MA uses by default when a fixture leaves a stored cue is [unverified].

### ETC Eos: effect spacing is computed from the number of groups

- "Grouping defaults to {Spread}. This means that every light the effect is applied to will act as an individual element, moving through the effect sequentially based on the channel selection order, cycle time, and trail times." [doc] https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/14_Effects/01_Effects_Editor/About_the_Effects_Editor.htm
- Trail defaults to Even: "The groups will be distributed evenly throughout the pattern. This is calculated by dividing the cycle time of the effect by the number of groups of channels." [doc] (same page)
- A fixed trail is the alternative: "Trail determines how channels are to follow each other through the effect; it is a percentage of the cycle time." [doc] (same page)
- With Even trail, spacing is a function of the member count, so fewer members means wider spacing (re-spread). With a fixed trail %, spacing between neighbours stays constant. [inferred]
- The page does not say whether a running effect re-divides when a channel leaves. [unverified]

---

## 3. Ordered chains (follow-the-leader): what happens to the order?

### The order is the selection order, and it is stored data

- Eos: an effect moves through channels "based on the channel selection order". "When an effect is applied to a group in live, that group is distributed by order". [doc] (Eos Effects Editor, above)
- Eos Cascade entry: "channels enter the effect according to the trail and cycle time values". [doc] (same page)
- grandMA3: "When deactivating or resetting the MAtricks, the original selection order will be restored." Shuffle "allows for the selection order to be sorted randomly", and "the same shuffle value will result in the same shuffled selection order." [doc] https://help.malighting.com/grandMA3/2.3/HTML/matricks.html
- grandMA3 Wings "separate the selection into the number of wings set and select devices from each wing from opposite directions." [doc] https://help.malighting.com/grandMA3/2.0/HTML/matricks_wings.html
- **Lesson.** Order is an ordered list plus a reorder operator (Shuffle, Wings, Interleave), stored with the group. Deleting one item from an ordered list closes up the order (rank n+1 becomes rank n). Whether that also closes up the timing depends on whether the timing is per-rank (Even trail: closes) or per-member (stored phase: stays). [inferred]

### Index-based vs id-based identity (Houdini)

- "id: A unique element ID. This is not the same as the element number (for example, the point number). This is an attribute you can, for example, assign to points to keep track of them even if the point numbers change (which can happen if the number of points change)." [doc] https://www.sidefx.com/docs/houdini/model/attributes.html
- **Lesson.** A chain addressed by index re-flows when a member leaves. A chain addressed by stable id keeps each member's slot. Houdini makes this explicit and puts the choice in the user's hands.

### Blender Follow Path: each follower owns its own offset

- The constraint places its owner on a curve "Using a frame number ... with an optional Offset in the constraint" or "Using a number between 0 and 1, namely the Offset Factor in the constraint." [doc] https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/animation/constraints/relationship/follow_path.rst
- Each object carries its own constraint and offset, so removing one follower changes nothing for the others. The chain keeps a gap. [inferred]
- **Lesson.** Per-member offsets give "keep the gap" for free. Re-spreading needs offsets computed from rank.

---

## 4. Splitting a clip: what belongs to the clip and what belongs to the track?

### Ableton Live

- Split: "The newly split clip will have its own clip edges and can be moved or edited like any other clip." [doc] https://www.ableton.com/en/manual/arrangement-view/
- "fades are a property of clips rather than the tracks that contain them, and are independent of automation envelopes." [doc] (same page)
- Track automation follows clips unless locked: "When moving Arrangement View clips, Live normally moves all automation with the clip. Sometimes, you might want to lock the envelopes to the song position rather than to the clips." [doc] https://www.ableton.com/en/manual/automation-and-editing-envelopes/
- Clip envelopes and track automation are different kinds of data:
  - "In the Arrangement, clips only have modulation envelopes, while the automation envelopes reside on the track's automation lane."
  - Modulation envelopes "can only influence this defined value". [doc] https://www.ableton.com/en/manual/clip-envelopes/
- Clip envelopes can be unlinked: "A clip envelope can have its own local loop/region settings." [doc] (same page)
- What happens to a clip envelope across a split is not stated. Since the envelope belongs to the clip, each half presumably keeps its own portion. [unverified]

### Bitwig Studio

- "This button toggles whether track automation is moved in tandem with Arranger clips or not. The setting is enabled by default". With it off, moving a clip "would leave any and all track automation behind." [doc] https://www.bitwig.com/userguide/latest/automation/
- Clip editing mode is for "When you want automation to be attached to an Arranger clip instead of the track's timeline". [doc] https://www.bitwig.com/userguide/latest/the_automation_editor_panel/
- Relative automation: "you can move a parameter ±50% of its total range (additive automation), or scale a parameter toward zero ... (multiplicative automation)." The shaded curve shows "the result of both the absolute and relative automation together." [doc] (same page)

### REAPER

- REAPER has take envelopes (owned by the item or take) and track envelopes. [doc] REAPER User Guide v7.83, ch. 18.13.2 "Item FX and Take Envelopes": https://www.reaper.fm/userguide/ReaperUserGuide783c.pdf
- Whether track envelopes follow an item is a global toggle: "Move envelope points with media items should be enabled if you wish an envelope to follow its media item when that item is moved or copied." [doc] (same PDF, §18.6, p. 361)
- Take envelopes are reportedly adjusted when an item is split. That comes from a 6.x change-log line seen in search results only. [unverified]

### Logic Pro and Pro Tools

- Logic: "with region automation, if you re-record the region, the automation is lost; if you move or copy the region ... the automation remains with the region." Track automation "remains tied to the initial point on the track". Mix > Convert Automation converts in either direction. [doc] https://support.apple.com/guide/logicpro/track-automation-vs-region-automation-lgcp967649d0/mac
- Pro Tools has a single global option, Automation Follows Edit. "When the Automation Follows Edit indicator is lit, the option is enabled." [doc] https://resources.avid.com/SupportFiles/attach/Pro_Tools/10.0/ENGLISH/Whats_New_in_Pro_Tools_10.pdf (p. 35)
- Its exact behaviour on a split is [unverified]: the Reference Guide PDF was not located, and forum descriptions are excluded.

### NLEs (Premiere Pro, DaVinci Resolve) and the Blender NLA

- Premiere: "If you want to change Effects settings over time, don't split the clip — you can apply keyframes to a single clip instead." [snippet] https://helpx.adobe.com/premiere-pro/using/split-or-cut-clips.html
- Resolve keeps keyframes that fall outside a trimmed clip: "If you've set keyframes on a clip, and then subsequently make it shorter on the timeline, the keyframes that were 'cut off' are still displayed in the Keyframe Editor. They were always still there and active in previous versions". [doc] https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_20.1_New_Features_Guide.pdf (p. 10)
- Blender NLA Split: "Split the selected strips in two at the current frame." [doc] https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/editors/nla/editing/strip.rst
- Both halves keep referencing the same action, so the logic is shared and only the time windows differ. [inferred from "Multiple strips can reference the same action"]
- **Lesson.** Splitting cuts the time window, and both halves keep the clip's own data:
  - In Resolve, the hidden part survives.
  - In Blender, both halves reference the same action.
  - Track-owned data ignores the cut entirely.
- Every DAW offers a "follow the clip vs stay on the timeline" toggle, and following the clip is the default (Ableton, Bitwig, and Pro Tools by name).

---

## 5. Excluding one member from an operation for a time range

### Lighting consoles: Block, Cue Only, Release and record-except

- Eos tracking: "Any changes in this new cue will also track forward into subsequent cues until a move instruction is encountered." [doc] https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/12_Cues_and_Cue_Lists/Cue_Only_Track.htm
- Eos record-except: "[-] [5] [Record] <Cue> [6] [Q Only] [Enter] - records the specified cue, except the contributions from channel 5." [doc] (same page)
- Eos Block:
  - It can apply "to a cue, a cue part, to any channel (or group of channels), or parameter (or group of parameters) within a cue."
  - "Block is an editing function. It has no impact on how the data is played back."
  - A cue-level block "causes all tracked values in the cue to be treated as move instructions from an editing standpoint". [doc] https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/12_Cues_and_Cue_Lists/05_Flags/Block.htm
- grandMA3 Block: "Block is a function used to add data and prevent them from tracking. Tracked values are converted to stored values." It is scoped by fixture and feature group: "Block Cue 5 If Fixture 4 FeatureGroup 'Position' EndIf". [doc] https://help.malighting.com/grandMA3/2.4/HTML/keyword_block.html
- grandMA3 Cue Only: "When stored in a cue with Cue Only, the tracked values will be blocked in the next cue or cue part to preserve the previous look on stage." [doc] https://help.malighting.com/grandMA3/2.2/HTML/cue_tracking_cue-only.html
- grandMA3 Release:
  - "Release values that are stored using the merge function release previously tracked values in the tracking list."
  - Released fixtures fall back to default ("The fixtures use their default values").
  - The keyword reference: https://help.malighting.com/grandMA3/2.4/HTML/keyword_release.html
- Off and KnockOut in grandMA3 only remove values from the programmer ("Knock out selections in the programmer"). They are not stored exclusions. [doc] https://help.malighting.com/grandMA3/2.4/HTML/keyword_off.html, https://help.malighting.com/grandMA3/2.4/HTML/keyword_knockout.html
- **Lesson.** Exclusion on consoles is scoped by member and by time:
  - A per-member Block stops upstream changes from reaching one cue.
  - Cue Only protects the next cue.
  - Release ends a tracked value from a given cue onward.
  - The tracked value is derived until something breaks the chain.

### Animation layers: Blender NLA and Maya

- Blender's Replace blend "Overwrites the values produced by the lower tracks. If Influence is less than 1, a linear interpolation between the previous and new values is used instead." Blend In/Out ramp the influence. [doc] https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/editors/nla/sidebar.rst
- Blender's Extrapolation "Nothing" means "The animated properties return to their default values outside of the strip boundaries"; Hold carries values outward. [doc] (same page)
- Maya Override layers act only on the attributes they share: an Override layer "overrides the animation of any layer that shares the same attributes and precedes it in the stack." [doc] https://help.autodesk.com/cloudhelp/2024/ENU/Maya-Animation/files/GUID-BBCA0BC3-7608-4E86-8E9F-B4099C316156.htm
- Maya layer membership is per attribute: "Attributes can be assigned to more than one layer, but are only keyframed on one layer at a time". Members are removed with "Remove Selected Objects". [doc] https://help.autodesk.com/cloudhelp/2020/ENU/Maya-Animation/files/GUID-E7E41BFB-30F9-45BF-AAB9-D4FD59338F78.htm
- **Lesson.** Overriding a subset for a time range works like this: a higher strip or layer whose membership is just the overridden members, clipped to the time range, wins over the base without editing it. This is what the ownership hypothesis-A layers already do.

---

## 6. Procedural vs baked, and pinning individual members

| Tool          | Live/procedural                           | Bake                                        | Is the bake reversible?                               | Per-element override on the live result    |
| ------------- | ----------------------------------------- | ------------------------------------------- | ----------------------------------------------------- | ------------------------------------------ |
| Houdini       | node network recooks                      | File Cache "Load from Disk"; node Lock flag | Yes: turn off Load from Disk or unlock                | Edit SOP ("cumulative"), masked by a group |
| Blender       | drivers, constraints, Geometry Nodes      | NLA "Bake Action"; GN Bake node             | Bake creates a new action unless Overwrite is set     | A higher NLA strip, or keys on top         |
| Cinema 4D     | Cloner and Effectors                      | Current State to Object                     | Original kept: "The original object ... is preserved" | MoGraph Selection plus an Effector         |
| After Effects | expressions                               | Convert Expression to Keyframes             | Expression kept but disabled                          | Keyframes after conversion                 |
| grandMA3      | recipes referencing group/preset/MAtricks | Cook                                        | "cooked data can easily be removed again"             | Stored values; Block                       |

Evidence for each row:

- **Houdini**
  - "the node reads its output from the cached disk files, rather than cooking its input". [doc] https://www.sidefx.com/docs/houdini/nodes/sop/filecache.html
  - "Lock 'freezes' and caches the node's output geometry. While the node is locked, the node outputs the 'frozen' geometry instead of cooking." [doc] https://www.sidefx.com/docs/houdini/network/flags.html
  - "Unlike most Houdini operators, Edit is cumulative ... An Edit node stores the final result of all the edits you perform in that node." [doc] https://www.sidefx.com/docs/houdini/nodes/sop/edit.html
- **Blender**
  - Bake Action "computes this final motion and creates a corresponding keyframe on every scene frame". It is used "to create a keyframe animation from drivers or constraints". "Overwrite Current Action" is optional. [doc] https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/editors/nla/editing/strip.rst
  - The GN Bake node "allows saving and loading intermediate geometries". [doc] https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/modeling/geometry_nodes/geometry/operations/bake.rst
  - "Drivers are a way to control values of properties by means of a function, or a mathematical expression." [doc] https://projects.blender.org/blender/blender-manual/raw/branch/main/manual/animation/drivers/introduction.rst
- **Cinema 4D:** Current State to Object "creates a polygon copy of the selected object ... Animation data is not copied to the new object. The original object (including its animation data) is preserved." [doc] https://help.maxon.net/c4d/s22/us/html/5667.html
- **After Effects:** the command evaluates the expression, creates a keyframe at every frame and turns the expression off. Adobe gives "freeze the values" and slow evaluation as the reasons. [snippet] https://helpx.adobe.com/after-effects/using/expression-basics.html
- **Lesson.** No tool both keeps the live result and lets you pin a single element inside it by editing that element directly. The pattern is always one of two:
  1. A separate override object stacked on top (Edit SOP, Effector plus Selection, NLA strip, Block). It survives recooks but can drift when upstream topology or order changes. That is why Houdini has `id`.
  2. A bake that discards the link and keeps the source switched off, ready to restore (AE, Houdini cache, MA Cook, C4D).

---

## Takeaways for OpenMarch

1. **Re-spread vs keep-gap is a named switch in every tool that has both.** Cinema 4D has Per Step/Endpoint and Step/Even. Blender has Offset/Endpoint and Count/Distance. MA has Remove Gaps, Preserve GridPositions and Adaptive Measure. Eos has Even trail vs a fixed trail %. OpenMarch should expose it as one shape-level setting, not decide it silently.
2. **The default depends on where the spacing is stored.**
   - If spacing is computed from the count (C4D Endpoint, Eos Even, Blender Endpoint), the remaining members re-spread.
   - If it is stored per member (MA per-fixture phase, Blender Follow Path offsets), a gap stays.
   - For shapes, "fit between ends", which re-spreads, is the closest analogue to the C4D default (Endpoint is "the typical Cinema 4D behavior"). Keep-gap should be the explicit alternative [inferred recommendation].
3. **Hiding a member is a different operation from changing the count.** C4D and Maya hide or override a subset with a Selection or layer, and the layout is untouched. OpenMarch "leave for a time range" should work this way: it creates a gap and does not re-spread.
4. **Order belongs to the group, and identity should be by id, not by index.** Consoles store selection order with the group, plus reorder operators (Shuffle, Wings). Houdini warns that index numbering changes when the count changes. A follow-the-leader chain should store member ids in order. Removing one should close up the rank by default, with a per-chain option to keep the slot.
5. **Clips own their logic, and tracks own what crosses clips.** Logic, Ableton, Bitwig and REAPER all keep both kinds of data, and Logic converts between them. A transition block should own its HOW. Anything that must survive a cut or move belongs on the track, or on the shape.
6. **A split cuts the time window, not the logic.** Blender's split halves reference the same action. Resolve keeps keyframes outside a trimmed clip "still there and active". Splitting a transition should produce two windows onto one motion definition, so that undoing the split or re-joining the halves loses nothing.
7. **"Follow the clip" is a toggle, and on is the default.** Ableton's Lock Envelopes, Bitwig's Automation Follow (on by default), REAPER's Move envelope points and Pro Tools' Automation Follows Edit all have one. If shape-owned data moves with a block, offer the opposite only as an advanced option.
8. **Exclusions are scoped edits that stop at a boundary.** Eos and MA Block apply to a channel or attribute in one cue, Cue Only protects the next cue, and Release ends a tracked value from a given cue onward. "Exclude performer P from transition T over beats a–b" fits this pattern. It should be a stored exclusion on the block, not edited keyframes.
9. **Derived by default, bake on request, and baking must be reversible.** AE keeps the expression disabled, Houdini can turn Load from Disk off, MA "cooked data can easily be removed", and C4D preserves the original. If OpenMarch ever offers "make keyframes real", it should keep the shape and transition that produced them, so the user can go back.
10. **Pins are override layers, not edits to derived output.** Houdini Edit, a C4D Effector plus Selection, Maya Override and NLA Replace all sit above the procedural result. Pins should be keyed by performer id so they survive re-spread and reordering.

## Gaps

- No vendor page states what grandMA3 or Eos does to a running or stored effect when one fixture is removed. Takeaway 2 is inferred from where each tool stores spacing.
- What happens to clip envelopes on a split is not documented for Ableton, Bitwig, Premiere or Pro Tools. Only Resolve (trim) and Blender (shared action) give evidence.
- Adobe help pages blocked direct fetching, so the Premiere and After Effects quotes are [snippet].
