import type { Book } from "./model";

interface Entry {
	name: string;
	isDirectory(): boolean;
	isFile(): boolean;
}

interface FileInfo {
	size: number;
	mtime: Date;
	isFile(): boolean;
}

declare function require(name: "node:fs/promises"): {
	readdir(path: string, options: { withFileTypes: true }): Promise<Entry[]>;
	readFile(path: string, encoding: "utf8"): Promise<string>;
	realpath(path: string): Promise<string>;
	stat(path: string): Promise<FileInfo>;
};
declare function require(name: "node:path"): {
	isAbsolute(path: string): boolean;
	join(...parts: string[]): string;
};
declare function require(name: "node:url"): {
	pathToFileURL(path: string): URL;
	fileURLToPath(url: string): string;
};

export async function scanLocalFolder(input: string, deviceId: string): Promise<{ folder: string; books: Book[] }> {
	const fs = require("node:fs/promises");
	const path = require("node:path");
	const { pathToFileURL } = require("node:url");
	const requested = input.trim();
	if (!path.isAbsolute(requested)) throw new Error("Enter the full path to your PDF folder.");
	const books: Book[] = [];
	let folder: string;
	try {
		folder = await fs.realpath(requested);
		const pending = [{ directory: folder, categories: [] as string[] }];
		while (pending.length) {
			const { directory, categories } = pending.pop()!;
			const entries = await fs.readdir(directory, { withFileTypes: true });
			for (const entry of entries) {
				const absolute = path.join(directory, entry.name);
				if (entry.isDirectory()) {
					pending.push({ directory: absolute, categories: [...categories, entry.name] });
				} else if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
					const info = await fs.stat(absolute);
					if (info.size <= 300 && /^(?:https?:\/\/|file:\/\/\/)/.test(await fs.readFile(absolute, "utf8"))) continue;
					const readUrl = pathToFileURL(absolute).href;
					const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceId + "\n" + readUrl));
					const hex = Array.from(new Uint8Array(digest).slice(0, 16), byte => byte.toString(16).padStart(2, "0")).join("");
					const id = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
					books.push({
						source: "local", id, title: entry.name.slice(0, -4), category: categories.join(" / ") || "Uncategorized",
						sizeBytes: info.size, format: "pdf", readUrl, availability: "available",
						etag: info.size + "-" + info.mtime.getTime(), lastModified: info.mtime.toISOString(),
					});
				}
			}
		}
	} catch {
		throw new Error("Could not scan this folder. Check that the folder and its PDFs are accessible.");
	}
	books.sort((a, b) => a.readUrl.localeCompare(b.readUrl));
	return { folder, books };
}

export async function checkLocalPDF(url: string): Promise<void> {
	const { fileURLToPath } = require("node:url");
	const { stat } = require("node:fs/promises");
	try {
		if ((await stat(fileURLToPath(url))).isFile()) return;
	} catch {
		// The file may have moved since the last scan.
	}
	throw new Error("Could not find this PDF. Check the folder and refresh the library.");
}
