# Development

Use Node.js 24 and npm for the plugin. After the build, copy `main.js`, `manifest.json`, and `styles.css` from `plugin/` into the test vault using the [manual installation steps](../README.md#manual-installation).

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

The workflow bumps the version in its checkout. The manifest on the public default branch currently declares `0.2.4`, while the published release and attached manifest use `0.2.28`. Align the default-branch manifest, release tag, and attached manifest before submission. [Official submission guide](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)

- Choose a compliant display name and plugin ID before submission. Both “Obsidian Library” and `obsidian-library` contain a term reserved by the directory. Plan the change to the plugin folder and ID for existing installations before making it. [Manifest requirements](https://docs.obsidian.md/Reference/Manifest)
- Choose a license and add a `LICENSE` file. [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)
- Resolve the use of desktop-only Node.js APIs in **Local folder** against the directory's `isDesktopOnly` rule while preserving **Remote server** on mobile. Confirm the declared minimum Obsidian version on supported devices. [Submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
