import { expect, it, vi } from "vitest";
import type LibraryPlugin from "./main";
import { LibraryView } from "./view";

vi.mock("obsidian", () => {
	class Element {
		text = "";
		dataset: Record<string, string> = {};
		listeners = new Map<string, () => void>();
		children: Element[] = [];
		createEl(_tag: string, options?: { text?: string }): Element {
			const child = new Element();
			child.text = options?.text ?? "";
			this.children.push(child);
			return child;
		}
		createDiv(): Element { return this.createEl("div"); }
		addClass(): void {}
		addEventListener(event: string, listener: () => void): void { this.listeners.set(event, listener); }
		querySelector(): null { return null; }
		find(text: string): Element | undefined {
			if (this.text === text) return this;
			for (const child of this.children) {
				const match = child.find(text);
				if (match) return match;
			}
		}
		setAttribute(): void {}
		empty(): void { this.children = []; }
		setText(text: string): void { this.text = text; }
	}

	return {
		ItemView: class {
			contentEl = new Element();
			open(): Promise<void> { return this.onOpen(); }
			async onOpen(): Promise<void> {}
		},
		Platform: { isMobile: false },
	};
});

it("renders the library when Obsidian opens the workspace view", async () => {
	const plugin = {
		storage: { personals: () => new Map(), progress: () => new Map(), deletedBookIds: () => new Set(["test-11"]) },
		books: Array.from({ length: 12 }, (_, i) => ({
			id: "test-" + i, title: "Test book " + (i + 1), author: "Test author",
			category: "Test", availability: "available", pageCount: 100,
		})),
		origin: "https://books.example.test",
		pdfPlusStatus: () => "enabled",
		run: (action: () => Promise<unknown>) => action(),
	} as unknown as LibraryPlugin;
	const view = new LibraryView({} as ConstructorParameters<typeof LibraryView>[0], plugin);

	await (view as unknown as { open(): Promise<void> }).open();

	const content = view.contentEl as unknown as { find: (text: string) => { listeners: Map<string, () => void> } | undefined };
	expect(JSON.stringify(content)).toContain("Test book 10");
	expect(JSON.stringify(content)).not.toContain("Test book 11");
	expect(JSON.stringify(content)).toContain("Page 1 of 2");
	expect(JSON.stringify(content)).toContain("Books (11)");
	expect(JSON.stringify(content)).toContain("New note");
	expect(JSON.stringify(content)).toContain("0%");
	expect(JSON.stringify(content)).toContain('"connected":"false"');
	expect(JSON.stringify(content)).not.toContain("Open notes");
	expect(JSON.stringify(content)).not.toContain("Test author");
	content.find("Next")!.listeners.get("click")!();
	expect(JSON.stringify(content)).toContain("Page 2 of 2");
	expect(JSON.stringify(content)).toContain("Test book 11");
	expect(JSON.stringify(content)).not.toContain("Test book 12");
	content.find("Previous")!.listeners.get("click")!();
	expect(JSON.stringify(content)).toContain("Page 1 of 2");
});
