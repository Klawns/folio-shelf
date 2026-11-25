import { App, TFile, TFolder } from "obsidian";
import { expect, it, vi } from "vitest";
import { Book, referencePath } from "./model";
import { LibraryStorage } from "./storage";

vi.mock("obsidian", () => ({
	TFolder: class {},
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
	const app = {
		vault: {
			getAbstractFileByPath: (path: string) => files.get(path),
			getMarkdownFiles: () => [...files.values()].filter(file => file instanceof TFile && file.path.endsWith(".md")),
			createFolder: async (path: string) => { files.set(path, new TFolder()); },
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
			renameFile: async (file: TFile, path: string) => {
				files.delete(file.path);
				file.path = path;
				files.set(path, file);
			},
		},
	} as unknown as App;
	return { storage: new LibraryStorage(app), app, files, content, frontmatter, create };
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
	expect(files.get(note.path)).toBe(note);
});

it("moves a previously created note and preserves the existing PDF and stable reference", async () => {
	const { storage, create, content, frontmatter, files } = testVault();
	const original = create("Biblioteca/Notas/Minha ficha.md", "Texto que escrevi.");
	frontmatter.set(original, { bookId: book.id, refPath: referencePath(book.id) });
	const occupied = create("Estudos/Redes/Files/Meu livro.pdf", "%PDF-1.7 original");

	await storage.linkFolder(book, "Estudos/Redes");

	expect(content.get(occupied)).toBe("%PDF-1.7 original");
	expect(content.get(files.get("Estudos/Redes/Files/Meu livro (12345678).pdf") as TFile)).toBe(book.readUrl);
	expect(content.get(files.get(referencePath(book.id)) as TFile)).toBe(book.readUrl);
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

it("creates a short properties-only ficha and a PDF reference in the selected folder", async () => {
	const { storage, files, content, create, frontmatter } = testVault();
	const misplacedState = create("Estudos/" + book.id + ".md", "Estado que foi movido por uma versão anterior.");
	frontmatter.set(misplacedState, { bookId: book.id, folder: "Estudos/Redes", fileName: "Meu livro" });
	await storage.linkFolder(book, "Estudos/Redes");
	const ficha = content.get(files.get("Estudos/Redes/Notes/Meu livro.md") as TFile);
	expect(ficha).toContain('Title: "Meu livro"');
	expect(ficha).toContain("PDF: \"[[" + referencePath(book.id));
	expect(ficha).not.toContain("bookId:");
	expect(ficha?.endsWith("\n---\n")).toBe(true);
	expect(misplacedState.path).toBe("Estudos/" + book.id + ".md");
	expect(content.get(files.get("Estudos/Redes/Files/Meu livro.pdf") as TFile)).toBe(book.readUrl);
});
