import { App, parseYaml, TFile, TFolder } from "obsidian";
import {
	Book, LEGACY_ROOT, Progress, ROOT, endpoint,
	bookFileName, idPattern, referencePath, studyFolder, validBooks, validProgress,
} from "./model";

interface Snapshot {
	schema: 1;
	origin: string;
	version: string;
	books: Book[];
}

export interface Personal {
	customTitle?: string;
	customCategory?: string;
	folder?: string;
	fileName?: string;
	organized?: boolean;
	coverPage?: number;
	favorite?: boolean;
}

export class LibraryStorage {
	private pendingNotes = new Map<string, Promise<TFile>>();
	private pendingRefs = new Map<string, Promise<TFile>>();

	readonly statePath: string;
	readonly snapshotPath: string;
	readonly personalPath: string;
	readonly notesPath: string;
	readonly root: string;
	readonly legacy: boolean;
	private paused = false;
	private writes = new Set<Promise<unknown>>();
	private readonly progressPath: string;
	private readonly deletedPath: string;

	constructor(private app: App, root?: string, legacyLayout?: boolean) {
		const legacy = legacyLayout ?? (root ? root === LEGACY_ROOT : ["_state", "_refs", "Notas"].some(folder =>
			app.vault.getAbstractFileByPath(LEGACY_ROOT + "/" + folder) instanceof TFolder));
		this.legacy = legacy;
		this.root = root ?? (legacy ? LEGACY_ROOT : ROOT);
		this.statePath = this.root + "/_state";
		this.snapshotPath = this.statePath + (legacy ? "/catalogo.md" : "/catalog.md");
		this.personalPath = this.statePath + (legacy ? "/livros/" : "/books/");
		this.progressPath = this.statePath + (legacy ? "/progresso/" : "/progress/");
		this.deletedPath = this.statePath + "/deleted/";
		this.notesPath = legacy ? LEGACY_ROOT + "/Notas/" : ROOT + "/Notes/";
	}

	async pauseWrites(): Promise<void> {
		this.paused = true;
		await Promise.allSettled(this.writes);
	}

	resumeWrites(): void { this.paused = false; }

	private write<T>(action: () => Promise<T>): Promise<T> {
		if (this.paused) return Promise.reject(new Error("Library data migration is pending. Open Data storage in settings."));
		const task = action().finally(() => this.writes.delete(task));
		this.writes.add(task);
		return task;
	}

	referencePath(bookId: string): string {
		return referencePath(bookId, this.root);
	}

	deletedBookIds(): Set<string> {
		return new Set(this.app.vault.getMarkdownFiles()
			.filter(file => file.path === this.deletedPath + file.basename + ".md" && idPattern.test(file.basename))
			.map(file => file.basename));
	}

	deleteFromLibrary(book: Book): Promise<void> {
		return this.write(() => this.deleteFromLibraryInternal(book));
	}

	private async deleteFromLibraryInternal(book: Book): Promise<void> {
		if (!idPattern.test(book.id)) throw new Error("Invalid book ID.");
		await this.ensureFolder(this.deletedPath.slice(0, -1));
		const path = this.deletedPath + book.id + ".md";
		if (this.app.vault.getAbstractFileByPath(path) instanceof TFile) return;
		try {
			await this.app.vault.create(path, "---\nbookId: " + book.id + "\n---\n");
		} catch (error) {
			if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFile)) throw error;
		}
	}

	async ensureFolder(path: string): Promise<void> {
		if (!path || this.app.vault.getAbstractFileByPath(path) instanceof TFolder) return;
		await this.ensureFolder(path.slice(0, Math.max(0, path.lastIndexOf("/"))));
		try {
			await this.app.vault.createFolder(path);
		} catch (error) {
			if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFolder)) throw error;
		}
	}

	private async metadata(path: string): Promise<Record<string, unknown> | undefined> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		const contents = await this.app.vault.read(file);
		const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(contents);
		if (match) return parseYaml(match[1]) as Record<string, unknown>;
	}

	async snapshot(): Promise<Snapshot | undefined> {
		const state = await this.metadata(this.snapshotPath);
		if (state?.schema !== 1 || typeof state.origin !== "string" || typeof state.version !== "string"
			|| typeof state.catalog !== "string") return;
		const origin = endpoint(state.origin);
		const books: unknown = JSON.parse(state.catalog);
		if (validBooks(books, origin)) return { schema: 1, origin, version: state.version, books };
	}

	saveSnapshot(state: Snapshot): Promise<void> {
		return this.write(() => this.saveSnapshotInternal(state));
	}

	private async saveSnapshotInternal(state: Snapshot): Promise<void> {
		const contents = "---\nschema: 1\norigin: " + JSON.stringify(state.origin)
			+ "\nversion: " + JSON.stringify(state.version) + "\ncatalog: "
			+ JSON.stringify(JSON.stringify(state.books)) + "\n---\n";
		await this.ensureFolder(this.snapshotPath.slice(0, this.snapshotPath.lastIndexOf("/")));
		const existing = this.app.vault.getAbstractFileByPath(this.snapshotPath);
		if (existing instanceof TFile) {
			await this.app.vault.process(existing, current => current === contents ? current : contents);
		} else {
			try {
				await this.app.vault.create(this.snapshotPath, contents);
			} catch (error) {
				const synced = this.app.vault.getAbstractFileByPath(this.snapshotPath);
				if (!(synced instanceof TFile)) throw error;
			}
		}
	}

	personals(): Map<string, Personal> {
		const result = new Map<string, Personal>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!file.path.startsWith(this.personalPath)) continue;
			const data = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (data?.bookId !== file.basename) continue;
			result.set(file.basename, {
				customTitle: typeof data.customTitle === "string" ? data.customTitle : undefined,
				customCategory: typeof data.customCategory === "string" ? data.customCategory : undefined,
				folder: typeof data.folder === "string" ? data.folder : undefined,
				fileName: typeof data.fileName === "string" ? data.fileName : undefined,
				organized: data.organized === true,
				favorite: data.favorite === true,
				coverPage: Number.isSafeInteger(data.coverPage) && data.coverPage > 1 ? data.coverPage : undefined,
			});
		}
		return result;
	}

	savePersonal(book: Book, values: Personal): Promise<void> {
		return this.write(() => this.savePersonalInternal(book, values));
	}

	private async savePersonalInternal(book: Book, values: Personal): Promise<void> {
		await this.ensureFolder(this.personalPath.slice(0, -1));
		const path = this.personalPath + book.id + ".md";
		let file = this.app.vault.getAbstractFileByPath(path);
		if (!file) {
			try {
				file = await this.app.vault.create(path, "---\nbookId: " + book.id + "\n---\n");
			} catch (error) {
				file = this.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) throw error;
			}
		}
		if (!(file instanceof TFile)) throw new Error("The metadata path is occupied.");
		await this.app.fileManager.processFrontMatter(file, data => {
			data.bookId = book.id;
			for (const [key, value] of Object.entries(values)) data[key] = value || null;
		});
	}

	progress(): Map<string, Progress[]> {
		const result = new Map<string, Progress[]>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!file.path.startsWith(this.progressPath)) continue;
			const data = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!validProgress(data) || file.path !== this.progressPath + data.bookId + "/" + data.id + ".md") continue;
			const entries = result.get(data.bookId) ?? [];
			entries.push(data);
			result.set(data.bookId, entries);
		}
		return result;
	}

	saveProgress(entry: Progress): Promise<void> {
		return this.write(() => this.saveProgressInternal(entry));
	}

	private async saveProgressInternal(entry: Progress): Promise<void> {
		const folder = this.progressPath + entry.bookId;
		await this.ensureFolder(folder);
		const fields = Object.entries({ schema: 1, ...entry });
		await this.app.vault.create(folder + "/" + entry.id + ".md",
			"---\n" + fields.map(([key, value]) => key + ": " + JSON.stringify(value)).join("\n") + "\n---\n");
	}

	ensureReference(book: Book, path = this.referencePath(book.id)): Promise<TFile> {
		return this.write(() => this.ensureReferenceInternal(book, path));
	}

	private ensureReferenceInternal(book: Book, path = this.referencePath(book.id)): Promise<TFile> {
		const pending = this.pendingRefs.get(path);
		if (pending) return pending;
		const task = this.writeReference(book, path).finally(() => this.pendingRefs.delete(path));
		this.pendingRefs.set(path, task);
		return task;
	}

	private async writeReference(book: Book, path: string): Promise<TFile> {
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
				if (!(file instanceof TFile)) throw error;
			}
		}
		if (!(file instanceof TFile) || file.stat.size > 300) {
			throw new Error("Another file occupies the reference path.");
		}
		const old = new TextDecoder().decode(await this.app.vault.readBinary(file));
		if (old !== book.readUrl) {
			let oldOrigin: string;
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

	note(book: Book, root: string): Promise<TFile> {
		return this.write(() => this.noteInternal(book, root));
	}

	private noteInternal(book: Book, root: string): Promise<TFile> {
		const pending = this.pendingNotes.get(book.id);
		if (pending) return pending;
		const task = this.findOrCreateNote(book, root).finally(() => this.pendingNotes.delete(book.id));
		this.pendingNotes.set(book.id, task);
		return task;
	}

	studyNotes(book: Book): TFile[] {
		const record = this.findNote(book);
		if (!record?.parent) return [];
		const folder = record.parent.name === "Notes" ? record.parent.path
			: record.parent.isRoot() ? "Notes" : record.parent.path + "/Notes";
		const links = this.app.metadataCache.resolvedLinks;
		const notes = this.app.vault.getMarkdownFiles().filter(file =>
			file !== record && file.parent?.path === folder && links[file.path]?.[record.path]);
		return [record, ...notes];
	}

	private findNote(book: Book): TFile | undefined {
		const files = this.app.vault.getMarkdownFiles().filter(file => !file.path.startsWith(this.statePath + "/"));
		return files.find(file => {
			const data = this.app.metadataCache.getFileCache(file)?.frontmatter;
			return this.isBookRecord(data, book, file.path)
				|| (data?.bookId === book.id && data?.refPath === this.referencePath(book.id));
		}) ?? files.find(file => file.path.startsWith(this.notesPath) && file.basename.endsWith("-" + book.id));
	}

	private isBookRecord(data: Record<string, unknown> | undefined, book: Book, source: string): boolean {
		if ((typeof data?.Title !== "string" && typeof data?.Livro !== "string") || typeof data?.PDF !== "string") return false;
		const target = /^\[\[([^#|\]]+)/.exec(data.PDF)?.[1];
		const reference = this.referencePath(book.id);
		return target === reference || (!!target && this.app.metadataCache.getFirstLinkpathDest?.(target, source)?.path === reference);
	}

	private pdfLink(book: Book): string {
		return "[[" + this.referencePath(book.id) + "|Open book]]";
	}

	folderReference(values: Personal | undefined): string | undefined {
		const { folder, fileName } = values ?? {};
		if (!folder || !fileName || bookFileName(fileName) !== fileName) return;
		try { return studyFolder(folder, this.root) + (values?.organized ? "/Files/" : "/") + fileName + ".pdf"; } catch { return; }
	}

	linkFolder(book: Book, input: string): Promise<TFile> {
		return this.write(() => this.linkFolderInternal(book, input));
	}

	private async linkFolderInternal(book: Book, input: string): Promise<TFile> {
		const folder = studyFolder(input, this.root);
		await this.ensureReferenceInternal(book);
		const values = this.personals().get(book.id);
		let fileName = values?.fileName ?? bookFileName(values?.customTitle ?? book.title);
		const previousReference = this.folderReference(values);
		const files = folder + "/Files";
		const notes = folder + "/Notes";
		const existing = this.findNote(book)
			?? await this.noteAt(notes + "/" + fileName + ".md", book)
			?? (values?.folder ? await this.noteAt(values.folder + "/" + fileName + ".md", book) : undefined);
		await this.ensureFolder(folder);
		const occupied = this.app.vault.getAbstractFileByPath(files + "/" + fileName + ".pdf");
		const alreadyLinked = occupied instanceof TFile && occupied.stat.size <= 300
			&& new TextDecoder().decode(await this.app.vault.readBinary(occupied)) === book.readUrl;
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
		const old = previousReference ? this.app.vault.getAbstractFileByPath(previousReference) : undefined;
		if (values?.folder === folder && !values.organized && old instanceof TFile && old.stat.size <= 300
			&& !this.app.vault.getAbstractFileByPath(targetReference)
			&& new TextDecoder().decode(await this.app.vault.readBinary(old)) === book.readUrl) {
			await this.ensureFolder(files);
			await this.app.fileManager.renameFile(old, targetReference);
		}
		await this.ensureReferenceInternal(book, targetReference);
		const note = existing ?? await this.createNote(book, notes, fileName);
		await this.savePersonalInternal(book, { folder, fileName, organized: true });
		return note;
	}

	private async noteAt(path: string, book: Book): Promise<TFile | undefined> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile && this.isBookRecord(await this.metadata(path), book, path)) return file;
	}

	private async findOrCreateNote(book: Book, root: string): Promise<TFile> {
		await this.ensureReferenceInternal(book);
		const existing = this.findNote(book);
		const values = this.personals().get(book.id);
		const linked = this.folderReference(values);
		if (linked) await this.ensureReferenceInternal(book, linked);
		if (existing) return existing;
		if (values?.folder && linked) return this.createNote(book, values.folder + (values.organized ? "/Notes" : ""), values.fileName!);
		const fileName = bookFileName(values?.customTitle ?? book.title);
		const folder = studyFolder(root, this.root) + "/" + fileName + " (" + book.id.slice(0, 8) + ")";
		return this.linkFolderInternal(book, folder);
	}

	private async createNote(book: Book, folder: string, fileName: string): Promise<TFile> {
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

	createStudyNote(book: Book, ficha: TFile, title: string, templatePath: string): Promise<TFile> {
		return this.write(() => this.createStudyNoteInternal(book, ficha, title, templatePath));
	}

	private async createStudyNoteInternal(book: Book, ficha: TFile, title: string, templatePath: string): Promise<TFile> {
		const requested = title.trim().replace(/\.md$/i, "").trim();
		if (!requested || !ficha.parent) throw new Error("Enter a note title.");
		const name = bookFileName(requested);
		const template = templatePath ? this.app.vault.getAbstractFileByPath(templatePath) : undefined;
		if (templatePath && !(template instanceof TFile)) throw new Error("The study note template was not found in the vault.");
		const body = template instanceof TFile ? await this.app.vault.read(template) : "# " + name + "\n";
		const notes = ficha.parent.name === "Notes" ? ficha.parent.path
			: ficha.parent.isRoot() ? "Notes" : ficha.parent.path + "/Notes";
		await this.ensureFolder(notes);
		const directory = notes + "/";
		const link = this.app.fileManager.generateMarkdownLink(ficha, directory + name + ".md", undefined, "Book record");
		const path = directory + name + ".md";
		if (this.app.vault.getAbstractFileByPath(path)) throw new Error("A note with that name already exists in the folder.");
		return this.app.vault.create(path, body.trimEnd() + "\n\n"
			+ link + " · " + this.pdfLink(book) + "\n");
	}
}
