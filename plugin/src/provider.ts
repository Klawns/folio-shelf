import type { Book } from "./model";

export interface LibraryProvider<Catalog extends { books: Book[] }> {
	readCatalog(): Promise<Catalog>;
	checkPDF(url: string): Promise<void>;
}
