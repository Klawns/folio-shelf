import { afterEach, expect, it, vi } from "vitest";
import LibraryPlugin from "./main";
import { referencePath } from "./model";

const requestUrl = vi.hoisted(() => vi.fn());

vi.mock("obsidian", () => ({
	ItemView: class {},
	Plugin: class {},
	PluginSettingTab: class {},
	requestUrl,
}));

afterEach(() => {
	requestUrl.mockReset();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it("skips the catalog download and snapshot write when the server version matches", async () => {
	const origin = "https://library.example";
	const library = new LibraryPlugin({} as never, {} as never);
	const saveSnapshot = vi.fn();
	Object.assign(library, {
		origin,
		app: { workspace: { getLeavesOfType: () => [] } },
		storage: {
			snapshot: async () => ({ origin, version: "same", books: [] }),
			personals: () => new Map(),
			saveSnapshot,
		},
	});
	await (library as unknown as { loadSnapshot(): Promise<void> }).loadSnapshot();
	requestUrl.mockResolvedValue({ status: 200, json: { version: "0.2.1", catalogReady: true, catalogVersion: "same" } });
	await library.refresh();

	expect(requestUrl).toHaveBeenCalledExactlyOnceWith({ url: origin + "/health", throw: false });
	expect(saveSnapshot).not.toHaveBeenCalled();
	expect(library.connected).toBe(true);
});

it("prepares the reference while checking the PDF and waits for both before opening", async () => {
	const book = { id: "12345678-1234-1234-1234-123456789abc", readUrl: "https://library.example/book.pdf" };
	const file = { path: referencePath(book.id) };
	type Response = { status: number; headers: Record<string, string> };
	let respond!: (response: Response) => void;
	requestUrl.mockReturnValue(new Promise<Response>(resolve => { respond = resolve; }));
	const ensureReference = vi.fn().mockResolvedValue(file);
	const openFile = vi.fn().mockResolvedValue(undefined);
	const library = new LibraryPlugin({} as never, {} as never);
	Object.assign(library, {
		app: { workspace: { getLeaf: () => ({ openFile }) } },
		storage: { personals: () => new Map(), folderReference: () => undefined, ensureReference },
	});

	const opening = library.openBook(book as Parameters<LibraryPlugin["openBook"]>[0]);
	expect(ensureReference).toHaveBeenCalledExactlyOnceWith(book, undefined);
	expect(openFile).not.toHaveBeenCalled();
	respond({ status: 200, headers: { "content-type": "application/pdf" } });
	await opening;
	expect(openFile).toHaveBeenCalledExactlyOnceWith(file, { active: true });
});

it("saves a settled PDF++ page once and preserves progress when the reader reopens at page one", async () => {
	vi.useFakeTimers();
	const id = "12345678-1234-1234-1234-123456789abc";
	const file = { path: referencePath(id) };
	const viewer = { currentPageNumber: 240, pdfDocument: {} };
	vi.stubGlobal("window", { pdfPlus: { lib: {
		getPDFView: () => ({ file }),
		getPDFViewer: () => viewer,
	} } });
	const library = new LibraryPlugin({} as never, {} as never);
	const saveProgress = vi.fn().mockResolvedValue(undefined);
	const progress = vi.fn().mockReturnValue(new Map());
	Object.assign(library, {
		app: { workspace: { getActiveFile: () => file } },
		storage: { personals: () => new Map(), progress, saveProgress, referencePath },
		books: [{ id, pageCount: 400 }],
	});
	const sample = () => (library as unknown as { saveViewerPage(): Promise<void> }).saveViewerPage();
	await sample();
	vi.advanceTimersByTime(1999);
	await sample();
	expect(saveProgress).not.toHaveBeenCalled();
	vi.advanceTimersByTime(1);
	await sample();
	await sample();
	expect(saveProgress).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ bookId: id, page: 240 }));

	progress.mockReturnValue(new Map([[id, [saveProgress.mock.calls[0][0]]]]));
	viewer.pdfDocument = {};
	viewer.currentPageNumber = 1;
	await sample();
	vi.advanceTimersByTime(2000);
	await sample();
	expect(saveProgress).toHaveBeenCalledTimes(1);
});
