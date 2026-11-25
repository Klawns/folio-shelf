import { ItemView, Menu, Modal, Platform, Setting, SuggestModal, WorkspaceLeaf, setIcon, setTooltip } from "obsidian";
import type LibraryPlugin from "./main";
import { Book, Progress, hasConflict, progressHeads, studyFolder } from "./model";
import type { Personal } from "./storage";

export const VIEW = "obsidian-library";
export const DETAILS_VIEW = "obsidian-library-details";

export class BookDetailsView extends ItemView {
	getViewType(): string { return DETAILS_VIEW; }
	getDisplayText(): string { return "Book details"; }
	getIcon(): string { return "book-open"; }
	async onOpen(): Promise<void> {
		this.contentEl.addClass("ol-book-details");
		this.contentEl.createEl("p", { text: "Open a book's details from the Library.", cls: "ol-secondary" });
	}
}

const PAGE_SIZE = 10;
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en");

export class LibraryView extends ItemView {
	private query = "";
	private category = "";
	private status = "";
	private page = 1;
	private isRenderingEnabled = false;
	private body!: HTMLElement;
	private message!: HTMLElement;
	private categories!: HTMLSelectElement;
	private clearFilters!: () => void;
	private sort = "title";
	private layoutButtons = new Map<string, HTMLButtonElement>();
	private summary!: HTMLElement;
	private resultCount!: HTMLElement;
	private resume!: HTMLElement;
	private details?: { bookId: string; view: BookDetailsView };
	private detailsRequest = 0;
	private connectionButton!: HTMLButtonElement;
	private personals = new Map<string, Personal>();
	private heads = new Map<string, Progress[]>();
	private books: Book[] = [];

	constructor(leaf: WorkspaceLeaf, private plugin: LibraryPlugin) { super(leaf); }
	getViewType(): string { return VIEW; }
	getDisplayText(): string { return "Library"; }
	getIcon(): string { return "library"; }

	async onOpen(): Promise<void> {
		await this.mountLibrary();
	}

	async mountLibrary(): Promise<void> {
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
		const toolbar = root.createDiv("ol-toolbar ol-filters");
		const search = toolbar.createEl("input", { type: "search", placeholder: "Search by title or author",
			attr: { "aria-label": "Search by title or author" } });
		search.value = this.query;
		search.addEventListener("input", () => { this.query = search.value; this.reset(); });
		const filterModal = Platform.isMobile ? new Modal(this.app) : undefined;
		filterModal?.setTitle("Filter and sort");
		if (filterModal) this.iconButton(toolbar, "Filter and sort", "list-filter", () => filterModal.open());
		const filters = (filterModal?.contentEl ?? toolbar).createDiv("ol-toolbar ol-filter-controls");
		const statuses = filters.createEl("select", { attr: { "aria-label": "Reading status" } });
		for (const [value, text] of [["", "All statuses"], ["reading", "Reading"], ["new", "Unread"], ["done", "Finished"], ["favorite", "Favorites"]]) {
			statuses.createEl("option", { value, text });
		}
		statuses.value = this.status;
		statuses.addEventListener("change", () => { this.status = statuses.value; this.reset(); });
		this.categories = filters.createEl("select", { attr: { "aria-label": "Category" } });
		this.categories.addEventListener("change", () => { this.category = this.categories.value; this.reset(); });
		const sort = filters.createEl("select", { attr: { "aria-label": "Sort by" } });
		for (const [value, text] of [["title", "Title"], ["author", "Author"], ["reading", "Last read"], ["added", "Recently added"]]) {
			sort.createEl("option", { value, text });
		}
		sort.value = this.sort;
		sort.addEventListener("change", () => { this.sort = sort.value; this.reset(); });
		this.clearFilters = () => {
			this.query = search.value = this.category = this.categories.value = this.status = statuses.value = "";
			this.reset();
			search.focus();
		};
		this.resume = root.createDiv("ol-resume-section");
		const heading = root.createDiv("ol-toolbar ol-section-heading");
		const allBooks = heading.createEl("h3", { text: "All books" });
		this.resultCount = allBooks.createSpan({ cls: "ol-result-count ol-secondary" });
		for (const [layout, label, icon] of [["grid", "Grid", "layout-grid"], ["list", "List", "list"]] as const) {
			this.layoutButtons.set(layout, this.iconButton(heading, label, icon, async () => {
				this.plugin.appearance.layout = layout;
				this.plugin.redraw();
				await this.plugin.saveSettings();
			}));
		}
		this.body = root.createDiv();
		this.isRenderingEnabled = true;
		await this.render();
	}

	async onClose(): Promise<void> {
		this.isRenderingEnabled = false;
	}

	async render(): Promise<void> {
		if (!this.isRenderingEnabled) return;
		this.personals = this.plugin.storage.personals();
		this.heads = new Map([...this.plugin.storage.progress()].map(([id, entries]) => [id, progressHeads(entries)]));
		const deleted = this.plugin.storage.deletedBookIds();
		this.books = this.plugin.books.filter(book => !deleted.has(book.id));
		const categories = [...new Set(this.books.map(book => this.categoryFor(book)))].sort(collator.compare);
		this.categories.empty();
		this.categories.createEl("option", { value: "", text: "All categories" });
		for (const category of categories) this.categories.createEl("option", { value: category, text: category });
		if (this.category && !categories.includes(this.category)) this.category = "";
		this.categories.value = this.category;
		const local = Boolean(this.plugin.localFolder);
		const configured = local || Boolean(this.plugin.origin);
		const state = this.plugin.busy ? "Refreshing" : this.plugin.connected
			? (local ? "Local folder" : "Connected") : configured ? "Unavailable" : "Set up library";
		this.connectionButton.setText(state);
		this.connectionButton.dataset.connected = String(this.plugin.connected === true);
		this.connectionButton.setAttribute("aria-label", configured ? state + ". Show library connection" : state);
		const reading = this.books.filter(book => this.statusFor(book) === "reading").length;
		this.summary.setText(this.bookCount(this.books.length) + " / " + reading + " in progress");
		this.message.setText([
			this.plugin.busy ? "Loading library..." : "",
			this.plugin.error,
			this.plugin.pdfPlusStatus() === "disabled" ? "Enable PDF++ to open external references." : "",
		].filter(Boolean).join(" "));
		if (this.plugin.pdfPlusStatus() === "disabled") this.message.createEl("a", {
			text: " PDF++ instructions", href: "https://ryotaushio.github.io/obsidian-pdf-plus/external-pdf-files.html",
			attr: { target: "_blank", rel: "noopener noreferrer" },
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

	refreshDetails(): void {
		const selected = this.details;
		if (!selected) return;
		const leaf = selected.view.leaf;
		if (!this.app.workspace.getLeavesOfType(DETAILS_VIEW).includes(leaf)) {
			this.details = undefined;
			return;
		}
		const book = this.books.find(book => book.id === selected.bookId);
		if (book) this.renderDetails(selected.view.contentEl, book, () => leaf.detach());
		else leaf.detach();
	}

	private bookCount(count: number): string {
		return count + (count === 1 ? " book" : " books");
	}

	private reset(): void {
		this.page = 1;
		this.draw();
	}

	private title(book: Book): string { return this.personals.get(book.id)?.customTitle || book.title; }
	private categoryFor(book: Book): string { return this.personals.get(book.id)?.customCategory || book.category; }
	private current(book: Book): Progress | undefined {
		const heads = this.heads.get(book.id) ?? [];
		return hasConflict(heads) ? undefined : heads[0];
	}

	private statusFor(book: Book): string {
		const current = this.current(book);
		return current?.completed ? "done"
			: (current?.page ?? 1) > 1 || hasConflict(this.heads.get(book.id) ?? []) ? "reading" : "new";
	}

	private lastRead(book: Book): string {
		return (this.heads.get(book.id) ?? []).reduce((latest, head) => head.updatedAt > latest ? head.updatedAt : latest, "");
	}

	private drawResume(): void {
		this.resume.empty();
		const reading = this.books.filter(book => this.statusFor(book) === "reading" && book.availability === "available")
			.sort((a, b) => this.lastRead(b).localeCompare(this.lastRead(a)));
		if (!reading.length) return;
		const heading = this.resume.createEl("h3", { text: "Continue reading", cls: "ol-section-heading" });
		heading.createSpan({ text: String(reading.length), cls: "ol-result-count ol-secondary" });
		const shelf = this.resume.createDiv("ol-resume");
		for (const book of reading) {
			const title = this.title(book);
			const current = this.current(book);
			const label = (current ? "Continue reading " : "Resolve reading progress for ") + title;
			const item = this.button(shelf, "", () => this.continue(book));
			item.addClass("ol-resume-book");
			item.setAttribute("aria-label", label);
			setTooltip(item, label);
			this.renderCover(item, book);
			const info = item.createSpan({ cls: "ol-resume-info" });
			info.createSpan({ text: title, cls: "ol-card-title" });
			if (this.plugin.appearance?.showProgress !== false) this.renderProgress(info, book);
			const action = item.createSpan({ cls: "ol-resume-action", attr: { "aria-hidden": "true" } });
			setIcon(action, current ? "play" : "book-open");
		}
	}

	private draw(): void {
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
		const filtered = books.filter(book => {
			if (this.category && this.category !== this.categoryFor(book)) return false;
			const matchesStatus = !this.status || (this.status === "favorite"
				? this.personals.get(book.id)?.favorite : this.statusFor(book) === this.status);
			return matchesStatus && normalize(this.title(book) + " " + (book.author ?? "")).includes(query);
		}).sort((a, b) => {
			const order = this.sort === "author" ? collator.compare(a.author ?? "", b.author ?? "")
				: this.sort === "reading" ? this.lastRead(b).localeCompare(this.lastRead(a))
				: this.sort === "added" ? (this.plugin.addedAt[b.id] ?? 0) - (this.plugin.addedAt[a.id] ?? 0) : 0;
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
		const move = (offset: number) => {
			this.page += offset;
			this.draw();
			this.body.querySelector<HTMLButtonElement>(".ol-card-open")?.focus();
		};
		this.button(navigation, "Previous", () => move(-1)).disabled = this.page === 1;
		navigation.createEl("span", { text: "Page " + this.page + " of " + pageCount });
		this.button(navigation, "Next", () => move(1)).disabled = this.page === pageCount;
	}

	private renderProgress(parent: HTMLElement, book: Book, showPage = true): void {
		const progress = this.current(book);
		const conflict = hasConflict(this.heads.get(book.id) ?? []);
		const percent = conflict ? undefined : progress?.completed ? 100
			: progress && book.pageCount ? Math.min(100, Math.round(progress.page / book.pageCount * 100)) : undefined;
		const status = book.availability === "missing" ? "Unavailable"
			: conflict ? "Conflicting reading progress" : progress?.completed ? "Finished"
			: this.statusFor(book) === "reading" ? "Page " + progress?.page : "Not started";
		const row = parent.createSpan({ cls: "ol-progress" });
		const label = row.createSpan({ cls: "ol-progress-label ol-secondary" });
		label.createSpan({ text: showPage || !progress || progress.completed || book.availability === "missing" ? status : "" });
		if (percent !== undefined && book.availability !== "missing") {
			label.createSpan({ text: percent + "%" });
			row.createEl("progress", { attr: { value: percent, max: 100, "aria-label": "Reading progress" } });
		}
	}

	private card(grid: HTMLElement, book: Book): void {
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
		card.addEventListener("contextmenu", event => {
			event.preventDefault();
			this.bookMenu(book).showAtMouseEvent(event);
		});
	}

	private showMenu(button: HTMLElement, book: Book): void {
		const position = button.getBoundingClientRect();
		this.bookMenu(book).showAtPosition({ x: position.left, y: position.bottom });
	}

	private bookMenu(book: Book): Menu {
		const options = new Menu();
		const add = (label: string, icon: string, action: () => void | Promise<void>) => options.addItem(item =>
			item.setTitle(label).setIcon(icon).onClick(() => void this.plugin.run(async () => action())));
		const progress = this.current(book);
		const conflict = hasConflict(this.heads.get(book.id) ?? []);
		if (book.availability === "available") {
			add("Open book", "book-open", () => this.continue(book));
			if (!Platform.isMobile) add("Open to the side", "columns-2", () => this.continue(book, true));
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
		if (!conflict && !progress?.completed) add("Mark as finished", "check", () =>
			this.plugin.record(book, progress?.page ?? 1, true, progress ? [progress] : []));
		if (!conflict && progress && (progress.completed || progress.page > 1)) add("Reset progress...", "rotate-ccw", () => this.resetProgressDialog(book, progress));
		options.addSeparator();
		add("Delete from library...", "trash-2", () => this.deleteDialog(book));
		return options;
	}

	private resetProgressDialog(book: Book, progress: Progress): void {
		const modal = new Modal(this.app);
		modal.setTitle("Reset reading progress?");
		modal.contentEl.createEl("p", { text: this.title(book) + " will return to page 1." });
		new Setting(modal.contentEl)
			.addButton(button => button.setButtonText("Cancel").onClick(() => modal.close()))
			.addButton(button => button.setButtonText("Reset progress").setWarning().onClick(async () => {
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

	private deleteDialog(book: Book): void {
		const modal = new Modal(this.app);
		modal.setTitle("Delete from library?");
		modal.contentEl.createEl("p", {
			text: "Hide “" + this.title(book) + "” from your library. The original PDF, notes, and reading progress are kept.",
		});
		new Setting(modal.contentEl)
			.addButton(button => button.setButtonText("Cancel").onClick(() => modal.close()))
			.addButton(button => button.setButtonText("Delete from library").setWarning().onClick(async () => {
				button.setDisabled(true);
				await this.plugin.run(async () => {
					await this.plugin.deleteFromLibrary(book);
					modal.close();
				});
				button.setDisabled(false);
			}));
		modal.open();
	}

	private renderCover(parent: HTMLElement, book: Book): void {
		const cover = parent.createEl("span", { cls: "ol-cover", attr: { "aria-hidden": "true" } });
		setIcon(cover, "file-text");
		cover.createSpan({ text: "PDF" });
		const page = this.personals.get(book.id)?.coverPage;
		const selectedPage = page && book.pageCount && page <= book.pageCount ? page : undefined;
		const src = selectedPage ? book.readUrl.replace(/\/file$/, "/cover?page=" + selectedPage) : book.coverUrl;
		if (!src) return;
		const image = cover.createEl("img", { attr: { loading: "lazy", alt: "", src } });
		const markLoaded = () => cover.addClass("ol-cover-loaded");
		image.addEventListener("load", markLoaded);
		if (image.complete && image.naturalWidth > 0) markLoaded();
		image.addEventListener("error", () => {
			cover.classList.remove("ol-cover-loaded");
			if (selectedPage && book.coverUrl && image.getAttribute("src") !== book.coverUrl) image.src = book.coverUrl;
			else image.remove();
		});
	}

	private async continue(book: Book, side = false): Promise<void> {
		if (hasConflict(this.heads.get(book.id) ?? [])) this.showBookProgress(book);
		else await this.plugin.openBook(book, this.current(book)?.page, side);
	}

	private button(parent: HTMLElement, text: string, action: () => void | Promise<void>): HTMLButtonElement {
		const button = parent.createEl("button", { text });
		button.addEventListener("click", () => void this.plugin.run(async () => action()));
		return button;
	}

	private iconButton(parent: HTMLElement, label: string, icon: string, action: () => void | Promise<void>): HTMLButtonElement {
		const button = this.button(parent, "", action);
		button.addClass("clickable-icon", "ol-icon-button");
		button.setAttribute("aria-label", label);
		setTooltip(button, label);
		setIcon(button, icon);
		return button;
	}

	private connection(): void {
		const source = this.plugin.localFolder || this.plugin.origin;
		if (!source) return this.configure();
		const modal = new Modal(this.app);
		modal.setTitle("Library connection");
		const info = modal.contentEl.createDiv("ol-connection-info");
		const status = info.createDiv({ cls: "ol-connection-state", attr: { role: "status" } });
		const details = info.createEl("dl");
		const detail = (label: string) => {
			const row = details.createDiv();
			row.createEl("dt", { text: label });
			return row.createEl("dd");
		};
		const address = detail("Source");
		const count = detail("Books");
		const updated = detail("Last refreshed");
		const error = info.createDiv({ cls: "ol-connection-error", attr: { role: "alert" } });
		const showStatus = () => {
			status.setText(this.plugin.connected ? "Connected" : "Unavailable");
			status.dataset.connected = String(this.plugin.connected);
			address.setText(this.plugin.localFolder || this.plugin.origin);
			count.setText(String(this.books.length));
			updated.setText(this.plugin.lastRefresh?.toLocaleString() ?? "Not refreshed this session");
			error.setText(this.plugin.error);
		};
		showStatus();
		const actions = modal.contentEl.createDiv("ol-toolbar");
		const retry = this.button(actions, "Reconnect", async () => {
			retry.disabled = true;
			status.setText("Refreshing library...");
			status.dataset.connected = "false";
			error.setText("");
			try { await this.plugin.refresh(); }
			finally { showStatus(); retry.disabled = false; }
		});
		this.button(actions, "Configure library", () => { modal.close(); this.configure(); });
		modal.open();
	}

	private configure(): void {
		const modal = new Modal(this.app);
		modal.setTitle("Library source");
		renderLibrarySettings(modal.contentEl, this.plugin, () => modal.close());
		modal.open();
	}

	private folderDialog(book: Book): void {
		const modal = new Modal(this.app);
		modal.setTitle("Book study folder");
		let path = this.personals.get(book.id)?.folder ?? "";
		new Setting(modal.contentEl).setName("Vault folder")
			.setDesc("Creates Files for the PDF reference and Notes for the book record and new study notes.")
			.addText(text => text.setValue(path).setPlaceholder("Studies/Software Engineering/Book")
				.onChange(value => { path = value; }));
		new Setting(modal.contentEl).addButton(button => button.setButtonText("Link folder").setCta().onClick(async () => {
			button.setDisabled(true);
			await this.plugin.run(async () => {
				await this.plugin.linkFolder(book, path);
				modal.close();
			});
			button.setDisabled(false);
		}));
		modal.open();
	}

	private coverDialog(book: Book): void {
		const modal = new Modal(this.app);
		modal.setTitle("Cover page");
		let value = String(this.personals.get(book.id)?.coverPage ?? 1);
		new Setting(modal.contentEl).setName("PDF page")
			.setDesc("Use 1 to return to the first page. A custom cover image on the server takes priority.")
			.addText(text => {
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text.inputEl.max = String(book.pageCount);
				text.setValue(value).onChange(next => { value = next; });
			});
		new Setting(modal.contentEl).addButton(button => button.setButtonText("Save cover").setCta().onClick(async () => {
			button.setDisabled(true);
			await this.plugin.run(async () => {
				const coverPage = Number(value);
				if (!Number.isSafeInteger(coverPage) || coverPage < 1 || coverPage > (book.pageCount ?? 0)) {
					throw new Error("Enter a page between 1 and " + book.pageCount + ".");
				}
				await this.plugin.personalize(book, { coverPage: coverPage > 1 ? coverPage : undefined });
				modal.close();
			});
			button.setDisabled(false);
		}));
		modal.open();
	}

	private studyNoteDialog(book: Book): void {
		const modal = new Modal(this.app);
		modal.setTitle("New note");
		let name = "";
		const canSplit = !Platform.isMobile && book.availability === "available";
		let field!: HTMLInputElement;
		const create = async () => {
			if (field.disabled) return;
			field.disabled = true;
			await this.plugin.run(async () => {
				await this.plugin.createStudyNote(book, name, this.current(book)?.page);
				modal.close();
			});
			field.disabled = false;
		};
		new Setting(modal.contentEl).setName("Filename").addText(text => {
			field = text.inputEl;
			text.setPlaceholder("Chapter 1").onChange(value => { name = value; });
			field.addEventListener("keydown", event => {
				if (event.key !== "Enter" || event.isComposing) return;
				event.preventDefault();
				void create();
			});
		});
		new Setting(modal.contentEl).addButton(button => button.setButtonText(canSplit ? "Create and study" : "Create note")
			.setCta().onClick(create));
		modal.open();
		field.focus();
	}

	showBookProgress(book: Book): void {
		const modal = new Modal(this.app);
		modal.setTitle("Reading progress for " + this.title(book));
		const heads = progressHeads(this.plugin.storage.progress().get(book.id) ?? []);
		const conflict = hasConflict(heads);
		if (conflict) {
			modal.contentEl.createEl("p", { text: "Choose which reading update to keep." });
			for (const head of heads) {
				const date = new Date(head.updatedAt).toLocaleString();
				this.button(modal.contentEl, "Page " + head.page + (head.completed ? " · Completed" : "")
					+ " · " + head.deviceId.slice(0, 8) + " · " + date, async () => {
					await this.plugin.record(book, head.page, head.completed, heads);
					modal.close();
				});
			}
		} else {
			const current = heads[0];
			let value = String(current?.page ?? 1);
			let complete = current?.completed ?? false;
			if (current) modal.contentEl.createEl("p", {
				text: "Last confirmed on " + new Date(current.updatedAt).toLocaleString(),
			});
			new Setting(modal.contentEl).setName("Last confirmed page").addText(text => {
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text.setValue(value).onChange(next => { value = next; });
			});
			new Setting(modal.contentEl).setName("Completed").addToggle(toggle =>
				toggle.setValue(complete).onChange(next => { complete = next; }));
			new Setting(modal.contentEl).addButton(button => button.setButtonText("Save progress").setCta()
				.onClick(async () => {
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

	private async showBookDetails(book: Book): Promise<void> {
		const workspace = this.app.workspace;
		const request = ++this.detailsRequest;
		const leaf = Platform.isMobile ? undefined : workspace.getLeavesOfType(DETAILS_VIEW)[0] ?? workspace.getRightLeaf(false);
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
		const modal = new Modal(this.app);
		modal.setTitle("Book details");
		modal.modalEl.addClass("ol-details-modal");
		this.renderDetails(modal.contentEl, book, () => modal.close(), true);
		modal.open();
	}

	private renderDetails(content: HTMLElement, book: Book, close: () => void, inModal = false): void {
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
		const reading = this.button(progress, current ? "Continue reading" : this.heads.has(book.id) ? "Resolve progress" : "Open book",
			async () => {
				if (hasConflict(this.heads.get(book.id) ?? [])) {
					if (inModal) close();
					this.showBookProgress(book);
				} else {
					await this.continue(book);
					if (inModal) close();
				}
			});
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
			setIcon(row.createSpan({ attr: { "aria-hidden": "true" } }), "notebook-pen");
			const label = row.createSpan();
			label.createSpan({ text: file.basename });
			label.createSpan({ text: index === 0 ? "Book record" : "Study note", cls: "ol-secondary" });
			setIcon(row.createSpan({ attr: { "aria-hidden": "true" } }), "chevron-right");
		}
		this.button(notes, "+ Create study note", () => { if (inModal) close(); this.studyNoteDialog(book); }).addClass("ol-note-create");
		const metadata = content.createDiv("ol-detail-section");
		metadata.createEl("h4", { text: "Reading information" });
		const list = metadata.createEl("dl", { cls: "ol-detail-grid" });
		for (const [label, value] of [
			["Source", book.source === "local" ? "Local folder" : "Remote server"],
			["Status", book.availability === "missing" ? "Unavailable" : this.statusFor(book) === "reading"
				? "Reading" : current?.completed ? "Finished" : "Not started"],
			["Format", "PDF"],
			["Pages", book.pageCount?.toLocaleString() ?? "Unknown"],
			["Size", (book.sizeBytes / 1048576).toLocaleString(undefined, { maximumFractionDigits: 2 }) + " MiB"],
			["Study folder", this.personals.get(book.id)?.folder ?? "Not linked"],
		]) {
			const item = list.createDiv("ol-detail-item");
			item.createEl("dt", { text: label });
			item.createEl("dd", { text: value });
		}
	}

	private editMetadata(book: Book): void {
		const modal = new Modal(this.app);
		modal.setTitle("Edit metadata");
		const edit = modal.contentEl;
		const personal = this.personals.get(book.id);
		let title = personal?.customTitle ?? "";
		let category = personal?.customCategory ?? "";
		new Setting(edit).setName("Custom title").addText(text =>
			text.setPlaceholder(book.title).setValue(title).onChange(value => { title = value; }));
		new Setting(edit).setName("Custom category").addText(text =>
			text.setPlaceholder(book.category).setValue(category).onChange(value => { category = value; }));
		new Setting(edit).addButton(button => button.setButtonText("Save changes").onClick(() =>
			this.plugin.run(async () => {
				await this.plugin.personalize(book, { customTitle: title.trim(), customCategory: category.trim() });
				modal.close();
			})));
		modal.open();
	}
}

function chooseVaultPath(plugin: LibraryPlugin, folders: boolean, onSelect: (path: string) => void): void {
	const options = folders ? plugin.app.vault.getAllFolders() : plugin.app.vault.getMarkdownFiles();
	const paths = options.map(file => file.path).sort(collator.compare);
	const picker = new class extends SuggestModal<string> {
		getSuggestions(query: string): string[] {
			return paths.filter(path => normalize(path).includes(normalize(query.trim())));
		}
		renderSuggestion(path: string, el: HTMLElement): void { el.setText(path); }
		onChooseSuggestion(path: string): void { onSelect(path); }
	}(plugin.app);
	picker.setPlaceholder(folders ? "Search vault folders..." : "Search Markdown files...");
	picker.open();
}

export function renderLibrarySettings(container: HTMLElement, plugin: LibraryPlugin, onSuccess?: () => void): void {
	const settings = container.createDiv("ol-settings");
	if (!onSuccess) settings.createDiv({
		text: "Manage your books, reading preferences and study notes.", cls: "ol-secondary",
	});
	const source = settings.createDiv(onSuccess ? "ol-source-settings" : "ol-settings-section");
	if (!onSuccess) new Setting(source).setName("Library source").setHeading();

	let localPath = plugin.localFolder;
	let serverAddress = plugin.origin;
	let sourceType = localPath ? "local" : serverAddress ? "server" : "";
	const location = new Setting(source).setName("Storage location").setDesc("Choose where your books are stored.");
	const fields = source.createDiv("ol-source-fields");
	location.addDropdown(selector => {
		selector.addOption("", "Choose a source");
		if (!Platform.isMobile) selector.addOption("local", "Local folder");
		selector.addOption("server", "Remote server").setValue(sourceType);
		selector.selectEl.options[0].disabled = true;
		const renderSource = () => {
			fields.empty();
			if (!sourceType) return;
			const local = sourceType === "local";
			const row = new Setting(fields).setName(local ? "PDF folder" : "Server address")
				.setDesc(local ? "PDFs are scanned and opened in place with PDF++." : "HTTPS endpoint of your library server.");
			row.settingEl.addClass("ol-source-setting");
			row.addText(input => {
				input.setPlaceholder(local ? "C:/Books" : "https://server.example:9443")
					.setValue(local ? localPath : serverAddress);
				if (!local) input.inputEl.inputMode = "url";
				input.inputEl.spellcheck = false;
				input.inputEl.setAttribute("aria-label", local ? "PDF folder" : "Server address");
				input.onChange(value => {
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
		selector.onChange(value => { sourceType = value; renderSource(); });
		renderSource();
	});
	if (onSuccess) return;

	const notes = settings.createDiv("ol-settings-section");
	const appearance = settings.createDiv("ol-settings-section");
	const feedback = settings.createDiv({ cls: "ol-secondary", attr: { role: "status" } });
	let timer: ReturnType<typeof setTimeout> | undefined;
	const save = () => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			void plugin.saveSettings().then(() => feedback.setText(""), error => feedback.setText(
				error instanceof Error ? error.message : "Could not save preferences."));
		}, 300);
	};
	new Setting(notes).setName("Study notes").setHeading();
	new Setting(notes).setName("Notes folder").setDesc("Location for new study notes.")
		.addText(input => {
			input.setValue(plugin.studyRoot).onChange(value => {
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
			setIcon(browse, "folder");
			setTooltip(browse, "Browse vault folders");
			browse.addEventListener("click", () => chooseVaultPath(plugin, true, path => {
				input.setValue(path);
				plugin.studyRoot = path;
				save();
			}));
		});
	new Setting(notes).setName("Note template").setDesc("Optional Markdown template.")
		.addButton(select => {
			const update = () => select.setButtonText(plugin.studyTemplate || "Select a template");
			update();
			select.onClick(() => chooseVaultPath(plugin, false, path => {
				plugin.studyTemplate = path;
				update();
				save();
			}));
			select.buttonEl.parentElement?.createEl("button", { text: "Clear", attr: { "aria-label": "Clear note template" } })
				.addEventListener("click", () => {
					plugin.studyTemplate = "";
					update();
					save();
				});
		});
	new Setting(appearance).setName("Appearance").setHeading();
	const changeAppearance = () => { plugin.redraw(); save(); };
	const layout = new Setting(appearance).setName("Default view").setDesc("How books are displayed.");
	const choices = new Map<string, HTMLButtonElement>();
	const sync = () => {
		for (const [value, button] of choices) button.setAttribute("aria-pressed", String(value === plugin.appearance.layout));
	};
	for (const [value, label] of [["grid", "Grid"], ["list", "List"]] as const) {
		layout.addButton(button => {
			choices.set(value, button.buttonEl);
			button.setButtonText(label).onClick(() => {
				plugin.appearance.layout = value;
				sync();
				changeAppearance();
			});
		});
	}
	sync();
	new Setting(appearance).setName("Cover size").setDesc("Adjust the size of book covers.")
		.addSlider(slider => slider.setLimits(110, 220, 5).setValue(plugin.appearance.coverSize).setDynamicTooltip()
			.onChange(value => { plugin.appearance.coverSize = value; changeAppearance(); }));
	new Setting(appearance).setName("Show reading progress").setDesc("Display progress below book covers.")
		.addToggle(toggle => toggle.setValue(plugin.appearance.showProgress)
			.onChange(value => { plugin.appearance.showProgress = value; changeAppearance(); }));
}
