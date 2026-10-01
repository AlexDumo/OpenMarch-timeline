# Testing

## Writing tests

Use Vitest to write all unit tests.

Tests should be placed in a **test** folder within the same directory of the file being tested.

Never use mocks for packages or database operations.
Everything should be able to be tested with the real functionality.
If you run into trouble getting a module to import correctly, please ask for assistance.
The only exception to this is mocking React context providers when trying to render components that rely on the hooks.

## Running tests

Since the is a monorepo, be sure to change directory to the package or app where you want to run tests.
E.g. `pnpm --dir apps/desktop run test:focused <relative-test-file>`.

Use `test:focused` rather than `test` for a single file: the `test` script ends in
`--silent`, and Vitest 4 parses a trailing path as that flag's value and exits.
Tests that use `getTestWithHistory` need `pnpm --dir apps/desktop run test:history
<relative-test-file>` instead.

`pnpm --dir apps/desktop run test:timeline` runs the desktop suite with timeline mode on in the
fixtures (`VITEST_TIMELINE_MODE=true`, see `apps/desktop/src/test/timelineMode.ts`): data
fixtures are converted to timeline rows and the workspace `timelineMode` flag is set. A file whose
tests set up timeline mode themselves calls `keepFixturesInPageMode(reason)`; a test that asserts
page-mode behavior that timeline mode drops uses `it.skipIf(skipInTimelineMode(reason))`.
