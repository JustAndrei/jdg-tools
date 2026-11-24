# PDF filler

A static page that turns a PDF annotated with sample text into a fill-in form and draws the answers
back onto the PDF. Serve the folder over HTTP (`python3 -m http.server`); `file://` does not work.

`index.html?debug#<name>` marks the anchor point of every text on the output, which helps when calibrating coordinates.

## Files next to index.html, per PDF

| File | Required | Purpose |
|------|----------|---------|
| `<name>.pdf` | yes | PDF whose **FreeText** annotations hold sample text (position, size, alignment, letter spacing) and whose **Square** annotations are drawn onto the output (e.g. to white out printed text). All annotations are removed from the output |
| `<name>.json` | yes | The form description, see below. If it is missing, a starting-point file is downloaded |
| `<name>.js` | no | An ES module whose exports are extra transformations |
| font files | yes | Listed in `global.fonts` |

## Metadata (`<name>.json`)

```jsonc
{
  "title": "Form title",
  "global": {
    "fonts": { "*": "CourierPrime-Regular.ttf" },  // embedded in this order, the first one is used
    "coordinateCorrection": { "x": 0, "y": 5 },    // added to every annotation position
    "defaultTransform": "caps"                     // applied unless an annotation says otherwise
  },
  "annotations": [ ... ]
}
```

Annotations that have a `value` are matched, in order, with the PDF's FreeText annotations, which are
sorted top-to-bottom, left-to-right, page by page. `value` must equal the annotation's text, `newValue`
overrides what the form is pre-filled with. Common attributes: `type`, `title` (label), `name` (to refer
to the field), `transform`, `ifEmpty` (draw the value of the field with this name when this one is empty).

| `type` | Meaning | Specific attributes |
|--------|---------|---------------------|
| `text` | text input | `multiline`, `maxCharsPerLine`, `maxWidth`, `mode` (`simple`, `fit`, `chars`, `chars-with-spacing`) |
| `date` | date picker | `format` (moment.js tokens) |
| `select` | drop-down | `options`: an object `{ drawn: label }` or `"standard.<set>"` (see `js/constants.js`); `indexer` + `indices` to draw the variant of `a\|b` matching another field |
| `check` | one drop-down per `title`, each annotation is an option with the position of its own mark | `option` (label), `optionId` (what profiles save), `default`. Set `groupSelector` to `true` to make the drop-down working as a `group-selector` at once. |
| `static` | fixed text | `dependsOn`, `comparison` (`equals`), `argument`: draw only when the named field has that value |
| `copy` | repeat another field | `from`: name of the source field |
| `same-as` | checkbox under the `target` field, checked by default: the target mirrors the `source` field and is disabled; unticking it lets the person edit the target. Draws nothing itself | `source`, `target`: names of two fields defined **earlier** in `annotations` (of the same kind of control); `title`: checkbox label. Not supported inside tables |
| `table`, `row-number`, `last-row-number`, `end-of-table` | rows the person can add | `row-number` is the first row's number (`render: false` to keep it off the PDF), `last-row-number` marks the last row and so the row spacing, `add` is the button label |
| `group-selector` | when PDF contains several sections, only one of which should be filled in, enclose groups of annotations between`group-start` and `group-end`  | `options`: an object `{ groupName: label }` |
| `group-start` | opens a custom group, selectable with `group-selector`. Nested groups are not supported yet | `group`: custom group name |
| `group-end` | closes the custom group, opened with `group-start` | `group`: custom group name, must match the one specified in `group-start` |
| `section`, `comment`, `break` | layout only; `comment.text` is HTML |  |

## Profiles

The state of the form is kept in localStorage as *profiles*, under the name of the form (`<n>`):

| Key | Value |
|-----|-------|
| `<n>/profiles/<profile name>` | the serialized form: `{version, fields: {key: value}, tables: [[{key: value}]]}` |
| `<n>/currentProfile` | the name of the profile on the screen |

- Annotations with `"profile-name-part": <number>` make up the profile name: the values of those fields, in the order of the
  numbers, joined with a space. **Fill PDF** saves the form into the profile of that name (so changing one of those
  fields creates a copy) and makes it the current one.
- A value is saved under the annotation's `name`, or `annotation<N>` (N is the index in `annotations`) while it has none.
  Inserting annotations shifts unnamed ones, so give every annotation that holds a value (`text`, `date`, `select`, `group-selector`, `same-as`, and the first `check` of a group) a unique name to keep saved profiles valid; within a table the names must be unique per row.
- Drop-downs are saved as the `value` of the chosen option, i.e. the key of `options`. The options of a `check` group are saved as the annotation's `optionId` (falls back to the `option` text, which is translated, so give every `check` annotation an `optionId`).
- The bar at the top (always shown, stays in place while scrolling, holds the language picker at its right end; without profiles only **Load from file** is enabled): the profile drop-down, **Save to file** (downloads `<profile name>.json`),
  **Load from file** (makes a profile of the file; the name is computed from its data) and the red **Reset**
  (deletes all profiles of the form and restores the defaults).
- Changing the language rebuilds the form but keeps what was typed in.

## Code

```
index.html            loads the libraries and js/main.js
css/styles.css
js/main.js            entry point: URL/file picker -> load -> build form -> fill PDF
js/loader.js          metadata, fonts and optional script of a PDF
js/io.js              fetch / file picker / file save helpers
js/errors.js          AppError (technical detail + message for the person)
js/ui.js              page-level messages and the PDF viewer
js/constants.js       standard option sets for `select`
js/transformations.js standard transformations and lookup of PDF-specific ones
js/text-util.js       splitToLines (pure text wrapping)
js/util.js
js/profiles/          profiles: form-state (serialize/restore), profile-store (localStorage), profile-bar (UI)
js/form/              metadata -> form (form-builder, table) and form -> draw instructions (collect, conditions)
js/pdf/               annotations (read the PDF), draw-text (pdf-lib text drawing), render (produce the PDF)
```