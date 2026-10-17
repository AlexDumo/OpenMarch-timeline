# 7. Per-user undo (extra)

Ctrl+Z undoes **your** last edit and never anyone else's. If someone has changed part of your edit
since, that part is kept and you're told. This was not on the requested list, but it is the report's
riskiest untested claim (§4.4), so it got a prototype.

## Run

Same as [1](../01-live-sync/README.md), with two windows. **Undo** and **Redo** are in the
transport bar; the shortcuts are Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y (⌘ on a Mac).

## Try

- **Only yours.** Nudge W1 in window A (arrow key), nudge W2 in window B, then press Ctrl+Z in A.
  W1 goes back in both windows. W2 stays where B put it: B's edit is not on A's stack, even though
  it came later.
- **Partly someone else's.** In A, select W4 and W5 and nudge them down. In B, nudge W5 up twice.
  Undo in A. W4 goes back, but W5 stays where B put it. A sees "_Undid 'Nudge 2 marchers', except
  what Sam changed since. That was kept._", and W5 is marked "_kept Sam's_".
- **All of it changed since.** If B changed everything A's edit touched, A's undo does nothing and
  says so. The entry is used up, as with any undo.
- **Redo.** Ctrl+Shift+Z re-applies what the undo put back.
- **Undo a delete.** Select a move bar, press Delete, then Ctrl+Z. The move comes back **with the
  same ID** in both windows. IDs are global, so re-inserting can't collide.
- **Undo inserting time.** As head, click **Insert 4 counts at playhead** and undo it right away:
  it works. Insert again, let B resize any move, then undo in A. It's refused: "_others have edited
  moves or pages since_". Half an undo of a ripple would leave moves over the wrong music, so a
  structural undo is all or nothing, and only while nobody has built on the new grid.
- **Solo.** Open a show without making it collaborative. Undo works the same way, with no server.
- Undo is an ordinary op, so the server checks it like any edit. Undoing an edit in a section
  someone has since claimed is refused as `CLAIMED`.

## What it taught

1. **Build the inverse from the server's echo, not the local transaction.** The `prev` values the
   server returns with each applied op are what the server actually replaced. They are the truest
   base for an inverse. The local undo trigger SQL can't be used at all: it restores whole rows by
   `rowid` and would erase other people's columns.
2. **"Still mine?" is a per-field equality check.** It compares the current value with the value I
   wrote. Who changed it comes from a client-side "last writer per field" map, filled from every
   applied op. No server help is needed.
3. **Structural edits need a stricter rule than fields.** A per-field check misses moves that
   others _created_ on the new grid. The rule is: refuse if anyone else wrote beat-dependent data
   after my op's seq. That is the same `gridVersion` idea as in prototype 4, seen from the undo side.
4. **This replaces, rather than adapts, today's undo while in a session.** `history_undo` stays for
   solo files. In a session the stack holds ops. The app's `timelineHistoryFocus`, which jumps to
   the page and selection an undo touched, works unchanged, because it reads a `ChangeBatch` and
   undo still produces one.
