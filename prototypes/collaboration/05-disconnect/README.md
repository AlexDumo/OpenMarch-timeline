# 5. Disconnect behavior

Kill a window's connection. It goes read-only with a clear banner. When it reconnects, it catches
up on everything that happened while it was away.

## Run

Same as [1](../01-live-sync/README.md), with two windows.

## Try

- **Read-only.** In window B, click **Kill connection** (Network panel). B shows a red "_Disconnected
  … read-only_" banner and the chip reads _Offline · read-only_. Others' presence disappears, because
  B no longer knows what they are doing. B can still select, scrub and play, but dragging, nudging
  and editing moves are refused with a reason.
- **Catch up.** While B is offline, edit a few things in A. A's People list no longer shows B. Click
  **Reconnect** in B. It gets "_Caught up on N edits from while you were away_". Each of those edits
  flashes in its author's color, and the Activity list marks them "(while you were offline)". B asks
  for ops after its last `seq`, so nothing is re-downloaded.
- **Unsent edits are undone, not queued.** Set B's **Simulated latency** to 1500 ms, nudge a
  marcher with an arrow key, and click **Kill connection** within a second and a half. B gets "_1
  edit hadn't reached the server and was undone_", and the marcher snaps back. After reconnecting,
  both windows agree that the edit never happened. This is v1's online-only rule.
- **The session outlives everyone.** Close every window, then open the invite link again. The show
  is exactly as you left it: it lives in the Durable Object's SQLite, not in anyone's window.
- Stop `wrangler dev` and start it again while windows are open. They drop to "_Connection lost …
  trying to reconnect_" and come back by themselves.

## What it taught

Online-only makes disconnect simple. **Three rules** cover it:

1. Revert unconfirmed ops on disconnect.
2. Refuse edits while offline.
3. Catch up from `lastSeq` on reconnect, or from a snapshot if the op log no longer reaches back
   that far.

There is no merge step, so nothing can diverge. The scripted check compares both windows' moves
after every scenario, and they always match.

The one subtle bug was in-flight messages. A message queued before the drop must not be sent on
the _new_ socket after its op was already reverted. Here, every send is tied to the socket it was
queued on. In the app, the equivalent is that an op belongs to a connection epoch.

Read-only in the app would mean gating every command, but nearly every command goes through
`transactionWithHistory`. A session flag checked there (refuse while offline) covers all of them,
with no per-feature work. Only UI hints, such as greying out tools, need to know.
