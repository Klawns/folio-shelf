import { expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import type LibraryPlugin from "./main";
import { LibraryView, renderLibrarySettings } from "./view";

const { menuItems, showMenu, picker } = vi.hoisted(() => ({
	menuItems: new Map<string, { checked: boolean; select: () => void }>(),
	showMenu: vi.fn(),
	picker: { choose: (_path: string) => {} },
}));

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
		appendChild(child: Element): void { this.children.push(child); }
		prepend(child: Element): void {
			this.children = [child, ...this.children.filter(element => element !== child)];
		}
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
		getBoundingClientRect() { return { left: 10, bottom: 50, width: 200 }; }
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
		attrs = new Map<string, string>();
		setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
		getAttribute(name: string): string | undefined { return this.attrs.get(name); }
		removeAttribute(name: string): void { this.attrs.delete(name); }
		empty(): void { this.children = []; }
		setText(text: string): void { this.text = text; }
	}

	return {
		ItemView: class {
			contentEl = new Element();
			open(): Promise<void> { return this.onOpen(); }
			async onOpen(): Promise<void> {}
		},
		Menu: class {
			constructor() { menuItems.clear(); }
			addItem(build: (item: {
				setTitle: (title: string) => typeof item;
				setChecked: (checked: boolean) => typeof item;
				onClick: (select: () => void) => void;
			}) => void) {
				let title = "";
				let checked = false;
				const item = {
					setTitle: (value: string) => { title = value; return item; },
					setChecked: (value: boolean) => { checked = value; return item; },
					onClick: (select: () => void) => { menuItems.set(title, { checked, select }); },
				};
				build(item);
			}
			onHide(): void {}
			showAtPosition = showMenu;
		},
		SuggestModal: class {
			setPlaceholder(): void {}
			onClose(): void {}
			open(): void {
				picker.choose = path => {
					this.onClose();
					this.onChooseSuggestion(path);
				};
			}
			onChooseSuggestion(_path: string): void {}
		},
		Platform: { isMobile: false },
		setIcon: () => {},
		setTooltip: () => {},
		Setting: class {
			settingEl: Element;
			descEl = new Element();
			get controlEl(): Element { return this.settingEl; }
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
			addButton(callback: (control: object) => void): this {
				const buttonEl = this.settingEl.createEl("button");
				callback({
					buttonEl,
					setButtonText: (text: string) => buttonEl.setText(text),
					onClick: (click: () => void) => buttonEl.addEventListener("click", click),
				});
				return this;
			}
			addSlider(): this { return this; }
			addToggle(): this { return this; }
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

it.each(["modal", "settings"] as const)("loads a desktop folder from the %s source menu", async surface => {
	const plugin = {
		localFolder: "",
		storage: { root: "Library" },
		origin: "https://books.example.test",
		books: [{}],
		appearance: { layout: "grid", coverSize: 150 },
		useLocalFolder: vi.fn(function (this: LibraryPlugin, path: string) {
			this.localFolder = path;
			this.connected = true;
		}),
	} as unknown as LibraryPlugin;
	const view = new LibraryView({} as ConstructorParameters<typeof LibraryView>[0], plugin);
	const close = vi.fn();
	renderLibrarySettings(view.contentEl, plugin, surface === "modal" ? close : undefined);

	type Element = {
		value: string;
		children: Element[];
		listeners: Map<string, () => unknown>;
		find(text: string): Element | undefined;
	};
	const content = view.contentEl as unknown as Element;
	const address = content.find("Server address")!.children.find(child => child.value === plugin.origin)!;
	address.value = "http://books.example.test";
	address.listeners.get("input")!();
	expect(content.find("Enter a valid HTTPS server address.")).toBeDefined();
	const selector = content.find("Storage location")!.children.find(child => child.find("Remote server"))!;
	selector.listeners.get("click")!();
	expect(showMenu).toHaveBeenLastCalledWith({ x: 10, y: 54, width: 200, overlap: true, left: false }, undefined);
	expect(menuItems.get("Remote server")?.checked).toBe(true);
	expect(menuItems.get("Local folder")?.checked).toBe(false);
	menuItems.get("Local folder")!.select();
	expect(selector.find("Local folder")).toBeDefined();
	selector.listeners.get("click")!();
	expect(menuItems.get("Local folder")?.checked).toBe(true);
	expect(content.find("Server address")).toBeUndefined();
	const [input] = content.find("PDF folder")!.children;
	input.value = "D:\\Books";
	await content.find("Load books")!.listeners.get("click")!();
	expect(plugin.useLocalFolder).toHaveBeenCalledWith("D:\\Books");
	if (surface === "modal") {
		expect(content.find("Connected")).toBeDefined();
		expect(content.find("1 book available")).toBeDefined();
		expect(close).toHaveBeenCalledOnce();
	} else {
		expect(content.find("Connected \u00b7 1 book")).toBeDefined();
	}
});

it("offers only the remote source in the native mobile selector", () => {
	const platform = Platform as { isMobile: boolean };
	const original = platform.isMobile;
	platform.isMobile = true;
	try {
		const plugin = { localFolder: "D:\\Books", origin: "", books: [] } as unknown as LibraryPlugin;
		const view = new LibraryView({} as ConstructorParameters<typeof LibraryView>[0], plugin);
		renderLibrarySettings(view.contentEl, plugin, vi.fn());

		type Element = { text: string; value: string; children: Element[]; find(text: string): Element | undefined };
		const content = view.contentEl as unknown as Element;
		const selector = content.find("Storage location")!.children.find(child => child.find("Choose a source"))!;
		expect(selector.children.map(option => option.text)).toEqual(["Choose a source", "Remote server"]);
		expect(selector.value).toBe("");
		expect(content.find("PDF folder")).toBeUndefined();
	} finally {
		platform.isMobile = original;
	}
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
	await latest.listeners.get("click")!();
	progress.clear();
	await view.render();
	expect(content.children.flatMap(node => node.children).some(node => node.cls === "ol-resume")).toBe(false);
	expect(openBook).toHaveBeenCalledExactlyOnceWith(books[1], 21, false);
});

it.each(["Enter", "blur", "picker"])("submits a data folder once via %s and restores it on cancellation", async trigger => {
	const changeDataFolder = vi.fn().mockResolvedValue(false);
	const { field, browse } = dataStorageControls(changeDataFolder);
	const blur = () => field.listeners.get("blur")!({});
	field.value = trigger === "picker" ? "Draft" : "New folder";
	field.listeners.get("input")!({});
	if (trigger === "Enter") {
		field.listeners.get("keydown")!({ key: "Enter", preventDefault: vi.fn() });
	} else if (trigger === "picker") {
		field.listeners.get("blur")!({ relatedTarget: browse });
		browse.listeners.get("click")!({});
		blur();
		expect(changeDataFolder).not.toHaveBeenCalled();
		picker.choose("New folder");
	}
	blur();
	await Promise.resolve();
	blur();
	expect(changeDataFolder).toHaveBeenCalledExactlyOnceWith("New folder", expect.any(Function));
	expect(field.value).toBe("Library");
});

it("shows the data conflict and resumes the pending data move", async () => {
	const changeDataFolder = vi.fn();
	const { plugin, field, resume, content } = dataStorageControls(changeDataFolder);
	changeDataFolder.mockImplementationOnce(async () => {
		plugin.dataMigration = { to: "New folder" } as LibraryPlugin["dataMigration"];
		throw new Error("Conflict at New folder/_refs");
	}).mockImplementationOnce(async () => {
		plugin.dataMigration = undefined;
		Object.assign(plugin.storage, { root: "New folder" });
		return true;
	});
	expect(resume.hidden).toBe(true);
	field.value = "New folder";
	field.listeners.get("blur")!({});
	await Promise.resolve();
	expect(field.disabled).toBe(true);
	expect(field.attrs.get("aria-invalid")).toBe("true");
	expect(content.find("Conflict at New folder/_refs")).toBeDefined();
	expect(resume.hidden).toBe(false);
	resume.listeners.get("click")!({});
	await Promise.resolve();
	expect(changeDataFolder).toHaveBeenCalledTimes(2);
	expect(field.value).toBe("New folder");
	expect(field.disabled).toBe(false);
	expect(field.attrs.has("aria-invalid")).toBe(false);
	expect(content.find("Conflict at New folder/_refs")).toBeUndefined();
	expect(resume.hidden).toBe(true);
});

function dataStorageControls(changeDataFolder: ReturnType<typeof vi.fn>) {
	const plugin = {
		app: { vault: { getAllFolders: () => [{ path: "New folder" }] } },
		localFolder: "",
		origin: "",
		books: [],
		storage: { root: "Library" },
		appearance: { layout: "grid", coverSize: 150 },
		changeDataFolder,
	} as unknown as LibraryPlugin;
	const view = new LibraryView({} as ConstructorParameters<typeof LibraryView>[0], plugin);
	renderLibrarySettings(view.contentEl, plugin);
	type Element = {
		children: Element[];
		listeners: Map<string, (event: object) => void>;
		attrs: Map<string, string>;
		value: string;
		disabled: boolean;
		hidden: boolean;
		find(text: string): Element | undefined;
	};
	const content = view.contentEl as unknown as Element;
	const [field, browse, resume] = content.find("Library data folder")!.children;
	return { plugin, field, browse, resume, content };
}
