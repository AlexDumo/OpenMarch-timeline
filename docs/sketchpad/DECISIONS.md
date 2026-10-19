# Sketchpad: owner decisions

Answers to the eight questions on the proposal page (2026-10-19). Where an answer changes the
UX spec (`design/ux-spec.md`), this file wins.

| #   | Question                                  | Decision                                                                                                                    |
| --- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | Excalidraw with our own UI on top?        | Yes. Excalidraw 0.18.1 plus a roughjs patch for the dot fills, with Excalidraw's own menus hidden.                          |
| 2   | One window per sketch, or tabs?           | One Sketchpad window with a tab per open sketch. Each sketch also has pages, as in FigJam.                                  |
| 3   | Templates in the file or the Library?     | Both. Save a template to the show or to your Library. The web build has no Library, so it saves templates in the file only. |
| 4   | When does an overlay show?                | A sketch page is pinned to one beat. It shows on the field when playback is paused on that beat. It is not a beat range.    |
| 5   | Does undo survive closing the window?     | No. Each tab keeps its undo history in memory while the window is open.                                                     |
| 6   | Collaboration in v1?                      | No, but storage keeps Excalidraw's per-element id, version and isDeleted so it can be added later.                          |
| 7   | Ship the standalone static site publicly? | Lab builds only at first.                                                                                                   |
| 8   | Sketchy or clean strokes by default?      | Sketchy. The setting shows a sample stroke for each option, so people can see the difference before choosing.               |

## What the answers change in the spec

- **Tabs (Q2).** A window replaces the per-sketch windows. Opening a sketch from the sidebar opens
  or focuses its tab. Each tab keeps its own Excalidraw instance mounted while the window is open,
  so its undo history survives switching tabs. Closing a tab saves it.
- **Pages (Q2).** A sketch holds an ordered list of pages, each a separate scene with its own undo
  history. All pages share the sketch's field snapshot and field style. Page navigation is a
  FigJam-style list in the left of the window. Copy and paste works across pages and tabs.
- **Overlay (Q4).** The sidebar overlay settings become a pin. Pin a sketch page to a beat, which
  is the playhead's beat when you pin it. The pin stores `beats.id`, so inserting or deleting other
  beats does not move it. If its beat is deleted, the pin stays in the list as unpinned. While
  paused on a beat, every pinned page on that beat shows with its own opacity and position (below
  or above marchers). The overlay hides while playing or scrubbing.
- **Templates (Q3).** "Save as template" asks for a destination: This show or My Library. The New
  sketch dialog lists both groups. A template carries every page and the field style, never the
  field layout.
- **Stroke style (Q8).** The Sloppiness control is a pair of buttons, each drawing a short sample
  stroke in its style.
