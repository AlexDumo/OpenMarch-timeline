# 3. Soft section claims

A collaborator claims a section, such as _Battery_. Everyone else still sees it but can't edit it.
The head drill writer can override the claim.

## Run

Same as [1](../01-live-sync/README.md). The window that clicked **Make collaborative** is the head
drill writer; windows opened from the invite link are collaborators.

## Try

- In the collaborator's window, click **claim** next to _Battery_. Both windows label Battery
  "_held by Sam_" on the field, draw a box in Sam's color around each Battery marcher, and tint
  Battery rows on the timeline. The claimer sees "_yours_".
- **Blocked.** Claim _Guard_ in the head's window. In the collaborator's window, try to drag a
  Guard marcher, nudge one with the arrows, or resize a Guard move. Nothing starts, and a toast
  says who holds it. The marchers are faded but still selectable, and you can still scrub and
  play.
- **Override.** In the head's window, drag a Battery marcher. On release, the head is asked
  "_Battery is held by Sam_" with an **Override claim** button. If they click it, the edit lands,
  Sam gets "_Alex (head drill writer) edited Battery, which you hold_", and the Activity list
  records the override.
- The head can **take back** any claim. Claims survive their owner leaving: close Sam's window, and
  Battery shows "_Sam (away)_".
- The server enforces claims, not just the UI. `pnpm smoke` sends a claimed edit without the
  client check and gets `CLAIMED` back.

## What it taught

Claims need a **mapping from each op to the entities it touches**. Here that is
`sectionsTouched` in `server/session.js`. Moves map to marchers through `marcher_id`, and marchers
map to sections through `section`.

In the real schema that mapping is deeper:

- assignment → marcher
- transition → assignments
- shape → transitions → assignments

A shape or transition shared by marchers from two sections touches both sections. So claims want a
server-side "touched marchers" function per table. It is the same function the conflict toasts
need (prototype 4).

**Structural edits ignore claims and are head-only.** Inserting time shifts everyone's moves, so a
claim can't protect against it. That is a product rule, not a technical one.

Claims are soft locks that live **beside** the data, not in it: a separate table, never synced as
ops, and never undone.
