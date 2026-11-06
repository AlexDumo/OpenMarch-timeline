---
name: user-docs
description: Write, update or check the OpenMarch user guide (openmarch.com/guides) and its screenshots and clips. Use when a change alters what users see or do in the app, when asked to document a feature, or to check the guide against the app.
---

# User guide

The guide lives in `apps/website/src/content/docs/guides` and `troubleshooting`. It describes the app on `main`, and every picture in it is recorded from the app by a script.

1. Read `docs/conventions/user-docs.md` (what to write, words to use and avoid) and `apps/website/AGENTS.md` (how to make pages, record media and check them). Both are short; read them every time.
2. Find the pages to change: search `src/content/docs` for the code folder, action id or i18n key you touched (pages list them in `covers`), and for the old label text.
3. Learn the behavior from the code, not from memory or old pages: the component, its i18n strings in `apps/desktop/i18n/en.json`, and its tests. When unsure how something behaves, record a quick shot and look at it.
4. Write or edit the page. Use `<Ui k>` for labels and `<Kbd>` for shortcuts. One paragraph per line.
5. Add or update shots in `apps/desktop/scripts/docs-media/shots/<chapter>.mjs`, record them, and look at every image and a contact sheet of every clip before keeping them.
6. If shortcuts, actions or hold terms changed: `pnpm --dir apps/desktop docs:reference`.
7. Build the site (`pnpm --dir apps/website run build`). Report what you changed, what you recorded, and anything you couldn't confirm.

When a change can't include its guide update, list the affected pages in the pull request instead.
