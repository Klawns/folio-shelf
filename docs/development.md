# Development

Use Node.js 24 and npm for the plugin. The build compiles TypeScript and bundles `plugin/main.js`. Follow the [manual installation steps](../README.md#manual-installation) to load the build in a test vault.

```sh
git clone https://github.com/Klawns/obsidian-library-plugin.git
cd obsidian-library-plugin/plugin
npm ci
npm test
npm run build
```

Use Go 1.25 or later for the server. From the `plugin/` directory above, run:

```sh
cd ../server
go test ./...
go build -o obsidian-library .
```

## Contributing

Use [GitHub Issues](https://github.com/Klawns/obsidian-library-plugin/issues) for bugs and suggestions. Include reproduction steps, expected and actual behavior, your platform, Obsidian and plugin versions, and the library source. Remove private paths and server addresses from screenshots and logs.

In a pull request, describe what changed and how you verified it. Run the tests for the component you changed.

## Release packaging

The [release workflow](../.github/workflows/release.yml) runs the plugin tests and builds the release. It uploads `main.js`, `manifest.json`, and `styles.css` as individual attachments, plus a ZIP for manual installation.

The workflow bumps the version in its checkout. Before submitting to Community Plugins, verify that the root manifest on the public default branch points to a published release with the exact same version tag and that the attached manifest matches. See the [official submission guide](https://docs.obsidian.md/plugins/releasing/submit-plugin).
