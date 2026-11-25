import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import LibraryPlugin from "./main";

vi.mock("obsidian", () => ({
	ItemView: class {},
	Platform: { isMobile: false },
	Plugin: class {},
	PluginSettingTab: class {},
	requestUrl: vi.fn(),
}));

it("indexes and opens external PDFs without an HTTP request and keeps the source after a failed switch", async () => {
	const folder = await mkdtemp(join(tmpdir(), "obsidian-library-test-"));
	try {
		const category = join(folder, "Computer Science");
		await mkdir(category);
		await writeFile(join(category, "Book #1.PDF"), "%PDF-1.7");
		await writeFile(join(folder, "Ignore.txt"), "");
		await writeFile(join(folder, "Existing reference.pdf"), "https://books.example.test/book.pdf");
		const openFile = vi.fn();
		const reference = { path: "reference.pdf" };
		const ensureReference = vi.fn().mockResolvedValue(reference);
		const plugin = new LibraryPlugin();
		Object.assign(plugin, {
			app: {
				saveLocalStorage: vi.fn(),
				workspace: { getLeavesOfType: () => [], getLeaf: () => ({ openFile }) },
			},
			storage: { personals: () => new Map(), folderReference: () => undefined, ensureReference },
		});
		await plugin.useLocalFolder(folder);
		expect(plugin.books).toHaveLength(1);
		const [book] = plugin.books;
		expect(book).toMatchObject({ source: "local", title: "Book #1", category: "Computer Science" });
		expect(book.readUrl).toMatch(/^file:\/\/\/.*Book%20%231\.PDF$/);
		await plugin.openBook(book);
		expect(requestUrl).not.toHaveBeenCalled();
		expect(ensureReference).toHaveBeenCalledWith(book, undefined);
		expect(openFile).toHaveBeenCalledWith(reference, { active: true });
		await expect(plugin.useLocalFolder(join(folder, "missing"))).rejects.toThrow("Could not scan this folder");
		await plugin.refresh();
		expect(plugin.books[0].id).toBe(book.id);
		await rm(join(category, "Book #1.PDF"));
		await expect(plugin.openBook(book)).rejects.toThrow("Could not find this PDF");
		await plugin.refresh();
		expect(plugin.books).toEqual([]);
	} finally {
		await rm(folder, { recursive: true, force: true });
	}
});
