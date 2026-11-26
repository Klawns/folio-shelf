import { ItemView, Menu, Modal, Platform, Setting, SuggestModal, WorkspaceLeaf, setIcon, setTooltip } from "obsidian";
import type LibraryPlugin from "./main";
import { Book, Progress, endpoint, hasConflict, progressHeads, studyFolder } from "./model";
import { CatalogPendingError } from "./remote";
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

type FilterOption = readonly [value: string, label: string];

function showChoiceMenu(button: HTMLButtonElement, options: FilterOption[], value: string, select: (value: string) => void, left = false): void {
	const menu = new Menu();
	for (const [key, label] of options) {
		menu.addItem(item => item.setTitle(label).setChecked(key === value).onClick(() => select(key)));
	}
	const rect = button.getBoundingClientRect();
	button.setAttribute("aria-expanded", "true");
	menu.onHide(() => button.setAttribute("aria-expanded", "false"));
	menu.showAtPosition({ x: rect.left, y: rect.bottom + 4, width: rect.width, overlap: true, left }, button.ownerDocument);
}

const PAGE_SIZE = 10;
const STATUSES: FilterOption[] = [["", "All statuses"], ["reading", "Reading"], ["new", "Unread"], ["done", "Finished"], ["favorite", "Favorites"]];
const SORTS: FilterOption[] = [["title", "Title"], ["author", "Author"], ["reading", "Last read"], ["added", "Recently added"]];
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
	private syncFilters!: (categories: string[]) => void;
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
		const updateStatus = this.filterControl(filters, "Reading status", value => { this.status = value; });
		const updateCategory = this.filterControl(filters, "Category", value => { this.category = value; });
		const updateSort = this.filterControl(filters, "Sort by", value => { this.sort = value; });
		this.syncFilters = categories => {
			updateStatus(STATUSES, this.status);
			updateCategory([["", "All categories"], ...categories.map((name): FilterOption => [name, name])], this.category);
			updateSort(SORTS, this.sort);
		};
		this.clearFilters = () => {
			this.query = search.value = this.category = this.status = "";
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

	private filterControl(parent: HTMLElement, name: string, change: (value: string) => void):
		(options: FilterOption[], value: string) => void {
		const selectValue = (value: string) => { change(value); this.reset(); };
		if (Platform.isMobile) {
			const select = parent.createEl("select", { attr: { "aria-label": name } });
			select.addEventListener("change", () => selectValue(select.value));
			return (options, value) => {
				select.empty();
				for (const [key, text] of options) select.createEl("option", { value: key, text });
				select.value = value;
			};
		}

		let options: FilterOption[] = [];
		let value = "";
		const button = this.button(parent, "", () => showChoiceMenu(button, options, value, selectValue, name === "Sort by"));
		button.addClass("ol-filter-button");
		button.setAttribute("aria-haspopup", "menu");
		button.setAttribute("aria-expanded", "false");
		const label = button.createSpan();
		setIcon(button.createSpan({ attr: { "aria-hidden": "true" } }), "chevron-down");
		return (nextOptions, nextValue) => {
			options = nextOptions;
			value = nextValue;
			const text = options.find(([key]) => key === value)?.[1] ?? name;
			label.setText(text);
			button.setAttribute("aria-label", name + ": " + text);
		};
	}

	private updateFilters(): void {
		const categories = [...new Set(this.books.map(book => this.categoryFor(book)))].sort(collator.compare);
		if (this.category && !categories.includes(this.category)) this.category = "";
		this.syncFilters(categories);
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
		this.updateFilters();
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
		this.updateFilters();
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
		modal.modalEl.addClass("ol-source-modal");
		setIcon(modal.titleEl.createSpan({ attr: { "aria-hidden": "true" } }), "database");
		const close = modal.modalEl.createEl("button", {
			cls: "ol-source-close", attr: { type: "button", "aria-label": "Close library source" }
		});
		setIcon(close, "x");
		close.addEventListener("click", () => modal.close());
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

function chooseVaultPath(plugin: LibraryPlugin, folders: boolean, onSelect: (path: string) => void, onClose?: () => void): void {
	const options = folders ? plugin.app.vault.getAllFolders() : plugin.app.vault.getMarkdownFiles();
	const paths = options.map(file => file.path).sort(collator.compare);
	const picker = new class extends SuggestModal<string> {
		getSuggestions(query: string): string[] {
			return paths.filter(path => normalize(path).includes(normalize(query.trim())));
		}
		renderSuggestion(path: string, el: HTMLElement): void { el.setText(path); }
		onChooseSuggestion(path: string): void { onSelect(path); }
		onClose(): void {
			super.onClose();
			onClose?.();
		}
	}(plugin.app);
	picker.setPlaceholder(folders ? "Search vault folders..." : "Search Markdown files...");
	picker.open();
}

function confirmDataMove(plugin: LibraryPlugin, from: string, to: string): Promise<boolean> {
	return new Promise(resolve => {
		const modal = new Modal(plugin.app);
		modal.setTitle("Move library data?");
		modal.contentEl.createEl("p", { text: "From " + from + "/" });
		modal.contentEl.createEl("p", { text: "To " + to + "/" });
		modal.contentEl.createEl("p", { text: "Pause Fast Note Sync on all devices before moving the data." });
		new Setting(modal.contentEl)
			.addButton(button => button.setButtonText("Cancel").onClick(() => modal.close()))
			.addButton(button => button.setButtonText("Move data").setCta().onClick(() => {
				resolve(true);
				modal.close();
			}));
		modal.onClose = () => resolve(false);
		modal.open();
	});
}

function renderDataStorage(settings: HTMLElement, plugin: LibraryPlugin): void {
	const group = settingsGroup(settings, "Data storage", "database");
	const row = new Setting(group).setName("Library data folder")
		.setDesc("Stores catalog, progress, and PDF references.");
	const feedback = group.createDiv({ cls: "ol-data-error", attr: { role: "status" } });
	let field: HTMLInputElement;
	let browse: HTMLButtonElement;
	let busy = false;
	let picking = false;
	let lastSubmitted = plugin.storage.root;
	const update = () => {
		const pending = plugin.dataMigration;
		field.disabled = browse.disabled = busy || !!pending;
		resume.hidden = !pending;
		resume.disabled = busy;
		if (pending) field.value = pending.to;
	};
	const submit = async (path: string, explicit = false) => {
		if (busy || (!explicit && path === lastSubmitted)) return;
		busy = true;
		lastSubmitted = path;
		feedback.setText("");
		field.removeAttribute("aria-invalid");
		update();
		try {
			await plugin.changeDataFolder(path, (from, to) => confirmDataMove(plugin, from, to));
			field.value = lastSubmitted = plugin.storage.root;
		} catch (error) {
			field.setAttribute("aria-invalid", "true");
			feedback.setText(error instanceof Error ? error.message : "Could not change the library data folder.");
		} finally {
			busy = false;
			update();
		}
	};
	row.addText(input => {
		input.setValue(plugin.storage.root);
		field = input.inputEl;
		field.setAttribute("aria-label", "Library data folder");
		field.addEventListener("input", () => {
			field.removeAttribute("aria-invalid");
			feedback.setText("");
			lastSubmitted = plugin.storage.root;
		});
		field.addEventListener("keydown", event => {
			if (event.key !== "Enter" || event.isComposing) return;
			event.preventDefault();
			if (!event.repeat) void submit(field.value, field.getAttribute("aria-invalid") === "true");
		});
		field.addEventListener("blur", event => {
			if (!picking && !plugin.dataMigration && event.relatedTarget !== browse) void submit(field.value);
		});
	});
	browse = row.controlEl.createEl("button", {
		cls: "ol-settings-icon", attr: { type: "button", "aria-label": "Select library data folder" },
	});
	setIcon(browse, "folder");
	setTooltip(browse, "Select library data folder");
	browse.addEventListener("pointerdown", event => {
		if (field === field.ownerDocument.activeElement) event.preventDefault();
	});
	browse.addEventListener("blur", () => {
		if (!picking && !plugin.dataMigration) void submit(field.value);
	});
	browse.addEventListener("click", () => {
		picking = true;
		chooseVaultPath(plugin, true, selected => {
			field.value = selected;
			void submit(selected, true);
		}, () => { picking = false; });
	});
	const resume = row.controlEl.createEl("button", { text: "Resume move", cls: "ol-data-resume", attr: { type: "button" } });
	resume.addEventListener("click", () => {
		if (plugin.dataMigration) void submit(plugin.dataMigration.to, true);
	});
	update();
}

function settingsGroup(parent: HTMLElement, title?: string, icon?: string): HTMLElement {
	const section = parent.createEl("section", { cls: "ol-settings-section" });
	if (title && icon) {
		const heading = section.createEl("h3");
		setIcon(heading.createSpan({ attr: { "aria-hidden": "true" } }), icon);
		heading.createSpan({ text: title });
	}
	return section.createDiv("ol-settings-group");
}

function addSourceIcon(parent: HTMLElement, icon: string, cls: string): HTMLElement {
	const el = parent.createSpan({ cls, attr: { "aria-hidden": "true" } });
	setIcon(el, icon);
	return el;
}

export function renderLibrarySettings(container: HTMLElement, plugin: LibraryPlugin, onSuccess?: () => void): void {
	const settings = container.createDiv(onSuccess ? "ol-settings ol-settings-quick" : "ol-settings ol-settings-page");
	if (onSuccess) settings.createDiv({
		cls: "ol-source-description", text: "Manage where your library books are stored."
	});
	if (!onSuccess) {
		const header = settings.createEl("header");
		header.createEl("h2", { text: "Obsidian Library" });
		header.createDiv({ text: "Manage your books, reading preferences and study notes.", cls: "ol-secondary" });
	}
	const source = settingsGroup(settings, onSuccess ? undefined : "Library source", "server");

	let localPath = plugin.localFolder;
	let serverAddress = plugin.origin;
	let sourceType = localPath && !Platform.isMobile ? "local" : serverAddress ? "server" : "";
	const location = new Setting(source).setName("Storage location").setDesc(Platform.isMobile
		? "Remote server connects to your library over private HTTPS."
		: "Local folder reads PDFs from a drive or shared folder this computer can access. Remote server connects over private HTTPS and also works on mobile.");
	const fields = source.createDiv("ol-source-fields ol-settings-divider");
	const renderSource = () => {
		fields.empty();
		if (!sourceType) return;
		const local = sourceType === "local";
		const row = new Setting(fields).setName(local ? "PDF folder" : "Server address")
			.setDesc(local ? "Enter an absolute path, such as C:\\Books or \\\\files.home\\shares\\books." : "Enter the private HTTPS address of your library server.");
		row.settingEl.addClass("ol-source-setting");
		row.addText(input => {
			if (onSuccess) {
				addSourceIcon(row.controlEl, local ? "folder" : "link", "ol-source-field-icon");
				row.settingEl.appendChild(row.descEl);
			}
			input.setPlaceholder(local ? "C:\\Books" : "https://library.example.ts.net")
				.setValue(local ? localPath : serverAddress);
			input.inputEl.type = "text";
			if (!local) input.inputEl.inputMode = "url";
			input.inputEl.spellcheck = false;
			input.inputEl.setAttribute("aria-label", local ? "PDF folder" : "Server address");
			const actions = fields.createDiv("ol-settings-actions ol-settings-divider");
			const status = actions.createDiv({ cls: "ol-source-status", attr: { role: "status" } });
			const statusIcon = onSuccess ? addSourceIcon(status, "circle-minus", "ol-source-status-icon") : undefined;
			const statusCopy = onSuccess ? status.createDiv("ol-source-status-copy") : undefined;
			const statusTitle = statusCopy?.createDiv("ol-source-status-title");
			const statusDetail = statusCopy?.createDiv("ol-source-status-detail");
			const setState = (state: string, message: string, detail = "", icon = "circle-alert") => {
				status.dataset.state = state;
				if (statusIcon && statusTitle && statusDetail) {
					setIcon(statusIcon, icon);
					statusTitle.setText(message);
					statusDetail.setText(detail);
				} else status.setText(message);
			};
			const serverOrigin = (value: string) => {
				if (/^(?:smb:\/\/|\\\\|\/\/)/i.test(value.trim())) {
					throw new Error(Platform.isMobile
						? "Your Linux server needs access to the shared folder. Enter the server’s private HTTPS address here."
						: "Choose Local folder to use this shared folder directly, or enter your server’s private HTTPS address.");
				}
				try {
					return endpoint(value);
				} catch {
					throw new Error("Enter a valid HTTPS server address.");
				}
			};
			const show = () => {
				input.inputEl.setAttribute("aria-invalid", "false");
				const value = input.getValue();
				let active = local && Boolean(plugin.localFolder) && value === plugin.localFolder;
				if (!local && value.trim()) {
					try {
						const origin = serverOrigin(value);
						active = !plugin.localFolder && origin === plugin.origin;
					} catch (error) {
						input.inputEl.setAttribute("aria-invalid", "true");
						setState("error", (error as Error).message);
						return;
					}
				}
				if (!active) return setState("idle", local ? "Folder not scanned" : "Connection not tested", "", "circle-minus");
				const count = plugin.books.length;
				if (plugin.error) return setState(plugin.connected ? "warning" : "error", plugin.error);
				if (plugin.connected) {
					const books = count + (count === 1 ? " book" : " books");
					return onSuccess
						? setState("connected", "Connected", books + " available", "circle-check")
						: setState("connected", "Connected \u00b7 " + books);
				}
				setState("error", "Unavailable");
			};
			input.onChange(value => {
				if (local) localPath = value;
				else serverAddress = value;
				show();
			});
			show();
			const action = actions.createEl("button", { text: local ? "Load books" : "Test connection" });
			if (onSuccess) action.prepend(addSourceIcon(action, "refresh-cw", "ol-source-action-icon"));
			action.addEventListener("click", async () => {
				action.disabled = true;
				setSourceDisabled(true);
				input.setDisabled(true);
				setState("busy", local ? "Scanning folder..." : "Testing connection...", "", "clock");
				try {
					if (local) {
						await plugin.useLocalFolder(input.getValue());
						localPath = plugin.localFolder;
						input.setValue(localPath);
					} else {
						await plugin.connect(serverOrigin(input.getValue()));
						serverAddress = plugin.origin;
						input.setValue(serverAddress);
					}
					show();
					if (!plugin.error) onSuccess?.();
				} catch (error) {
					setState(error instanceof CatalogPendingError ? "warning" : "error",
						error instanceof Error ? error.message : "Could not set up the library source.");
				} finally {
					action.disabled = false;
					setSourceDisabled(false);
					input.setDisabled(false);
				}
			});
		});
		if (!local) {
			const guide = fields.createEl("details", { cls: "ol-server-guide" });
			const summary = guide.createEl("summary");
			for (const icon of onSuccess ? ["book-open"] : ["chevron-right", "chevron-down"]) {
				setIcon(summary.createSpan({ cls: "ol-guide-" + icon, attr: { "aria-hidden": "true" } }), icon);
			}
			summary.createSpan({ text: "Server setup guide" });
			if (onSuccess) addSourceIcon(summary, "chevron-right", "ol-source-chevron");
			const steps = guide.createEl("ol");
			steps.createEl("li", { text: "On a Linux computer with access to your PDFs, follow the installation guide to start the library server." });
			steps.createEl("li", { text: "Use Tailscale Serve or an existing private HTTPS proxy to reach the server from this device." });
			steps.createEl("li", { text: "Paste the private HTTPS address above and select Test connection." });
			guide.createEl("a", { text: "Read the full server setup guide", href: "https://github.com/Klawns/obsidian-library-plugin/blob/main/docs/server-setup.md" });
		}
	};

	const options: FilterOption[] = [];
	if (!Platform.isMobile) options.push(["local", "Local folder"]);
	options.push(["server", "Remote server"]);
	const sourceIcon = () => sourceType === "local" ? "folder" : "server";
	const changeSource = (value: string) => {
		sourceType = value;
		renderSource();
	};

	let setSourceDisabled: (disabled: boolean) => void;
	if (!Platform.isMobile) {
		const button = location.controlEl.createEl("button", {
			cls: onSuccess ? "ol-source-select" : "ol-filter-button",
			attr: { type: "button", "aria-haspopup": "menu", "aria-expanded": "false" },
		});
		const icon = onSuccess ? addSourceIcon(button, sourceIcon(), "ol-source-field-icon") : undefined;
		const label = button.createSpan();
		addSourceIcon(button, "chevron-down", "ol-source-chevron");
		const updateButton = () => {
			const text = options.find(([value]) => value === sourceType)?.[1] ?? "Choose a source";
			label.setText(text);
			button.setAttribute("aria-label", "Storage location: " + text);
			if (icon) setIcon(icon, sourceIcon());
		};
		updateButton();
		button.addEventListener("click", () => showChoiceMenu(button, options, sourceType, value => {
			if (value === sourceType) return;
			changeSource(value);
			updateButton();
		}));
		setSourceDisabled = disabled => { button.disabled = disabled; };
	} else {
		location.addDropdown(selector => {
			const icon = onSuccess ? addSourceIcon(location.controlEl, sourceIcon(), "ol-source-field-icon") : undefined;
			if (onSuccess) addSourceIcon(location.controlEl, "chevron-down", "ol-source-chevron");
			selector.addOption("", "Choose a source");
			for (const [value, label] of options) selector.addOption(value, label);
			selector.setValue(sourceType);
			selector.selectEl.options[0].disabled = true;
			selector.selectEl.setAttribute("aria-label", "Storage location");
			selector.onChange(value => {
				changeSource(value);
				if (icon) setIcon(icon, sourceIcon());
			});
			setSourceDisabled = disabled => { selector.setDisabled(disabled); };
		});
	}
	renderSource();
	if (onSuccess) return;

	renderDataStorage(settings, plugin);
	const notes = settingsGroup(settings, "Study notes", "notebook-pen");
	const appearance = settingsGroup(settings, "Appearance", "palette");
	const feedback = settings.createDiv({ cls: "ol-secondary", attr: { role: "status" } });
	let timer: ReturnType<typeof setTimeout> | undefined;
	const save = () => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			void plugin.saveSettings().then(() => feedback.setText(""), error => feedback.setText(
				error instanceof Error ? error.message : "Could not save preferences."));
		}, 300);
	};
	new Setting(notes).setName("Notes folder").setDesc("Location for new study notes.")
		.addText(input => {
			input.setValue(plugin.studyRoot).onChange(value => {
				try {
					plugin.studyRoot = studyFolder(value, plugin.storage.root);
					feedback.setText("");
					save();
				} catch (error) {
					feedback.setText(error instanceof Error ? error.message : "Enter a vault folder.");
				}
			});
			input.inputEl.setAttribute("aria-label", "Notes folder");
			const browse = input.inputEl.parentElement?.createEl("button", { attr: { "aria-label": "Select notes folder" } });
			if (!browse) return;
			browse.addClass("ol-settings-icon");
			setIcon(browse, "folder");
			setTooltip(browse, "Select notes folder");
			browse.addEventListener("click", () => chooseVaultPath(plugin, true, path => {
				try {
					plugin.studyRoot = studyFolder(path, plugin.storage.root);
				} catch (error) {
					feedback.setText(error instanceof Error ? error.message : "Enter a vault folder.");
					return;
				}
				input.setValue(path);
				save();
			}));
		});
	const template = new Setting(notes).setName("Note template").setDesc("Optional Markdown template.");
	template.settingEl.addClass("ol-settings-divider");
	template.addButton(select => {
			select.buttonEl.addClass("ol-template-select");
			const clear = select.buttonEl.parentElement?.createEl("button", {
				cls: "ol-settings-icon", attr: { "aria-label": "Clear note template" },
			});
			if (clear) {
				setIcon(clear, "x");
				setTooltip(clear, "Clear note template");
				clear.addEventListener("click", () => {
					plugin.studyTemplate = "";
					update();
					select.buttonEl.focus();
					save();
				});
			}
			const update = () => {
				select.setButtonText(plugin.studyTemplate || "Select a template");
				select.buttonEl.title = plugin.studyTemplate;
				if (clear) clear.hidden = !plugin.studyTemplate;
			};
			update();
			select.onClick(() => chooseVaultPath(plugin, false, path => {
				plugin.studyTemplate = path;
				update();
				save();
			}));
		});
	const changeAppearance = () => { plugin.redraw(); save(); };
	const layout = new Setting(appearance).setName("Default view").setDesc("How books are displayed.");
	const segments = layout.controlEl.createDiv({ cls: "ol-layout-segments", attr: { role: "group", "aria-label": "Default view" } });
	const choices = new Map<string, HTMLButtonElement>();
	const sync = () => {
		for (const [value, button] of choices) button.setAttribute("aria-pressed", String(value === plugin.appearance.layout));
	};
	for (const [value, label, icon] of [["grid", "Grid", "layout-grid"], ["list", "List", "list"]] as const) {
		const button = segments.createEl("button");
		setIcon(button.createSpan({ attr: { "aria-hidden": "true" } }), icon);
		button.createSpan({ text: label });
		choices.set(value, button);
		button.addEventListener("click", () => {
			plugin.appearance.layout = value;
			sync();
			changeAppearance();
		});
	}
	sync();
	const coverSize = new Setting(appearance).setName("Cover size").setDesc("Adjust the size of book covers.");
	coverSize.settingEl.addClass("ol-settings-divider");
	const sizeLabel = coverSize.controlEl.createSpan({ cls: "ol-cover-size-value", text: plugin.appearance.coverSize + "px" });
	coverSize.addSlider(slider => {
		slider.sliderEl.setAttribute("aria-label", "Cover size");
		slider.sliderEl.addClass("ol-cover-size-slider");
		slider.setLimits(110, 220, 5).setValue(plugin.appearance.coverSize).setDynamicTooltip()
			.onChange(value => {
				plugin.appearance.coverSize = value;
				sizeLabel.setText(value + "px");
				changeAppearance();
			});
	});
	const progress = new Setting(appearance).setName("Show reading progress").setDesc("Display progress below book covers.");
	progress.settingEl.addClass("ol-settings-divider");
	progress.addToggle(toggle => {
			toggle.toggleEl.setAttribute("aria-label", "Show reading progress");
			toggle.setValue(plugin.appearance.showProgress)
				.onChange(value => { plugin.appearance.showProgress = value; changeAppearance(); });
		});
}
