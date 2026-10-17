# 6. "Make collaborative"

A local show becomes a session: confirm, upload a snapshot, open the session, invite someone. Then
take the result away again as a file.

## Run

Same as [1](../01-live-sync/README.md).

## Try

- **Open a real file.** On the start page, choose **part1-demo.dots** (the repo's page-model demo,
  95 marchers), or open any `.dots` file of your own. Page-model files become one move per page where
  a marcher's spot changed (the converter's rule). Timeline files keep their shapeless moves. The
  show opens **solo**: the banner says nothing leaves the window, and there is no network panel.
- **Edit solo.** Nudge a marcher. Solo edits go through the same `submit` path, with no server.
- **Make collaborative.** The confirm dialog says what is uploaded (counts and size), that positions
  are not uploaded, that you become the head drill writer, that offline means read-only, and that
  your local file is left alone. Confirm. The snapshot is POSTed to `/api/sessions`, a new Durable
  Object is created for it, and your window rejoins it as head.
- **Invite.** The invite dialog has the link, **Copy link** and **Open a second window**. The second
  window joins as a collaborator and loads the snapshot, including the edit you made while solo.
  **Invite** in the header reopens the dialog.
- **Take it away.** Make an edit in either window, then click **Download a copy**. You get
  `<show> (session copy, #N).json`, the server's state as of edit N. Open it from the start page
  ("Open a .dots file (or a downloaded session copy)"). It opens solo and unlinked.
- **Dead link.** Open `http://localhost:8787/?s=` followed by 64 hex characters that aren't a
  session. You land on the start page with a message instead of a window that keeps retrying.

## What it taught

- **The upload is small and dull, which is good.** It holds source rows only. For the 95-marcher
  demo that is about 820 moves and 78 KB of JSON, because positions are derived. A real `.dots` file is
  larger only because of audio, history tables and Library blobs, all of which should stay out of
  the snapshot. Audio and blobs go to R2 by hash, and history isn't shared.
- **"Make collaborative" is a conversion, and it should feel like one.** The app already has the
  pattern: `ConvertShowDialog` asks first and names what happens to the original file (ADR 0001
  §6). The same confirm-then-convert shape fits here. It is also the natural place to run the
  migration to stable IDs and refuse files that are too new.
- **The creator's window reloads from the server's snapshot** rather than trusting its local copy.
  That one rule (the session's first state is whatever the server stored) means every client
  starts identical.
- **Leaving is still an open question** (report §7 question 3). This prototype answers it the
  simplest way: you download a new, unlinked copy. Saving back into the original local file would
  need a "which file is this session" link, and a decision about edits made locally while the
  session ran.
