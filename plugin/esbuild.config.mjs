import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

await build({
	entryPoints: ["./src/main.ts"],
	bundle: true,
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
