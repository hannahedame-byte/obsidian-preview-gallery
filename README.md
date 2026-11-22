# Preview Gallery

Notion-style views for [Bases](https://help.obsidian.md/bases): see your notes as cards with their **actual text**, open them in a **side peek**, sort them on a **board**, and leave **comments** that live inside the note as plain markdown.

No extra properties needed. Previews and covers come from the notes as they are.

## Features

### Preview gallery (Bases view)

Each note becomes a card with:

- **A preview of the note's text** — the first lines, cleaned of markdown syntax, code, tables and leading `Key: value` lines.
- **A cover image** — from a `cover`, `image` or `banner` property, otherwise the first image in the note.
- Any properties you pick in the Bases **Properties** menu.

Grouping, sorting and filters all come from Bases.

### Tag board (Bases view)

One column per tag value under a prefix: with the prefix `type`, you get columns for `#type/note`, `#type/idea`, `#type/project`…

- **Drag a card to another column** to change its tag. Only real tags are edited (never text inside code), in the note body or in frontmatter `tags`.
- Notes without the tag get a "No type" column. Dragging a note out of it adds a `Type: #type/…` line at the top of the note (or adds the tag to an existing `Type:` line).
- **Column order** lists columns in the order you want. Listed columns always show, even when empty.

> Dragging edits your notes. Try it on a test note first.

### Side peek

Clicking a card opens the note in a panel beside the view, like Notion's side peek. The next card reuses that panel, and the open card is highlighted. **Cmd/Ctrl-click** opens a full tab instead. Turn it off per view with **Open notes in side peek**.

### "+ New" cards

Each group or column ends with a **+ New** card. It creates a note in the same folder as the cards around it (or the view's **New notes folder**), opens it in the side peek and focuses the title. On the board, the new note already has the column's tag.

### Comments

**Insert comment** adds a comment callout that is part of the note:

```markdown
> [!comment] Hannah · 2026-11-22
> This needs a source.
```

- With text selected, the text is highlighted (`==like this==`) and the comment goes below its paragraph.
- **Resolve / reopen comment** fades a comment out (`[!comment|resolved]`).
- Comments are skipped in card previews.
- Set your name under **Settings → Preview Gallery**.

### Open on startup

Set **Settings → Preview Gallery → Open on startup** to a base (e.g. `Gallery.base`) or note, and it opens when Obsidian starts, like a home page. If it's already open in a tab, that tab is focused instead.

### Embed base view

**Embed base view** lists every view in every `.base` file and inserts it as `![[File.base#View]]`, so a gallery or board shows inline in a note.

Tip: [Slash Commander](https://github.com/alephpiece/obsidian-slash-commander) can put these commands in the `/` menu.

## View options

| Option | Gallery | Board |
|---|---|---|
| Preview lines | ✓ | ✓ |
| Card width / Column width | ✓ | ✓ |
| Show cover image | ✓ | ✓ |
| Open notes in side peek | ✓ | ✓ |
| New notes folder | ✓ | ✓ |
| Columns from tag | | ✓ |
| Column order | | ✓ |

## Requirements

- Obsidian **1.10** or newer with the **Bases** core plugin enabled.
- Works on mobile, except dragging cards between board columns.

## Network use

The plugin sends no data anywhere and needs no account. Its only network use is cover images: if a note's cover is a web link (`https://…`), from its cover property or an image in the note, the card loads that image from the website hosting it. Turn off **Show cover image** to avoid this.

## Install

In Obsidian, open **Settings → Community plugins → Browse**, search for **Preview Gallery**, then install and enable it. Or start from its [directory page](https://community.obsidian.md/plugins/preview-gallery).

### Manual install

1. Download `main.js`, `manifest.json` and `styles.css` from the latest release.
2. Put them in `<your vault>/.obsidian/plugins/preview-gallery/`.
3. Reload Obsidian and enable **Preview Gallery** under **Settings → Community plugins**.

Or install with [BRAT](https://github.com/TfTHacker/obsidian42-brat) using this repo's URL.

## License

[MIT](LICENSE)
