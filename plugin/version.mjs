import { readFile, writeFile } from "node:fs/promises";

const manifestPath = new URL("../manifest.json", import.meta.url);
const packagePath = new URL("./package.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const { version } = JSON.parse(await readFile(packagePath, "utf8"));
manifest.version = version;
const contents = JSON.stringify(manifest, null, 2) + "\n";
await writeFile(manifestPath, contents);
await writeFile(new URL("./manifest.json", import.meta.url), contents);
