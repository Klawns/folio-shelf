# Development

Use Node.js 24 and npm for the plugin. After the build, copy `main.js`, `manifest.json`, and `styles.css` from `plugin/` into the test vault using the [manual installation steps](../README.md#manual-installation).

```sh
git clone https://github.com/Klawns/folio-shelf.git
cd folio-shelf/plugin
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

Use [GitHub Issues](https://github.com/Klawns/folio-shelf/issues) for bugs and suggestions. Include reproduction steps, expected and actual behavior, your platform, Obsidian and plugin versions, and the library source. Remove private paths and server addresses from screenshots and logs.

In a pull request, describe what changed and how you verified it. Run the tests for the component you changed.

## Release packaging

The [release workflow](../.github/workflows/release.yml) runs the plugin tests and builds the release. It uploads `main.js`, `manifest.json`, and `styles.css` as individual attachments, plus a ZIP for manual installation that includes the [MIT License](../LICENSE).

1. Update the version with `npm --prefix plugin version <version> --no-git-tag-version` from the repository root. Choose a version higher than the latest published tag.
2. Open a pull request with the version changes in both manifests, the package, and the lockfile. Merge it after CI passes.
3. In GitHub Actions, run **Release Folio Shelf** on `main`. The workflow tests and builds the committed version, then publishes a release with a matching tag and manifest.

The workflow uses the version committed on `main`. To publish another build, commit a new version first. [Official submission guide](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)

- Resolve the use of desktop-only Node.js APIs in **Local folder** against the directory's `isDesktopOnly` rule while preserving **Remote server** on mobile. Confirm the declared minimum Obsidian version on supported devices. [Submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
