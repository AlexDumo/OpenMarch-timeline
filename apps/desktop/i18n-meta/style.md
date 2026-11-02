# Translation style

How each language sounds in OpenMarch. Translators (people and AI) follow this together with
the agreed words in `glossary.json` and the note for each key in `context.json`. Drafted
2026-11-02; a native-speaking reviewer may change any rule here.

## Every language

- Translate what the string means where it appears, using its note. Don't translate word for
  word, and don't add or drop information.
- Keep every `{argument}`, `#` and `<tag></tag>` the English uses, unchanged, but move them
  wherever the sentence needs them. Translate the words inside plural and select branches;
  never translate argument names, select keys or plural keywords (`one`, `other`, `=1`).
- Plurals follow the language's own forms (CLDR). Keep an `other` branch. Keep `=1` branches
  as `=1`.
- Buttons and menu items are short and follow the platform convention for the language
  (what macOS and Windows show in that language). Keep them about as long as the English;
  a much longer label may not fit.
- "OpenMarch" and file extensions (`.dots`, `.glb`) stay as they are. Product names (Pyware,
  MuseScore), file formats (PDF, CSV, MusicXML) and units written as symbols stay as they are.
- Strings the note calls "search words" are never shown: write words people in that language
  would type to find the action, separated by spaces. Keep the English words too, so an
  English search still finds it.
- Keep the English capitalization style only where the language uses it. Most of these
  languages use sentence case for everything.
- Keyboard keys inside a string are tags (`<keys></keys>`); never write key names as text.

## Español (`es`)

- Neutral Latin American Spanish, the one most bands using OpenMarch speak. Avoid words that
  only Spain uses (ordenador → computadora, fichero → archivo, móvil → celular).
- Address the user as **tú**. Commands use the imperative ("Selecciona"), buttons the
  infinitive ("Guardar", "Agregar").
- "Agregar" rather than "Añadir"; "Eliminar" for delete; "Deshacer" / "Rehacer".
- Opening ¿ and ¡ always.

## Français (`fr`)

- Address the user as **vous**. Buttons use the infinitive ("Enregistrer", "Supprimer").
- French typography: a non-breaking space (U+00A0) before `:` and a narrow non-breaking
  space (U+202F) before `;`, `?` and `!`. Guillemets « » with non-breaking spaces inside.
- Sentence case for titles and buttons.

## Português do Brasil (`pt-BR`)

- Brazilian Portuguese only (tela, arquivo, celular; never ecrã, ficheiro, telemóvel).
- Address the user as **você**. Buttons use the infinitive ("Salvar", "Excluir").
- "Excluir" for delete, "Desfazer" / "Refazer".

## 日本語 (`ja`)

- Sentences and messages (toasts, dialogs, tooltips that are sentences) use です・ます.
- Buttons, menu items and labels are short: a noun or a verb stem with no ます
  ("保存", "削除", "ページを追加"). Follow what macOS and Windows show in Japanese.
- No spaces between Japanese words. Put no space between Japanese and an `{argument}` or a
  number either, unless it reads badly without one (a Latin word next to kana).
- Full-width 、。「」 and ？！ in Japanese text; half-width digits and Latin letters.
- Japanese has no grammatical plural. A plural message may become one plain string with `#`
  or the argument, or keep only the `other` branch, and must not invent a `one` branch.
- Katakana loanwords use the long-vowel mark the way major software does (ユーザー,
  フォルダー, ファイル).
