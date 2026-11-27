import { App, TFile, TFolder } from "obsidian";
import { expect, it, vi } from "vitest";
import LibraryPlugin from "./main";
import { pendingMigration } from "./migration";
import { Book, referencePath } from "./model";
import { LibraryStorage } from "./storage";

vi.mock("obsidian", () => ({
	TFolder: class {},
	ItemView: class {},
	Notice: class {},
	Platform: { isMobile: false },
	PluginSettingTab: class {},
	Plugin: class {
		registerView() {}
		addRibbonIcon() {}
		addCommand() {}
		addSettingTab() {}
	},
	parseYaml: (text: string) => Object.fromEntries(text.split("\n").map(line => {
		const [key, ...value] = line.split(": ");
		const raw = value.join(": ");
		try { return [key, JSON.parse(raw)]; } catch { return [key, raw]; }
	})),
	TFile: class {},
}));

function testVault() {
	const files = new Map<string, TFile | TFolder>();
	const content = new Map<TFile, string>();
	const frontmatter = new Map<TFile, Record<string, unknown>>();
	const create = (path: string, text: string): TFile => {
		if (files.has(path)) throw new Error("Occupied");
		const name = path.split("/").pop()!;
		const file = Object.assign(new TFile(), {
			path, name, basename: name.replace(/\.(pdf|md)$/, ""),
			parent: { path: path.slice(0, path.lastIndexOf("/")), isRoot: () => !path.includes("/") },
			stat: { size: text.length },
		});
		files.set(path, file);
		content.set(file, text);
		return file;
	};
	const local = new Map<string, unknown>();
	const addFolder = (path: string) => {
		const folder = Object.assign(new TFolder(), {
			path,
			get children() { return [...files.values()].filter(child => child.path?.slice(0, child.path.lastIndexOf("/")) === this.path); },
		});
		files.set(path, folder);
		return folder;
	};
	const app = {
		loadLocalStorage: (key: string) => local.get(key),
		saveLocalStorage: (key: string, value: unknown) => local.set(key, structuredClone(value)),
		workspace: { onLayoutReady: () => {} },
		vault: {
			getAbstractFileByPath: (path: string) => files.get(path),
			getMarkdownFiles: () => [...files.values()].filter(file => file instanceof TFile && file.path.endsWith(".md")),
			adapter: { exists: async (path: string) => [...files.keys()].some(key => key.toLowerCase() === path.toLowerCase()) },
			createFolder: async (path: string) => { addFolder(path); },
			read: async (file: TFile) => content.get(file),
			process: async (file: TFile, update: (text: string) => string) => {
				const updated = update(content.get(file)!);
				content.set(file, updated);
				return updated;
			},
			create: async (path: string, text: string) => create(path, text),
			createBinary: async (path: string, data: ArrayBuffer) => create(path, new TextDecoder().decode(data)),
			readBinary: async (file: TFile) => new TextEncoder().encode(content.get(file)).buffer,
		},
		metadataCache: {
			getFileCache: (file: TFile) => ({ frontmatter: frontmatter.get(file) }),
		},
		fileManager: {
			generateMarkdownLink: (file: TFile) => "[[" + file.path + "|Book record]]",
			processFrontMatter: async (file: TFile, modify: (data: Record<string, unknown>) => void) => {
				const data = frontmatter.get(file) ?? {};
				modify(data);
				frontmatter.set(file, data);
			},
			renameFile: async (file: TFile | TFolder, path: string) => {
				const from = file.path;
				for (const [key, entry] of [...files]) {
					if (key !== from && !key.startsWith(from + "/")) continue;
					files.delete(key);
					entry.path = path + key.slice(from.length);
					files.set(entry.path, entry);
				}
			},
		},
	} as unknown as App;
	return { storage: new LibraryStorage(app), app, files, content, frontmatter, create, addFolder };
}

const id = "12345678-1234-1234-1234-123456789abc";
const book: Book = {
	id, title: "Meu livro", category: "Redes", author: "Autor", format: "pdf",
	readUrl: "https://books.example.test/api/v1/books/" + id + "/file",
	availability: "available", sizeBytes: 1234, etag: '"tag"', lastModified: "2026-11-24T00:00:00Z",
};

it("persists library deletion across storage instances and allows retry", async () => {
	const { storage, app, create, files } = testVault();
	const note = create("Study/Notes/Chapter.md", "Personal notes");
	await Promise.all([storage.deleteFromLibrary(book), storage.deleteFromLibrary(book)]);
	expect(new LibraryStorage(app).deletedBookIds()).toEqual(new Set([book.id]));
	expect(files.has("Library/_state/deleted/" + book.id + ".md")).toBe(true);
	expect(files.get(note.path)).toBe(note);
});

it("moves a previously created note and preserves the existing PDF and stable reference", async () => {
	const { app, create, content, frontmatter, files } = testVault();
	files.set("Biblioteca/Notas", new TFolder());
	const storage = new LibraryStorage(app);
	const legacyReference = referencePath(book.id, "Biblioteca");
	const original = create("Biblioteca/Notas/Minha ficha.md", "Texto que escrevi.");
	frontmatter.set(original, { bookId: book.id, refPath: legacyReference });
	const occupied = create("Estudos/Redes/Files/Meu livro.pdf", "%PDF-1.7 original");

	await storage.linkFolder(book, "Estudos/Redes");

	expect(content.get(occupied)).toBe("%PDF-1.7 original");
	expect(content.get(files.get("Estudos/Redes/Files/Meu livro (12345678).pdf") as TFile)).toBe(book.readUrl);
	expect(content.get(files.get(legacyReference) as TFile)).toBe(book.readUrl);
	expect(original.path).toBe("Estudos/Redes/Notes/Minha ficha.md");
	expect(content.get(original)).toBe("Texto que escrevi.");
	expect(await storage.note(book, "Biblioteca/Notas")).toBe(original);
});

it("uses the typed filename for a study note and preserves an existing chapter", async () => {
	const { storage, create, content } = testVault();
	const ficha = create("Estudos/Redes/Meu livro.md", "Ficha");
	const note = await storage.createStudyNote(book, ficha, "Capítulo 1.md", "");
	expect(note.path).toBe("Estudos/Redes/Notes/Capítulo 1.md");
	expect(content.get(note)).toContain("# Capítulo 1");
	expect(content.get(note)).toContain("|Book record]]");
	await expect(storage.createStudyNote(book, ficha, "Capítulo 1", "")).rejects.toThrow("A note with that name already exists");
});

it("creates a prefixed book record with the original title and reopens it", async () => {
	const { storage, files, content, create, frontmatter } = testVault();
	const misplacedState = create("Estudos/" + book.id + ".md", "Estado que foi movido por uma versão anterior.");
	frontmatter.set(misplacedState, { bookId: book.id, folder: "Estudos/Redes", fileName: "Meu livro" });
	const record = await storage.linkFolder(book, "Estudos/Redes");
	expect(record.path).toBe("Estudos/Redes/Notes/Book record - Meu livro.md");
	expect(await storage.note(book, "Estudos")).toBe(record);
	const ficha = content.get(record);
	expect(ficha).toContain('Title: "Meu livro"');
	expect(ficha).toContain("PDF: \"[[" + referencePath(book.id));
	expect(ficha).not.toContain("bookId:");
	expect(ficha?.endsWith("\n---\n")).toBe(true);
	expect(misplacedState.path).toBe("Estudos/" + book.id + ".md");
	expect(content.get(files.get("Estudos/Redes/Files/Meu livro.pdf") as TFile)).toBe(book.readUrl);
});

it("reuses an unprefixed book record before Obsidian indexes it", async () => {
	const { storage, create } = testVault();
	const original = create("Study/Notes/Meu livro.md",
		'---\nTitle: "Meu livro"\nPDF: "[[' + referencePath(book.id) + '|Open book]]"\n---\n');

	expect(await storage.linkFolder(book, "Study")).toBe(original);
	expect(original.path).toBe("Study/Notes/Meu livro.md");
});

function pluginFor(app: App) {
	let settings: unknown;
	return async () => {
		const plugin = new LibraryPlugin(app, {} as never);
		Object.assign(plugin, {
			app,
			loadData: async () => structuredClone(settings),
			saveData: async (value: unknown) => { settings = structuredClone(value); },
		});
		await plugin.onload();
		return plugin;
	};
}

it("applies and reloads a custom data folder in a fresh vault", async () => {
	const { app, files } = testVault();
	const start = pluginFor(app);
	const plugin = await start();
	const confirm = vi.fn();
	expect(await plugin.changeDataFolder("04 Diversos/Biblioteca", confirm)).toBe(true);
	expect(confirm).not.toHaveBeenCalled();
	expect(plugin.studyRoot).toBe("Library/Notes");
	const restarted = await start();
	expect(restarted.storage.root).toBe("04 Diversos/Biblioteca");
	await restarted.storage.deleteFromLibrary(book);
	await restarted.storage.ensureReference(book);
	expect(files.has("04 Diversos/Biblioteca/_state/deleted/" + id + ".md")).toBe(true);
	expect(files.has(referencePath(id, "04 Diversos/Biblioteca"))).toBe(true);
	expect(files.has("Library/_state")).toBe(false);
});

it("migrates legacy data and resumes when Obsidian closes during a rename", async () => {
	const { app, addFolder, files, create, content, frontmatter } = testVault();
	addFolder("Biblioteca");
	addFolder("Biblioteca/_state");
	addFolder("Biblioteca/_state/livros");
	addFolder("Biblioteca/_state/progresso");
	addFolder("Biblioteca/Notas");
	const start = pluginFor(app);
	const plugin = await start();
	const snapshot = create("Biblioteca/_state/catalogo.md", "---\nschema: 1\norigin: \"https://books.example.test\""
		+ "\nversion: \"1\"\ncatalog: " + JSON.stringify(JSON.stringify([book])) + "\n---\n");
	const personal = create("Biblioteca/_state/livros/" + id + ".md", "");
	frontmatter.set(personal, { bookId: id, favorite: true });
	await plugin.storage.deleteFromLibrary(book);
	const progress = { id, bookId: id, deviceId: id, page: 42, completed: false, updatedAt: "2026-11-24", parents: [] };
	await plugin.storage.saveProgress(progress);
	frontmatter.set(files.get("Biblioteca/_state/progresso/" + id + "/" + id + ".md") as TFile, progress);
	const ref = await plugin.storage.ensureReference(book);
	const oldPath = ref.path;
	const record = create("Biblioteca/Notas/Record.md", "---\nbookId: " + id + "\nrefPath: " + oldPath + "\n---\n");
	frontmatter.set(record, { bookId: id, refPath: oldPath });
	const note = create("Study/Notes/Chapter.md", "See [[" + oldPath + "#page=4|Open book]].");
	const currentRecord = create("Study/Notes/Record.md", '---\nTitle: "Book"\nPDF: "[[' + oldPath + '|Open book]]"\n---\n');
	const original = create("Study/Files/Book.pdf", "%PDF-1.7");
	addFolder("Other/_refs");
	await expect(plugin.changeDataFolder("Other", vi.fn())).rejects.toThrow("Other/_refs");
	await expect(plugin.changeDataFolder("Biblioteca/_refs/Inside", vi.fn())).rejects.toThrow("vault-relative");
	const cancel = vi.fn().mockResolvedValue(false);
	expect(await plugin.changeDataFolder("New/Data", cancel)).toBe(false);
	expect(cancel).toHaveBeenCalledWith("Biblioteca", "New/Data");
	expect(pendingMigration(app)).toBeUndefined();

	const rename = app.fileManager.renameFile.bind(app.fileManager);
	vi.spyOn(app.fileManager, "renameFile").mockImplementationOnce(async (file, path) => {
		await rename(file, path);
		throw new Error("Interrupted after rename");
	});
	await expect(plugin.changeDataFolder("New/Data", async () => true)).rejects.toThrow("Interrupted");
	expect(plugin.storage.root).toBe("Biblioteca");
	expect(pendingMigration(app)?.moves._state.phase).toBe("moving");
	await expect(plugin.storage.saveProgress(progress)).rejects.toThrow("migration is pending");

	const collision = addFolder("New/Data/_refs");
	const blocked = await start();
	expect(blocked.storage.root).toBe("Biblioteca");
	expect(files.get("New/Data/_refs")).toBe(collision);
	expect(files.get(oldPath)).toBe(ref);
	files.delete("New/Data/_refs");

	const confirmResume = vi.fn();
	expect(await blocked.changeDataFolder("New/Data", confirmResume)).toBe(true);
	expect(confirmResume).not.toHaveBeenCalled();
	const restarted = await start();
	expect(pendingMigration(app)).toBeUndefined();
	expect(restarted.storage.root).toBe("New/Data");
	expect(restarted.studyRoot).toBe("Biblioteca/Notas");
	expect(restarted.storage.snapshotPath).toBe(snapshot.path);
	expect((await restarted.storage.snapshot())?.books).toEqual([book]);
	expect(restarted.storage.progress().get(id)).toEqual([progress]);
	expect(restarted.storage.personals().get(id)?.favorite).toBe(true);
	expect(restarted.storage.deletedBookIds()).toEqual(new Set([id]));
	expect(ref.path).toBe(referencePath(id, "New/Data"));
	expect(content.get(note)).toBe("See [[" + ref.path + "#page=4|Open book]].");
	expect(content.get(currentRecord)).toContain("PDF: \"[[" + ref.path + "|Open book]]\"");
	expect(frontmatter.get(record)?.refPath).toBe(ref.path);
	expect(await restarted.storage.note(book, restarted.studyRoot)).toBe(record);
	expect(record.path).toBe("Biblioteca/Notas/Record.md");
	expect(original.path).toBe("Study/Files/Book.pdf");
	expect(content.get(original)).toBe("%PDF-1.7");
	expect((await start()).storage.snapshotPath).toBe(snapshot.path);
});
