# Localization

The desktop app's text is translated with [Tolgee](https://tolgee.io). Write every
piece of user-facing text through Tolgee as you build, even though only English
ships at first. Translators fill in the other languages later, from the English
text and the context you leave for them.

`pnpm check:i18n` enforces this for `apps/desktop/src`. It runs in `pnpm check:quick`,
in the pre-commit hook when desktop source or i18n files change, and in PR checks.

## What counts as user-facing text

Anything a person can read or hear:

- JSX text and string expressions shown in JSX (`{on ? "On" : "Off"}`).
- Text props: `title`, `aria-label` and the other `aria-*` text props, `placeholder`,
  `alt`, `label`, `tooltip`, `description`, `heading`, `message`, and props ending in
  `Label`, `Text`, `Title`, `Tooltip`, `Description` or `Message`.
- Toasts (`toast.*`, `conToastError`) and `alert` / `confirm`.
- Error messages a user sees, and screen-reader text (`sr-only`, `aria-label`).

Not user-facing: class names, ids, test ids, log messages, keys, file formats, and
code shown as code (`<code>`, `<pre>`).

The check sees literals written directly in those places. Text built elsewhere and
passed in through a variable is still your responsibility.

## How to add text

1. Add the key and its English text to `apps/desktop/i18n/en.json`. Don't edit the
   other language files; they come from Tolgee.
2. Add translator context for the key to `apps/desktop/i18n-meta/context.json` (see
   below).
3. Show it with Tolgee:
   - In components, `const { t } = useTranslate();` then `t("timeline.loop.on")`, or
     `<T keyName="timeline.loop.on" />`.
   - Outside React, `tolgee.t("timeline.loop.on")` from `@/global/singletons/Tolgee`.
   - An inline default (`t("key", "English")`) is allowed but must match `en.json`
     exactly; the check fails if they drift.

Key names are `<area>.<feature>.<thing>`, for example
`timeline.rangeMenu.setAsShown`. Reuse an existing key only when the text means
the same thing in the same place; "Set" on a button and "Set" as a state can
translate differently.

## Writing translatable strings

- Never build a sentence from pieces (`"Page " + label + " flag"`). Other languages
  reorder words. Use one string with arguments: `"Page {page}'s flag"`.
- Counts use ICU plurals: `"{count, plural, one {# marcher} other {# marchers}}"`.
- Inline elements are tags in the string, rendered with `<T params>`:
  `"zoom out with <keys></keys>"` and
  `<T keyName="…" params={{ keys: () => <Keycaps … /> }} />`. Keyboard shortcuts
  always render as keycaps (see `apps/desktop/AGENTS.md`).
- Units and short labels (`"fps"`, `"X:"`, `"bpm"`) are text too.

## Translator context

`apps/desktop/i18n-meta/context.json` maps each key to a note for translators, kept
in key order:

```json
{
  "timeline.rangeMenu.setAsShown": "Menu item in a page's right-click menu on the timeline. Stores the selected marchers' current on-field positions as set (fixed) positions on that page, so they stop following the move around them."
}
```

Say what the text is (button, menu item, tooltip, toast, screen-reader label),
where it appears, and what it does or means. Explain OpenMarch terms (set, move,
page flag, start flag, count) and every `{argument}`. A translator sees only the
string and this note, with no access to the code or the app, so the note has to
stand on its own.

When you change a key's English text or what it does, update its note in the same
change. A stale note misleads more than a missing one, and the check can't tell.

Every new key needs context. Keys that existed before the check are listed in
`keysWithoutContext` in `apps/desktop/i18n-meta/baseline.json`; adding their context
is welcome.

Tolgee's file push doesn't carry descriptions, so a translation sync copies these
notes into Tolgee's key descriptions separately.

## Exceptions

Mark a deliberate exception, such as the product name, with a comment on the same
line or the line before, and say why:

```tsx
{
  /* i18n-ignore: product name */
}
<span>OpenMarch</span>;
```

Use this for text that must stay the same in every language, not to skip work.

## The baseline

Text written before the check is counted per file in
`apps/desktop/i18n-meta/baseline.json`. A file may not gain untranslated text, and
when a file loses some (you translated it, or deleted the code) the check asks you
to run `pnpm check:i18n --update` so the lower count is locked in. `--update` only
lowers counts and removes entries; it never accepts new problems.

When you touch a file in the baseline, translating its old text is welcome but not
required.
