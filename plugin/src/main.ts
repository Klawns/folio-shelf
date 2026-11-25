import { Notice, Platform, Plugin, PluginSettingTab, WorkspaceLeaf } from "obsidian";
import { checkLocalPDF, scanLocalFolder } from "./local";
import { Book, NOTES, PERSONAL, Progress, SNAPSHOT, STATE, endpoint, hasConflict, idPattern, progressHeads, referencePath } from "./model";
import { checkPDF, checkServer, fetchCatalog } from "./remote";
import { LibraryStorage, Personal } from "./storage";
import { BookDetailsView, DETAILS_VIEW, LibraryView, VIEW, renderLibrarySettings } from "./view";

interface PDFViewer {
	currentPageNumber: number;
	pdfDocument?: object;
}

const LOCAL_FOLDER_KEY = "obsidian-library-local-folder";

interface PageSample {
	viewer: PDFViewer;
	document: object;
	bookId: string;
	page: number;
	since: number;
	handled: boolean;
	moved: boolean;
}

export default class LibraryPlugin extends Plugin {
	storage!: LibraryStorage;
	origin = "";
	localFolder = "";
	studyRoot = NOTES.slice(0, -1);
	studyTemplate = "";
	appearance = { layout: "grid" as "grid" | "list", coverSize: 150, showProgress: true };
	lastRefresh?: Date;
	addedAt: Record<string, number> = {};
	private trackAdditions = false;
	private settingsWrite = Promise.resolve();
	books: Book[] = [];
	connected = false;
	error = "";
	busy = false;
	private deviceId = "";
	private stopped = false;
	private refreshTask?: Promise<void>;
	private changingSource = false;
	private catalogIdentity?: { origin: string; version: string };
	private snapshotSaved = false;
	private reloadTimer?: number;
	private snapshotDirty = false;
	private referencesDirty = false;
	private generatingReferences = false;
	private pageSample?: PageSample;
	private savingViewerPage = false;

	async onload(): Promise<void> {
		this.storage = new LibraryStorage(this.app);
		const added: unknown = this.app.loadLocalStorage("obsidian-library-first-seen");
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
			try { this.origin = endpoint(settings.origin); } catch { this.origin = ""; }
		}
		const key = "obsidian-library-device-id";
		const stored: unknown = this.app.loadLocalStorage(key);
		this.deviceId = typeof stored === "string" && idPattern.test(stored) ? stored : crypto.randomUUID();
		this.app.saveLocalStorage(key, this.deviceId);
		const localFolder: unknown = this.app.loadLocalStorage(LOCAL_FOLDER_KEY);
		if (!Platform.isMobile && typeof localFolder === "string") this.localFolder = localFolder;
		this.registerView(VIEW, leaf => new LibraryView(leaf, this));
		this.registerView(DETAILS_VIEW, leaf => new BookDetailsView(leaf));
		this.addRibbonIcon("library", "Open library", () => void this.run(() => this.openLibrary()));
		this.addCommand({ id: "open-library", name: "Open library", callback: () => void this.run(() => this.openLibrary()) });
		this.addCommand({ id: "open-book-note", name: "Open notes for the current book", checkCallback: checking => {
			const book = this.activeBook();
			if (!book) return false;
			if (!checking) void this.run(() => this.openNote(book));
			return true;
		} });
		this.addCommand({ id: "confirm-page", name: "Confirm page for the current book", checkCallback: checking => {
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
			this.registerInterval(window.setInterval(() => void this.run(() => this.saveViewerPage()), 1000));
			const update = (path: string) => {
				if (!path.startsWith(STATE + "/")) return;
				this.snapshotDirty ||= path === SNAPSHOT;
				this.referencesDirty ||= path.startsWith(PERSONAL);
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
			this.registerEvent(this.app.metadataCache.on("changed", file => update(file.path)));
			this.registerEvent(this.app.metadataCache.on("resolve", file => {
				if (!file.path.startsWith(STATE + "/")) this.redrawDetails();
			}));
			this.registerEvent(this.app.vault.on("delete", file => {
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

	onunload(): void {
		this.stopped = true;
		window.clearTimeout(this.reloadTimer);
	}

	async run(action: () => Promise<unknown>): Promise<void> {
		try {
			await action();
		} catch (error) {
			if (!this.stopped) new Notice(error instanceof Error ? error.message : "Could not complete the operation.");
		}
	}

	private async loadSnapshot(): Promise<void> {
		if (this.localFolder) return;
		try {
			const state = await this.storage.snapshot();
			if (this.stopped || this.localFolder) return;
			if (!state || (this.origin && state.origin !== this.origin)) {
				this.snapshotSaved = false;
				return;
			}
			this.applyCatalog(state.origin, state);
			this.snapshotSaved = true;
		} catch {
			if (!this.stopped) this.error = "Could not read the synced catalog.";
		}
	}

	private hasCatalog(origin: string, version: string): boolean {
		return this.catalogIdentity?.origin === origin && this.catalogIdentity.version === version;
	}

	private setBooks(books: Book[]): void {
		this.books = books;
		if (!this.trackAdditions) return;
		const newBooks = books.filter(book => this.addedAt[book.id] === undefined);
		if (!newBooks.length) return;
		const now = Date.now();
		for (const book of newBooks) this.addedAt[book.id] = now;
		this.app.saveLocalStorage("obsidian-library-first-seen", this.addedAt);
	}

	private applyCatalog(origin: string, state: { version: string; books: Book[] }): void {
		if (this.hasCatalog(origin, state.version)) return;
		this.catalogIdentity = { origin, version: state.version };
		this.snapshotSaved = false;
		this.setBooks(state.books);
		void this.regenerateReferences();
	}

	private async regenerateReferences(): Promise<void> {
		if (this.generatingReferences) return;
		this.generatingReferences = true;
		try {
			let source: Book[];
			let failed: boolean;
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
					} catch { failed = true; }
					if (index % 20 === 0) await new Promise(resolve => window.setTimeout(resolve, 0));
				}
			} while (!this.stopped && source !== this.books);
			if (failed && !this.stopped) new Notice("Some PDF references need attention. Open the book to see the error.");
		} finally {
			this.generatingReferences = false;
		}
	}

	refresh(): Promise<void> {
		if (this.changingSource || (!this.localFolder && !this.origin)) return Promise.resolve();
		const folder = this.localFolder;
		return this.refreshTask ??= (folder ? this.refreshLocal(folder) : this.refreshCatalog(this.origin)).finally(() => {
			this.refreshTask = undefined;
		});
	}

	private async refreshLocal(folder: string): Promise<void> {
		this.busy = true;
		this.error = "";
		this.redraw();
		try {
			const state = await scanLocalFolder(folder, this.deviceId);
			if (this.stopped) return;
			this.setBooks(state.books);
			this.connected = true;
			this.lastRefresh = new Date();
		} catch (error) {
			this.connected = false;
			this.error = error instanceof Error ? error.message : "Could not scan the PDF folder.";
		} finally {
			this.busy = false;
			this.redraw();
		}
	}

	async useLocalFolder(value: string): Promise<void> {
		if (Platform.isMobile) throw new Error("Local folders are available on desktop.");
		if (this.changingSource) throw new Error("Wait for the current source change to finish.");
		this.changingSource = true;
		try {
			await this.refreshTask;
			const state = await scanLocalFolder(value, this.deviceId);
			if (this.stopped) return;
			this.app.saveLocalStorage(LOCAL_FOLDER_KEY, state.folder);
			this.localFolder = state.folder;
			this.catalogIdentity = undefined;
			this.snapshotSaved = false;
			this.setBooks(state.books);
			this.error = "";
			this.connected = true;
			this.lastRefresh = new Date();
		} finally {
			this.changingSource = false;
			this.redraw();
		}
	}

	private async refreshCatalog(origin: string): Promise<void> {
		this.busy = true;
		this.error = "";
		this.redraw();
		try {
			const version = await checkServer(origin);
			if (this.stopped || this.origin !== origin) return;
			const state = version && this.hasCatalog(origin, version)
				? { version, books: this.books }
				: await fetchCatalog(origin);
			if (this.stopped || this.origin !== origin) return;
			this.applyCatalog(origin, state);
			this.connected = true;
			this.lastRefresh = new Date();
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

	async connect(value: string): Promise<void> {
		const origin = endpoint(value);
		if (this.changingSource) throw new Error("Wait for the current source change to finish.");
		this.changingSource = true;
		try {
			await this.refreshTask;
			const version = await checkServer(origin);
			const state = version && !this.localFolder && this.hasCatalog(origin, version)
				? { version, books: this.books }
				: await fetchCatalog(origin);
			if (this.stopped) return;
			await this.saveSettings(origin);
			this.app.saveLocalStorage(LOCAL_FOLDER_KEY, "");
			this.localFolder = "";
			this.applyCatalog(origin, state);
			this.connected = true;
			this.lastRefresh = new Date();
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

	redraw(): void {
		if (this.stopped) return;
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) {
			const view = leaf.view;
			if (view instanceof LibraryView) void this.run(() => view.render());
		}
	}

	private redrawDetails(): void {
		if (!this.app.workspace.getLeavesOfType(DETAILS_VIEW).length) return;
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) {
			if (leaf.view instanceof LibraryView) leaf.view.refreshDetails();
		}
	}

	private activeBook(): Book | undefined {
		const path = this.app.workspace.getActiveFile()?.path;
		if (!path?.endsWith(".pdf")) return;
		const personals = this.storage.personals();
		return this.books.find(book => referencePath(book.id) === path
			|| this.storage.folderReference(personals.get(book.id)) === path);
	}

	private async saveViewerPage(): Promise<void> {
		const path = this.app.workspace.getActiveFile()?.path;
		if (!path?.endsWith(".pdf")) return;
		const pdfPlus = (window as Window & { pdfPlus?: { lib?: {
			getPDFView?(activeOnly: boolean): { file?: { path: string } } | null;
			getPDFViewer?(activeOnly: boolean): PDFViewer | undefined;
		} } }).pdfPlus?.lib;
		if (pdfPlus?.getPDFView?.(true)?.file?.path !== path) return;
		const viewer = pdfPlus.getPDFViewer?.(true);
		const page = viewer?.currentPageNumber;
		const document = viewer?.pdfDocument;
		if (!viewer || !document || typeof page !== "number" || !Number.isSafeInteger(page) || page < 1) return;
		const previous = this.pageSample;
		if (previous?.viewer === viewer && previous.document === document && previous.page === page && previous.handled) return;
		const book = this.activeBook();
		if (!book || (book.pageCount && page > book.pageCount)) return;
		const sameDocument = previous?.viewer === viewer && previous.document === document && previous.bookId === book.id;
		if (!sameDocument || previous.page !== page) {
			this.pageSample = { viewer, document, bookId: book.id, page, since: Date.now(), handled: false, moved: sameDocument };
			return;
		}
		if (Date.now() - previous.since < 2000 || this.savingViewerPage) return;
		const heads = progressHeads(this.storage.progress().get(book.id) ?? []);
		const current = heads[0];
		if (hasConflict(heads) || current?.completed || page === (current?.page ?? 1)
			|| (!previous.moved && page < (current?.page ?? 1))) {
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

	private async libraryLeaf(): Promise<WorkspaceLeaf> {
		const leaves = this.app.workspace.getLeavesOfType(VIEW);
		let leaf = leaves.find(candidate => candidate.view instanceof LibraryView
			&& candidate.view.containerEl.parentElement !== null);
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

	async openLibrary(): Promise<void> {
		const leaf = await this.libraryLeaf();
		await this.app.workspace.revealLeaf(leaf);
		if (leaf.view instanceof LibraryView) await leaf.view.mountLibrary();
	}

	pdfPlusStatus(): "enabled" | "disabled" | "unknown" {
		const app = this.app as typeof this.app & { plugins?: { enabledPlugins?: Set<string> } };
		const enabled = app.plugins?.enabledPlugins;
		if (!enabled || typeof enabled.has !== "function") return "unknown";
		return enabled.has("pdf-plus") ? "enabled" : "disabled";
	}

	async openBook(book: Book, page = 1, side = false): Promise<void> {
		await this.openPDF(book, page, side);
	}

	private async openPDF(book: Book, page: number, side = false): Promise<WorkspaceLeaf> {
		if (this.pdfPlusStatus() === "disabled") throw new Error("Enable PDF++ to open external references.");
		if (book.availability === "missing") throw new Error("Book not found on the server.");
		const linked = this.storage.folderReference(this.storage.personals().get(book.id));
		if (book.source === "local") await checkLocalPDF(book.readUrl);
		const available = (book.source === "local" ? Promise.resolve() : checkPDF(book.readUrl)).catch(error => {
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
			new Notice("Saved page: " + page);
		} else {
			await leaf.openFile(file, { active: true });
		}
		return leaf;
	}

	async openNote(book: Book): Promise<void> {
		const note = await this.storage.note(book, this.studyRoot);
		await this.app.workspace.getLeaf("tab").openFile(note);
	}

	async copyLink(book: Book): Promise<void> {
		await this.storage.ensureReference(book);
		await navigator.clipboard.writeText("[[" + referencePath(book.id) + "]]");
		new Notice("Reference copied.");
	}

	async record(book: Book, page: number, completed: boolean, heads: Progress[]): Promise<void> {
		if (!Number.isSafeInteger(page) || page < 1 || (book.pageCount && page > book.pageCount)) {
			throw new Error("Enter a valid page number.");
		}
		await this.storage.saveProgress({
			id: crypto.randomUUID(), bookId: book.id, page, completed,
			updatedAt: new Date().toISOString(), deviceId: this.deviceId, parents: heads.map(head => head.id),
		});
	}

	async personalize(book: Book, values: Personal): Promise<void> {
		await this.storage.savePersonal(book, values);
	}

	async linkFolder(book: Book, path: string): Promise<void> {
		await this.storage.linkFolder(book, path);
		new Notice("Folder linked to the book.");
	}

	async deleteFromLibrary(book: Book): Promise<void> {
		await this.storage.deleteFromLibrary(book);
		this.redraw();
	}

	async createStudyNote(book: Book, title: string, page = 1): Promise<void> {
		const ficha = await this.storage.note(book, this.studyRoot);
		const note = await this.storage.createStudyNote(book, ficha, title, this.studyTemplate);
		let pdfLeaf: WorkspaceLeaf | undefined;
		if (!Platform.isMobile && book.availability === "available") {
			try {
				pdfLeaf = await this.openPDF(book, page);
			} catch (error) {
				new Notice(error instanceof Error ? error.message : "Could not open the PDF alongside the note.");
			}
		}
		const noteLeaf = pdfLeaf ? this.app.workspace.createLeafBySplit(pdfLeaf, "vertical") : this.app.workspace.getLeaf("tab");
		await noteLeaf.openFile(note, { active: true });
	}

	saveSettings(origin?: string): Promise<void> {
		const write = this.settingsWrite.then(async () => {
			await this.saveData({
				origin: origin ?? this.origin, studyRoot: this.studyRoot,
				studyTemplate: this.studyTemplate, appearance: this.appearance,
			});
			if (origin !== undefined) this.origin = origin;
		});
		this.settingsWrite = write.catch(() => {});
		return write;
	}
}

class LibrarySettings extends PluginSettingTab {
	constructor(private library: LibraryPlugin) { super(library.app, library); }

	display(): void {
		this.containerEl.empty();
		renderLibrarySettings(this.containerEl, this.library);
	}
}
