import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import LibraryPlugin from "./main";

vi.mock("obsidian", () => ({
	ItemView: class {},
	Platform: { isMobile: false, isDesktopApp: true },
	Plugin: class {},
	PluginSettingTab: class {},
	requestUrl: vi.fn(),
}));

const sources = process.platform === "win32" && process.env.OBSIDIAN_TEST_UNC === "1"
	? ["local", "UNC"] : ["local"];

it.each(sources)("indexes and opens external PDFs from a %s path and keeps the source after a failed switch", async source => {
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
		const sourcePath = source === "UNC" ? folder.replace(/^([a-z]):\\/i, "\\\\localhost\\$1$\\") : folder;
		await plugin.useLocalFolder(sourcePath);
		expect(plugin.books).toHaveLength(1);
		const [book] = plugin.books;
		expect(book).toMatchObject({ source: "local", title: "Book #1", category: "Computer Science" });
		expect(book.readUrl).toMatch(/^file:\/\/\/.*Book%20%231\.PDF$/);
		if (source === "UNC") expect(book.readUrl).toMatch(/^file:\/{5}localhost\//i);
		await plugin.openBook(book);
		expect(requestUrl).not.toHaveBeenCalled();
		expect(ensureReference).toHaveBeenCalledWith(book, undefined);
		expect(openFile).toHaveBeenCalledWith(reference, { active: true });
		await expect(plugin.useLocalFolder(join(sourcePath, "missing"))).rejects.toThrow("Could not scan this folder");
		if (source === "UNC") {
			await expect(plugin.useLocalFolder("\\\\localhost\\obsidian-library-missing-test-share"))
				.rejects.toThrow("Could not scan this folder");
		}
		await plugin.refresh();
		expect(plugin.books[0].id).toBe(book.id);
		await rm(join(category, "Book #1.PDF"));
		await expect(plugin.openBook(book)).rejects.toThrow("Could not find this PDF");
		await plugin.refresh();
		expect(plugin.books).toEqual([]);
	} finally {
		await rm(folder, { recursive: true, force: true });
	}
}, 40_000);
