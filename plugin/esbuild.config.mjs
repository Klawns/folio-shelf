import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export async function buildPlugin() {
	const result = await build({
		entryPoints: ["./src/main.ts"],
		bundle: true,
		write: false,
		metafile: true,
		external: ["obsidian", "node:*"],
		platform: "browser",
		format: "cjs",
		target: "es2020",
		outfile: "main.js",
		tsconfigRaw: {},
		plugins: [{
			name: "local-typescript",
			setup(bundler) {
				// Route local reads through Node so the build also works in restricted Windows workspaces.
				bundler.onResolve({ filter: /^\./ }, args => {
					const directory = args.kind === "entry-point" ? process.cwd() : dirname(args.importer);
					const source = args.path.endsWith(".ts") ? args.path : args.path + ".ts";
					return { path: resolve(directory, source), namespace: "local-typescript" };
				});
				bundler.onLoad({ filter: /.*/, namespace: "local-typescript" }, async args => ({
					contents: await readFile(args.path, "utf8"),
					loader: "ts",
				}));
			},
		}],
	});
	const desktopModules = new Set(["node:fs/promises", "node:path", "node:url"]);
	for (const [source, input] of Object.entries(result.metafile.inputs)) {
		for (const dependency of input.imports) {
			if (!dependency.external || !desktopModules.has(dependency.path)) continue;
			if (source.replaceAll("\\", "/").endsWith("/src/local.ts")
				&& dependency.kind === "require-call" && desktopModules.has(dependency.path)) continue;
			throw new Error("Unexpected external import in " + source + " of " + dependency.path);
		}
	}
	for (const output of Object.values(result.metafile.outputs)) {
		for (const dependency of output.imports) {
			if (dependency.external && dependency.path !== "obsidian" && !desktopModules.has(dependency.path)) {
				throw new Error("Unexpected external module in the plugin bundle: " + dependency.path);
			}
		}
	}
	return result.outputFiles[0].text;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await writeFile("main.js", await buildPlugin());
}
