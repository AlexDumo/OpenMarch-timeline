---
# The lab reads this file when this branch's test build is published.
# Keep `id` stable: feedback is filed under it.
id: tempo-lab
title: Line the counts up with the music
summary: New ways to set tempos and line counts up with your recording. Turn them on in Settings, then try them on a show with music.
status: open
questions:
  - Could you get the counts lined up with your music? What was hardest, and what did you give up on?
  - Which of the tools (Line up with music, Tap the beat, Punch-in tap, Tempo map) would you actually use, and for what?
  - When you added or removed counts, did the drill do what you expected? Was the preview clear?
  - Did anything change your drill or your tempos when you didn't expect it to?
---

Getting counts to line up with the music is a pain. This build tries several
ways to make it easier. Each one is switched off until you turn it on.

**Before you start**

Open a show **with music**: a demo show, or your own show with an MP3 or a
MusicXML score. Then open **Settings → Tempo lab** and turn on the tools you
want to try. You can turn them on one at a time.

**1. Line up with music (press A)**

Shows the timeline in seconds, on top of the real waveform. Drag a page's flag
onto the hit in the music where that page should start. The counts before it
stretch or shrink to fit. Press **A** again to go back.

**2. Tap the beat**

Tap along with the music for a few counts to set the tempo and where count 1
is. A good start for a show made from an MP3.

**3. Punch-in tap (T, in Line up with music)**

Play the music and press **T** where each page starts. Fix a mistake by tapping
again; nothing is applied until you say so.

**4. Tempo map**

A table of tempo and meter changes, such as "152.5 BPM from m30". Open it from
the timeline's header or the Music panel.

**5. Drill choices**

Right-click a measure and choose **Remove counts…**, or right-click a page and
choose **Add counts…**. You're asked what should happen to the drill and shown
a preview first.

**Also new, always on**

- Click a measure number on the measure row to add a rehearsal mark (or press
  **R** at the playhead).

**Good to know**

- Everything you do here is one undo step at a time: **Ctrl+Z** (**⌘Z**) puts it
  back.
- This is an experiment. Tools may change or go away based on what you tell us.
