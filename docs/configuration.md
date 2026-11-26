# Advanced configuration

## Library sources and preferences

In **Settings → Obsidian Library**, select a source, choose a default study notes folder and optional Markdown template, and set the default layout, cover size, and progress visibility.

**Local folder** scans an absolute path and its subfolders on desktop. The folder selection is device-local. Generated references contain absolute file URLs and require access to the referenced path.

**Remote server** keeps a Markdown catalog snapshot in the vault for offline browsing. Opening a remote PDF requires a server connection. Select **Refresh** to fetch the current catalog and any newly processed metadata.

## Data storage

In **Settings → Obsidian Library → Data storage**, enter a vault-relative **Library data folder** and press **Enter** or leave the field. Selecting a folder in the picker also validates it immediately. New vaults default to `Library/`. Existing vaults continue using their current location until you change the folder. For example, choosing `04 Diversos/Biblioteca` puts the catalog, reading progress, per-book preferences, hidden-book markers, and PDF references under that folder’s `_state/` and `_refs/` directories.

Choose a destination without either internal directory. If the current folder has data, confirm the displayed source and destination. The plugin moves those two directories and updates its note links. Study notes, book records, and original PDFs stay in place. **Study notes → Notes folder** still controls where new book records and study notes are created.

If Obsidian closes during a move, the plugin resumes when it starts again. If it reports a conflict, inspect the displayed path and preserve both sets of files while resolving it, then select **Resume move** if a move is pending. If validation failed before the move began, press **Enter** to try the path again.

### Fast Note Sync

Pause Fast Note Sync on every device and update Obsidian Library on each one before moving data. Keep synchronization paused while setting the same data folder on each device. Check that the new folder is included in your sync rules and that the library opens from it on each device before resuming synchronization.

## Book state

Use **⋯ → Confirm page…** to enter a page or mark the book finished. When updates conflict, choose **⋯ → Resolve reading progress…**. **⋯ → Delete from library…** hides a book while preserving its PDF, notes, and progress. To restore it, remove its Markdown marker from `_state/deleted/` in your configured data folder. Existing vaults with plugin data under `Biblioteca/` continue to use their original folders and links.

Linking a vault folder places the generated reference in `Files/` and the book record in `Notes/`. Study notes can use the default Markdown template.

## Server options

| Setting | Purpose |
| --- | --- |
| `LIBRARY_SCAN_INTERVAL` | Controls periodic scans. Defaults to `15m` and accepts intervals of at least one minute. |
| `LIBRARY_GENERATE_COVERS` | Set to `false` to disable thumbnail generation. |
| `LIBRARY_PDF_ORIGIN` | Optional comma-separated list of exact viewer origins. Set it when the PDF viewer requires CORS. |
| `LIBRARY_UID`, `LIBRARY_GID`, `LIBRARY_BOOKS_GID` | Compose user and group IDs for reading books and writing server state. |
| `LIBRARY_ROOT`, `LIBRARY_INDEX`, `LIBRARY_LISTEN` | Native service PDF directory, catalog file, and loopback listener. Compose sets these internally. |

Place `Book.cover.jpg` or `Book.cover.png` beside `Book.pdf` on the server to use a custom cover. The image can be up to 5 MiB and 4,000 pixels per side. A custom image takes precedence over a PDF page selected through **⋯ → Change cover…**.

See [server setup](server-setup.md) for deployment and access controls.
