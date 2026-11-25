import { expect, it, vi } from "vitest";
import type LibraryPlugin from "./main";
import { LibraryView, renderLibrarySettings } from "./view";

vi.mock("obsidian", () => {
	class Element {
		text = "";
		cls = "";
		style = { setProperty: () => {} };
		get options(): Element[] { return this.children; }
		createSpan(options?: { text?: string }): Element { return this.createEl("span", options); }
		value = "";
		dataset: Record<string, string> = {};
		listeners = new Map<string, () => void>();
		children: Element[] = [];
		createEl(_tag: string, options?: { text?: string; cls?: string }): Element {
			const child = new Element();
			child.text = options?.text ?? "";
			child.cls = options?.cls ?? "";
			this.children.push(child);
			return child;
		}
		createDiv(options?: string | { text?: string }): Element {
			return this.createEl("div", typeof options === "string" ? { cls: options } : options);
		}
		addClass(): void {}
		addEventListener(event: string, listener: () => void): void { this.listeners.set(event, listener); }
		querySelector(): null { return null; }
		find(text: string): Element | undefined {
			if (this.text === text) return this;
			for (const child of this.children) {
				const match = child.find(text);
				if (match) return match;
			}
		}
		setAttribute(): void {}
		empty(): void { this.children = []; }
		setText(text: string): void { this.text = text; }
	}

	return {
		ItemView: class {
			contentEl = new Element();
			open(): Promise<void> { return this.onOpen(); }
			async onOpen(): Promise<void> {}
		},
		Platform: { isMobile: false },
		setIcon: () => {},
		setTooltip: () => {},
		Setting: class {
			settingEl: Element;
			constructor(root: Element) { this.settingEl = root.createDiv(); }
			setName(text: string): this { this.settingEl.text = text; return this; }
			setDesc(): this { return this; }
			setHeading(): this { return this; }
			addDropdown(callback: (control: object) => void): this {
				const selectEl = this.settingEl.createEl("select");
				const control = {
					selectEl,
					addOption: (_value: string, text: string) => { selectEl.createEl("option", { text }); return control; },
					setValue: (value: string) => { selectEl.value = value; return control; },
					setDisabled: () => control,
					onChange: (change: (value: string) => void) => selectEl.addEventListener("change", () => change(selectEl.value)),
				};
				callback(control);
				return this;
			}
			addText(callback: (control: object) => void): this {
				const inputEl = this.settingEl.createEl("input");
				const control = {
					inputEl,
					setValue: (value: string) => { inputEl.value = value; return control; },
					getValue: () => inputEl.value,
					setPlaceholder: () => control,
					setDisabled: () => control,
					onChange: (change: (value: string) => void) => inputEl.addEventListener("input", () => change(inputEl.value)),
				};
				callback(control);
				return this;
			}
		},
	};
});

it("renders the library when Obsidian opens the workspace view", async () => {
	const plugin = {
		storage: { personals: () => new Map(), progress: () => new Map(), deletedBookIds: () => new Set(["test-11"]) },
		books: Array.from({ length: 12 }, (_, i) => ({
			id: "test-" + i, title: "Test book " + (i + 1), author: "Test author",
			category: "Test", availability: "available", pageCount: 100,
		})),
		origin: "https://books.example.test",
		pdfPlusStatus: () => "enabled",
		run: (action: () => Promise<unknown>) => action(),
	} as unknown as LibraryPlugin;
	const view = new LibraryView({} as ConstructorParameters<typeof LibraryView>[0], plugin);

	await (view as unknown as { open(): Promise<void> }).open();

	const content = view.contentEl as unknown as { find: (text: string) => { listeners: Map<string, () => void> } | undefined };
	expect(JSON.stringify(content)).toContain("Test book 10");
	expect(JSON.stringify(content)).not.toContain("Test book 11");
	expect(JSON.stringify(content)).toContain("Page 1 of 2");
	expect(JSON.stringify(content)).toContain("All books");
	expect(JSON.stringify(content)).not.toContain("New note");
	expect(JSON.stringify(content)).toContain("Not started");
	expect(JSON.stringify(content)).toContain('"connected":"false"');
	expect(JSON.stringify(content)).not.toContain("Open notes");
	expect(JSON.stringify(content)).toContain("Test author");
	content.find("Next")!.listeners.get("click")!();
	expect(JSON.stringify(content)).toContain("Page 2 of 2");
	expect(JSON.stringify(content)).toContain("Test book 11");
	expect(JSON.stringify(content)).not.toContain("Test book 12");
	content.find("Previous")!.listeners.get("click")!();
	expect(JSON.stringify(content)).toContain("Page 1 of 2");
});

it("shows the active source fields and loads a desktop folder from the settings", async () => {
	const plugin = {
		localFolder: "",
		origin: "https://books.example.test",
		books: [{}],
		useLocalFolder: vi.fn(function (this: LibraryPlugin) {
			this.connected = true;
		}),
	} as unknown as LibraryPlugin;
	const view = new LibraryView({} as ConstructorParameters<typeof LibraryView>[0], plugin);
	const close = vi.fn();
	renderLibrarySettings(view.contentEl, plugin, close);

	type Element = {
		value: string;
		children: Element[];
		listeners: Map<string, () => unknown>;
		find(text: string): Element | undefined;
	};
	const content = view.contentEl as unknown as Element;
	expect(content.find("Server address")).toBeDefined();
	const [selector] = content.find("Storage location")!.children;
	selector.value = "local";
	selector.listeners.get("change")!();
	expect(content.find("Server address")).toBeUndefined();
	const [input] = content.find("PDF folder")!.children;
	input.value = "D:\\Books";
	await content.find("Load books")!.listeners.get("click")!();
	expect(plugin.useLocalFolder).toHaveBeenCalledWith("D:\\Books");
	expect(content.find("Connected / 1 book")).toBeDefined();
	expect(close).toHaveBeenCalledOnce();
});

it("resumes the most recently read available book at its saved page", async () => {
	const openBook = vi.fn();
	const books = ["earlier", "recent", "unavailable"].map(id => ({
		id, title: id, category: "Test", availability: id === "unavailable" ? "missing" : "available",
	}));
	const progress = new Map(books.map((book, index) => [book.id, [{
		id: book.id, bookId: book.id, parents: [], page: 20 + index,
		updatedAt: "2026-11-2" + index, completed: false,
	}]]));
	const plugin = {
		books, openBook, origin: "https://books.example.test", connected: true,
		storage: { personals: () => new Map(), progress: () => progress, deletedBookIds: () => new Set() },
		pdfPlusStatus: () => "enabled",
		run: (action: () => Promise<unknown>) => action(),
	} as unknown as LibraryPlugin;
	const view = new LibraryView({} as ConstructorParameters<typeof LibraryView>[0], plugin);

	await view.onOpen();

	type Node = { text: string; cls: string; children: Node[]; listeners: Map<string, () => unknown> };
	const content = view.contentEl as unknown as Node;
	const shelf = content.children.flatMap(node => node.children).find(node => node.cls === "ol-resume")!;
	expect(shelf.children).toHaveLength(2);
	const [latest, earlier] = shelf.children;
	expect(JSON.stringify(latest)).toContain("recent");
	expect(JSON.stringify(earlier)).toContain("earlier");
	await latest.children[1].children.find(node => node.text === "Continue reading")!.listeners.get("click")!();
	expect(openBook).toHaveBeenCalledExactlyOnceWith(books[1], 21, false);
});
