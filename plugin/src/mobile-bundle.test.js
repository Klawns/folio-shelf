import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { beforeAll, expect, it, vi } from "vitest";
import { buildPlugin } from "../esbuild.config.mjs";

let bundle;
beforeAll(async () => { bundle = await buildPlugin(); });

it.each(["iOS", "Android"])("loads the release bundle and reads remotely on simulated %s without Node.js", async platform => {
	const origin = "https://books.example.test";
	const id = "12345678-1234-1234-1234-123456789abc";
	const book = {
		id, title: "A book", category: "Test", sizeBytes: 100, format: "pdf",
		readUrl: origin + "/api/v1/books/" + id + "/file",
		availability: "available", etag: "test", lastModified: "2026-01-01T00:00:00Z",
	};
	const requestUrl = vi.fn(async ({ url, method }) => {
		if (url === origin + "/health") return { status: 200, json: { version: "1", catalogReady: true, catalogVersion: "2" } };
		if (url === origin + "/api/v1/books") return { status: 200, json: { version: "2", nextCursor: "next", books: [] } };
		if (url === origin + "/api/v1/books?cursor=next") return { status: 200, json: { version: "2", nextCursor: "", books: [book] } };
		if (url === book.readUrl && method === "HEAD") return { status: 200, headers: { "content-type": "application/pdf" } };
		throw new Error("Unexpected request " + url);
	});
	const folderKey = "obsidian-library-local-folder";
	const preferences = new Map([[folderKey, "/desktop/books"], ["obsidian-library-device-id", id]]);
	const openFile = vi.fn();
	const onLayoutReady = vi.fn();
	const module = { exports: {} };
	const requireObsidian = vi.fn(name => {
		if (name !== "obsidian") throw new Error("Unavailable module " + name);
		return {
			Platform: { isDesktopApp: false, isMobile: true, isIosApp: platform === "iOS", isAndroidApp: platform === "Android" },
			ItemView: class {},
			TFolder: class {},
			PluginSettingTab: class {},
			Plugin: class {
				app = {
					workspace: { onLayoutReady, getLeavesOfType: () => [], getLeaf: () => ({ openFile }) },
					vault: { on() {}, getAbstractFileByPath: () => undefined }, metadataCache: { on() {} },
					loadLocalStorage: key => preferences.get(key),
					saveLocalStorage: (key, value) => preferences.set(key, value),
				};
				async loadData() { return { origin }; }
				async saveData() {}
				registerView() {}
				addRibbonIcon() {}
				addCommand() {}
				addSettingTab() {}
				registerInterval() {}
				registerEvent() {}
			},
			requestUrl,
		};
	});
	runInNewContext(bundle, {
		module, require: requireObsidian, URL, TextEncoder, crypto: webcrypto,
		window: { setInterval: () => 1, setTimeout, clearTimeout },
	});
	const plugin = new module.exports.default();
	await plugin.onload();
	expect(plugin.localFolder).toBe("");
	expect(plugin.deviceId).toBe(id);
	expect(plugin.origin).toBe(origin);
	const file = { path: id + ".pdf" };
	const ensureReference = vi.fn().mockResolvedValue(file);
	const saveSnapshot = vi.fn();
	plugin.storage = {
		snapshot: async () => undefined, personals: () => new Map(),
		folderReference: () => undefined, ensureReference, saveSnapshot,
	};
	onLayoutReady.mock.calls[0][0]();
	await vi.waitFor(() => expect(saveSnapshot).toHaveBeenCalledWith({ schema: 1, origin, version: "2", books: [book] }));
	expect(plugin.books).toEqual([book]);
	expect(plugin.connected).toBe(true);
	await plugin.openBook(book);
	expect(requestUrl).toHaveBeenCalledWith({ url: book.readUrl, method: "HEAD", throw: false });
	expect(openFile).toHaveBeenCalledWith(file, { active: true });
	ensureReference.mockClear();
	await expect(plugin.openBook({ ...book, source: "local" })).rejects.toThrow("Local folders are available on desktop.");
	await expect(plugin.useLocalFolder("/files")).rejects.toThrow("Local folders are available on desktop.");
	expect(ensureReference).not.toHaveBeenCalled();
	await plugin.connect(origin);
	expect(preferences.get(folderKey)).toBe("/desktop/books");
	expect(requireObsidian.mock.calls.every(([name]) => name === "obsidian")).toBe(true);
	plugin.onunload();
});
