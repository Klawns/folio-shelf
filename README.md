# Obsidian Library

A personal PDF library inside Obsidian. Open books from a folder on your desktop or from a computer running the Obsidian Library server. PDF++ opens the PDFs, and the vault stores notes, lightweight references, and reading progress.

[Product requirements](PRD_Obsidian_Library.md) · [Technical decisions](DECISOES_TECNICAS.md) · [Windows, iPhone, and Raspberry Pi validation](docs/VALIDACAO.md)

## Deploy on Raspberry Pi with Docker

1. Check the system architecture with `uname -m`. The multi-stage Dockerfile builds the Go service for the Docker architecture and packages it with Poppler in an Alpine image. The deployment targets Linux ARMv7 and ARM64.
2. Copy `.env.example` to `.env` in the project root. Set `LIBRARY_BOOKS_DIR` to the PDF directory on the external disk and `LIBRARY_PUBLIC_URL` to the private HTTPS origin of the Pi. Create an empty `.obsidian-library` file in the PDF directory on the mounted disk. This marker protects the index when the disk is unavailable.
3. Create `LIBRARY_STATE_DIR` on the Pi. Use a UID and GID that can read the books and write to the state directory. Compose defaults to `10001:10001`. Back up `catalog.json` because it contains the book IDs used by vault notes.
4. Run `docker compose up -d --build` and monitor `docker compose logs -f obsidian-library`. The first scan hashes files with one worker. The container uses the Linux host network, and the service listens on `127.0.0.1:8091`. After remounting the disk, run `docker compose up -d --force-recreate` to refresh the bind mount.
5. Use a private Tailscale Serve route to forward HTTPS to the service. Check `tailscale serve status` first. If the host has no existing route, run `tailscale serve --bg http://127.0.0.1:8091`. Check the tailnet policy and open `/health` on both authorized devices.
6. If the WebView requires CORS, set `LIBRARY_PDF_ORIGIN` to the exact origins observed during validation, separated by commas, then run `docker compose up -d`.

### Deploy with systemd

In `server/`, use Go 1.25 or newer. For ARMv7, build with `CGO_ENABLED=0 GOOS=linux GOARCH=arm GOARM=7 go build -trimpath -o obsidian-library .`. For ARM64, set `GOARCH=arm64` and omit `GOARM`. In PowerShell, set environment variables with syntax such as `$env:GOOS = 'linux'` before building.

Install the binary at `/usr/local/bin/obsidian-library`. Create an `obsidian-library` system user and group with read access to the books and the marker. Copy `server/.env.example` to `/etc/obsidian-library.env`, edit it, and install `server/obsidian-library.service` in `/etc/systemd/system/`. Run `sudo systemctl daemon-reload` and `sudo systemctl enable --now obsidian-library`. Read logs with `journalctl -u obsidian-library`.

## Install and update the plugin

Once a release is published, install **BRAT** from Obsidian's Community plugins. In BRAT, choose **Add Beta plugin**, enter `Klawns/obsidian-library-plugin`, and select **Latest version**. Add the repository on each device where you want BRAT to manage updates. You can also download the ZIP from [GitHub Releases](https://github.com/Klawns/obsidian-library-plugin/releases).

Use `dist/obsidian-library-plugin.zip` or build from source. With Node.js 22.12 or newer, run `npm ci`, `npm test`, and `npm run build` in `plugin/`.

Copy `manifest.json`, `main.js`, and `styles.css` to `.obsidian/plugins/obsidian-library/` in the vault. On iPhone, transfer the same three files to the corresponding mobile vault folder. Restart Obsidian if the plugin does not appear. Enable **Obsidian Library**, **PDF++**, and **Fast Note Sync**, then enable external PDFs in PDF++.

Open the library from the ribbon or with **Open library**. Click **Set up library** and choose where your books are stored.

- **This device** (desktop only). Paste the full path to the folder, such as `C:\Books` or `/Users/you/Books`, then click **Load books**. The plugin includes PDFs in subfolders and leaves the original files where they are. Enable external PDFs in PDF++ to open them in Obsidian. The source folder is saved on the current device. PDF++ references use absolute paths and can resolve on another device only if the same path is accessible there.
- **Another computer or server**. Run the Obsidian Library server on a computer that can read your PDF folder, then enter its HTTPS address and click **Test and connect**. Devices that can reach that address can browse and read the library.

Use **Refresh** to rescan the active folder or update the server catalog. Set the default notes folder and optional template separately under **Study notes**.

### Publish an update

Push or merge plugin changes into `main`. GitHub Actions takes the greater of the source version and the latest version tag, increments its patch number in the build, runs the tests, and publishes the matching tag, release, and assets. The generated version is recorded in the release and its manifest. Check progress under **Actions → Release Obsidian plugin**.

After publication, run the BRAT command to check for plugin updates in Obsidian, or enable automatic plugin updates in BRAT settings. Repeat on each device you configured with BRAT.

Update the Raspberry Pi service using the deployment steps above when a change requires it.

## Read and sync

- Use **⋯ → Link folder…** and enter a vault-relative path such as `Studies/Networking/Book`. The plugin puts the PDF reference in `Files/` and the book record in `Notes/`. Relinking a legacy folder moves the recognized book record and its original generated PDF reference when the destination is available.
- Choose **New note** to create a study note in `Notes/`. On desktop, the note opens alongside the PDF when available. Set the default study folder and an optional Markdown template in **Community plugins → Obsidian Library**.
- The plugin saves the current page after it settles in the active PDF++ book tab. Fast Note Sync sends the saved page to other devices. Cards show the saved page as a percentage of the catalog page count. Use **Confirm page…** to enter a page manually, mark a book complete, or resolve conflicting updates.
- Browse 10 books at a time with **Previous** and **Next**. Search and filters apply to the full catalog. Use the **Reading** filter to return to a book in progress.
- Use **⋯ → Delete from library…** to remove a book from the displayed catalog on synced devices. The PDF, notes, and reading progress are kept. To restore the book, remove its Markdown marker from `Biblioteca/_state/deleted/`.
- Sync Markdown under `Biblioteca/` and your linked study folders with Fast Note Sync. In server mode, the latest synced catalog stays available offline and opening a PDF requires a server connection. In local mode, the plugin scans the configured folder directly and creates PDF references when needed.

## Metadata and covers

The server publishes the catalog before calling `pdfinfo` and `pdftoppm`. A worker extracts the title, author, and page count and generates thumbnails up to 480 pixels. Click **Refresh** to fetch newly processed metadata.

- For a custom cover, place `Book.cover.jpg` or `Book.cover.png` alongside `Book.pdf` on the server. Use an image up to 5 MiB and 4,000 pixels per side.
- Use **⋯ → Change cover…** to select a PDF page. A custom image takes priority. The server caches the first page and the last alternate page rendered for each PDF.
- Set `LIBRARY_GENERATE_COVERS=false` in Compose to disable new thumbnails. Install Poppler for metadata extraction and cover generation in a systemd deployment.

## PDF storage

Compose mounts `LIBRARY_BOOKS_DIR` on the Raspberry Pi as read-only at `/books`. The server indexes PDF paths recursively and serves stable HTTPS URLs by book ID.

To change the source directory, run `python3 configurar-biblioteca.py` on the Pi. The helper accepts a local path or a Samba share served by the same Pi, resolves it to a Linux path, checks container access, and recreates the library service. If it cannot create the `.obsidian-library` marker, create an empty readable marker in the PDF directory first.

Copy new PDFs to the source directory. They appear in the plugin after the server scans the directory and you click **Refresh**.

## Test

Run `go test ./...` in `server/` and `npm test` in `plugin/`. Follow the [device validation guide](docs/VALIDACAO.md) to verify opening and syncing in Obsidian.
