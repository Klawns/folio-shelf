import { ItemView, Menu, Modal, Platform, Setting, WorkspaceLeaf } from "obsidian";
import type LibraryPlugin from "./main";
import { Book, Progress, hasConflict, progressHeads, studyFolder } from "./model";
import type { Personal } from "./storage";

export const VIEW = "obsidian-library";
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
	private refreshButton!: HTMLButtonElement;
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
		this.refreshButton = this.button(bar, "Refresh", () => this.plugin.refresh());
		this.connectionButton = this.button(bar, "", () => this.configure());
		this.connectionButton.addClass("ol-connection");
		this.message = root.createDiv({ cls: "ol-message", attr: { role: "status" } });
		const filters = root.createDiv("ol-toolbar ol-filters");
		const search = filters.createEl("input", { type: "search", placeholder: "Search by title or author",
			attr: { "aria-label": "Search by title or author" } });
		search.value = this.query;
		search.addEventListener("input", () => { this.query = search.value; this.reset(); });
		const statuses = filters.createEl("select", { attr: { "aria-label": "Reading status" } });
		for (const [value, text] of [["", "All statuses"], ["reading", "Reading"], ["new", "Not started"], ["done", "Completed"]]) {
			statuses.createEl("option", { value, text });
		}
		statuses.value = this.status;
		statuses.addEventListener("change", () => { this.status = statuses.value; this.reset(); });
		this.categories = filters.createEl("select", { attr: { "aria-label": "Category" } });
		this.categories.addEventListener("change", () => { this.category = this.categories.value; this.reset(); });
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
		this.refreshButton.disabled = this.plugin.busy || !configured;
		const connection = local ? "Local folder" : configured ? "Server" : "Set up library";
		const state = this.plugin.connected ? "Ready" : configured ? "Unavailable" : "Choose a source";
		this.connectionButton.setText(connection);
		this.connectionButton.dataset.connected = String(this.plugin.connected === true);
		this.connectionButton.title = connection + " · " + state + " · Library source settings";
		this.connectionButton.setAttribute("aria-label", this.connectionButton.title);
		this.message.setText([
			this.plugin.busy ? "Refreshing catalog…" : "",
			this.plugin.error,
			!configured ? "Choose where your PDF books are stored to set up the library." : "",
			this.plugin.pdfPlusStatus() === "disabled" ? "Enable PDF++ to open external references." : "",
		].filter(Boolean).join(" "));
		if (this.plugin.pdfPlusStatus() === "disabled") this.message.createEl("a", {
			text: " PDF++ instructions", href: "https://ryotaushio.github.io/obsidian-pdf-plus/external-pdf-files.html",
			attr: { target: "_blank", rel: "noopener noreferrer" },
		});
		this.draw();
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

	private draw(): void {
		this.body.empty();
		const books = this.books;
		if (!books.length) {
			if (!this.plugin.busy) this.body.createEl("p", { text: "No books in the catalog." });
			return;
		}
		const query = normalize(this.query.trim());
		const filtered = books.filter(book => {
			if (this.category && this.category !== this.categoryFor(book)) return false;
			const current = this.current(book);
			const status = current?.completed ? "done" : this.heads.has(book.id) ? "reading" : "new";
			return (!this.status || this.status === status)
				&& normalize(this.title(book) + " " + (book.author ?? "")).includes(query);
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
		const move = (offset: number) => {
			this.page += offset;
			this.draw();
			this.body.querySelector<HTMLButtonElement>(".ol-card-open")?.focus();
		};
		this.button(navigation, "Previous", () => move(-1)).disabled = this.page === 1;
		navigation.createEl("span", { text: "Page " + this.page + " of " + pageCount });
		this.button(navigation, "Next", () => move(1)).disabled = this.page === pageCount;
	}

	private card(grid: HTMLElement, book: Book): void {
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
		const percent = conflict ? undefined : progress?.completed ? 100
			: book.pageCount ? Math.min(100, Math.round((progress?.page ?? 0) / book.pageCount * 100)) : undefined;
		const status = book.availability === "missing" ? "Unavailable"
			: conflict ? "Conflicting reading progress" : progress?.completed ? "Completed"
			: progress ? "Page " + progress.page : "";
		const label = [status, percent === undefined ? "" : percent + "%"].filter(Boolean).join(" · ");
		if (label) card.createDiv("ol-card-labels").createEl("span", { text: label, cls: "ol-book-status" });
		const actions = card.createDiv("ol-toolbar ol-card-actions");
		this.button(actions, "New note", () => this.studyNoteDialog(book));
		const menu = actions.createEl("button", { text: "⋯", cls: "ol-card-menu", attr: { "aria-label": "Options for " + title } });
		menu.addEventListener("click", () => {
			const options = new Menu();
			const add = (label: string, action: () => void | Promise<void>) => options.addItem(item =>
				item.setTitle(label).onClick(() => void this.plugin.run(async () => action())));
			add(conflict ? "Resolve reading progress…" : "Confirm page…", () => this.showBookProgress(book));
			if (book.availability === "available" && progress && progress.page > 1) {
				add("Open at first page", () => this.plugin.openBook(book));
			}
			add("Copy PDF link", () => this.plugin.copyLink(book));
			options.addSeparator();
			add("Link folder…", () => this.folderDialog(book));
			if (book.availability === "available" && (book.pageCount ?? 0) > 1) {
				add("Change cover…", () => this.coverDialog(book));
			}
			add("View details…", () => this.showBookDetails(book));
			options.addSeparator();
			add("Delete from library…", () => this.deleteDialog(book));
			const position = menu.getBoundingClientRect();
			options.showAtPosition({ x: position.left, y: position.bottom });
		});
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
		const words = this.title(book).match(/[\p{L}\p{N}]+/gu) ?? [];
		const placeholder = words.slice(0, 3).map(word => Array.from(word)[0]).join("").toUpperCase();
		cover.setText(placeholder || "PDF");
		const page = this.personals.get(book.id)?.coverPage;
		const selectedPage = page && book.pageCount && page <= book.pageCount ? page : undefined;
		const src = selectedPage ? book.readUrl.replace(/\/file$/, "/cover?page=" + selectedPage) : book.coverUrl;
		if (!src) return;
		const image = cover.createEl("img", { attr: { loading: "lazy", alt: "", src } });
		image.addEventListener("error", () => {
			if (selectedPage && book.coverUrl && image.getAttribute("src") !== book.coverUrl) image.src = book.coverUrl;
			else image.remove();
		});
	}

	private async continue(book: Book): Promise<void> {
		if (hasConflict(this.heads.get(book.id) ?? [])) this.showBookProgress(book);
		else await this.plugin.openBook(book, this.current(book)?.page);
	}

	private button(parent: HTMLElement, text: string, action: () => void | Promise<void>): HTMLButtonElement {
		const button = parent.createEl("button", { text });
		button.addEventListener("click", () => void this.plugin.run(async () => action()));
		return button;
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
				const date = new Date(head.updatedAt).toLocaleString("en");
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
				text: "Last confirmed on " + new Date(current.updatedAt).toLocaleString("en"),
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

	private showBookDetails(book: Book): void {
		const modal = new Modal(this.app);
		modal.setTitle(this.title(book));
		const content = modal.contentEl;
		content.addClass("ol-book-details");
		const hero = content.createDiv("ol-detail-hero");
		this.renderCover(hero, book);
		const personal = this.personals.get(book.id);
		const heads = progressHeads(this.plugin.storage.progress().get(book.id) ?? []);
		const progress = heads[0];
		const reading = hasConflict(heads) ? "Conflicting reading updates"
			: progress?.completed ? "Completed"
			: progress ? "Page " + progress.page : "Not started";
		const details: Array<[string, string | undefined]> = [
			["Author", book.author || "Unknown"],
			["Category", this.categoryFor(book)],
			["Format and size", "PDF · " + (book.sizeBytes / 1048576).toLocaleString("en", { maximumFractionDigits: 2 }) + " MiB"],
			["Pages", book.pageCount?.toLocaleString("en") ?? "Unknown"],
			["Availability", book.availability === "available" ? (book.source === "local" ? "Available locally" : "Available on server") : "File unavailable"],
			["Progress", reading],
			["Last updated", progress && new Date(progress.updatedAt).toLocaleString("en")],
			["Study folder", personal?.folder ?? "Not linked yet"],
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

export function renderLibrarySettings(container: HTMLElement, plugin: LibraryPlugin, onSuccess?: () => void): void {
	const settings = container.createDiv("ol-settings");
	const source = settings.createDiv("ol-settings-section");
	source.createEl("h3", { text: "Where are your books?" });
	const selector = source.createEl("select", { attr: { "aria-label": "Book source" } });
	selector.createEl("option", { value: "", text: "Choose a source" }).disabled = true;
	selector.createEl("option", { value: "local", text: Platform.isMobile ? "This device (desktop only)" : "This device" }).disabled = Platform.isMobile;
	selector.createEl("option", { value: "server", text: "Another computer or server" });
	selector.value = plugin.localFolder ? "local" : plugin.origin ? "server" : "";
	const fields = source.createDiv("ol-source-fields");
	let localPath = plugin.localFolder;
	let serverAddress = plugin.origin;
	const renderSource = () => {
		fields.empty();
		if (!selector.value) return;
		const local = selector.value === "local";
		const label = fields.createEl("label", { text: local ? "PDF folder" : "Library address" });
		const input = label.createEl("input", {
			type: local ? "text" : "url",
			placeholder: local ? "C:\\Books or /Users/you/Books" : "https://library.example.net",
			attr: { spellcheck: "false" },
		});
		input.value = local ? localPath : serverAddress;
		input.addEventListener("input", () => {
			if (local) localPath = input.value;
			else serverAddress = input.value;
		});
		fields.createEl("p", { cls: "ol-settings-help", text: local
			? "Paste the full path to a folder on this computer. The library scans its subfolders and opens PDFs in place with PDF++."
			: "Enter the HTTPS address of the Obsidian Library server that shares your PDF folder." });
		if (!local) {
			const guide = fields.createEl("details");
			guide.createEl("summary", { text: "How do I set up a server?" });
			guide.createEl("p", { cls: "ol-settings-help", text: "Run the Obsidian Library server on a computer that can read your PDF folder. Make the service available over HTTPS, then paste its base address here. The server scans the folder and streams PDFs to your devices." });
		}
		const actions = fields.createDiv("ol-settings-actions");
		const action = actions.createEl("button", { cls: "mod-cta", text: local ? "Load books" : "Test and connect" });
		const active = local ? Boolean(plugin.localFolder) : Boolean(plugin.origin && !plugin.localFolder);
		const status = actions.createDiv({
			text: active ? plugin.error || (plugin.connected ? "Connected · " + plugin.books.length + " PDFs" : "") : "",
			attr: { role: "status" },
		});
		action.addEventListener("click", async () => {
			action.disabled = selector.disabled = input.disabled = true;
			status.setText(local ? "Scanning folder…" : "Testing connection…");
			try {
				if (local) await plugin.useLocalFolder(input.value);
				else await plugin.connect(input.value);
				const count = plugin.books.length;
				status.setText(plugin.error || count + (count === 1 ? " PDF found." : " PDFs found."));
				if (!plugin.error) onSuccess?.();
			} catch (error) {
				status.setText(error instanceof Error ? error.message : "Could not set up the library source.");
			} finally {
				action.disabled = selector.disabled = input.disabled = false;
			}
		});
	};
	selector.addEventListener("change", renderSource);
	renderSource();
	if (!onSuccess) {
		const notes = settings.createDiv("ol-settings-section");
		notes.createEl("h3", { text: "Study notes" });
		let root = plugin.studyRoot;
		let template = plugin.studyTemplate;
		new Setting(notes).setName("Default notes folder").setDesc("Where new book records and study notes are created in this vault.").addText(text =>
			text.setValue(root).onChange(next => { root = next; }));
		new Setting(notes).setName("Note template").setDesc("Optional path to a Markdown file in this vault.").addText(text =>
			text.setValue(template).setPlaceholder("Studies/Templates/Study Note.md")
				.onChange(next => { template = next; }));
		const actions = notes.createDiv("ol-settings-actions");
		const save = actions.createEl("button", { text: "Save note preferences" });
		const status = actions.createDiv({ attr: { role: "status" } });
		save.addEventListener("click", async () => {
			save.disabled = true;
			try {
				plugin.studyRoot = studyFolder(root);
				plugin.studyTemplate = template.trim();
				await plugin.saveSettings();
				status.setText("Preferences saved.");
			} catch (error) {
				status.setText(error instanceof Error ? error.message : "Could not save preferences.");
			} finally {
				save.disabled = false;
			}
		});
	}
}
