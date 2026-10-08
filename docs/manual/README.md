# Offline keyboard manual

These files hold a short manual page for every custom-keyboard function and
keyword, plus `rank-basics`, a beginner's guide to reading them. The mobile
and web apps bundle the whole manual through `key-manual.ts`; opening a page
never fetches anything from the internet. A long press on a key opens its
page.

The Core keyboard tab contains forms that need no import. Import-gated
keywords appear on their module tabs. Android hides CLI from both the tabs
and the module picker. Sort directions remain `.ascending` / `.descending`;
there are no bare-word direction keys.

Each page follows the same shape:

````markdown
## sqrt

Square root of a number.          <- one plain sentence

```rank                           <- a runnable example, first
use numbers
9 sqrt
```

```result                         <- generated, never typed by hand
3
```

### Usage                         <- the forms you can write, then prose
### Notes                         <- optional: limits and common mistakes
### See also                      <- optional: comma-separated page names
````

Write for someone seeing the function for the first time. Say what it does
in ordinary words, show it working, then cover inputs and limits. Skip
anything the example already shows. Paragraphs between the summary and the
example are an optional caption. `Backticks` render as inline code, and the
See also names become links.

After editing, wrap the prose to 40 columns and refresh the results:

```sh
node scripts/format-manual.mjs
UPDATE_MANUAL=1 npx vitest run --root packages/interpreter test/manual.test.ts
```

`manual.test.ts` checks that every builtin has a page, that the structure
and the 40-column limit hold, that every See also link exists, and that each
result block matches what its example really produces. File, database and
image examples must state their requirements. The browser regression checks
the viewer, its links and copying.
