const {
  Plugin, PluginSettingTab, Setting, BasesView, Keymap, Platform, moment, parseYaml,
  FuzzySuggestModal, Notice, getAllTags, parseFrontMatterTags,
} = require("obsidian");

const VIEW_TYPE = "preview-gallery";
const BOARD_TYPE = "tag-board";
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp"]);
const COVER_PROPS = ["cover", "image", "banner"];
const PREVIEW_CHARS = 700;
const DEFAULT_SETTINGS = { commentAuthor: "", startupFile: "" };
const COMMENT_HEADER = /^(>\s*\[!comment)(\|resolved)?(\][+-]?)/i;

// Turn raw markdown into a plain-text preview.
function toPreviewText(md) {
  return md
    .replace(/^---[ \t]*\r?\n(?:[\s\S]*?\n)??---[ \t]*(?:\r?\n|$)/, "") // frontmatter
    .replace(/%%[\s\S]*?%%/g, "")                      // obsidian comments
    .replace(/<!--[\s\S]*?-->/g, "")                   // html comments
    .replace(/^>[ \t]*\[!comment(\|[^\]]*)?\][^\n]*(\n>[^\n]*)*/gim, "") // comment callouts, open or resolved
    .replace(/```[\s\S]*?```/g, "")                    // code blocks
    .replace(/^\s*\$\$[\s\S]*?\$\$/gm, "")             // math blocks
    .replace(/!\[\[[^\]]*\]\]/g, "")                   // embeds
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")              // images
    .replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]|#]*)(?:#[^\]]*)?\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/^\s*>\s?(\[![^\]]*\][+-]?\s*)?/gm, "")   // quotes / callout headers
    .replace(/^\s*#{1,6}\s+/gm, "")                    // heading markers
    .replace(/^\s*([-*+]|\d+\.)\s+(\[.\]\s+)?/gm, "")  // list / task markers
    .replace(/^\s*([-*_]\s*){3,}$/gm, "")              // horizontal rules
    .replace(/^\|.*\|$/gm, "")                         // tables
    .replace(/(\*\*|__|==|~~|`)/g, "")
    .replace(/(^|\s)[*_](\S[^*_]*)[*_]/g, "$1$2")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// Drop what the card already shows: leading `Key: value` metadata lines
// and a first line that just repeats the note title.
function trimLead(text, title) {
  const lines = text.split("\n");
  while (lines.length && /^[A-Za-z][\w-]*::?\s/.test(lines[0])) lines.shift();
  if (lines.length && lines[0].trim().toLowerCase() === title.toLowerCase()) lines.shift();
  return lines.join("\n").slice(0, PREVIEW_CHARS);
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalizePrefix = (text) => String(text ?? "").trim().replace(/^#+/, "").replace(/\/+$/, "");
const tagLabel = (prefix) => {
  const last = prefix.split("/").pop() || prefix;
  return last.charAt(0).toUpperCase() + last.slice(1);
};

// Where the first `Label:` line of the note body sits, skipping frontmatter
// and fenced code. Returns the offset to insert a tag at (after the line's
// text, before trailing spaces), or null.
function findLabelLine(content, label) {
  const lines = content.split("\n");
  const labelRe = new RegExp(`^ {0,3}${escapeRegExp(label)}::?(?=\\s|$)`, "i");
  let first = 0;
  if (lines[0].trimEnd() === "---") {
    const close = lines.findIndex((line, i) => i > 0 && line.trimEnd() === "---");
    if (close > 0) first = close + 1;
  }
  let fence = null;
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i >= first) {
      if (fence) {
        const close = line.trim();
        if (close.length >= fence.length && close === fence[0].repeat(close.length)) fence = null;
      } else {
        const open = line.match(/^\s*(?:(?:[-*+]|\d+[.)])\s+)*(`{3,}(?=[^`]*$)|~{3,})/);
        if (open) fence = open[1];
        else if (labelRe.test(line)) return offset + line.trimEnd().length;
      }
    }
    offset += line.length + 1;
  }
  return null;
}

class PreviewGalleryView extends BasesView {
  type = VIEW_TYPE;

  constructor(controller, containerEl, plugin) {
    super(controller);
    this.plugin = plugin;
    this.hoverPopover = null;
    this.containerEl = containerEl.createDiv({ cls: "note-gallery" });
    this.renderId = 0;
    plugin.takeOverNewButton(this);
  }

  onDataUpdated() {
    const renderId = ++this.renderId;
    const root = this.containerEl;
    root.empty();

    const lines = this.config.get("previewLines") ?? 5;
    const width = this.config.get("cardWidth") ?? 260;
    const showCover = this.config.get("showCover") ?? true;
    root.setCssProps({ "--note-gallery-lines": String(lines), "--note-gallery-width": `${width}px` });

    const props = this.config.getOrder().filter((p) => p !== "file.name");

    for (const group of this.data.groupedData) {
      if (group.hasKey()) {
        const header = root.createDiv({ cls: "note-gallery-group" });
        header.setText(group.key.toString() || "—");
        header.createSpan({ cls: "note-gallery-count", text: String(group.entries.length) });
      }
      const grid = root.createDiv({ cls: "note-gallery-grid" });
      for (const entry of group.entries) {
        this.renderCard(grid, entry, props, showCover, renderId);
      }
      const newCard = grid.createDiv({ cls: "note-gallery-new", text: "+ New" });
      newCard.addEventListener("click", (evt) => this.createNote(group.entries, evt));
    }
  }

  // Notion-style side peek: open the note in a panel to the right of the
  // gallery and reuse that panel for each next card. Cmd-click opens a tab.
  async openNote(file, evt, openState = {}) {
    const mod = Keymap.isModEvent(evt);
    const peekOn = this.config.get("sidePeek") ?? true;
    if (mod || !peekOn || Platform.isMobile) {
      await this.app.workspace.getLeaf(mod || false).openFile(file, { active: true, ...openState });
      return;
    }

    let own = null;
    let peekAlive = false;
    const peek = this.plugin.peekLeaf;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!own && leaf.view?.containerEl?.contains(this.containerEl)) own = leaf;
      if (leaf === peek) peekAlive = true;
    });

    let target = peek;
    if (!peekAlive || !peek || peek === own) {
      target = own
        ? this.app.workspace.createLeafBySplit(own, "vertical")
        : this.app.workspace.getLeaf("split", "vertical");
      this.plugin.peekLeaf = target;
    }
    await target.openFile(file, { active: true, ...openState });
    this.plugin.peekPath = file.path;
    this.markPeeked();
  }

  markPeeked() {
    this.containerEl.querySelectorAll(".note-gallery-card").forEach((card) => {
      card.toggleClass("is-peeked", card.dataset.path === this.plugin.peekPath);
    });
  }

  async createNote(entries, evt, content = "") {
    const folder = this.folderForNewNote(entries);
    const prefix = folder.isRoot() ? "" : `${folder.path}/`;
    let name = "Untitled";
    for (let n = 1; this.app.vault.getAbstractFileByPath(`${prefix}${name}.md`); n++) name = `Untitled ${n}`;
    const file = await this.app.vault.create(`${prefix}${name}.md`, content);
    await this.openNote(file, evt, { state: { mode: "source" }, eState: { rename: "all" } });
  }

  // The view's "New notes folder" option, else the folder shared by the
  // cards in this group, else Obsidian's default location for new notes.
  folderForNewNote(entries) {
    const asFolder = (path) => {
      const f = path ? this.app.vault.getAbstractFileByPath(path.replace(/^\/+|\/+$/g, "")) : null;
      return f && f.children ? f : null;
    };
    const configured = asFolder(String(this.config.get("newNoteFolder") ?? "").trim());
    if (configured) return configured;

    let common = null;
    for (const entry of entries) {
      const parent = entry.file.parent;
      const parts = !parent || parent.isRoot() ? [] : parent.path.split("/");
      if (common === null) { common = parts; continue; }
      let i = 0;
      while (i < common.length && common[i] === parts[i]) i++;
      common = common.slice(0, i);
    }
    return asFolder((common ?? []).join("/"))
      ?? this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path ?? "");
  }

  renderCard(grid, entry, props, showCover, renderId) {
    const file = entry.file;
    const card = grid.createDiv({ cls: "note-gallery-card" });
    card.dataset.path = file.path;
    if (file.path === this.plugin.peekPath) card.addClass("is-peeked");
    card.addEventListener("click", (evt) => this.openNote(file, evt));

    const coverEl = showCover ? card.createDiv({ cls: "note-gallery-cover" }) : null;
    const body = card.createDiv({ cls: "note-gallery-body" });
    body.createDiv({ cls: "note-gallery-title", text: file.basename });
    const previewEl = body.createDiv({ cls: "note-gallery-preview" });

    if (props.length) {
      const meta = body.createDiv({ cls: "note-gallery-meta" });
      for (const prop of props) {
        let text = "";
        try {
          const value = entry.getValue(prop);
          text = value && value.isTruthy() ? value.toString() : "";
        } catch (e) { /* ignore unreadable values */ }
        if (!text) continue;
        const item = meta.createDiv({ cls: "note-gallery-prop" });
        item.createSpan({ cls: "note-gallery-prop-name", text: this.config.getDisplayName(prop) });
        item.createSpan({ cls: "note-gallery-prop-value", text });
      }
    }

    if (file.extension !== "md") {
      previewEl.setText(file.extension.toUpperCase());
      return card;
    }

    this.plugin.getPreview(file).then(({ text, cover }) => {
      if (renderId !== this.renderId) return;
      previewEl.setText(text);
      if (!coverEl) return;
      if (cover) {
        coverEl.createEl("img", { attr: { src: cover, loading: "lazy", alt: "" } });
      } else {
        coverEl.addClass("is-empty");
      }
    });
    return card;
  }
}

// Notion-style board: one column per tag under a prefix (e.g. #type/note,
// #type/idea). Dragging a card to another column rewrites that tag.
class TagBoardView extends PreviewGalleryView {
  type = BOARD_TYPE;

  onDataUpdated() {
    const renderId = ++this.renderId;
    const root = this.containerEl;
    root.empty();
    root.addClass("note-board");

    const prefix = normalizePrefix(this.config.get("tagPrefix") || "type");
    const lines = this.config.get("previewLines") ?? 3;
    const width = this.config.get("cardWidth") ?? 260;
    const showCover = this.config.get("showCover") ?? false;
    root.setCssProps({ "--note-gallery-lines": String(lines), "--note-gallery-width": `${width}px` });
    const props = this.config.getOrder().filter((p) => p !== "file.name");

    // Columns: every value of the tag in the vault, so you can drop into an
    // empty one. Keys are lowercase because Obsidian tags ignore case.
    const columns = this.plugin.collectTagValues(prefix);
    const buckets = new Map([...columns.keys()].map((key) => [key, []]));
    const untagged = [];
    for (const entry of this.data.data) {
      const value = this.plugin.groupValue(entry.file, prefix);
      if (!value) { untagged.push(entry); continue; }
      const key = value.toLowerCase();
      if (!buckets.has(key)) { buckets.set(key, []); columns.set(key, value); }
      buckets.get(key).push(entry);
    }

    // Columns named in "Column order" always show, even when empty.
    const order = [];
    for (const raw of String(this.config.get("columnOrder") ?? "").split(",")) {
      const value = raw.trim().replace(/^#?/, "").replace(new RegExp(`^${escapeRegExp(prefix)}/`, "i"), "");
      if (!value) continue;
      const key = value.toLowerCase();
      if (!buckets.has(key)) { buckets.set(key, []); columns.set(key, value); }
      order.push(key);
    }
    const rest = [...buckets.keys()].filter((k) => !order.includes(k)).sort();

    const label = tagLabel(prefix);
    if (untagged.length) this.renderColumn(root, null, `No ${label.toLowerCase()}`, untagged, prefix, props, showCover, renderId);
    for (const key of [...new Set(order), ...rest]) {
      this.renderColumn(root, columns.get(key), `#${prefix}/${columns.get(key)}`, buckets.get(key), prefix, props, showCover, renderId);
    }
  }

  renderColumn(root, value, title, entries, prefix, props, showCover, renderId) {
    const column = root.createDiv({ cls: "note-board-column" });
    const header = column.createDiv({ cls: "note-board-header" });
    header.createSpan({ cls: value ? "note-board-label" : "note-board-label is-empty", text: title });
    header.createSpan({ cls: "note-gallery-count", text: String(entries.length) });

    const list = column.createDiv({ cls: "note-board-cards" });
    for (const entry of entries) {
      const card = this.renderCard(list, entry, props, showCover, renderId);
      card.draggable = true;
      card.addEventListener("dragstart", (evt) => {
        evt.dataTransfer?.setData("text/plain", entry.file.path);
        this.dragging = { file: entry.file, from: value, card };
        card.addClass("is-dragging");
      });
      card.addEventListener("dragend", () => card.removeClass("is-dragging"));
    }

    const newCard = column.createDiv({ cls: "note-gallery-new", text: "+ New" });
    const content = value ? `${tagLabel(prefix)}: #${prefix}/${value}  \n` : "";
    newCard.addEventListener("click", (evt) => this.createNote(entries, evt, content));

    column.addEventListener("dragover", (evt) => {
      if (!this.dragging) return;
      evt.preventDefault();
      column.addClass("is-drop-target");
    });
    column.addEventListener("dragleave", (evt) => {
      if (!column.contains(evt.relatedTarget)) column.removeClass("is-drop-target");
    });
    column.addEventListener("drop", async (evt) => {
      evt.preventDefault();
      column.removeClass("is-drop-target");
      const drag = this.dragging;
      this.dragging = null;
      if (!drag || (drag.from ?? "").toLowerCase() === (value ?? "").toLowerCase()) return;
      list.appendChild(drag.card); // move right away; the base re-renders once the note is saved
      try {
        await this.plugin.setGroupTag(drag.file, prefix, drag.from, value);
      } catch (e) {
        console.error(e);
        new Notice(`Couldn't move "${drag.file.basename}": ${e.message}`);
        this.onDataUpdated();
      }
    });
  }
}

// Picker listing every view of every .base file in the vault.
class BaseViewModal extends FuzzySuggestModal {
  constructor(app, items, onChoose) {
    super(app);
    this.items = items;
    this.onChoose = onChoose;
    this.setPlaceholder("Pick a base view to embed…");
  }
  getItems() { return this.items; }
  getItemText(item) { return `${item.file.basename} › ${item.view}`; }
  onChooseItem(item) { this.onChoose(item); }
}

class PreviewGallerySettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("Your name in comments")
      .setDesc("Shown at the top of comments you insert. Leave empty to show only the date.")
      .addText((text) => text
        .setPlaceholder("Your name")
        .setValue(this.plugin.settings.commentAuthor)
        .onChange(async (value) => {
          this.plugin.settings.commentAuthor = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));
    new Setting(this.containerEl)
      .setName("Open on startup")
      .setDesc("A base or note to show when Obsidian starts, like a home page. Leave empty to keep your last open tabs.")
      .addText((text) => text
        .setPlaceholder("Gallery.base")
        .setValue(this.plugin.settings.startupFile)
        .onChange(async (value) => {
          this.plugin.settings.startupFile = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }));
  }
}

module.exports = class PreviewGalleryPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.patchedMenus = new Map(); // Bases "+ New" menu → its original open()
    this.menuOwners = new WeakMap(); // Bases "+ New" menu → our latest view on it
    this.addSettingTab(new PreviewGallerySettingTab(this.app, this));
    // Only on app start — not when the plugin is turned on mid-session.
    if (!this.app.workspace.layoutReady) this.app.workspace.onLayoutReady(() => this.openStartupFile());
    this.cache = new Map();

    this.registerBasesView(VIEW_TYPE, {
      name: "Preview gallery",
      icon: "layout-grid",
      factory: (controller, containerEl) => new PreviewGalleryView(controller, containerEl, this),
      options: () => [
        { type: "slider", key: "previewLines", displayName: "Preview lines", default: 5, min: 0, max: 15, step: 1 },
        { type: "slider", key: "cardWidth", displayName: "Card width", default: 260, min: 160, max: 480, step: 20 },
        { type: "toggle", key: "showCover", displayName: "Show cover image", default: true },
        { type: "toggle", key: "sidePeek", displayName: "Open notes in side peek", default: true },
        { type: "text", key: "newNoteFolder", displayName: "New notes folder", placeholder: "Auto (same folder as the cards)" },
      ],
    });

    this.registerBasesView(BOARD_TYPE, {
      name: "Tag board",
      icon: "square-kanban",
      factory: (controller, containerEl) => new TagBoardView(controller, containerEl, this),
      options: () => [
        { type: "text", key: "tagPrefix", displayName: "Columns from tag", default: "type", placeholder: "type  (uses #type/…)" },
        { type: "text", key: "columnOrder", displayName: "Column order", placeholder: "idea, note, project" },
        { type: "slider", key: "previewLines", displayName: "Preview lines", default: 3, min: 0, max: 15, step: 1 },
        { type: "slider", key: "cardWidth", displayName: "Column width", default: 260, min: 180, max: 420, step: 20 },
        { type: "toggle", key: "showCover", displayName: "Show cover image", default: false },
        { type: "toggle", key: "sidePeek", displayName: "Open notes in side peek", default: true },
        { type: "text", key: "newNoteFolder", displayName: "New notes folder", placeholder: "Auto (same folder as the cards)" },
      ],
    });

    this.addCommand({
      id: "insert-comment",
      name: "Insert comment",
      icon: "message-square",
      editorCallback: (editor) => this.insertComment(editor),
    });
    this.addCommand({
      id: "toggle-comment-resolved",
      name: "Resolve / reopen comment",
      icon: "check-circle",
      editorCallback: (editor) => this.toggleResolved(editor),
    });

    this.addCommand({
      id: "embed-base-view",
      name: "Embed base view",
      icon: "layout-grid",
      editorCallback: (editor, ctx) => this.embedBaseView(editor, ctx.file),
    });

    this.registerEvent(this.app.vault.on("delete", (file) => this.cache.delete(file.path)));
    this.registerEvent(this.app.vault.on("rename", (_file, oldPath) => this.cache.delete(oldPath)));
  }

  async openStartupFile() {
    const path = this.settings.startupFile.replace(/^\/+/, "");
    if (!path) return;
    const file = this.app.vault.getFileByPath(path)
      ?? this.app.metadataCache.getFirstLinkpathDest(path.replace(/\.md$/, ""), "");
    if (!file) {
      new Notice(`Open on startup: "${path}" not found.`);
      return;
    }
    let existing = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!existing && leaf.view?.file?.path === file.path) existing = leaf;
    });
    if (existing) {
      this.app.workspace.setActiveLeaf(existing, { focus: true });
      return;
    }
    await this.app.workspace.getLeaf(false).openFile(file, { active: true });
  }

  onunload() {
    for (const [menu, original] of this.patchedMenus) menu.open = original;
    this.patchedMenus.clear();
  }

  // The Bases toolbar "+ New" creates the note and shows it in a popover.
  // While one of our views is showing with side peek on, close that popover
  // and open the note in the side peek instead. This relies on Bases
  // internals, so if they change, the button keeps its normal behavior.
  takeOverNewButton(view) {
    const menu = view.queryController?.newItemMenu;
    if (!menu || typeof menu.open !== "function" || typeof menu.close !== "function") return;
    this.menuOwners.set(menu, view);
    if (this.patchedMenus.has(menu)) return;

    const plugin = this;
    const original = menu.open;
    this.patchedMenus.set(menu, original);
    menu.open = async function (...args) {
      const result = await original.apply(this, args);
      const owner = plugin.menuOwners.get(menu);
      const file = this.newlyCreatedFile;
      const peekOn = owner?.containerEl.isConnected && (owner.config.get("sidePeek") ?? true);
      if (file && peekOn && !Platform.isMobile) {
        this.close();
        await owner.openNote(file, null, { state: { mode: "source" }, eState: { rename: "all" } });
      }
      return result;
    };
  }

  // Highlights the selection (if any) and adds a comment callout below the
  // current paragraph; on an empty line, the comment goes right there.
  insertComment(editor) {
    const date = moment().format("YYYY-MM-DD");
    const author = this.settings.commentAuthor;
    const header = `> [!comment] ${author ? `${author} · ${date}` : date}`;
    const selection = editor.getSelection();
    if (selection && !selection.includes("\n")) editor.replaceSelection(`==${selection}==`);

    let line = editor.getCursor("to").line;
    if (!editor.getLine(line).trim()) {
      const before = line > 0 && editor.getLine(line - 1).trim() ? "\n" : "";
      const after = line + 1 < editor.lineCount() && editor.getLine(line + 1).trim() ? "\n" : "";
      editor.replaceRange(`${before}${header}\n> ${after}`, { line, ch: 0 }, { line, ch: editor.getLine(line).length });
      editor.setCursor({ line: line + (before ? 2 : 1), ch: 2 });
      return;
    }
    while (line + 1 < editor.lineCount() && editor.getLine(line + 1).trim()) line++;
    editor.replaceRange(`\n\n${header}\n> `, { line, ch: editor.getLine(line).length });
    editor.setCursor({ line: line + 3, ch: 2 });
  }

  async embedBaseView(editor, sourceFile) {
    const items = [];
    for (const file of this.app.vault.getFiles().filter((f) => f.extension === "base")) {
      let views = [];
      try {
        views = parseYaml(await this.app.vault.cachedRead(file))?.views ?? [];
      } catch (e) { /* skip unreadable bases */ }
      for (const view of views) if (view?.name) items.push({ file, view: String(view.name) });
    }
    if (!items.length) {
      new Notice("No base views found in this vault.");
      return;
    }
    new BaseViewModal(this.app, items, ({ file, view }) => {
      const link = this.app.metadataCache.fileToLinktext(file, sourceFile?.path ?? "");
      const embed = `![[${link}#${view}]]`;
      const cursor = editor.getCursor();
      const prefix = editor.getLine(cursor.line).trim() ? "\n" : "";
      editor.replaceRange(`${prefix}${embed}\n`, cursor);
      editor.setCursor({ line: cursor.line + (prefix ? 2 : 1), ch: 0 });
    }).open();
  }

  // Toggles `|resolved` on the comment callout the cursor is in.
  toggleResolved(editor) {
    let line = editor.getCursor().line;
    while (line > 0 && /^\s*>/.test(editor.getLine(line)) && !COMMENT_HEADER.test(editor.getLine(line))) line--;
    const text = editor.getLine(line);
    if (!COMMENT_HEADER.test(text)) return;
    const updated = text.replace(COMMENT_HEADER, (_m, start, resolved, end) => start + (resolved ? "" : "|resolved") + end);
    editor.replaceRange(updated, { line, ch: 0 }, { line, ch: text.length });
  }

  // Every value of `#prefix/<value>` in the vault: lowercase key → display form.
  collectTagValues(prefix) {
    const values = new Map();
    const lower = `#${prefix.toLowerCase()}/`;
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      for (const tag of (cache && getAllTags(cache)) ?? []) {
        if (!tag.toLowerCase().startsWith(lower)) continue;
        const value = tag.slice(lower.length).split("/")[0];
        if (value && !values.has(value.toLowerCase())) values.set(value.toLowerCase(), value);
      }
    }
    return values;
  }

  groupValue(file, prefix) {
    const cache = this.app.metadataCache.getFileCache(file);
    const lower = `#${prefix.toLowerCase()}/`;
    const tag = ((cache && getAllTags(cache)) ?? []).find((t) => t.toLowerCase().startsWith(lower) && t.length > lower.length);
    return tag ? tag.slice(lower.length).split("/")[0] : null;
  }

  // Moves a note from `#prefix/from` to `#prefix/to`. Either side may be null
  // (no tag yet / remove the tag). Only real tags are touched — Obsidian's
  // tag positions skip anything inside code.
  async setGroupTag(file, prefix, from, to) {
    const cache = this.app.metadataCache.getFileCache(file);
    const matcher = (value) => new RegExp(`^#?${escapeRegExp(prefix)}/${escapeRegExp(value)}(?=/|$)`, "i");
    const newTag = to ? `${prefix}/${to}` : null;

    if (from && (parseFrontMatterTags(cache?.frontmatter) ?? []).some((t) => matcher(from).test(t))) {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        for (const key of ["tags", "tag"]) {
          if (fm[key] == null) continue;
          const asList = Array.isArray(fm[key]) ? fm[key] : String(fm[key]).split(/[,\s]+/).filter(Boolean);
          const updated = asList
            .map((t) => (matcher(from).test(String(t)) ? (newTag ? String(t).replace(matcher(from), newTag) : null) : t))
            .filter((t) => t != null);
          fm[key] = updated;
        }
      });
      return;
    }

    const label = tagLabel(prefix);
    const emptyLabelRe = new RegExp(`^\\s*${escapeRegExp(label)}::?\\s*$`, "i");
    await this.app.vault.process(file, (content) => {
      if (from) {
        const hits = (cache?.tags ?? []).filter((t) => matcher(from).test(t.tag));
        if (!hits.length) throw new Error("tag not found, try again in a moment");
        for (const hit of [...hits].reverse()) {
          const { start, end } = hit.position;
          const original = content.slice(start.offset, end.offset);
          if (!matcher(from).test(original)) throw new Error("note changed, try again");
          const replacement = newTag ? original.replace(matcher(from), `#${newTag}`) : "";
          // When removing, also drop the space before the tag.
          const cut = !newTag && content[start.offset - 1] === " " ? start.offset - 1 : start.offset;
          content = content.slice(0, cut) + replacement + content.slice(end.offset);
          if (newTag) continue;
          // Drop the tag's own line if the removal left it as a bare `Type:`.
          const lineStart = content.lastIndexOf("\n", cut - 1) + 1;
          const nextBreak = content.indexOf("\n", cut);
          const lineEnd = nextBreak < 0 ? content.length : nextBreak + 1;
          if (emptyLabelRe.test(content.slice(lineStart, lineEnd))) {
            content = content.slice(0, lineStart) + content.slice(lineEnd);
          }
        }
        return content;
      }

      // No tag yet: add it to an existing `Type:` line, else add that line on top.
      const insertAt = findLabelLine(content, label);
      if (insertAt != null) return `${content.slice(0, insertAt)} #${newTag}${content.slice(insertAt)}`;
      const fmEnd = cache?.frontmatterPosition?.end.offset;
      const at = fmEnd != null ? content.indexOf("\n", fmEnd) + 1 || content.length : 0;
      return `${content.slice(0, at)}${label}: #${newTag}  \n${content.slice(at)}`;
    });
  }

  async getPreview(file) {
    const hit = this.cache.get(file.path);
    if (hit && hit.mtime === file.stat.mtime) return hit;

    const content = await this.app.vault.cachedRead(file);
    // Excalidraw drawings are stored as markdown; their text is only a warning banner.
    const isDrawing = this.app.metadataCache.getFileCache(file)?.frontmatter?.["excalidraw-plugin"] != null;
    const result = {
      mtime: file.stat.mtime,
      text: isDrawing ? "Excalidraw drawing" : trimLead(toPreviewText(content), file.basename),
      cover: this.findCover(file, content),
    };
    this.cache.set(file.path, result);
    return result;
  }

  // Cover = `cover`/`image`/`banner` property, else the first image in the note.
  findCover(file, content) {
    const fileCache = this.app.metadataCache.getFileCache(file);
    const fm = fileCache?.frontmatter ?? {};
    for (const key of COVER_PROPS) {
      const raw = fm[key];
      if (typeof raw === "string" && raw.trim()) {
        const resolved = this.resolveImage(raw.trim(), file);
        if (resolved) return resolved;
      }
    }

    const embed = (fileCache?.embeds ?? []).find((e) => {
      const dest = this.app.metadataCache.getFirstLinkpathDest(e.link.split("#")[0], file.path);
      return dest && IMAGE_EXT.has(dest.extension.toLowerCase());
    });
    if (embed) return this.resolveImage(embed.link, file);

    const external = content.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)/);
    return external ? external[1] : null;
  }

  resolveImage(link, file) {
    if (/^https?:\/\//.test(link)) return link;
    const path = link.replace(/^!?\[\[|\]\]$/g, "").split("|")[0].split("#")[0];
    const dest = this.app.metadataCache.getFirstLinkpathDest(path, file.path);
    if (!dest || !IMAGE_EXT.has(dest.extension.toLowerCase())) return null;
    return this.app.vault.getResourcePath(dest);
  }
};
