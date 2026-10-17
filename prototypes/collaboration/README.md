# Collaboration prototypes

Throwaway prototypes for [the collaboration report](../../docs/collaboration/REPORT.md). They are not
part of the pnpm workspace and do not touch the app. Everything runs locally against a Worker and
one Durable Object per show under `wrangler dev`.

## Run

```sh
cd prototypes/collaboration
pnpm install --ignore-workspace   # sql.js, wrangler, ws, kept out of the workspace
pnpm dev                          # copies sql.js and the demo shows into public/, then wrangler dev
```

Open <http://localhost:8787>, choose a show, then click **Make collaborative**. Use **Open a second
window** (or paste the invite link into another browser) to add a collaborator. Each tab is its own
person. The name is random per tab, and you can change it in the header.

Two scripted checks run against `pnpm dev`:

- `pnpm smoke` drives the server with two scripted Node clients. It covers sync, conflicts,
  delete versus edit, the stale-grid refusal, claims and catch-up.
- `pnpm check:browser` runs `scripts/browser/*.mjs`. These are two-window walkthroughs of each
  prototype in headless Chromium, using the Playwright browsers the repo already installs. Each one
  also checks that both windows end with identical moves. Screenshots go to `/tmp/om-sync-shots`.

Both should print `all passed`.

## How it is built, and how that maps to the report

| Piece                                                                                   | File                                   | Report section                                        |
| --------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------- |
| Shared DDL, run unchanged by the browser and the Durable Object                         | `public/shared/schema.js`              | §4.5: the server validates by running the same schema |
| Capture triggers (`sync_change_log`, gated by `sync_state.recording`)                   | `public/shared/schema.js` `captureDdl` | §4.1                                                  |
| Local mirror: commands are SQL transactions; remote changes applied with recording off  | `public/client/mirror.js`              | §4.2, §4.3                                            |
| Pending queue, shadowing, revert on refusal, read-only offline                          | `public/client/connection.js`          | §4.2                                                  |
| Single write path for every edit (`submit`)                                             | `public/client/app.js`                 | §6 rule 1                                             |
| Positions derived on every client; who wins is derived (later start, then shorter)      | `public/shared/model.js`               | §5.1                                                  |
| Durable Object: order, validate, field-level LWW, conflicts, tombstones, claims, op log | `server/session.js`                    | §4.5, §5                                              |
| `.dots` import (page model and timeline model)                                          | `public/shared/shows.js`               | –                                                     |

The "move" here is a simplified timeline row: one marcher going to (x, y) over a beat range, which is
what a one-slot shapeless transition plus its assignment is in the app. Moves into shapes are not
modeled.

## Prototypes

1. [Live sync](01-live-sync/README.md)
2. [Presence](02-presence/README.md)
3. [Soft section claims](03-section-claims/README.md)
4. [Conflict feedback](04-conflict-feedback/README.md)
5. [Disconnect behavior](05-disconnect/README.md)
6. ["Make collaborative"](06-make-collaborative/README.md)
7. [Per-user undo](07-per-user-undo/README.md) (extra: the report's riskiest untested claim)
