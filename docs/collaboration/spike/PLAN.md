# Collaboration spike: plan

<!-- cspell:words collab -->

Branch `research/collab-spike` (from `research/collaboration`, which is fork `main` plus the
collaboration docs and prototypes). No other PR is touched. Interfaces: [CONTRACT.md](CONTRACT.md).

| WP  | What                                                                                                                                                                                                          | Where                                             | Depends on    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------- |
| A   | Client foundation: temp capture triggers, drain in `transactionWithHistory`, `applyRemoteChanges` / revert / replace-all, session ID helper on the 25 inserts, read-only gate, Vitest tests on real databases | `apps/desktop/src/sync/`, `src/db-functions/`     | –             |
| B   | Server: Worker plus Durable Object running the app's real DDL (dump script), the protocol, validation, LWW, op log, a Node smoke test                                                                         | `apps/desktop/sync-server/`                       | –             |
| C   | Wiring: WebSocket connection (port of the prototype's), session store, dev actions "Make collaborative (dev)" / "Join session (dev)", status chip and read-only banner, two-window browser scenario           | `src/sync/`, small UI hooks, `e2e/browser/tests/` | A, B          |
| D   | Per-user undo, conflict toasts, presence of selection and playhead                                                                                                                                            | `src/sync/`, small UI hooks                       | C             |
| E   | Measurement: files touched against the kill criterion; the seven acceptance criteria measured (remote latency, solo speed before and after, …); one Electron run; verdict                                     | `docs/collaboration/spike/RESULTS.md`             | C (D if done) |

**Verification.** Each package runs focused checks only (`pnpm run test:focused <file>`,
`test:history`, `pnpm tsc --noEmit` in `apps/desktop`, the server smoke test, and the browser
scenario). CI runs the full suite. Never use `--no-verify`. If a hook is broken, stop and report it.
