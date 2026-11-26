import { App, TFolder, parseYaml } from "obsidian";
import { idPattern, studyFolder } from "./model";
import { LibraryStorage } from "./storage";

const migrationKey = "obsidian-library-data-migration";
const folders = ["_state", "_refs"] as const;
type Move = { phase: "absent" | "pending" | "moving" | "done"; entries: string[] };
export interface DataMigration {
	from: string;
	to: string;
	legacy: boolean;
	moves: Record<typeof folders[number], Move>;
}

export function pendingMigration(app: App): DataMigration | undefined {
	return app.loadLocalStorage(migrationKey) ?? undefined;
}

function conflict(path: string): Error {
	return new Error("Resolve the library data conflict at " + path + " and try Apply again.");
}

function entries(folder: TFolder, root = folder.path): string[] {
	return folder.children.flatMap(child => [
		child.path.slice(root.length + 1) + (child instanceof TFolder ? "/" : ""),
		...(child instanceof TFolder ? entries(child, root) : []),
	]).sort();
}

export async function planMigration(storage: LibraryStorage, app: App, input: string): Promise<DataMigration | undefined> {
	const to = studyFolder(input, storage.root);
	if (to === storage.root) return;
	if (to.toLowerCase() === storage.root.toLowerCase()) throw conflict(to);
	const moves = {} as DataMigration["moves"];
	for (const name of folders) {
		const destination = to + "/" + name;
		if (await app.vault.adapter.exists(destination, false)) throw conflict(destination);
		const source = storage.root + "/" + name;
		const file = app.vault.getAbstractFileByPath(source);
		if (!(file instanceof TFolder) && (file || await app.vault.adapter.exists(source, false))) throw conflict(source);
		moves[name] = file instanceof TFolder
			? { phase: "pending", entries: entries(file) }
			: { phase: "absent", entries: [] };
	}
	for (let path = to; path; path = path.slice(0, Math.max(0, path.lastIndexOf("/")))) {
		if (!(app.vault.getAbstractFileByPath(path) instanceof TFolder) && await app.vault.adapter.exists(path, false)) {
			throw conflict(path);
		}
	}
	return { from: storage.root, to, legacy: storage.legacy, moves };
}

export function saveMigration(app: App, move: DataMigration | null): void {
	app.saveLocalStorage(migrationKey, move);
}

export async function moveLibraryData(app: App, storage: LibraryStorage, migration: DataMigration): Promise<void> {
	const { from, to, moves } = migration;
	for (const name of folders) {
		const source = from + "/" + name;
		const destination = to + "/" + name;
		const step = moves[name];
		const old = app.vault.getAbstractFileByPath(source);
		const targetExists = await app.vault.adapter.exists(destination, false);
		if (step.phase === "absent") {
			if (old || await app.vault.adapter.exists(source, false)) throw conflict(source);
			if (targetExists) throw conflict(destination);
			continue;
		}
		if (step.phase !== "done" && old instanceof TFolder) {
			if (targetExists) throw conflict(destination);
			// The inventory is refreshed before the first move to include any changes made while the confirmation was open.
			if (step.phase === "pending") step.entries = entries(old);
			step.phase = "moving";
			saveMigration(app, migration);
			try {
				await storage.ensureFolder(to);
				if (await app.vault.adapter.exists(destination, false)) throw conflict(destination);
				await app.fileManager.renameFile(old, destination);
			} catch (error) {
				throw new Error("Could not move " + source + " to " + destination + ". "
					+ (error instanceof Error ? error.message : ""));
			}
		} else if (old || await app.vault.adapter.exists(source, false) || step.phase === "pending") {
			throw conflict(source);
		}
		const target = app.vault.getAbstractFileByPath(destination);
		if (!(target instanceof TFolder) || JSON.stringify(entries(target)) !== JSON.stringify(step.entries)) {
			throw conflict(destination);
		}
		step.phase = "done";
		saveMigration(app, migration);
	}
	await updateReferences(app, from, to);
}

async function updateReferences(app: App, from: string, to: string): Promise<void> {
	const prefix = from + "/_refs/";
	const newPrefix = to + "/_refs/";
	for (const file of app.vault.getMarkdownFiles()) {
		if (file.path.startsWith(to + "/_state/")) continue;
		const original = await app.vault.read(file);
		if (!original.includes(prefix)) continue;
		const rewrite = (content: string) => content.replace(
			/\[\[([^\]\n#|]+\.pdf)(?=[#|\]])/g, (link, path: string) =>
				path.startsWith(prefix) && idPattern.test(path.slice(prefix.length, -4))
					? "[[" + newPrefix + path.slice(prefix.length) : link,
		);
		const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(original);
		if (header?.[1].includes(prefix) && /^refPath\s*:/m.test(header[1])) {
			const ref = parseYaml(header[1])?.refPath;
			if (typeof ref === "string" && ref.startsWith(prefix) && ref.endsWith(".pdf")
				&& idPattern.test(ref.slice(prefix.length, -4))) {
				await app.fileManager.processFrontMatter(file, data => {
					if (data.refPath === ref) data.refPath = newPrefix + ref.slice(prefix.length);
				});
			}
		}
		if (rewrite(original) !== original) await app.vault.process(file, rewrite);
	}
}
