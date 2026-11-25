export const ROOT = "Biblioteca";
export const STATE = ROOT + "/_state";
export const SNAPSHOT = STATE + "/catalogo.md";
export const PROGRESS = STATE + "/progresso/";
export const PERSONAL = STATE + "/livros/";
export const DELETED = STATE + "/deleted/";
export const NOTES = ROOT + "/Notas/";
export const idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export interface Book {
	source?: "local";
	id: string;
	title: string;
	author?: string;
	category: string;
	sizeBytes: number;
	format: "pdf";
	readUrl: string;
	availability: "available" | "missing";
	etag: string;
	lastModified: string;
	pageCount?: number;
	coverUrl?: string;
}

export interface Progress {
	id: string;
	bookId: string;
	page: number;
	completed: boolean;
	updatedAt: string;
	deviceId: string;
	parents: string[];
}

export function endpoint(value: string): string {
	const url = new URL(value.trim());
	if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/"
		|| url.href !== url.origin + "/") {
		throw new Error("Enter a private HTTPS origin without a path or credentials.");
	}
	return url.origin;
}

function validateBook(value: unknown, origin: string): value is Book {
	if (!value || typeof value !== "object") return false;
	const entry = value as Partial<Book>;
	return typeof entry.id === "string" && idPattern.test(entry.id)
		&& entry.source === undefined
		&& typeof entry.title === "string" && typeof entry.category === "string"
		&& (entry.author === undefined || typeof entry.author === "string")
		&& (entry.coverUrl === undefined || entry.coverUrl === origin + "/api/v1/books/" + entry.id + "/cover")
		&& (entry.pageCount === undefined || (Number.isSafeInteger(entry.pageCount) && entry.pageCount > 0))
		&& Number.isSafeInteger(entry.sizeBytes) && entry.sizeBytes! >= 0
		&& typeof entry.etag === "string" && typeof entry.lastModified === "string"
		&& entry.format === "pdf" && (entry.availability === "available" || entry.availability === "missing")
		&& entry.readUrl === origin + "/api/v1/books/" + entry.id + "/file"
		&& new TextEncoder().encode(entry.readUrl).length <= 300;
}

export function validBooks(value: unknown, origin: string): value is Book[] {
	return Array.isArray(value) && value.every(book => validateBook(book, origin))
		&& new Set(value.map(book => book.id)).size === value.length;
}

export function validProgress(value: unknown): value is Progress {
	if (!value || typeof value !== "object") return false;
	const entry = value as Partial<Progress>;
	return typeof entry.id === "string" && idPattern.test(entry.id)
		&& typeof entry.bookId === "string" && idPattern.test(entry.bookId)
		&& typeof entry.deviceId === "string" && idPattern.test(entry.deviceId)
		&& typeof entry.updatedAt === "string" && Number.isFinite(Date.parse(entry.updatedAt))
		&& typeof entry.completed === "boolean" && Number.isSafeInteger(entry.page) && entry.page! > 0
		&& Array.isArray(entry.parents) && entry.parents.every(parent => (
			typeof parent === "string" && idPattern.test(parent) && parent !== entry.id
		));
}

export function progressHeads(entries: Progress[]): Progress[] {
	const superseded = new Set(entries.flatMap(entry => entry.parents));
	return [...new Map(entries.map(entry => [entry.id, entry])).values()]
		.filter(entry => !superseded.has(entry.id))
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

export function hasConflict(heads: Progress[]): boolean {
	return new Set(heads.map(entry => entry.page + "/" + entry.completed)).size > 1;
}

export function referencePath(id: string): string {
	return ROOT + "/_refs/" + id + ".pdf";
}

export function slug(title: string): string {
	return title.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
		.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "book";
}

export function studyFolder(input: string): string {
	const path = input.trim().replace(/\\/g, "/");
	if (!path || path.split("/").some(segment => !segment || segment.startsWith(".")
		|| /[<>:"|?*#[\]\x00-\x1f]/.test(segment) || /[. ]$/.test(segment)
		|| /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))
		|| path.toLowerCase().startsWith((STATE + "/").toLowerCase()) || path.toLowerCase() === STATE.toLowerCase()
		|| path.toLowerCase() === "biblioteca/_refs" || path.toLowerCase().startsWith("biblioteca/_refs/")) {
		throw new Error("Enter a valid vault-relative folder.");
	}
	return path;
}

export function bookFileName(title: string): string {
	const name = title.replace(/[<>:"/\\|?*#[\]\x00-\x1f]/g, " ").trim().slice(0, 90).replace(/^[. ]+|[. ]+$/g, "");
	return !name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? "Book " + slug(title) : name;
}
