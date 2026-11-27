# 0020: The report recorder follows the OpenMarch window in front

- Status: accepted
- Date: 2026-11-27

## Context

The report drawer's recorder (fork #801) asked for the screen, and main's
`setDisplayMediaRequestHandler` answered with the editor's own page, so the
3D View and Settings windows never appeared. A tester recording a 3D View
playback bug (report 13, fork #1378) had to use another app.

Measured on this box (RTX 3060 Ti, Xvfb, 3D View orbiting, 3 × 4 s runs):

- Capturing a window slows that window's drawing: the 3D View went from about
  31 to 27 fps while it was captured, and kept most of that cost with its
  track disabled. Capturing the editor cost the 3D View nothing.
- Writing frames drawn on a GPU canvas into a generated track stalled for
  seconds per frame while the 3D View drew; a canvas kept in memory
  (`willReadFrequently`) wrote each frame in about 0.1 ms with no extra cost.
- Chromium's MP4 recorder can't take frames that change size (the file fails
  to decode), and capture constraints don't force one size.
- A new capture of a window delivers its first frame in 70–140 ms.

## Decision

- Main (`electron/main/reportRecording.ts`) answers each editor screen request
  with one OpenMarch window's page: the one the editor named just before with
  `report-recording:target`, otherwise the editor. Only visible windows showing
  OpenMarch's own pages (`app://openmarch` or the dev server) can be named;
  requests from anything but the editor are refused, as before.
- While a recording runs (`report-recording:watch` / `unwatch`), main sends the
  editor `report-recording:windows`: the open windows, which is the editor,
  which are minimized, and which has focus.
- The editor (`src/feedback/windowsRecorder.ts`) captures only the window shown:
  the focused one, or the last one shown while another app is in front, or the
  editor or any window left when that one is minimized or closed. On a change it
  captures the new window and keeps the old picture until the first new frame.
  Frames are scaled into a fixed in-memory canvas (the editor's size, at most
  1920 × 1080) and written to a `MediaStreamTrackGenerator` that MediaRecorder
  records. With every window minimized it shows a "minimized" card.
- The web build keeps the single-tab recorder.

## Consequences

- The recording follows the person around OpenMarch without a question.
- Recording the 3D View costs it about 13% of its frame rate here, the price of
  capturing it at all; following focus adds nothing on top. Windows not in
  front cost nothing.
- Switching windows leaves about a tenth of a second of the previous window.
- The recording bar's dot no longer pulses: the endless animation kept the
  editor drawing and halved the 3D View's frame rate while recording.
- Relies on Chromium's `MediaStreamTrackProcessor` and
  `MediaStreamTrackGenerator` on the page; without them the recorder records
  the editor only, as before.

## Verification

- `src/feedback/__test__/recordingWindows.test.ts`: which window is shown, and
  the letterbox and video size.
- `~/om-capture/scenarios/record-all-windows-1378.mjs` (validate toolkit, `WM=1`):
  records editor → 3D View → Settings → minimize → close, and measures the 3D
  View's frame rate with and without recording.
