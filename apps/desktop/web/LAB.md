# Lab test builds (fork-only, do not merge to OpenMarch's `main`)

> **Do not merge the lab pieces into OpenMarch's `main` branch:** this file,
> the `lab` channel in `vite.web.config.mts` (with `LAB_TEST_ID`) and its
> wording in the app (`webChannel === "lab"`), the example shows (`demos.ts`,
> `public/demos/`, which the fork's `preview` channel uses too), `lab/` and
> `.github/workflows/lab-deploy.yaml`. They exist so testers can try features
> that are still in development, in a browser, and give feedback. They live
> on the fork.

A lab test build is the production web editor (`README.md`) built on its
`lab` channel. There is one browser build: the lab publishes the same
worker, storage, Settings and 3D View windows that editor.openmarch.com runs,
with these differences:

- **Example shows.** The start page offers the shows in `public/demos/`
  (listed in `demos.ts`), as the `preview` channel does, so a tester doesn't
  need a `.dots` file of their own. A page-era show converts to timelines
  when it opens.
- **Served from a folder.** The lab serves each test at
  `https://lab.openmarch.com/x/<test id>/`, so the build's URLs are relative
  (`base: "./"`): its scripts, the worker, SQLite's WebAssembly, the 3D
  models, the example shows and the Settings (`#settings`) and 3D View
  (`?view=3d`) windows all load from that folder.
- **Its own storage.** Every test shares the origin `lab.openmarch.com`, so
  what a build keeps in the browser is namespaced by its test id, as
  `lab-<test id>`, rather than by channel (`renderer/channel.ts`, used by
  the page and the worker). The kept show (OPFS), its Web Lock, the
  settings, the hand-off between reloads, the channels between windows and
  the Settings window's name are each test's own, so two tests open in one
  browser don't see each other's show or settings. Preferences the app
  keeps in `localStorage` itself (UI settings, shortcuts, 3D View quality)
  are shared by every build on the origin, as they are between production
  channels.
- **Wording.** The title bar says "lab" next to the version, and the "Web"
  notice says it is a test build.
- **No `_headers` file.** The lab's Worker serves the files itself. The app
  needs no special headers (no cross-origin isolation; see "The show in the
  browser" in `README.md`).

## Commands

From `apps/desktop`, after the workspace packages are built
(`pnpm turbo run build --filter="@openmarch/desktop^..."` from the root):

```bash
WEB_CHANNEL=lab LAB_TEST_ID=my-test pnpm run web:dev     # local server
WEB_CHANNEL=lab LAB_TEST_ID=my-test pnpm run web:build   # static site in dist-web/
```

A lab build without `LAB_TEST_ID` (a-z, 0-9 and -) fails. To try it as the
lab serves it, copy `dist-web/` to `<folder>/x/my-test/`, serve `<folder>`
(e.g. with `python3 -m http.server`) and open `/x/my-test/`.

## Publishing to the lab

A test is a folder `lab/<id>/` with `experiment.md` (the test's title, intro
and questions) and, optionally, an intro video or GIF. To publish one:

1. Open a pull request on the fork that adds or changes exactly one
   `lab/<id>/experiment.md`.
2. Add the **`lab`** label.

`.github/workflows/lab-deploy.yaml` builds the web editor with
`WEB_CHANNEL=lab` and `LAB_TEST_ID=<id>`, publishes `apps/desktop/dist-web`
to the OpenMarch lab, with a link to the pull request and credit to its
author, and comments on the pull request with the test's link. It publishes
again on every push while the label is on. Merging the pull request archives
the test: it's closed and hidden from testers. Removing the label or closing
the pull request unmerged closes it. Its feedback stays either way. The lab
adds its feedback widget to the page (a script before `</body>` in
`index.html`); nothing in the build knows about it. The manifest format and
the lab itself are in the `OpenMarch/om-lab` repository.

## Demo shows

`public/demos/` holds the demo `.dots` files, listed in `demos.ts`. To add
one, copy the file there and add an entry. The preview Worker's Cloudflare
static assets reject files over 25 MiB, which includes a show's embedded
music.
