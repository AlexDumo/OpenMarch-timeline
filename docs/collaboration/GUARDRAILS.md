# Collaboration-ready features

How to build a feature so that real-time collaboration can sync it later with no per-feature sync
code. These are conventions for now, not enforced: the enforcing test is added by the collaboration
spike, on its own branch (decision Q31). Background: [REPORT.md](REPORT.md) §6.

1. **Write show data only through `transactionWithHistory`**, preferably inside a db-function. No
   plain `db.transaction` writes that commit, and no main-process SQL for show data.
2. **Register every new show table in `tablesWithHistory`.** If a table is per-user (view, playhead,
   selection, a "selected" flag) or bookkeeping, keep it out of show tables, or say so in its
   schema comment.
3. **Insert through drizzle without assuming ids are small, dense or reused.** Never infer meaning
   from id order (such as "the oldest row is the page's"); store the meaning instead.
4. **Don't store derived data.** If a value can be recomputed (positions, layers, counts), compute
   it. A cache must be safe to be stale and must be rebuilt after any change.
5. **Prefer columns to JSON blobs** for anything two people might edit independently. Never put show
   data in `workspace_settings`.
6. **Refer to beats by `beats.id`** in new tables, as pages, measures and cues do, not by ordinal.
7. **Refresh the UI from table-name invalidation or the change feed**, not only from your mutation's
   `onSuccess`. A remote edit has no mutation.
8. **Keep cross-row invariants in the schema** (CHECKs, triggers, the commit-violation view), so a
   server can enforce them without the app's code.
