var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// local-typescript:C:\Users\Fabricio\Documents\PluginLivrosObsidian\plugin\src\main.ts
var main_exports = {};
__export(main_exports, {
  default: () => LibraryPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// local-typescript:C:\Users\Fabricio\Documents\PluginLivrosObsidian\plugin\src\model.ts
var ROOT = "Biblioteca";
var STATE = ROOT + "/_state";
var SNAPSHOT = STATE + "/catalogo.md";
var PROGRESS = STATE + "/progresso/";
var PERSONAL = STATE + "/livros/";
var DELETED = STATE + "/deleted/";
var NOTES = ROOT + "/Notas/";
var idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function endpoint(value) {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.href !== url.origin + "/") {
    throw new Error("Enter a private HTTPS origin without a path or credentials.");
  }
  return url.origin;
}
function validateBook(value, origin) {
  if (!value || typeof value !== "object") return false;
  const entry = value;
  return typeof entry.id === "string" && idPattern.test(entry.id) && typeof entry.title === "string" && typeof entry.category === "string" && (entry.author === void 0 || typeof entry.author === "string") && (entry.coverUrl === void 0 || entry.coverUrl === origin + "/api/v1/books/" + entry.id + "/cover") && (entry.pageCount === void 0 || Number.isSafeInteger(entry.pageCount) && entry.pageCount > 0) && Number.isSafeInteger(entry.sizeBytes) && entry.sizeBytes >= 0 && typeof entry.etag === "string" && typeof entry.lastModified === "string" && entry.format === "pdf" && (entry.availability === "available" || entry.availability === "missing") && entry.readUrl === origin + "/api/v1/books/" + entry.id + "/file" && new TextEncoder().encode(entry.readUrl).length <= 300;
}
function validBooks(value, origin) {
  return Array.isArray(value) && value.every((book) => validateBook(book, origin)) && new Set(value.map((book) => book.id)).size === value.length;
}
function validProgress(value) {
  if (!value || typeof value !== "object") return false;
  const entry = value;
  return typeof entry.id === "string" && idPattern.test(entry.id) && typeof entry.bookId === "string" && idPattern.test(entry.bookId) && typeof entry.deviceId === "string" && idPattern.test(entry.deviceId) && typeof entry.updatedAt === "string" && Number.isFinite(Date.parse(entry.updatedAt)) && typeof entry.completed === "boolean" && Number.isSafeInteger(entry.page) && entry.page > 0 && Array.isArray(entry.parents) && entry.parents.every((parent) => typeof parent === "string" && idPattern.test(parent) && parent !== entry.id);
}
function progressHeads(entries) {
  const superseded = new Set(entries.flatMap((entry) => entry.parents));
  return [...new Map(entries.map((entry) => [entry.id, entry])).values()].filter((entry) => !superseded.has(entry.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}
function hasConflict(heads) {
  return new Set(heads.map((entry) => entry.page + "/" + entry.completed)).size > 1;
}
function referencePath(id) {
  return ROOT + "/_refs/" + id + ".pdf";
}
function slug(title) {
  return title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "book";
}
function studyFolder(input) {
  const path = input.trim().replace(/\\/g, "/");
  if (!path || path.split("/").some((segment) => !segment || segment.startsWith(".") || /[<>:"|?*#[\]\x00-\x1f]/.test(segment) || /[. ]$/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)) || path.toLowerCase().startsWith((STATE + "/").toLowerCase()) || path.toLowerCase() === STATE.toLowerCase() || path.toLowerCase() === "biblioteca/_refs" || path.toLowerCase().startsWith("biblioteca/_refs/")) {
    throw new Error("Enter a valid vault-relative folder.");
  }
  return path;
}
function bookFileName(title) {
  const name = title.replace(/[<>:"/\\|?*#[\]\x00-\x1f]/g, " ").trim().slice(0, 90).replace(/^[. ]+|[. ]+$/g, "");
  return !name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? "Book " + slug(title) : name;
}

// local-typescript:C:\Users\Fabricio\Documents\PluginLivrosObsidian\plugin\src\remote.ts
var import_obsidian = require("obsidian");
async function checkServer(origin) {
  const response = await (0, import_obsidian.requestUrl)({ url: origin + "/health", throw: false });
  if (response.status !== 200 || typeof response.json?.version !== "string") {
    throw new Error("Unexpected server response (HTTP " + response.status + ").");
  }
  if (response.json.catalogReady !== true) {
    throw new Error("The server is reachable. The library is indexing or the disk is unavailable.");
  }
  const catalogVersion = response.json.catalogVersion;
  return typeof catalogVersion === "string" && catalogVersion ? catalogVersion : void 0;
}
async function fetchCatalog(origin) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const books = [];
    const cursors = /* @__PURE__ */ new Set();
    let version;
    let cursor = "";
    do {
      const response = await (0, import_obsidian.requestUrl)({
        url: origin + "/api/v1/books" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
        throw: false
      });
      if (response.status === 409) break;
      if (response.status !== 200) throw new Error("Catalog request failed (HTTP " + response.status + ").");
      const data = response.json;
      if (!data || typeof data.version !== "string" || typeof data.nextCursor !== "string" || version !== void 0 && version !== data.version || !validBooks(data.books, origin) || cursors.has(data.nextCursor)) {
        throw new Error("The server returned an incompatible catalog.");
      }
      version = data.version;
      books.push(...data.books);
      cursor = data.nextCursor;
      cursors.add(cursor);
      if (!cursor && version !== void 0 && validBooks(books, origin)) return { version, books };
    } while (cursor);
  }
  throw new Error("Could not fetch a consistent catalog version.");
}
async function checkPDF(url) {
  const response = await (0, import_obsidian.requestUrl)({ url, method: "HEAD", throw: false });
  if (response.status === 404) throw new Error("Book not found on the server.");
  if (response.status === 415) throw new Error("The file is incompatible with the PDF reader.");
  if (response.status === 401 || response.status === 403) throw new Error("PDF access is unavailable on this network.");
  if (response.status !== 200) throw new Error("PDF unavailable (HTTP " + response.status + ").");
  if (!Object.entries(response.headers).some(([name, value]) => name.toLowerCase() === "content-type" && value.toLowerCase().startsWith("application/pdf"))) {
    throw new Error("The server did not return a compatible PDF.");
  }
}

// local-typescript:C:\Users\Fabricio\Documents\PluginLivrosObsidian\plugin\src\storage.ts
var import_obsidian2 = require("obsidian");
var LibraryStorage = class {
  constructor(app) {
    this.app = app;
    __publicField(this, "pendingNotes", /* @__PURE__ */ new Map());
    __publicField(this, "pendingRefs", /* @__PURE__ */ new Map());
  }
  deletedBookIds() {
    return new Set(this.app.vault.getMarkdownFiles().filter((file) => file.path === DELETED + file.basename + ".md" && idPattern.test(file.basename)).map((file) => file.basename));
  }
  async deleteFromLibrary(book) {
    if (!idPattern.test(book.id)) throw new Error("Invalid book ID.");
    await this.ensureFolder(DELETED.slice(0, -1));
    const path = DELETED + book.id + ".md";
    if (this.app.vault.getAbstractFileByPath(path) instanceof import_obsidian2.TFile) return;
    try {
      await this.app.vault.create(path, "---\nbookId: " + book.id + "\n---\n");
    } catch (error) {
      if (!(this.app.vault.getAbstractFileByPath(path) instanceof import_obsidian2.TFile)) throw error;
    }
  }
  async ensureFolder(path) {
    if (!path || this.app.vault.getAbstractFileByPath(path) instanceof import_obsidian2.TFolder) return;
    await this.ensureFolder(path.slice(0, Math.max(0, path.lastIndexOf("/"))));
    try {
      await this.app.vault.createFolder(path);
    } catch (error) {
      if (!(this.app.vault.getAbstractFileByPath(path) instanceof import_obsidian2.TFolder)) throw error;
    }
  }
  async metadata(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian2.TFile)) return;
    const contents = await this.app.vault.read(file);
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(contents);
    if (match) return (0, import_obsidian2.parseYaml)(match[1]);
  }
  async snapshot() {
    const state = await this.metadata(SNAPSHOT);
    if (state?.schema !== 1 || typeof state.origin !== "string" || typeof state.version !== "string" || typeof state.catalog !== "string") return;
    const origin = endpoint(state.origin);
    const books = JSON.parse(state.catalog);
    if (validBooks(books, origin)) return { schema: 1, origin, version: state.version, books };
  }
  async saveSnapshot(state) {
    const contents = "---\nschema: 1\norigin: " + JSON.stringify(state.origin) + "\nversion: " + JSON.stringify(state.version) + "\ncatalog: " + JSON.stringify(JSON.stringify(state.books)) + "\n---\n";
    await this.ensureFolder(SNAPSHOT.slice(0, SNAPSHOT.lastIndexOf("/")));
    const existing = this.app.vault.getAbstractFileByPath(SNAPSHOT);
    if (existing instanceof import_obsidian2.TFile) {
      await this.app.vault.process(existing, (current) => current === contents ? current : contents);
    } else {
      try {
        await this.app.vault.create(SNAPSHOT, contents);
      } catch (error) {
        const synced = this.app.vault.getAbstractFileByPath(SNAPSHOT);
        if (!(synced instanceof import_obsidian2.TFile)) throw error;
      }
    }
  }
  personals() {
    const result = /* @__PURE__ */ new Map();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(PERSONAL)) continue;
      const data = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (data?.bookId !== file.basename) continue;
      result.set(file.basename, {
        customTitle: typeof data.customTitle === "string" ? data.customTitle : void 0,
        customCategory: typeof data.customCategory === "string" ? data.customCategory : void 0,
        folder: typeof data.folder === "string" ? data.folder : void 0,
        fileName: typeof data.fileName === "string" ? data.fileName : void 0,
        organized: data.organized === true,
        coverPage: Number.isSafeInteger(data.coverPage) && data.coverPage > 1 ? data.coverPage : void 0
      });
    }
    return result;
  }
  async savePersonal(book, values) {
    await this.ensureFolder(PERSONAL.slice(0, -1));
    const path = PERSONAL + book.id + ".md";
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      try {
        file = await this.app.vault.create(path, "---\nbookId: " + book.id + "\n---\n");
      } catch (error) {
        file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof import_obsidian2.TFile)) throw error;
      }
    }
    if (!(file instanceof import_obsidian2.TFile)) throw new Error("The metadata path is occupied.");
    await this.app.fileManager.processFrontMatter(file, (data) => {
      data.bookId = book.id;
      for (const [key, value] of Object.entries(values)) data[key] = value || null;
    });
  }
  progress() {
    const result = /* @__PURE__ */ new Map();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(PROGRESS)) continue;
      const data = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!validProgress(data) || file.path !== PROGRESS + data.bookId + "/" + data.id + ".md") continue;
      const entries = result.get(data.bookId) ?? [];
      entries.push(data);
      result.set(data.bookId, entries);
    }
    return result;
  }
  async saveProgress(entry) {
    const folder = PROGRESS + entry.bookId;
    await this.ensureFolder(folder);
    const fields = Object.entries({ schema: 1, ...entry });
    await this.app.vault.create(
      folder + "/" + entry.id + ".md",
      "---\n" + fields.map(([key, value]) => key + ": " + JSON.stringify(value)).join("\n") + "\n---\n"
    );
  }
  ensureReference(book, path = referencePath(book.id)) {
    const pending = this.pendingRefs.get(path);
    if (pending) return pending;
    const task = this.writeReference(book, path).finally(() => this.pendingRefs.delete(path));
    this.pendingRefs.set(path, task);
    return task;
  }
  async writeReference(book, path) {
    await this.ensureFolder(path.slice(0, path.lastIndexOf("/")));
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      try {
        return await this.app.vault.createBinary(path, new TextEncoder().encode(book.readUrl).buffer);
      } catch (error) {
        file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof import_obsidian2.TFile)) throw error;
      }
    }
    if (!(file instanceof import_obsidian2.TFile) || file.stat.size > 300) {
      throw new Error("Another file occupies the reference path.");
    }
    const old = new TextDecoder().decode(await this.app.vault.readBinary(file));
    if (old !== book.readUrl) {
      let oldOrigin;
      try {
        oldOrigin = new URL(old).origin;
      } catch {
        throw new Error("The existing file is not a library reference.");
      }
      if (old !== oldOrigin + "/api/v1/books/" + book.id + "/file" || !old.startsWith("https://")) {
        throw new Error("The existing file is not a library reference.");
      }
      await this.app.vault.modifyBinary(file, new TextEncoder().encode(book.readUrl).buffer);
    }
    return file;
  }
  note(book, root) {
    const pending = this.pendingNotes.get(book.id);
    if (pending) return pending;
    const task = this.findOrCreateNote(book, root).finally(() => this.pendingNotes.delete(book.id));
    this.pendingNotes.set(book.id, task);
    return task;
  }
  findNote(book) {
    const files = this.app.vault.getMarkdownFiles().filter((file) => !file.path.startsWith("Biblioteca/_state/"));
    return files.find((file) => {
      const data = this.app.metadataCache.getFileCache(file)?.frontmatter;
      return this.isBookRecord(data, book) || data?.bookId === book.id && data?.refPath === referencePath(book.id);
    }) ?? files.find((file) => file.path.startsWith(NOTES) && file.basename.endsWith("-" + book.id));
  }
  isBookRecord(data, book) {
    return (typeof data?.Title === "string" || typeof data?.Livro === "string") && typeof data?.PDF === "string" && data.PDF.startsWith("[[" + referencePath(book.id) + "|");
  }
  pdfLink(book) {
    return "[[" + referencePath(book.id) + "|Open book]]";
  }
  folderReference(values) {
    const { folder, fileName } = values ?? {};
    if (!folder || !fileName || bookFileName(fileName) !== fileName) return;
    try {
      return studyFolder(folder) + (values?.organized ? "/Files/" : "/") + fileName + ".pdf";
    } catch {
      return;
    }
  }
  async linkFolder(book, input) {
    const folder = studyFolder(input);
    await this.ensureReference(book);
    const values = this.personals().get(book.id);
    let fileName = values?.fileName ?? bookFileName(values?.customTitle ?? book.title);
    const previousReference = this.folderReference(values);
    const files = folder + "/Files";
    const notes = folder + "/Notes";
    const existing = this.findNote(book) ?? await this.noteAt(notes + "/" + fileName + ".md", book) ?? (values?.folder ? await this.noteAt(values.folder + "/" + fileName + ".md", book) : void 0);
    await this.ensureFolder(folder);
    const occupied = this.app.vault.getAbstractFileByPath(files + "/" + fileName + ".pdf");
    const alreadyLinked = occupied instanceof import_obsidian2.TFile && occupied.stat.size <= 300 && new TextDecoder().decode(await this.app.vault.readBinary(occupied)) === book.readUrl;
    if (occupied && !alreadyLinked && this.folderReference(values) !== occupied.path) {
      fileName = bookFileName(fileName.slice(0, 72) + " (" + book.id.slice(0, 8) + ")");
    }
    const targetReference = files + "/" + fileName + ".pdf";
    await this.ensureFolder(notes);
    if (existing && existing.path !== notes + "/" + existing.name) {
      let target = notes + "/" + existing.name;
      if (this.app.vault.getAbstractFileByPath(target)) target = notes + "/" + fileName + " - Book record.md";
      if (this.app.vault.getAbstractFileByPath(target)) throw new Error("A note with that name already exists in the folder.");
      await this.app.fileManager.renameFile(existing, target);
    }
    const old = previousReference ? this.app.vault.getAbstractFileByPath(previousReference) : void 0;
    if (values?.folder === folder && !values.organized && old instanceof import_obsidian2.TFile && old.stat.size <= 300 && !this.app.vault.getAbstractFileByPath(targetReference) && new TextDecoder().decode(await this.app.vault.readBinary(old)) === book.readUrl) {
      await this.ensureFolder(files);
      await this.app.fileManager.renameFile(old, targetReference);
    }
    await this.ensureReference(book, targetReference);
    const note = existing ?? await this.createNote(book, notes, fileName);
    await this.savePersonal(book, { folder, fileName, organized: true });
    return note;
  }
  async noteAt(path, book) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof import_obsidian2.TFile && this.isBookRecord(await this.metadata(path), book)) return file;
  }
  async findOrCreateNote(book, root) {
    await this.ensureReference(book);
    const existing = this.findNote(book);
    const values = this.personals().get(book.id);
    const linked = this.folderReference(values);
    if (linked) await this.ensureReference(book, linked);
    if (existing) return existing;
    if (values?.folder && linked) return this.createNote(book, values.folder + (values.organized ? "/Notes" : ""), values.fileName);
    const fileName = bookFileName(values?.customTitle ?? book.title);
    const folder = studyFolder(root) + "/" + fileName + " (" + book.id.slice(0, 8) + ")";
    return this.linkFolder(book, folder);
  }
  async createNote(book, folder, fileName) {
    await this.ensureFolder(folder);
    let path = folder + "/" + fileName + ".md";
    const link = this.pdfLink(book);
    if (this.app.vault.getAbstractFileByPath(path)) {
      const current = await this.noteAt(path, book);
      if (current) return current;
      path = folder + "/" + fileName + " - Book record (" + book.id.slice(0, 8) + ").md";
    }
    const fields = { Title: book.title, Author: book.author ?? null, Category: book.category, Status: "Not started", PDF: link };
    const header = Object.entries(fields).map(([key, value]) => key + ": " + JSON.stringify(value)).join("\n");
    try {
      return await this.app.vault.create(path, "---\n" + header + "\n---\n");
    } catch (error) {
      const synced = await this.noteAt(path, book);
      if (synced) return synced;
      throw error;
    }
  }
  async createStudyNote(book, ficha, title, templatePath) {
    const requested = title.trim().replace(/\.md$/i, "").trim();
    if (!requested || !ficha.parent) throw new Error("Enter a note title.");
    const name = bookFileName(requested);
    const template = templatePath ? this.app.vault.getAbstractFileByPath(templatePath) : void 0;
    if (templatePath && !(template instanceof import_obsidian2.TFile)) throw new Error("The study note template was not found in the vault.");
    const body = template instanceof import_obsidian2.TFile ? await this.app.vault.read(template) : "# " + name + "\n";
    const notes = ficha.parent.name === "Notes" ? ficha.parent.path : ficha.parent.isRoot() ? "Notes" : ficha.parent.path + "/Notes";
    await this.ensureFolder(notes);
    const directory = notes + "/";
    const link = this.app.fileManager.generateMarkdownLink(ficha, directory + name + ".md", void 0, "Book record");
    const path = directory + name + ".md";
    if (this.app.vault.getAbstractFileByPath(path)) throw new Error("A note with that name already exists in the folder.");
    return this.app.vault.create(path, body.trimEnd() + "\n\n" + link + " \xB7 " + this.pdfLink(book) + "\n");
  }
};

// local-typescript:C:\Users\Fabricio\Documents\PluginLivrosObsidian\plugin\src\view.ts
var import_obsidian3 = require("obsidian");
var VIEW = "obsidian-library";
var PAGE_SIZE = 10;
var collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
var normalize = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en");
var LibraryView = class extends import_obsidian3.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    __publicField(this, "query", "");
    __publicField(this, "category", "");
    __publicField(this, "status", "");
    __publicField(this, "page", 1);
    __publicField(this, "isRenderingEnabled", false);
    __publicField(this, "body");
    __publicField(this, "message");
    __publicField(this, "categories");
    __publicField(this, "refreshButton");
    __publicField(this, "connectionButton");
    __publicField(this, "personals", /* @__PURE__ */ new Map());
    __publicField(this, "heads", /* @__PURE__ */ new Map());
    __publicField(this, "books", []);
  }
  getViewType() {
    return VIEW;
  }
  getDisplayText() {
    return "Library";
  }
  getIcon() {
    return "library";
  }
  async onOpen() {
    await this.mountLibrary();
  }
  async mountLibrary() {
    if (this.isRenderingEnabled) return;
    const root = this.contentEl;
    root.empty();
    root.addClass("ol-library");
    const bar = root.createDiv("ol-toolbar");
    bar.createEl("h2", { text: "Library" });
    this.refreshButton = this.button(bar, "Refresh", () => this.plugin.refresh());
    this.connectionButton = this.button(bar, "", () => this.configure());
    this.connectionButton.addClass("ol-connection");
    this.message = root.createDiv({ cls: "ol-message", attr: { role: "status" } });
    const filters = root.createDiv("ol-toolbar ol-filters");
    const search = filters.createEl("input", {
      type: "search",
      placeholder: "Search by title or author",
      attr: { "aria-label": "Search by title or author" }
    });
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value;
      this.reset();
    });
    const statuses = filters.createEl("select", { attr: { "aria-label": "Reading status" } });
    for (const [value, text] of [["", "All statuses"], ["reading", "Reading"], ["new", "Not started"], ["done", "Completed"]]) {
      statuses.createEl("option", { value, text });
    }
    statuses.value = this.status;
    statuses.addEventListener("change", () => {
      this.status = statuses.value;
      this.reset();
    });
    this.categories = filters.createEl("select", { attr: { "aria-label": "Category" } });
    this.categories.addEventListener("change", () => {
      this.category = this.categories.value;
      this.reset();
    });
    this.body = root.createDiv();
    this.isRenderingEnabled = true;
    await this.render();
  }
  async onClose() {
    this.isRenderingEnabled = false;
  }
  async render() {
    if (!this.isRenderingEnabled) return;
    this.personals = this.plugin.storage.personals();
    this.heads = new Map([...this.plugin.storage.progress()].map(([id, entries]) => [id, progressHeads(entries)]));
    const deleted = this.plugin.storage.deletedBookIds();
    this.books = this.plugin.books.filter((book) => !deleted.has(book.id));
    const categories = [...new Set(this.books.map((book) => this.categoryFor(book)))].sort(collator.compare);
    this.categories.empty();
    this.categories.createEl("option", { value: "", text: "All categories" });
    for (const category of categories) this.categories.createEl("option", { value: category, text: category });
    if (this.category && !categories.includes(this.category)) this.category = "";
    this.categories.value = this.category;
    this.refreshButton.disabled = this.plugin.busy || !this.plugin.origin;
    const connection = this.plugin.connected ? "Connected to server" : "Disconnected from server";
    this.connectionButton.dataset.connected = String(this.plugin.connected === true);
    this.connectionButton.title = connection + " \xB7 Server settings";
    this.connectionButton.setAttribute("aria-label", this.connectionButton.title);
    this.message.setText([
      this.plugin.busy ? "Refreshing catalog\u2026" : "",
      this.plugin.error,
      !this.plugin.origin ? "Connect to your Raspberry Pi library or browse the synced catalog." : "",
      this.plugin.pdfPlusStatus() === "disabled" ? "Enable PDF++ to open external references." : ""
    ].filter(Boolean).join(" "));
    if (this.plugin.pdfPlusStatus() === "disabled") this.message.createEl("a", {
      text: " PDF++ instructions",
      href: "https://ryotaushio.github.io/obsidian-pdf-plus/external-pdf-files.html",
      attr: { target: "_blank", rel: "noopener noreferrer" }
    });
    this.draw();
  }
  reset() {
    this.page = 1;
    this.draw();
  }
  title(book) {
    return this.personals.get(book.id)?.customTitle || book.title;
  }
  categoryFor(book) {
    return this.personals.get(book.id)?.customCategory || book.category;
  }
  current(book) {
    const heads = this.heads.get(book.id) ?? [];
    return hasConflict(heads) ? void 0 : heads[0];
  }
  draw() {
    this.body.empty();
    const books = this.books;
    if (!books.length) {
      if (!this.plugin.busy) this.body.createEl("p", { text: "No books in the catalog." });
      return;
    }
    const query = normalize(this.query.trim());
    const filtered = books.filter((book) => {
      if (this.category && this.category !== this.categoryFor(book)) return false;
      const current = this.current(book);
      const status = current?.completed ? "done" : this.heads.has(book.id) ? "reading" : "new";
      return (!this.status || this.status === status) && normalize(this.title(book) + " " + (book.author ?? "")).includes(query);
    }).sort((a, b) => collator.compare(this.title(a), this.title(b)));
    this.body.createEl("h3", { text: "Books (" + filtered.length + ")" });
    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    this.page = Math.min(this.page, pageCount);
    if (!filtered.length) this.body.createEl("p", { text: "No books match your filters." });
    const grid = this.body.createDiv("ol-grid");
    const start = (this.page - 1) * PAGE_SIZE;
    for (const book of filtered.slice(start, start + PAGE_SIZE)) this.card(grid, book);
    if (pageCount < 2) return;
    const navigation = this.body.createEl("nav", { cls: "ol-toolbar", attr: { "aria-label": "Library pages" } });
    const move = (offset) => {
      this.page += offset;
      this.draw();
      this.body.querySelector(".ol-card-open")?.focus();
    };
    this.button(navigation, "Previous", () => move(-1)).disabled = this.page === 1;
    navigation.createEl("span", { text: "Page " + this.page + " of " + pageCount });
    this.button(navigation, "Next", () => move(1)).disabled = this.page === pageCount;
  }
  card(grid, book) {
    const title = this.title(book);
    const card = grid.createEl("article", { cls: "ol-card" });
    const open = this.button(card, "", () => this.continue(book));
    open.addClass("ol-card-open");
    open.title = title;
    this.renderCover(open, book);
    const progress = this.current(book);
    const heads = this.heads.get(book.id) ?? [];
    const conflict = hasConflict(heads);
    open.createEl("span", { text: title, cls: "ol-card-title" });
    const percent = conflict ? void 0 : progress?.completed ? 100 : book.pageCount ? Math.min(100, Math.round((progress?.page ?? 0) / book.pageCount * 100)) : void 0;
    const status = book.availability === "missing" ? "Unavailable" : conflict ? "Conflicting reading progress" : progress?.completed ? "Completed" : progress ? "Page " + progress.page : "";
    const label = [status, percent === void 0 ? "" : percent + "%"].filter(Boolean).join(" \xB7 ");
    if (label) card.createDiv("ol-card-labels").createEl("span", { text: label, cls: "ol-book-status" });
    const actions = card.createDiv("ol-toolbar ol-card-actions");
    this.button(actions, "New note", () => this.studyNoteDialog(book));
    const menu = actions.createEl("button", { text: "\u22EF", cls: "ol-card-menu", attr: { "aria-label": "Options for " + title } });
    menu.addEventListener("click", () => {
      const options = new import_obsidian3.Menu();
      const add = (label2, action) => options.addItem((item) => item.setTitle(label2).onClick(() => void this.plugin.run(async () => action())));
      add(conflict ? "Resolve reading progress\u2026" : "Confirm page\u2026", () => this.showBookProgress(book));
      if (book.availability === "available" && progress && progress.page > 1) {
        add("Open at first page", () => this.plugin.openBook(book));
      }
      add("Copy PDF link", () => this.plugin.copyLink(book));
      options.addSeparator();
      add("Link folder\u2026", () => this.folderDialog(book));
      if (book.availability === "available" && (book.pageCount ?? 0) > 1) {
        add("Change cover\u2026", () => this.coverDialog(book));
      }
      add("View details\u2026", () => this.showBookDetails(book));
      options.addSeparator();
      add("Delete from library\u2026", () => this.deleteDialog(book));
      const position = menu.getBoundingClientRect();
      options.showAtPosition({ x: position.left, y: position.bottom });
    });
  }
  deleteDialog(book) {
    const modal = new import_obsidian3.Modal(this.app);
    modal.setTitle("Delete from library?");
    modal.contentEl.createEl("p", {
      text: "Remove \u201C" + this.title(book) + "\u201D from your library on synced devices. The server PDF, notes, and reading progress are kept."
    });
    new import_obsidian3.Setting(modal.contentEl).addButton((button) => button.setButtonText("Cancel").onClick(() => modal.close())).addButton((button) => button.setButtonText("Delete from library").setWarning().onClick(async () => {
      button.setDisabled(true);
      await this.plugin.run(async () => {
        await this.plugin.deleteFromLibrary(book);
        modal.close();
      });
      button.setDisabled(false);
    }));
    modal.open();
  }
  renderCover(parent, book) {
    const cover = parent.createEl("span", { cls: "ol-cover", attr: { "aria-hidden": "true" } });
    const words = this.title(book).match(/[\p{L}\p{N}]+/gu) ?? [];
    const placeholder = words.slice(0, 3).map((word) => Array.from(word)[0]).join("").toUpperCase();
    cover.setText(placeholder || "PDF");
    const page = this.personals.get(book.id)?.coverPage;
    const selectedPage = page && book.pageCount && page <= book.pageCount ? page : void 0;
    const src = selectedPage ? book.readUrl.replace(/\/file$/, "/cover?page=" + selectedPage) : book.coverUrl;
    if (!src) return;
    const image = cover.createEl("img", { attr: { loading: "lazy", alt: "", src } });
    image.addEventListener("error", () => {
      if (selectedPage && book.coverUrl && image.getAttribute("src") !== book.coverUrl) image.src = book.coverUrl;
      else image.remove();
    });
  }
  async continue(book) {
    if (hasConflict(this.heads.get(book.id) ?? [])) this.showBookProgress(book);
    else await this.plugin.openBook(book, this.current(book)?.page);
  }
  button(parent, text, action) {
    const button = parent.createEl("button", { text });
    button.addEventListener("click", () => void this.plugin.run(async () => action()));
    return button;
  }
  configure() {
    const modal = new import_obsidian3.Modal(this.app);
    modal.setTitle("Library server");
    renderServerSettings(modal.contentEl, this.plugin, () => modal.close());
    modal.open();
  }
  folderDialog(book) {
    const modal = new import_obsidian3.Modal(this.app);
    modal.setTitle("Book study folder");
    let path = this.personals.get(book.id)?.folder ?? "";
    new import_obsidian3.Setting(modal.contentEl).setName("Vault folder").setDesc("Creates Files for the PDF reference and Notes for the book record and new study notes.").addText((text) => text.setValue(path).setPlaceholder("Studies/Software Engineering/Book").onChange((value) => {
      path = value;
    }));
    new import_obsidian3.Setting(modal.contentEl).addButton((button) => button.setButtonText("Link folder").setCta().onClick(async () => {
      button.setDisabled(true);
      await this.plugin.run(async () => {
        await this.plugin.linkFolder(book, path);
        modal.close();
      });
      button.setDisabled(false);
    }));
    modal.open();
  }
  coverDialog(book) {
    const modal = new import_obsidian3.Modal(this.app);
    modal.setTitle("Cover page");
    let value = String(this.personals.get(book.id)?.coverPage ?? 1);
    new import_obsidian3.Setting(modal.contentEl).setName("PDF page").setDesc("Use 1 to return to the first page. A custom cover image on the server takes priority.").addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "1";
      text.inputEl.max = String(book.pageCount);
      text.setValue(value).onChange((next) => {
        value = next;
      });
    });
    new import_obsidian3.Setting(modal.contentEl).addButton((button) => button.setButtonText("Save cover").setCta().onClick(async () => {
      button.setDisabled(true);
      await this.plugin.run(async () => {
        const coverPage = Number(value);
        if (!Number.isSafeInteger(coverPage) || coverPage < 1 || coverPage > (book.pageCount ?? 0)) {
          throw new Error("Enter a page between 1 and " + book.pageCount + ".");
        }
        await this.plugin.personalize(book, { coverPage: coverPage > 1 ? coverPage : void 0 });
        modal.close();
      });
      button.setDisabled(false);
    }));
    modal.open();
  }
  studyNoteDialog(book) {
    const modal = new import_obsidian3.Modal(this.app);
    modal.setTitle("New note");
    let name = "";
    const canSplit = !import_obsidian3.Platform.isMobile && book.availability === "available";
    let field;
    const create = async () => {
      if (field.disabled) return;
      field.disabled = true;
      await this.plugin.run(async () => {
        await this.plugin.createStudyNote(book, name, this.current(book)?.page);
        modal.close();
      });
      field.disabled = false;
    };
    new import_obsidian3.Setting(modal.contentEl).setName("Filename").addText((text) => {
      field = text.inputEl;
      text.setPlaceholder("Chapter 1").onChange((value) => {
        name = value;
      });
      field.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.isComposing) return;
        event.preventDefault();
        void create();
      });
    });
    new import_obsidian3.Setting(modal.contentEl).addButton((button) => button.setButtonText(canSplit ? "Create and study" : "Create note").setCta().onClick(create));
    modal.open();
    field.focus();
  }
  showBookProgress(book) {
    const modal = new import_obsidian3.Modal(this.app);
    modal.setTitle("Reading progress for " + this.title(book));
    const heads = progressHeads(this.plugin.storage.progress().get(book.id) ?? []);
    const conflict = hasConflict(heads);
    if (conflict) {
      modal.contentEl.createEl("p", { text: "Choose which reading update to keep." });
      for (const head of heads) {
        const date = new Date(head.updatedAt).toLocaleString("en");
        this.button(modal.contentEl, "Page " + head.page + (head.completed ? " \xB7 Completed" : "") + " \xB7 " + head.deviceId.slice(0, 8) + " \xB7 " + date, async () => {
          await this.plugin.record(book, head.page, head.completed, heads);
          modal.close();
        });
      }
    } else {
      const current = heads[0];
      let value = String(current?.page ?? 1);
      let complete = current?.completed ?? false;
      if (current) modal.contentEl.createEl("p", {
        text: "Last confirmed on " + new Date(current.updatedAt).toLocaleString("en")
      });
      new import_obsidian3.Setting(modal.contentEl).setName("Last confirmed page").addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.setValue(value).onChange((next) => {
          value = next;
        });
      });
      new import_obsidian3.Setting(modal.contentEl).setName("Completed").addToggle((toggle) => toggle.setValue(complete).onChange((next) => {
        complete = next;
      }));
      new import_obsidian3.Setting(modal.contentEl).addButton((button) => button.setButtonText("Save progress").setCta().onClick(async () => {
        button.setDisabled(true);
        await this.plugin.run(async () => {
          await this.plugin.record(book, Number(value), complete, heads);
          modal.close();
        });
        button.setDisabled(false);
      }));
    }
    modal.open();
  }
  showBookDetails(book) {
    const modal = new import_obsidian3.Modal(this.app);
    modal.setTitle(this.title(book));
    const content = modal.contentEl;
    content.addClass("ol-book-details");
    const hero = content.createDiv("ol-detail-hero");
    this.renderCover(hero, book);
    const personal = this.personals.get(book.id);
    const heads = progressHeads(this.plugin.storage.progress().get(book.id) ?? []);
    const progress = heads[0];
    const reading = hasConflict(heads) ? "Conflicting reading updates" : progress?.completed ? "Completed" : progress ? "Page " + progress.page : "Not started";
    const details = [
      ["Author", book.author || "Unknown"],
      ["Category", this.categoryFor(book)],
      ["Format and size", "PDF \xB7 " + (book.sizeBytes / 1048576).toLocaleString("en", { maximumFractionDigits: 2 }) + " MiB"],
      ["Pages", book.pageCount?.toLocaleString("en") ?? "Unknown"],
      ["Availability", book.availability === "available" ? "Available on Raspberry Pi" : "File unavailable"],
      ["Progress", reading],
      ["Last updated", progress && new Date(progress.updatedAt).toLocaleString("en")],
      ["Study folder", personal?.folder ?? "Not linked yet"]
    ];
    const list = hero.createEl("dl", { cls: "ol-detail-grid" });
    for (const [label, value] of details) {
      if (!value) continue;
      const item = list.createDiv({ cls: "ol-detail-item" });
      item.createEl("dt", { text: label });
      item.createEl("dd", { text: value });
    }
    const edit = content.createEl("details", { cls: "ol-detail-edit" });
    edit.createEl("summary", { text: "Edit title and category" });
    let title = personal?.customTitle ?? "";
    let category = personal?.customCategory ?? "";
    new import_obsidian3.Setting(edit).setName("Custom title").addText((text) => text.setPlaceholder(book.title).setValue(title).onChange((value) => {
      title = value;
    }));
    new import_obsidian3.Setting(edit).setName("Custom category").addText((text) => text.setPlaceholder(book.category).setValue(category).onChange((value) => {
      category = value;
    }));
    new import_obsidian3.Setting(edit).addButton((button) => button.setButtonText("Save changes").onClick(() => this.plugin.run(async () => {
      await this.plugin.personalize(book, { customTitle: title.trim(), customCategory: category.trim() });
      modal.close();
    })));
    modal.open();
  }
};
function renderServerSettings(container, plugin, onSuccess) {
  let value = plugin.origin;
  new import_obsidian3.Setting(container).setName("Private HTTPS origin").addText((text) => text.setValue(value).setPlaceholder("https://pi.example.ts.net").onChange((next) => {
    value = next;
  }));
  const status = container.createDiv({ attr: { role: "status" } });
  new import_obsidian3.Setting(container).addButton((button) => button.setButtonText("Test and connect").setCta().onClick(async () => {
    button.setDisabled(true);
    status.setText("Testing connection\u2026");
    try {
      await plugin.connect(value);
      status.setText(plugin.error || (plugin.connected ? "Connected to server" : "Disconnected from server"));
      if (!plugin.error) onSuccess?.();
    } catch (error) {
      status.setText(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      button.setDisabled(false);
    }
  }));
  if (!onSuccess) {
    let root = plugin.studyRoot;
    let template = plugin.studyTemplate;
    new import_obsidian3.Setting(container).setName("Default study folder").addText((text) => text.setValue(root).onChange((next) => {
      root = next;
    }));
    new import_obsidian3.Setting(container).setName("Study note template").addText((text) => text.setValue(template).setPlaceholder("Studies/Templates/Study Note.md").onChange((next) => {
      template = next;
    }));
    new import_obsidian3.Setting(container).addButton((button) => button.setButtonText("Save preferences").onClick(() => plugin.run(async () => {
      plugin.studyRoot = studyFolder(root);
      plugin.studyTemplate = template.trim();
      await plugin.saveSettings();
      status.setText("Preferences saved.");
    })));
  }
}

// local-typescript:C:\Users\Fabricio\Documents\PluginLivrosObsidian\plugin\src\main.ts
var LibraryPlugin = class extends import_obsidian4.Plugin {
  constructor() {
    super(...arguments);
    __publicField(this, "storage");
    __publicField(this, "origin", "");
    __publicField(this, "studyRoot", NOTES.slice(0, -1));
    __publicField(this, "studyTemplate", "");
    __publicField(this, "books", []);
    __publicField(this, "connected", false);
    __publicField(this, "error", "");
    __publicField(this, "busy", false);
    __publicField(this, "deviceId", "");
    __publicField(this, "stopped", false);
    __publicField(this, "refreshTask");
    __publicField(this, "catalogIdentity");
    __publicField(this, "snapshotSaved", false);
    __publicField(this, "reloadTimer");
    __publicField(this, "snapshotDirty", false);
    __publicField(this, "referencesDirty", false);
    __publicField(this, "generatingReferences", false);
    __publicField(this, "pageSample");
    __publicField(this, "savingViewerPage", false);
  }
  async onload() {
    this.storage = new LibraryStorage(this.app);
    const settings = await this.loadData();
    if (typeof settings?.studyRoot === "string") this.studyRoot = settings.studyRoot;
    if (typeof settings?.studyTemplate === "string") this.studyTemplate = settings.studyTemplate;
    if (typeof settings?.origin === "string") {
      try {
        this.origin = endpoint(settings.origin);
      } catch {
        this.origin = "";
      }
    }
    const key = "obsidian-library-device-id";
    const stored = this.app.loadLocalStorage(key);
    this.deviceId = typeof stored === "string" && idPattern.test(stored) ? stored : crypto.randomUUID();
    this.app.saveLocalStorage(key, this.deviceId);
    this.registerView(VIEW, (leaf) => new LibraryView(leaf, this));
    this.addRibbonIcon("library", "Open library", () => void this.run(() => this.openLibrary()));
    this.addCommand({ id: "open-library", name: "Open library", callback: () => void this.run(() => this.openLibrary()) });
    this.addCommand({ id: "open-book-note", name: "Open notes for the current book", checkCallback: (checking) => {
      const book = this.activeBook();
      if (!book) return false;
      if (!checking) void this.run(() => this.openNote(book));
      return true;
    } });
    this.addCommand({ id: "confirm-page", name: "Confirm page for the current book", checkCallback: (checking) => {
      const book = this.activeBook();
      if (!book) return false;
      if (!checking) void this.run(async () => {
        const leaf = await this.libraryLeaf();
        if (leaf.view instanceof LibraryView) {
          await leaf.view.render();
          leaf.view.showBookProgress(book);
        }
      });
      return true;
    } });
    this.addSettingTab(new LibrarySettings(this));
    this.app.workspace.onLayoutReady(() => {
      if (this.stopped) return;
      this.registerInterval(window.setInterval(() => void this.run(() => this.saveViewerPage()), 1e3));
      const update = (path) => {
        if (!path.startsWith(STATE + "/")) return;
        this.snapshotDirty || (this.snapshotDirty = path === SNAPSHOT);
        this.referencesDirty || (this.referencesDirty = path.startsWith(PERSONAL));
        window.clearTimeout(this.reloadTimer);
        this.reloadTimer = window.setTimeout(() => {
          const dirty = this.snapshotDirty;
          const referencesDirty = this.referencesDirty;
          this.snapshotDirty = false;
          this.referencesDirty = false;
          void this.run(async () => {
            if (dirty && !this.busy) await this.loadSnapshot();
            if (referencesDirty) void this.regenerateReferences();
            this.redraw();
          });
        }, 150);
      };
      this.registerEvent(this.app.metadataCache.on("changed", (file) => update(file.path)));
      this.registerEvent(this.app.vault.on("delete", (file) => update(file.path)));
      this.registerEvent(this.app.vault.on("rename", (file, previous) => {
        update(previous);
        update(file.path);
      }));
      void this.run(async () => {
        await this.loadSnapshot();
        this.redraw();
        if (this.origin) await this.refresh();
      });
    });
  }
  onunload() {
    this.stopped = true;
    window.clearTimeout(this.reloadTimer);
  }
  async run(action) {
    try {
      await action();
    } catch (error) {
      if (!this.stopped) new import_obsidian4.Notice(error instanceof Error ? error.message : "Could not complete the operation.");
    }
  }
  async loadSnapshot() {
    try {
      const state = await this.storage.snapshot();
      if (this.stopped) return;
      if (!state || this.origin && state.origin !== this.origin) {
        this.snapshotSaved = false;
        return;
      }
      this.applyCatalog(state.origin, state);
      this.snapshotSaved = true;
    } catch {
      if (!this.stopped) this.error = "Could not read the synced catalog.";
    }
  }
  hasCatalog(origin, version) {
    return this.catalogIdentity?.origin === origin && this.catalogIdentity.version === version;
  }
  applyCatalog(origin, state) {
    if (this.hasCatalog(origin, state.version)) return;
    this.catalogIdentity = { origin, version: state.version };
    this.snapshotSaved = false;
    this.books = state.books;
    void this.regenerateReferences();
  }
  async regenerateReferences() {
    if (this.generatingReferences) return;
    this.generatingReferences = true;
    try {
      let source;
      let failed;
      do {
        source = this.books;
        const personals = this.storage.personals();
        failed = false;
        for (const [index, book] of source.entries()) {
          if (this.stopped || source !== this.books) break;
          try {
            await this.storage.ensureReference(book);
            const linked = this.storage.folderReference(personals.get(book.id));
            if (linked) await this.storage.ensureReference(book, linked);
          } catch {
            failed = true;
          }
          if (index % 20 === 0) await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
      } while (!this.stopped && source !== this.books);
      if (failed && !this.stopped) new import_obsidian4.Notice("Some PDF references need attention. Open the book to see the error.");
    } finally {
      this.generatingReferences = false;
    }
  }
  refresh() {
    if (!this.origin) return Promise.resolve();
    return this.refreshTask ?? (this.refreshTask = this.refreshCatalog(this.origin).finally(() => {
      this.refreshTask = void 0;
    }));
  }
  async refreshCatalog(origin) {
    this.busy = true;
    this.error = "";
    this.redraw();
    try {
      const version = await checkServer(origin);
      if (this.stopped || this.origin !== origin) return;
      const state = version && this.hasCatalog(origin, version) ? { version, books: this.books } : await fetchCatalog(origin);
      if (this.stopped || this.origin !== origin) return;
      this.applyCatalog(origin, state);
      this.connected = true;
      if (this.snapshotSaved) return;
      try {
        await this.storage.saveSnapshot({ schema: 1, origin, ...state });
        this.snapshotSaved = true;
      } catch {
        this.error = "Catalog refreshed. Could not save the offline snapshot.";
      }
    } catch (error) {
      if (this.stopped || this.origin !== origin) return;
      this.connected = false;
      this.error = error instanceof Error ? error.message : "Check your tailnet connection.";
    } finally {
      this.busy = false;
      this.redraw();
    }
  }
  async connect(value) {
    const origin = endpoint(value);
    await checkServer(origin);
    await this.refreshTask;
    if (this.origin !== origin) {
      this.books = [];
      this.catalogIdentity = void 0;
      this.snapshotSaved = false;
      this.connected = false;
    }
    this.origin = origin;
    await this.saveSettings();
    await this.refresh();
  }
  redraw() {
    if (this.stopped) return;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) {
      const view = leaf.view;
      if (view instanceof LibraryView) void this.run(() => view.render());
    }
  }
  activeBook() {
    const path = this.app.workspace.getActiveFile()?.path;
    if (!path?.endsWith(".pdf")) return;
    const personals = this.storage.personals();
    return this.books.find((book) => referencePath(book.id) === path || this.storage.folderReference(personals.get(book.id)) === path);
  }
  async saveViewerPage() {
    const path = this.app.workspace.getActiveFile()?.path;
    if (!path?.endsWith(".pdf")) return;
    const pdfPlus = window.pdfPlus?.lib;
    if (pdfPlus?.getPDFView?.(true)?.file?.path !== path) return;
    const viewer = pdfPlus.getPDFViewer?.(true);
    const page = viewer?.currentPageNumber;
    const document = viewer?.pdfDocument;
    if (!viewer || !document || typeof page !== "number" || !Number.isSafeInteger(page) || page < 1) return;
    const previous = this.pageSample;
    if (previous?.viewer === viewer && previous.document === document && previous.page === page && previous.handled) return;
    const book = this.activeBook();
    if (!book || book.pageCount && page > book.pageCount) return;
    const sameDocument = previous?.viewer === viewer && previous.document === document && previous.bookId === book.id;
    if (!sameDocument || previous.page !== page) {
      this.pageSample = { viewer, document, bookId: book.id, page, since: Date.now(), handled: false, moved: sameDocument };
      return;
    }
    if (Date.now() - previous.since < 2e3 || this.savingViewerPage) return;
    const heads = progressHeads(this.storage.progress().get(book.id) ?? []);
    const current = heads[0];
    if (hasConflict(heads) || current?.completed || page === (current?.page ?? 1) || !previous.moved && page < (current?.page ?? 1)) {
      previous.handled = true;
      return;
    }
    this.savingViewerPage = true;
    try {
      await this.record(book, page, false, heads);
      previous.handled = true;
    } finally {
      this.savingViewerPage = false;
    }
  }
  async libraryLeaf() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW);
    let leaf = leaves.find((candidate) => candidate.view instanceof LibraryView && candidate.view.containerEl.parentElement !== null);
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW, active: true });
      const view = leaf.view;
      if (!(view instanceof LibraryView)) throw new Error("Obsidian could not create the Library tab.");
      await view.mountLibrary();
      for (const previous of leaves) {
        if (previous !== leaf) previous.detach();
      }
    }
    return leaf;
  }
  async openLibrary() {
    const leaf = await this.libraryLeaf();
    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof LibraryView) await leaf.view.mountLibrary();
  }
  pdfPlusStatus() {
    const app = this.app;
    const enabled = app.plugins?.enabledPlugins;
    if (!enabled || typeof enabled.has !== "function") return "unknown";
    return enabled.has("pdf-plus") ? "enabled" : "disabled";
  }
  async openBook(book, page = 1) {
    await this.openPDF(book, page);
  }
  async openPDF(book, page) {
    if (this.pdfPlusStatus() === "disabled") throw new Error("Enable PDF++ to open external references.");
    if (book.availability === "missing") throw new Error("Book not found on the server.");
    const linked = this.storage.folderReference(this.storage.personals().get(book.id));
    const available = checkPDF(book.readUrl).catch((error) => {
      throw new Error("Could not load the PDF. " + (error instanceof Error ? error.message : "Check your tailnet connection."));
    });
    const [file] = await Promise.all([this.storage.ensureReference(book, linked), available]);
    const leaf = this.app.workspace.getLeaf("tab");
    if (page > 1) {
      try {
        await leaf.openFile(file, { active: true, eState: { subpath: "#page=" + page } });
      } catch {
        await leaf.openFile(file, { active: true });
      }
      new import_obsidian4.Notice("Saved page: " + page);
    } else {
      await leaf.openFile(file, { active: true });
    }
    return leaf;
  }
  async openNote(book) {
    const note = await this.storage.note(book, this.studyRoot);
    await this.app.workspace.getLeaf("tab").openFile(note);
  }
  async copyLink(book) {
    await this.storage.ensureReference(book);
    await navigator.clipboard.writeText("[[" + referencePath(book.id) + "]]");
    new import_obsidian4.Notice("Reference copied.");
  }
  async record(book, page, completed, heads) {
    if (!Number.isSafeInteger(page) || page < 1 || book.pageCount && page > book.pageCount) {
      throw new Error("Enter a valid page number.");
    }
    await this.storage.saveProgress({
      id: crypto.randomUUID(),
      bookId: book.id,
      page,
      completed,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      deviceId: this.deviceId,
      parents: heads.map((head) => head.id)
    });
  }
  async personalize(book, values) {
    await this.storage.savePersonal(book, values);
  }
  async linkFolder(book, path) {
    await this.storage.linkFolder(book, path);
    new import_obsidian4.Notice("Folder linked to the book.");
  }
  async deleteFromLibrary(book) {
    await this.storage.deleteFromLibrary(book);
    this.redraw();
  }
  async createStudyNote(book, title, page = 1) {
    const ficha = await this.storage.note(book, this.studyRoot);
    const note = await this.storage.createStudyNote(book, ficha, title, this.studyTemplate);
    let pdfLeaf;
    if (!import_obsidian4.Platform.isMobile && book.availability === "available") {
      try {
        pdfLeaf = await this.openPDF(book, page);
      } catch (error) {
        new import_obsidian4.Notice(error instanceof Error ? error.message : "Could not open the PDF alongside the note.");
      }
    }
    const noteLeaf = pdfLeaf ? this.app.workspace.createLeafBySplit(pdfLeaf, "vertical") : this.app.workspace.getLeaf("tab");
    await noteLeaf.openFile(note, { active: true });
  }
  async saveSettings() {
    await this.saveData({ origin: this.origin, studyRoot: this.studyRoot, studyTemplate: this.studyTemplate });
  }
};
var LibrarySettings = class extends import_obsidian4.PluginSettingTab {
  constructor(library) {
    super(library.app, library);
    this.library = library;
  }
  display() {
    this.containerEl.empty();
    renderServerSettings(this.containerEl, this.library);
  }
};
