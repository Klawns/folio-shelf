import { describe, expect, it } from "vitest";
import { Book, Progress, bookFileName, endpoint, hasConflict, progressHeads, referencePath, studyFolder, validBooks, validProgress } from "./model";

const bookId = "aaaaaaaa-0000-4000-8000-000000000001";
const origin = "https://books.example.test";
const event = (index: number, page: number, parents: string[] = [], completed = false): Progress => ({
	id: "bbbbbbbb-0000-4000-8000-" + String(index).padStart(12, "0"),
	bookId, page, completed, parents,
	updatedAt: new Date(Date.UTC(2026, 0, index)).toISOString(),
	deviceId: "cccccccc-0000-4000-8000-000000000001",
});

it("accepts study folders within the vault and sanitizes generated file names", () => {
	expect(studyFolder("03 Estudos\\Redes/Redes TCP")).toBe("03 Estudos/Redes/Redes TCP");
	expect(() => studyFolder("../Redes")).toThrow();
	expect(() => studyFolder("C:\\Redes")).toThrow();
	expect(() => studyFolder(".obsidian/plugins")).toThrow();
	expect(() => studyFolder("Library/_state")).toThrow();
	expect(() => studyFolder("Biblioteca/_state")).toThrow();
	expect(bookFileName("Protocolos: TCP/IP")).toBe("Protocolos  TCP IP");
	expect(bookFileName("CON")).toBe("Book con");
});

describe("progresso", () => {
	it("preserva atualizações concorrentes até a escolha explícita, mesmo fora de ordem", () => {
		const first = event(1, 7);
		const desktop = event(2, 19, [first.id]);
		const mobile = event(3, 13, [first.id]);
		const heads = progressHeads([mobile, first, desktop, desktop]);
		expect(hasConflict(heads)).toBe(true);
		expect(heads.map(item => item.page)).toEqual([13, 19]);
		const chosen = event(4, 19, heads.map(item => item.id));
		expect(progressHeads([chosen, desktop, mobile, first])).toEqual([chosen]);
		expect(hasConflict(progressHeads([chosen, mobile]))).toBe(false);
	});

	it("distingue conclusão e rejeita páginas inválidas", () => {
		expect(hasConflict([event(1, 7), event(2, 7, [], true)])).toBe(true);
		expect(hasConflict([event(1, 7), event(2, 7)])).toBe(false);
		expect(validProgress(event(1, 7))).toBe(true);
		expect(validProgress(event(1, 0))).toBe(false);
	});
});

describe("catálogo e referências", () => {
	const book: Book = {
		id: bookId, title: "Livro", category: "Livros", availability: "available",
		format: "pdf", sizeBytes: 200, lastModified: "2026-01-01T00:00:00Z", etag: '"example"',
		readUrl: origin + "/api/v1/books/" + bookId + "/file",
	};
	it("aceita apenas referências do servidor configurado e IDs únicos", () => {
		expect(validBooks([book], origin)).toBe(true);
		expect(validBooks([book, book], origin)).toBe(false);
		expect(validBooks([{ ...book, readUrl: book.readUrl + "?secret=x" }], origin)).toBe(false);
		expect(validBooks([{ ...book, id: "../example" }], origin)).toBe(false);
		expect(validBooks([{ ...book, readUrl: "https://elsewhere.test/book.pdf" }], origin)).toBe(false);
		expect(referencePath(bookId)).toBe("Library/_refs/" + bookId + ".pdf");
	});
	it("valida a origem HTTPS", () => {
		expect(endpoint(origin + "/")).toBe(origin);
		expect(() => endpoint("http://books.example.test")).toThrow();
		expect(() => endpoint(origin + "/api")).toThrow();
		expect(() => endpoint("https://user:password@books.example.test")).toThrow();
	});
});
