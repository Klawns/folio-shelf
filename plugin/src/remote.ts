import { requestUrl } from "obsidian";
import { Book, validBooks } from "./model";

export async function checkServer(origin: string): Promise<string | undefined> {
	const response = await requestUrl({ url: origin + "/health", throw: false });
	if (response.status !== 200 || typeof response.json?.version !== "string") {
		throw new Error("Unexpected server response (HTTP " + response.status + ").");
	}
	if (response.json.catalogReady !== true) {
		throw new Error("The server is reachable. The library is indexing or the disk is unavailable.");
	}
	const catalogVersion: unknown = response.json.catalogVersion;
	return typeof catalogVersion === "string" && catalogVersion ? catalogVersion : undefined;
}

export async function fetchCatalog(origin: string): Promise<{ version: string; books: Book[] }> {
	for (let attempt = 0; attempt < 2; attempt++) {
		const books: Book[] = [];
		const cursors = new Set<string>();
		let version: string | undefined;
		let cursor = "";
		do {
			const response = await requestUrl({
				url: origin + "/api/v1/books" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
				throw: false,
			});
			if (response.status === 409) break;
			if (response.status !== 200) throw new Error("Catalog request failed (HTTP " + response.status + ").");
			const data = response.json;
			if (!data || typeof data.version !== "string" || typeof data.nextCursor !== "string"
				|| (version !== undefined && version !== data.version) || !validBooks(data.books, origin)
				|| cursors.has(data.nextCursor)) {
				throw new Error("The server returned an incompatible catalog.");
			}
			version = data.version;
			books.push(...data.books);
			cursor = data.nextCursor;
			cursors.add(cursor);
			if (!cursor && version !== undefined && validBooks(books, origin)) return { version, books };
		} while (cursor);
	}
	throw new Error("Could not fetch a consistent catalog version.");
}

export async function checkPDF(url: string): Promise<void> {
	const response = await requestUrl({ url, method: "HEAD", throw: false });
	if (response.status === 404) throw new Error("Book not found on the server.");
	if (response.status === 415) throw new Error("The file is incompatible with the PDF reader.");
	if (response.status === 401 || response.status === 403) throw new Error("PDF access is unavailable on this network.");
	if (response.status !== 200) throw new Error("PDF unavailable (HTTP " + response.status + ").");
	if (!Object.entries(response.headers).some(([name, value]) =>
		name.toLowerCase() === "content-type" && value.toLowerCase().startsWith("application/pdf"))) {
		throw new Error("The server did not return a compatible PDF.");
	}
}
