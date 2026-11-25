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

// local-typescript:C:\Users\Fabricio\Documents\PluginLivrosObsidian\plugin\src\local.ts
async function scanLocalFolder(input, deviceId) {
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const { pathToFileURL } = require("node:url");
  const requested = input.trim();
  if (!path.isAbsolute(requested)) throw new Error("Enter the full path to your PDF folder.");
  const books = [];
  let folder;
  try {
    folder = await fs.realpath(requested);
    const pending = [{ directory: folder, categories: [] }];
    while (pending.length) {
      const { directory, categories } = pending.pop();
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          pending.push({ directory: absolute, categories: [...categories, entry.name] });
        } else if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
          const info = await fs.stat(absolute);
          if (info.size <= 300 && /^(?:https?:\/\/|file:\/\/\/)/.test(await fs.readFile(absolute, "utf8"))) continue;
          const readUrl = pathToFileURL(absolute).href;
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceId + "\n" + readUrl));
          const hex = Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
          const id = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
          books.push({
            source: "local",
            id,
            title: entry.name.slice(0, -4),
            category: categories.join(" / ") || "Uncategorized",
            sizeBytes: info.size,
            format: "pdf",
            readUrl,
            availability: "available",
            etag: info.size + "-" + info.mtime.getTime(),
            lastModified: info.mtime.toISOString()
          });
        }
      }
    }
  } catch {
    throw new Error("Could not scan this folder. Check that the folder and its PDFs are accessible.");
  }
  books.sort((a, b) => a.readUrl.localeCompare(b.readUrl));
  return { folder, books };
}
async function checkLocalPDF(url) {
  const { fileURLToPath } = require("node:url");
  const { stat } = require("node:fs/promises");
  try {
    if ((await stat(fileURLToPath(url))).isFile()) return;
  } catch {
  }
  throw new Error("Could not find this PDF. Check the folder and refresh the library.");
}

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
  return typeof entry.id === "string" && idPattern.test(entry.id) && entry.source === void 0 && typeof entry.title === "string" && typeof entry.category === "string" && (entry.author === void 0 || typeof entry.author === "string") && (entry.coverUrl === void 0 || entry.coverUrl === origin + "/api/v1/books/" + entry.id + "/cover") && (entry.pageCount === void 0 || Number.isSafeInteger(entry.pageCount) && entry.pageCount > 0) && Number.isSafeInteger(entry.sizeBytes) && entry.sizeBytes >= 0 && typeof entry.etag === "string" && typeof entry.lastModified === "string" && entry.format === "pdf" && (entry.availability === "available" || entry.availability === "missing") && entry.readUrl === origin + "/api/v1/books/" + entry.id + "/file" && new TextEncoder().encode(entry.readUrl).length <= 300;
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
        favorite: data.favorite === true,
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
    const contents = new TextEncoder().encode(book.readUrl);
    if (book.source === "local" && (!book.readUrl.startsWith("file:///") || contents.length > 300)) {
      throw new Error("PDF++ cannot open this file path. Use a shorter path on a local or mapped drive.");
    }
    await this.ensureFolder(path.slice(0, path.lastIndexOf("/")));
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      try {
        return await this.app.vault.createBinary(path, contents.buffer);
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
      await this.app.vault.modifyBinary(file, contents.buffer);
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
  studyNotes(book) {
    const record = this.findNote(book);
    if (!record?.parent) return [];
    const folder = record.parent.name === "Notes" ? record.parent.path : record.parent.isRoot() ? "Notes" : record.parent.path + "/Notes";
    const links = this.app.metadataCache.resolvedLinks;
    const notes = this.app.vault.getMarkdownFiles().filter((file) => file !== record && file.parent?.path === folder && links[file.path]?.[record.path]);
    return [record, ...notes];
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
var DETAILS_VIEW = "obsidian-library-details";
var BookDetailsView = class extends import_obsidian3.ItemView {
  getViewType() {
    return DETAILS_VIEW;
  }
  getDisplayText() {
    return "Book details";
  }
  getIcon() {
    return "book-open";
  }
  async onOpen() {
    this.contentEl.addClass("ol-book-details");
    this.contentEl.createEl("p", { text: "Open a book's details from the Library.", cls: "ol-secondary" });
  }
};
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
    __publicField(this, "clearFilters");
    __publicField(this, "sort", "title");
    __publicField(this, "layoutButtons", /* @__PURE__ */ new Map());
    __publicField(this, "summary");
    __publicField(this, "resultCount");
    __publicField(this, "resume");
    __publicField(this, "details");
    __publicField(this, "detailsRequest", 0);
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
    this.connectionButton = this.button(bar, "", () => this.connection());
    this.connectionButton.addClass("ol-connection");
    this.summary = root.createDiv("ol-secondary");
    this.message = root.createDiv({ cls: "ol-message", attr: { role: "status" } });
    this.resume = root.createDiv();
    const heading = root.createDiv("ol-toolbar ol-section-heading");
    const allBooks = heading.createEl("h3", { text: "All books" });
    this.resultCount = allBooks.createSpan({ cls: "ol-result-count ol-secondary" });
    for (const [layout, label, icon] of [["grid", "Grid", "layout-grid"], ["list", "List", "list"]]) {
      this.layoutButtons.set(layout, this.iconButton(heading, label, icon, async () => {
        this.plugin.appearance.layout = layout;
        this.plugin.redraw();
        await this.plugin.saveSettings();
      }));
    }
    const toolbar = root.createDiv("ol-toolbar ol-filters");
    const search = toolbar.createEl("input", {
      type: "search",
      placeholder: "Search by title or author",
      attr: { "aria-label": "Search by title or author" }
    });
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value;
      this.reset();
    });
    const filterModal = import_obsidian3.Platform.isMobile ? new import_obsidian3.Modal(this.app) : void 0;
    filterModal?.setTitle("Filter and sort");
    if (filterModal) this.iconButton(toolbar, "Filter and sort", "list-filter", () => filterModal.open());
    const filters = (filterModal?.contentEl ?? toolbar).createDiv("ol-toolbar ol-filter-controls");
    const statuses = filters.createEl("select", { attr: { "aria-label": "Reading status" } });
    for (const [value, text] of [["", "All statuses"], ["reading", "Reading"], ["new", "Unread"], ["done", "Finished"], ["favorite", "Favorites"]]) {
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
    const sort = filters.createEl("select", { attr: { "aria-label": "Sort by" } });
    for (const [value, text] of [["title", "Title"], ["author", "Author"], ["reading", "Last read"], ["added", "Recently added"]]) {
      sort.createEl("option", { value, text });
    }
    sort.value = this.sort;
    sort.addEventListener("change", () => {
      this.sort = sort.value;
      this.reset();
    });
    this.clearFilters = () => {
      this.query = search.value = this.category = this.categories.value = this.status = statuses.value = "";
      this.reset();
      search.focus();
    };
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
    const local = Boolean(this.plugin.localFolder);
    const configured = local || Boolean(this.plugin.origin);
    const state = this.plugin.busy ? "Refreshing" : this.plugin.connected ? local ? "Local folder" : "Connected" : configured ? "Unavailable" : "Set up library";
    this.connectionButton.setText(state);
    this.connectionButton.dataset.connected = String(this.plugin.connected === true);
    this.connectionButton.setAttribute("aria-label", configured ? state + ". Show library connection" : state);
    const reading = this.books.filter((book) => this.statusFor(book) === "reading").length;
    this.summary.setText(this.bookCount(this.books.length) + " / " + reading + " in progress");
    this.message.setText([
      this.plugin.busy ? "Loading library..." : "",
      this.plugin.error,
      this.plugin.pdfPlusStatus() === "disabled" ? "Enable PDF++ to open external references." : ""
    ].filter(Boolean).join(" "));
    if (this.plugin.pdfPlusStatus() === "disabled") this.message.createEl("a", {
      text: " PDF++ instructions",
      href: "https://ryotaushio.github.io/obsidian-pdf-plus/external-pdf-files.html",
      attr: { target: "_blank", rel: "noopener noreferrer" }
    });
    this.drawResume();
    const appearance = this.plugin.appearance;
    this.contentEl.style.setProperty("--ol-cover-size", (appearance?.coverSize ?? 150) + "px");
    for (const [layout, button] of this.layoutButtons) {
      button.setAttribute("aria-pressed", String(layout === (appearance?.layout ?? "grid")));
    }
    this.refreshDetails();
    this.draw();
  }
  refreshDetails() {
    const selected = this.details;
    if (!selected) return;
    const leaf = selected.view.leaf;
    if (!this.app.workspace.getLeavesOfType(DETAILS_VIEW).includes(leaf)) {
      this.details = void 0;
      return;
    }
    const book = this.books.find((book2) => book2.id === selected.bookId);
    if (book) this.renderDetails(selected.view.contentEl, book, () => leaf.detach());
    else leaf.detach();
  }
  bookCount(count) {
    return count + (count === 1 ? " book" : " books");
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
  statusFor(book) {
    const current = this.current(book);
    return current?.completed ? "done" : (current?.page ?? 1) > 1 || hasConflict(this.heads.get(book.id) ?? []) ? "reading" : "new";
  }
  lastRead(book) {
    return (this.heads.get(book.id) ?? []).reduce((latest, head) => head.updatedAt > latest ? head.updatedAt : latest, "");
  }
  drawResume() {
    this.resume.empty();
    const reading = this.books.filter((book) => this.statusFor(book) === "reading" && book.availability === "available").sort((a, b) => this.lastRead(b).localeCompare(this.lastRead(a)));
    if (!reading.length) return;
    this.resume.createEl("h3", { text: "Continue reading", cls: "ol-section-heading" });
    const shelf = this.resume.createDiv("ol-resume");
    for (const book of reading) {
      const item = shelf.createEl("article", { cls: "ol-resume-book" });
      this.renderCover(item, book);
      const info = item.createDiv("ol-resume-info");
      info.createDiv({ text: this.title(book), cls: "ol-card-title" });
      if (book.author) info.createDiv({ text: book.author, cls: "ol-secondary" });
      if (this.plugin.appearance?.showProgress !== false) this.renderProgress(info, book);
      this.button(info, this.current(book) ? "Continue reading" : "Resolve progress", () => this.continue(book)).addClass("mod-cta");
    }
  }
  draw() {
    this.body.empty();
    const books = this.books;
    if (!books.length) {
      this.resultCount.setText("");
      if (this.plugin.busy) return;
      const configured = this.plugin.origin || this.plugin.localFolder;
      const unavailable = configured && !this.plugin.connected;
      this.body.createEl("p", { text: unavailable ? "Library unavailable" : "Your library is empty" });
      if (!configured) this.body.createEl("p", { text: "Connect a folder or server to get started.", cls: "ol-secondary" });
      if (unavailable) this.button(this.body, "Reconnect", () => this.plugin.refresh());
      else this.button(this.body, "Configure library", () => this.configure());
      return;
    }
    const query = normalize(this.query.trim());
    const filtered = books.filter((book) => {
      if (this.category && this.category !== this.categoryFor(book)) return false;
      const matchesStatus = !this.status || (this.status === "favorite" ? this.personals.get(book.id)?.favorite : this.statusFor(book) === this.status);
      return matchesStatus && normalize(this.title(book) + " " + (book.author ?? "")).includes(query);
    }).sort((a, b) => {
      const order = this.sort === "author" ? collator.compare(a.author ?? "", b.author ?? "") : this.sort === "reading" ? this.lastRead(b).localeCompare(this.lastRead(a)) : this.sort === "added" ? (this.plugin.addedAt[b.id] ?? 0) - (this.plugin.addedAt[a.id] ?? 0) : 0;
      return order || collator.compare(this.title(a), this.title(b));
    });
    this.resultCount.setText(String(filtered.length));
    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    this.page = Math.min(this.page, pageCount);
    if (!filtered.length) {
      this.body.createEl("p", { text: "No books found. Try another search or clear the filters." });
      this.button(this.body, "Clear filters", this.clearFilters);
      return;
    }
    const grid = this.body.createDiv(this.plugin.appearance?.layout === "list" ? "ol-list" : "ol-grid");
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
  renderProgress(parent, book, showPage = true) {
    const progress = this.current(book);
    const conflict = hasConflict(this.heads.get(book.id) ?? []);
    const percent = conflict ? void 0 : progress?.completed ? 100 : progress && book.pageCount ? Math.min(100, Math.round(progress.page / book.pageCount * 100)) : void 0;
    const status = book.availability === "missing" ? "Unavailable" : conflict ? "Conflicting reading progress" : progress?.completed ? "Finished" : this.statusFor(book) === "reading" ? "Page " + progress?.page : "Not started";
    const row = parent.createDiv("ol-progress");
    const label = row.createDiv("ol-progress-label ol-secondary");
    label.createSpan({ text: showPage || !progress || progress.completed || book.availability === "missing" ? status : "" });
    if (percent !== void 0 && book.availability !== "missing") {
      label.createSpan({ text: percent + "%" });
      row.createEl("progress", { attr: { value: percent, max: 100, "aria-label": "Reading progress" } });
    }
  }
  card(grid, book) {
    const title = this.title(book);
    const card = grid.createEl("article", { cls: "ol-card" });
    const open = this.button(card, "", () => this.continue(book));
    open.addClass("ol-card-open");
    open.setAttribute("aria-label", "Open " + title);
    open.title = title;
    open.disabled = book.availability === "missing";
    this.renderCover(open, book);
    const info = open.createSpan({ cls: "ol-card-info" });
    info.createSpan({ text: title, cls: "ol-card-title" });
    if (book.author) info.createSpan({ text: book.author, cls: "ol-secondary ol-card-author" });
    const footer = card.createDiv("ol-card-footer");
    if (this.plugin.appearance?.showProgress !== false || book.availability === "missing") this.renderProgress(footer, book);
    const menu = this.iconButton(footer, "Options for " + title, "ellipsis", () => this.showMenu(menu, book));
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.bookMenu(book).showAtMouseEvent(event);
    });
  }
  showMenu(button, book) {
    const position = button.getBoundingClientRect();
    this.bookMenu(book).showAtPosition({ x: position.left, y: position.bottom });
  }
  bookMenu(book) {
    const options = new import_obsidian3.Menu();
    const add = (label, icon, action) => options.addItem((item) => item.setTitle(label).setIcon(icon).onClick(() => void this.plugin.run(async () => action())));
    const progress = this.current(book);
    const conflict = hasConflict(this.heads.get(book.id) ?? []);
    if (book.availability === "available") {
      add("Open book", "book-open", () => this.continue(book));
      if (!import_obsidian3.Platform.isMobile) add("Open to the side", "columns-2", () => this.continue(book, true));
      if ((progress?.page ?? 1) > 1) add("Open at first page", "file-text", () => this.plugin.openBook(book));
    }
    add("Copy PDF link", "link", () => this.plugin.copyLink(book));
    options.addSeparator();
    add("Open study note", "notebook-pen", () => this.plugin.openNote(book));
    add("Create note", "file-plus", () => this.studyNoteDialog(book));
    add("Link folder...", "folder", () => this.folderDialog(book));
    options.addSeparator();
    add("Book details", "info", () => this.showBookDetails(book));
    add("Edit metadata", "pencil", () => this.editMetadata(book));
    const favorite = this.personals.get(book.id)?.favorite === true;
    add(favorite ? "Remove from favorites" : "Add to favorites", "star", () => this.plugin.personalize(book, { favorite: !favorite }));
    if (book.availability === "available" && !book.source && (book.pageCount ?? 0) > 1) {
      add("Change cover...", "image", () => this.coverDialog(book));
    }
    options.addSeparator();
    add(conflict ? "Resolve reading progress..." : "Confirm page...", "book-open-check", () => this.showBookProgress(book));
    if (!conflict && !progress?.completed) add("Mark as finished", "check", () => this.plugin.record(book, progress?.page ?? 1, true, progress ? [progress] : []));
    if (!conflict && progress && (progress.completed || progress.page > 1)) add("Reset progress...", "rotate-ccw", () => this.resetProgressDialog(book, progress));
    options.addSeparator();
    add("Delete from library...", "trash-2", () => this.deleteDialog(book));
    return options;
  }
  resetProgressDialog(book, progress) {
    const modal = new import_obsidian3.Modal(this.app);
    modal.setTitle("Reset reading progress?");
    modal.contentEl.createEl("p", { text: this.title(book) + " will return to page 1." });
    new import_obsidian3.Setting(modal.contentEl).addButton((button) => button.setButtonText("Cancel").onClick(() => modal.close())).addButton((button) => button.setButtonText("Reset progress").setWarning().onClick(async () => {
      button.setDisabled(true);
      await this.plugin.run(async () => {
        const heads = progressHeads(this.plugin.storage.progress().get(book.id) ?? []);
        if (heads.length !== 1 || heads[0].id !== progress.id) {
          modal.close();
          this.showBookProgress(book);
          return;
        }
        await this.plugin.record(book, 1, false, heads);
        modal.close();
      });
      button.setDisabled(false);
    }));
    modal.open();
  }
  deleteDialog(book) {
    const modal = new import_obsidian3.Modal(this.app);
    modal.setTitle("Delete from library?");
    modal.contentEl.createEl("p", {
      text: "Hide \u201C" + this.title(book) + "\u201D from your library. The original PDF, notes, and reading progress are kept."
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
    (0, import_obsidian3.setIcon)(cover, "file-text");
    cover.createSpan({ text: "PDF" });
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
  async continue(book, side = false) {
    if (hasConflict(this.heads.get(book.id) ?? [])) this.showBookProgress(book);
    else await this.plugin.openBook(book, this.current(book)?.page, side);
  }
  button(parent, text, action) {
    const button = parent.createEl("button", { text });
    button.addEventListener("click", () => void this.plugin.run(async () => action()));
    return button;
  }
  iconButton(parent, label, icon, action) {
    const button = this.button(parent, "", action);
    button.addClass("clickable-icon", "ol-icon-button");
    button.setAttribute("aria-label", label);
    (0, import_obsidian3.setTooltip)(button, label);
    (0, import_obsidian3.setIcon)(button, icon);
    return button;
  }
  connection() {
    const source = this.plugin.localFolder || this.plugin.origin;
    if (!source) return this.configure();
    const modal = new import_obsidian3.Modal(this.app);
    modal.setTitle("Library connection");
    const info = modal.contentEl.createDiv("ol-connection-info");
    const showStatus = () => info.setText([
      source,
      this.plugin.connected ? "Connected" : "Unavailable",
      this.bookCount(this.books.length),
      this.plugin.lastRefresh ? "Last refreshed " + this.plugin.lastRefresh.toLocaleString() : "No refresh this session",
      this.plugin.error
    ].filter(Boolean).join("\n"));
    showStatus();
    const actions = modal.contentEl.createDiv("ol-toolbar");
    const retry = this.button(actions, "Reconnect", async () => {
      retry.disabled = true;
      info.setText("Refreshing library...");
      try {
        await this.plugin.refresh();
      } finally {
        showStatus();
        retry.disabled = false;
      }
    });
    this.button(actions, "Configure library", () => {
      modal.close();
      this.configure();
    });
    modal.open();
  }
  configure() {
    const modal = new import_obsidian3.Modal(this.app);
    modal.setTitle("Library source");
    renderLibrarySettings(modal.contentEl, this.plugin, () => modal.close());
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
        const date = new Date(head.updatedAt).toLocaleString();
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
        text: "Last confirmed on " + new Date(current.updatedAt).toLocaleString()
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
  async showBookDetails(book) {
    const workspace = this.app.workspace;
    const request = ++this.detailsRequest;
    const leaf = import_obsidian3.Platform.isMobile ? void 0 : workspace.getLeavesOfType(DETAILS_VIEW)[0] ?? workspace.getRightLeaf(false);
    if (leaf) {
      if (leaf.view.getViewType() !== DETAILS_VIEW) await leaf.setViewState({ type: DETAILS_VIEW });
      if (request !== this.detailsRequest) return;
      if (leaf.view instanceof BookDetailsView) {
        this.details = { bookId: book.id, view: leaf.view };
        this.renderDetails(leaf.view.contentEl, book, () => leaf.detach());
        await workspace.revealLeaf(leaf);
        return;
      }
    }
    const modal = new import_obsidian3.Modal(this.app);
    modal.setTitle("Book details");
    modal.modalEl.addClass("ol-details-modal");
    this.renderDetails(modal.contentEl, book, () => modal.close(), true);
    modal.open();
  }
  renderDetails(content, book, close, inModal = false) {
    content.empty();
    content.addClass("ol-book-details");
    const header = content.createDiv("ol-toolbar ol-detail-header");
    if (!inModal) header.createEl("h3", { text: "Book details" });
    const menu = this.iconButton(header, "Book options", "ellipsis", () => this.showMenu(menu, book));
    if (!inModal) this.iconButton(header, "Close book details", "x", close);
    const hero = content.createDiv("ol-detail-hero");
    this.renderCover(hero, book);
    const info = hero.createDiv();
    info.createEl("h4", { text: this.title(book) });
    if (book.author) info.createDiv({ text: book.author, cls: "ol-secondary" });
    const badges = info.createDiv("ol-detail-badges");
    for (const tag of [this.categoryFor(book), "PDF"]) badges.createSpan({ text: tag });
    const progress = content.createDiv("ol-detail-section");
    progress.createEl("h4", { text: "Reading progress" });
    this.renderProgress(progress, book, false);
    const current = this.current(book);
    if (current) progress.createDiv({ text: "Current page: " + current.page, cls: "ol-secondary" });
    const reading = this.button(
      progress,
      current ? "Continue reading" : this.heads.has(book.id) ? "Resolve progress" : "Open book",
      async () => {
        if (hasConflict(this.heads.get(book.id) ?? [])) {
          if (inModal) close();
          this.showBookProgress(book);
        } else {
          await this.continue(book);
          if (inModal) close();
        }
      }
    );
    reading.addClass("mod-cta", "ol-detail-read");
    reading.disabled = book.availability === "missing";
    const notes = content.createDiv("ol-detail-section");
    notes.createEl("h4", { text: "Study notes" });
    for (const [index, file] of this.plugin.storage.studyNotes(book).entries()) {
      const row = this.button(notes, "", async () => {
        await this.app.workspace.getLeaf("tab").openFile(file);
        if (inModal) close();
      });
      row.addClass("ol-note-link");
      (0, import_obsidian3.setIcon)(row.createSpan({ attr: { "aria-hidden": "true" } }), "notebook-pen");
      const label = row.createSpan();
      label.createSpan({ text: file.basename });
      label.createSpan({ text: index === 0 ? "Book record" : "Study note", cls: "ol-secondary" });
      (0, import_obsidian3.setIcon)(row.createSpan({ attr: { "aria-hidden": "true" } }), "chevron-right");
    }
    this.button(notes, "+ Create study note", () => {
      if (inModal) close();
      this.studyNoteDialog(book);
    }).addClass("ol-note-create");
    const metadata = content.createDiv("ol-detail-section");
    metadata.createEl("h4", { text: "Reading information" });
    const list = metadata.createEl("dl", { cls: "ol-detail-grid" });
    for (const [label, value] of [
      ["Source", book.source === "local" ? "Local folder" : "Remote server"],
      ["Status", book.availability === "missing" ? "Unavailable" : this.statusFor(book) === "reading" ? "Reading" : current?.completed ? "Finished" : "Not started"],
      ["Format", "PDF"],
      ["Pages", book.pageCount?.toLocaleString() ?? "Unknown"],
      ["Size", (book.sizeBytes / 1048576).toLocaleString(void 0, { maximumFractionDigits: 2 }) + " MiB"],
      ["Study folder", this.personals.get(book.id)?.folder ?? "Not linked"]
    ]) {
      const item = list.createDiv("ol-detail-item");
      item.createEl("dt", { text: label });
      item.createEl("dd", { text: value });
    }
  }
  editMetadata(book) {
    const modal = new import_obsidian3.Modal(this.app);
    modal.setTitle("Edit metadata");
    const edit = modal.contentEl;
    const personal = this.personals.get(book.id);
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
function chooseVaultPath(plugin, folders, onSelect) {
  const options = folders ? plugin.app.vault.getAllFolders() : plugin.app.vault.getMarkdownFiles();
  const paths = options.map((file) => file.path).sort(collator.compare);
  const picker = new class extends import_obsidian3.SuggestModal {
    getSuggestions(query) {
      return paths.filter((path) => normalize(path).includes(normalize(query.trim())));
    }
    renderSuggestion(path, el) {
      el.setText(path);
    }
    onChooseSuggestion(path) {
      onSelect(path);
    }
  }(plugin.app);
  picker.setPlaceholder(folders ? "Search vault folders..." : "Search Markdown files...");
  picker.open();
}
function renderLibrarySettings(container, plugin, onSuccess) {
  const settings = container.createDiv("ol-settings");
  if (!onSuccess) settings.createDiv({
    text: "Manage your books, reading preferences and study notes.",
    cls: "ol-secondary"
  });
  const source = settings.createDiv(onSuccess ? "ol-source-settings" : "ol-settings-section");
  if (!onSuccess) new import_obsidian3.Setting(source).setName("Library source").setHeading();
  let localPath = plugin.localFolder;
  let serverAddress = plugin.origin;
  let sourceType = localPath ? "local" : serverAddress ? "server" : "";
  const location = new import_obsidian3.Setting(source).setName("Storage location").setDesc("Choose where your books are stored.");
  const fields = source.createDiv("ol-source-fields");
  location.addDropdown((selector) => {
    selector.addOption("", "Choose a source");
    if (!import_obsidian3.Platform.isMobile) selector.addOption("local", "Local folder");
    selector.addOption("server", "Remote server").setValue(sourceType);
    selector.selectEl.options[0].disabled = true;
    const renderSource = () => {
      fields.empty();
      if (!sourceType) return;
      const local = sourceType === "local";
      const row = new import_obsidian3.Setting(fields).setName(local ? "PDF folder" : "Server address").setDesc(local ? "PDFs are scanned and opened in place with PDF++." : "HTTPS endpoint of your library server.");
      row.addText((input) => {
        input.setPlaceholder(local ? "C:/Books" : "https://server.example:9443").setValue(local ? localPath : serverAddress);
        input.inputEl.type = local ? "text" : "url";
        input.inputEl.spellcheck = false;
        input.inputEl.setAttribute("aria-label", local ? "PDF folder" : "Server address");
        input.onChange((value) => {
          if (local) localPath = value;
          else serverAddress = value;
        });
        const actions = fields.createDiv("ol-settings-actions");
        const active = local ? Boolean(plugin.localFolder) : Boolean(plugin.origin && !plugin.localFolder);
        const status = actions.createDiv({ attr: { role: "status" } });
        const show = () => {
          const count = plugin.books.length;
          status.setText(plugin.error || (plugin.connected ? "Connected / " + count + (count === 1 ? " book" : " books") : "Unavailable"));
          status.dataset.connected = String(plugin.connected && !plugin.error);
        };
        if (active) show();
        const action = actions.createEl("button", { text: local ? "Load books" : "Test connection" });
        action.addEventListener("click", async () => {
          action.disabled = true;
          selector.setDisabled(true);
          input.setDisabled(true);
          status.dataset.connected = "false";
          status.setText(local ? "Scanning folder..." : "Testing connection...");
          try {
            if (local) await plugin.useLocalFolder(input.getValue());
            else await plugin.connect(input.getValue());
            show();
            if (!plugin.error) onSuccess?.();
          } catch (error) {
            status.setText(error instanceof Error ? error.message : "Could not set up the library source.");
          } finally {
            action.disabled = false;
            selector.setDisabled(false);
            input.setDisabled(false);
          }
        });
      });
      if (!local) {
        const guide = fields.createEl("details", { cls: "ol-server-guide" });
        guide.createEl("summary", { text: "Server setup guide" });
        guide.createEl("p", { text: "Run the Obsidian Library server on a computer that can read your PDF folder. Make the service available over HTTPS and enter its base address here." });
      }
    };
    selector.onChange((value) => {
      sourceType = value;
      renderSource();
    });
    renderSource();
  });
  if (onSuccess) return;
  const notes = settings.createDiv("ol-settings-section");
  const appearance = settings.createDiv("ol-settings-section");
  const feedback = settings.createDiv({ cls: "ol-secondary", attr: { role: "status" } });
  let timer;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void plugin.saveSettings().then(() => feedback.setText(""), (error) => feedback.setText(
        error instanceof Error ? error.message : "Could not save preferences."
      ));
    }, 300);
  };
  new import_obsidian3.Setting(notes).setName("Study notes").setHeading();
  new import_obsidian3.Setting(notes).setName("Notes folder").setDesc("Location for new study notes.").addText((input) => {
    input.setValue(plugin.studyRoot).onChange((value) => {
      try {
        plugin.studyRoot = studyFolder(value);
        feedback.setText("");
        save();
      } catch (error) {
        feedback.setText(error instanceof Error ? error.message : "Enter a vault folder.");
      }
    });
    input.inputEl.setAttribute("aria-label", "Notes folder");
    const browse = input.inputEl.parentElement?.createEl("button", { attr: { "aria-label": "Browse vault folders" } });
    if (!browse) return;
    (0, import_obsidian3.setIcon)(browse, "folder");
    (0, import_obsidian3.setTooltip)(browse, "Browse vault folders");
    browse.addEventListener("click", () => chooseVaultPath(plugin, true, (path) => {
      input.setValue(path);
      plugin.studyRoot = path;
      save();
    }));
  });
  new import_obsidian3.Setting(notes).setName("Note template").setDesc("Optional Markdown template.").addButton((select) => {
    const update = () => select.setButtonText(plugin.studyTemplate || "Select a template");
    update();
    select.onClick(() => chooseVaultPath(plugin, false, (path) => {
      plugin.studyTemplate = path;
      update();
      save();
    }));
    select.buttonEl.parentElement?.createEl("button", { text: "Clear", attr: { "aria-label": "Clear note template" } }).addEventListener("click", () => {
      plugin.studyTemplate = "";
      update();
      save();
    });
  });
  new import_obsidian3.Setting(appearance).setName("Appearance").setHeading();
  const changeAppearance = () => {
    plugin.redraw();
    save();
  };
  const layout = new import_obsidian3.Setting(appearance).setName("Default view").setDesc("How books are displayed.");
  const choices = /* @__PURE__ */ new Map();
  const sync = () => {
    for (const [value, button] of choices) button.setAttribute("aria-pressed", String(value === plugin.appearance.layout));
  };
  for (const [value, label] of [["grid", "Grid"], ["list", "List"]]) {
    layout.addButton((button) => {
      choices.set(value, button.buttonEl);
      button.setButtonText(label).onClick(() => {
        plugin.appearance.layout = value;
        sync();
        changeAppearance();
      });
    });
  }
  sync();
  new import_obsidian3.Setting(appearance).setName("Cover size").setDesc("Adjust the size of book covers.").addSlider((slider) => slider.setLimits(110, 220, 5).setValue(plugin.appearance.coverSize).setDynamicTooltip().onChange((value) => {
    plugin.appearance.coverSize = value;
    changeAppearance();
  }));
  new import_obsidian3.Setting(appearance).setName("Show reading progress").setDesc("Display progress below book covers.").addToggle((toggle) => toggle.setValue(plugin.appearance.showProgress).onChange((value) => {
    plugin.appearance.showProgress = value;
    changeAppearance();
  }));
}

// local-typescript:C:\Users\Fabricio\Documents\PluginLivrosObsidian\plugin\src\main.ts
var LOCAL_FOLDER_KEY = "obsidian-library-local-folder";
var LibraryPlugin = class extends import_obsidian4.Plugin {
  constructor() {
    super(...arguments);
    __publicField(this, "storage");
    __publicField(this, "origin", "");
    __publicField(this, "localFolder", "");
    __publicField(this, "studyRoot", NOTES.slice(0, -1));
    __publicField(this, "studyTemplate", "");
    __publicField(this, "appearance", { layout: "grid", coverSize: 150, showProgress: true });
    __publicField(this, "lastRefresh");
    __publicField(this, "addedAt", {});
    __publicField(this, "trackAdditions", false);
    __publicField(this, "settingsWrite", Promise.resolve());
    __publicField(this, "books", []);
    __publicField(this, "connected", false);
    __publicField(this, "error", "");
    __publicField(this, "busy", false);
    __publicField(this, "deviceId", "");
    __publicField(this, "stopped", false);
    __publicField(this, "refreshTask");
    __publicField(this, "changingSource", false);
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
    const added = this.app.loadLocalStorage("obsidian-library-first-seen");
    if (added && typeof added === "object") {
      for (const [id, date] of Object.entries(added)) {
        if (idPattern.test(id) && typeof date === "number" && Number.isFinite(date)) this.addedAt[id] = date;
      }
    }
    this.trackAdditions = true;
    const settings = await this.loadData();
    if (settings?.appearance?.layout === "list") this.appearance.layout = "list";
    const coverSize = settings?.appearance?.coverSize;
    if (typeof coverSize === "number" && coverSize >= 110 && coverSize <= 220) this.appearance.coverSize = coverSize;
    if (typeof settings?.appearance?.showProgress === "boolean") this.appearance.showProgress = settings.appearance.showProgress;
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
    const localFolder = this.app.loadLocalStorage(LOCAL_FOLDER_KEY);
    if (!import_obsidian4.Platform.isMobile && typeof localFolder === "string") this.localFolder = localFolder;
    this.registerView(VIEW, (leaf) => new LibraryView(leaf, this));
    this.registerView(DETAILS_VIEW, (leaf) => new BookDetailsView(leaf));
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
      this.registerEvent(this.app.metadataCache.on("resolve", (file) => {
        if (!file.path.startsWith(STATE + "/")) this.redrawDetails();
      }));
      this.registerEvent(this.app.vault.on("delete", (file) => {
        update(file.path);
        if (file.path.endsWith(".md")) this.redrawDetails();
      }));
      this.registerEvent(this.app.vault.on("rename", (file, previous) => {
        update(previous);
        update(file.path);
        if (file.path.endsWith(".md")) this.redrawDetails();
      }));
      void this.run(async () => {
        await this.loadSnapshot();
        this.redraw();
        await this.refresh();
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
    if (this.localFolder) return;
    try {
      const state = await this.storage.snapshot();
      if (this.stopped || this.localFolder) return;
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
  setBooks(books) {
    this.books = books;
    if (!this.trackAdditions) return;
    const newBooks = books.filter((book) => this.addedAt[book.id] === void 0);
    if (!newBooks.length) return;
    const now = Date.now();
    for (const book of newBooks) this.addedAt[book.id] = now;
    this.app.saveLocalStorage("obsidian-library-first-seen", this.addedAt);
  }
  applyCatalog(origin, state) {
    if (this.hasCatalog(origin, state.version)) return;
    this.catalogIdentity = { origin, version: state.version };
    this.snapshotSaved = false;
    this.setBooks(state.books);
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
          if (book.source === "local") continue;
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
    if (this.changingSource || !this.localFolder && !this.origin) return Promise.resolve();
    const folder = this.localFolder;
    return this.refreshTask ?? (this.refreshTask = (folder ? this.refreshLocal(folder) : this.refreshCatalog(this.origin)).finally(() => {
      this.refreshTask = void 0;
    }));
  }
  async refreshLocal(folder) {
    this.busy = true;
    this.error = "";
    this.redraw();
    try {
      const state = await scanLocalFolder(folder, this.deviceId);
      if (this.stopped) return;
      this.setBooks(state.books);
      this.connected = true;
      this.lastRefresh = /* @__PURE__ */ new Date();
    } catch (error) {
      this.connected = false;
      this.error = error instanceof Error ? error.message : "Could not scan the PDF folder.";
    } finally {
      this.busy = false;
      this.redraw();
    }
  }
  async useLocalFolder(value) {
    if (import_obsidian4.Platform.isMobile) throw new Error("Local folders are available on desktop.");
    if (this.changingSource) throw new Error("Wait for the current source change to finish.");
    this.changingSource = true;
    try {
      await this.refreshTask;
      const state = await scanLocalFolder(value, this.deviceId);
      if (this.stopped) return;
      this.app.saveLocalStorage(LOCAL_FOLDER_KEY, state.folder);
      this.localFolder = state.folder;
      this.catalogIdentity = void 0;
      this.snapshotSaved = false;
      this.setBooks(state.books);
      this.error = "";
      this.connected = true;
      this.lastRefresh = /* @__PURE__ */ new Date();
    } finally {
      this.changingSource = false;
      this.redraw();
    }
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
      this.lastRefresh = /* @__PURE__ */ new Date();
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
      this.error = error instanceof Error ? error.message : "Check your connection to the library server.";
    } finally {
      this.busy = false;
      this.redraw();
    }
  }
  async connect(value) {
    const origin = endpoint(value);
    if (this.changingSource) throw new Error("Wait for the current source change to finish.");
    this.changingSource = true;
    try {
      await this.refreshTask;
      const version = await checkServer(origin);
      const state = version && !this.localFolder && this.hasCatalog(origin, version) ? { version, books: this.books } : await fetchCatalog(origin);
      if (this.stopped) return;
      await this.saveSettings(origin);
      this.app.saveLocalStorage(LOCAL_FOLDER_KEY, "");
      this.localFolder = "";
      this.applyCatalog(origin, state);
      this.connected = true;
      this.lastRefresh = /* @__PURE__ */ new Date();
      this.error = "";
      if (!this.snapshotSaved) {
        try {
          await this.storage.saveSnapshot({ schema: 1, origin, ...state });
          this.snapshotSaved = true;
        } catch {
          this.error = "Connected. Could not save the offline catalog.";
        }
      }
    } finally {
      this.changingSource = false;
      this.redraw();
    }
  }
  redraw() {
    if (this.stopped) return;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) {
      const view = leaf.view;
      if (view instanceof LibraryView) void this.run(() => view.render());
    }
  }
  redrawDetails() {
    if (!this.app.workspace.getLeavesOfType(DETAILS_VIEW).length) return;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) {
      if (leaf.view instanceof LibraryView) leaf.view.refreshDetails();
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
  async openBook(book, page = 1, side = false) {
    await this.openPDF(book, page, side);
  }
  async openPDF(book, page, side = false) {
    if (this.pdfPlusStatus() === "disabled") throw new Error("Enable PDF++ to open external references.");
    if (book.availability === "missing") throw new Error("Book not found on the server.");
    const linked = this.storage.folderReference(this.storage.personals().get(book.id));
    if (book.source === "local") await checkLocalPDF(book.readUrl);
    const available = (book.source === "local" ? Promise.resolve() : checkPDF(book.readUrl)).catch((error) => {
      throw new Error("Could not load the PDF. " + (error instanceof Error ? error.message : "Check your connection to the library server."));
    });
    const [file] = await Promise.all([this.storage.ensureReference(book, linked), available]);
    const leaf = this.app.workspace.getLeaf(side ? "split" : "tab");
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
  saveSettings(origin) {
    const write = this.settingsWrite.then(async () => {
      await this.saveData({
        origin: origin ?? this.origin,
        studyRoot: this.studyRoot,
        studyTemplate: this.studyTemplate,
        appearance: this.appearance
      });
      if (origin !== void 0) this.origin = origin;
    });
    this.settingsWrite = write.catch(() => {
    });
    return write;
  }
};
var LibrarySettings = class extends import_obsidian4.PluginSettingTab {
  constructor(library) {
    super(library.app, library);
    this.library = library;
  }
  display() {
    this.containerEl.empty();
    renderLibrarySettings(this.containerEl, this.library);
  }
};
