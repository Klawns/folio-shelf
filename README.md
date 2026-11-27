# Folio Shelf

Browse your PDF collection in Obsidian, resume reading from your last saved page, and keep study notes linked to your books. Your PDFs stay in a folder on your desktop or on a server you run.

![Folio Shelf desktop catalog with search, filters, and reading progress](docs/images/desktop-shots.png)

[Desktop reading progress and book grid](docs/images/desktop-reading.png)

## Features

- **Browse your library.** Search by title or author, filter by category or reading status, and switch between grid and list views.
- **Resume reading.** Return to your saved page, confirm it manually, or mark a book finished.
- **Organize books.** Add favorites, edit titles and categories, or hide books from the catalog.
- **Take study notes.** Link books to vault folders and create Markdown notes from an optional template.
- **See metadata and covers.** In server mode, use PDF metadata, generated covers, or your own cover images.

## Installation

Requires Obsidian **1.8.0** or later. Install and enable [PDF++](https://github.com/RyotaUshio/obsidian-pdf-plus) under **Settings → Community plugins**, then turn on external PDF support.

Folio Shelf is not yet listed in the official Community Plugins directory. To install it with [BRAT](https://github.com/TfTHacker/obsidian42-brat), enable BRAT from **Community plugins**, choose **Add beta plugin** in BRAT, and enter `https://github.com/Klawns/folio-shelf`. Enable **Folio Shelf** under **Community plugins** if needed.

### Manual installation

1. Download the ZIP from [GitHub Releases](https://github.com/Klawns/folio-shelf/releases) or [build from source](docs/development.md).
2. Copy `manifest.json`, `main.js`, and `styles.css` into `.obsidian/plugins/folio-shelf/` inside your vault.
3. Reload Obsidian and enable **Folio Shelf** under **Settings → Community plugins**.

## Getting started

1. Run **Folio Shelf: Open library** from the command palette or select the library icon in the ribbon.
2. Choose **Set up library**. On desktop, select **Local folder**, enter the full path to your local or shared folder, and select **Load books**. To connect to a server from desktop or mobile, choose **Remote server**, enter its private HTTPS address, and select **Test connection**. On mobile, **Local folder (Desktop only)** is shown as a disabled option. [Server setup guide](docs/server-setup.md) / [Compatibility and validation](docs/compatibility.md)
3. Open a book. Select **New note** to create a study note, or use **⋯ → Link folder…** to associate the book with a vault folder.
4. Select **Refresh** after adding PDFs. Remote books appear after the server indexes them.

## Integrations

- **PDF++** opens the external PDF references and provides the viewer used to capture reading progress.
- **Fast Note Sync** can sync your catalog, reading progress, book preferences, and notes between devices. [Data storage and sync](docs/configuration.md#data-storage)

## Privacy and security

Local mode reads the selected PDF folder. Remote mode contacts your configured HTTPS server for health checks, the catalog, covers, and PDFs. The plugin contains no telemetry code.

Obsidian stores plugin preferences and the server address in plugin data. The selected local folder and device identifier are kept in device-local storage. Vault files can contain book metadata, reading history, and references with absolute file paths or server URLs. Syncing those files shares that information with the configured sync destination.

The server has no built-in authentication. Restrict access to trusted devices using a private network or an access-controlled proxy.

## Documentation

[Server setup](docs/server-setup.md) · [Advanced configuration](docs/configuration.md) · [Compatibility](docs/compatibility.md) · [Development and contributions](docs/development.md)

## License

Distributed under the [MIT License](LICENSE).
