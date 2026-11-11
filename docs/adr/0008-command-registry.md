# 0008: One command registry for the menu, the command line and agents

- Status: proposed. The owner accepted the proposal behind it on 2026-10-20;
  merging this record accepts it.
- Date: 2026-10-20
- Spec: fork issue #357. Proposal and audit: "Commands, keyboard mode and MCP"
  (the owner's doc, 2026-10-20).
- Scope: fork only. This is not proposed upstream.
- Related: [ADR 0003](0003-menu-actions-ipc.md) (menu items run renderer
  actions over one IPC channel), spec #344 (the shape host's command bar and
  `ToolParam`)
- Number: 0006 is claimed twice (shape recipes on #181, sketchpad on #322),
  so the second of those to merge becomes 0007. This record takes 0008.

## Context

Everything a person can do should be reachable as a command: from the ⌘K and
`/` bar, from a typed command line (`brass - T4`, `create 12 trumpets`,
`focus T12`), and from AI agents through MCP. These surfaces need the same
things: typed arguments, a way to name marchers, and a result they can read.

The app has half of this. On `shapes/host` (c7adc71c6):

- **102 actions** live in `shortcuts/definitions.ts`. `runAction(id, args)`
  works outside React, but returns only a boolean. A handler's `run()`
  returns `void`, so failures reach the person as toasts and nothing else can
  see them.
- **Handlers are registered from React hooks** and exist only while their
  component is mounted. Basic hides an action by not registering it.
- **Two parameter types describe the same idea.** `ActionParam`
  (`shortcuts/definitions.ts`, used by no action yet) and the shape host's
  `ToolParam` (`shapes/tool/toolKind.ts`) both carry a key, a label, a unit,
  a default and a range.
- **Availability is a boolean.** `isActionEnabled()` gives no reason. Reasons
  exist only in the palette (the workspace rule and the shape gate).
- **Selected marchers are React state** in `SelectedMarchersContext`. Selecting
  by section, family, tag or drill number exists only inside
  `SelectTab.tsx`.
- **There is no outside entry point.** ADR 0003's `menu:action` channel
  carries five allowlisted actions. There is no server, socket, CLI, MCP or
  model code.
- **The web editor runs the same renderer and `db-functions`** against SQLite
  in a Web Worker, so anything built in the renderer serves both builds.

## Decision

### D-1: One registry; a command is a grown action

The action registry becomes the command registry. There is one list of
commands, and the palette, shortcuts, the command line, the app menu and the
agent bridge are surfaces over it. No surface keeps its own list.

A command adds these to today's `ActionDefinition`:

| Field              | What it is                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `id`               | A stable dotted name, `<area>.<verb>`: `marchers.create`, `page.addAt`, `select`, `view.focus`, `export.open` |
| `description`      | One plain sentence: what it does and when to use it. Required for any command agents can see.                |
| `params`           | An ordered list of command parameters (D-2)                                                                  |
| `available(ctx)`   | `{ ok: true }` or `{ ok: false, reason }` (D-4)                                                              |
| `preview(ctx, a)`  | Optional live preview while arguments are typed, as the box command does                                     |
| `run(ctx, a)`      | Async; returns a command result (D-3)                                                                        |
| `effects`          | `read`, `view`, `opensUi`, `editsDrill` or `destructive` (D-5)                                               |
| `expose`           | Which surfaces list it. All by default; `agent: false` keeps it from agents.                                 |

Existing action ids stay valid as aliases, so key bindings, user overrides,
`menuActions.ts` and the palette's usage history keep working.

### D-2: One parameter type

`CommandParam` holds what every surface needs: `key`, `label`, `kind`,
`default`, `range` and, for `enum`, its options. The kinds are `count`,
`steps`, `degrees`, `beat`, `page`, `section`, `marchers` (a marcher query,
D-7), `enum`, `text` and `boolean`. Each kind owns three things: parsing typed
text ("4x3", "32", "p4"), formatting a value back to text, and its JSON
Schema. A command's argument validator is derived from its list (zod), and so
is the schema agents see.

`ToolParam` extends `CommandParam` and keeps what only shapes need (drag axis,
interval scaling, stepper, chip display). `ActionParam` goes away.

### D-3: Commands return results

`run` resolves to `{ ok: true, summary, changed?, undoLabel? }` or
`{ ok: false, code, message }`. `summary` is one short sentence ("Created 12
Trumpets, T13 to T24"). Expected failures are results, not exceptions and not
toasts; showing a toast is the surface's job. The palette shows `message` as
it shows a toast today; an agent receives it as a tool error and can correct
its call.

### D-4: Availability says why

`available(ctx)` replaces the boolean `isEnabled()`. A refusal carries a
reason as an i18n key with values ("Select marchers first", "Only in Expert
mode", "Not in Visuals"). The workspace rules in `workspaceActions.ts` and
Basic/Expert become reasons instead of unregistered handlers, so a command is
always listed and can say why it can't run. `canRun(id)` returns the same
answer to any caller.

### D-5: Effects drive permissions

| Effect        | People                    | Agents                                                      |
| ------------- | ------------------------- | ----------------------------------------------------------- |
| `read`        | Always                    | Always, once the agent bridge is on                         |
| `view`        | Always                    | Always                                                      |
| `opensUi`     | Always                    | Always; it only opens something (export opens; it never exports) |
| `editsDrill`  | As today                  | Yes, under an "An agent is editing" banner with Undo        |
| `destructive` | As today                  | Only after the person confirms in the app                   |

`editsDrill` replaces the flag of the same name. Visuals and Preview turn off
`editsDrill` and `destructive` commands as they do today.

### D-6: One run is one undo step

A command that writes composes `*InTransaction` functions inside one
`transactionWithHistory` call, so each run is exactly one undo step, whoever
ran it. A batch of commands from an agent becomes one named step ("Agent:
create 12 trumpets") by flattening its groups after the batch. A command
never opens a second `transactionWithHistory` inside the first (the lock is
not re-entrant).

### D-7: Marcher queries

One pure parser turns text into a query, and a resolver turns a query into
marcher ids from the show's marchers, tags and the selection. The grammar:

- **Atoms:** `sel` (the selection), `all`, `#tag`, a drill number `T12`, a
  range `T1-6` or `T1-T6`, a section name in the singular or plural
  (`trumpet`, `trumpets`), and a family (`brass`, `battery`). Case doesn't
  matter.
- **Operators:** `,` and `+` add, `-` removes, `&` keeps the overlap. They
  apply left to right.
- **Errors:** an atom that matches nothing is an error with the closest names,
  never an empty selection.

The command line, the Select tab, `find_marchers` and every `marchers`
parameter use this one parser.

### D-8: Commands run without React

A command's `run` reads state from stores and plain modules, never from
hooks. The selected marchers move into a Zustand store, and
`SelectedMarchersContext` keeps its API by reading from that store.

During migration, actions whose handlers still live in React go through an
adapter. The adapter returns `{ ok: true, summary: null }` and marks the
command `agent: false`. So all 102 actions are in the registry from the start,
and a command reaches agents only once it has a real `run` and a
`description`.

### D-9: Outside access

- **Desktop:** an MCP server in Electron main, on `127.0.0.1` only. It is off
  by default, behind a per-install token, and it rejects requests whose
  `Origin` is not allowed. It targets MCP 2026-07-28 (stateless; a show handle
  is passed as an argument) and does not use Sampling. A stdio shim serves
  clients that only speak stdio.
- **One IPC channel pair** carries `{ id, args }` from main to the renderer and
  the result back. The renderer runs only commands whose `expose` allows
  agents, following ADR 0003's single-channel, allowlisted pattern.
- **Tools are few and broad:** show state, find marchers, list commands, run
  a batch of commands, a picture of the field, and open export. Agents never
  get a code-execution tool against the app's internals.
- **Web editor:** the same tools through WebMCP, behind feature detection.
- **Built-in assistant:** calls the registry directly. It uses the person's
  own key or local model, or a hosted OpenMarch server that requires sign-in;
  that server holds the provider key and sets usage limits. Billing is out of
  scope for now.

### D-10: What waits

Commands for moves, keyframes and transitions wait until the keyframe model
(#362) and transforms over time (#355) are decided. Until then, the agent
tool names and command ids are experimental, and agents get read access plus
the commands that don't write moves.

## Consequences

- New actions declare `CommandParam`s and return results. That includes shape
  and timeline work running in parallel with this.
- Basic no longer hides commands by not registering them. They stay listed,
  greyed, with a reason. Anything that checked "has a handler" to mean
  "available" must use `canRun`.
- The registry becomes an IPC contract. Renaming a command id needs an alias,
  as renaming an action does today.
- Drill-number allocation leaves `MarcherForm.tsx` and selection-by-section
  leaves `SelectTab.tsx` for plain modules the commands share.
- The MCP server adds a listening socket to the desktop app. It stays off
  until the person turns it on.

## Verification

- Unit tests: every `CommandParam` kind round-trips through parse and format,
  and produces a JSON Schema; every agent-exposed command has a description
  and a real `run`; every action id still resolves.
- Unit tests for the marcher query parser and resolver: a table of queries,
  including ranges, plurals, families, tags, operators and the errors.
- `transportShortcuts.test.ts` stays green: ADR 0003's menu actions still
  resolve.
- When the agent bridge lands: tests that a request with a bad token or a
  disallowed `Origin` is refused, and that a batch of commands is one undo
  step.
