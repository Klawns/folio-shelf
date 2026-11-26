# Server setup

Run the Obsidian Library server on a Linux host with access to your PDF folder. The server indexes PDFs recursively and serves the catalog, covers, and PDF files. Clients connect to an HTTPS base address, such as `https://books.example.com`.

## Docker Compose

1. From the repository root, copy [`.env.example`](../.env.example) to `.env`. Set `LIBRARY_BOOKS_DIR` to the PDF folder, `LIBRARY_STATE_DIR` to an existing writable directory, and `LIBRARY_PUBLIC_URL` to the HTTPS base address.
2. Create an empty `.obsidian-library` file in the PDF folder. The marker helps the server detect an unavailable library disk. Ensure the container UID and groups can read the books and marker and write to the state directory. Compose mounts the PDF folder read-only.
3. Start the service and check its logs.

   ```sh
   docker compose up -d --build
   docker compose logs obsidian-library
   ```

4. Route HTTPS to the service's loopback listener using a private network or an access-controlled proxy. The server has no built-in authentication. Use the same HTTPS base address in the proxy configuration, `.env`, and Obsidian.
5. Open `/health` on that HTTPS address from an authorized device. Wait for `catalogReady` to become `true`. In Obsidian choose **Remote server** and select **Test connection**.

Back up `catalog.json` from the state directory to preserve book IDs used by existing notes. If you remount the disk, run `docker compose up -d --force-recreate` to refresh the bind mount.

To change the PDF folder in an existing Compose installation, run `python3 server/scripts/configurar-biblioteca.py` from the repository root and enter the new folder when prompted.

## Native Linux with systemd

Build with Go 1.25 or later. Install Poppler for PDF metadata and generated covers.

```sh
cd server
go build -trimpath -o obsidian-library .
sudo install -m 0755 obsidian-library /usr/local/bin/obsidian-library
```

Create an `obsidian-library` system user and group with read access to the PDF folder and its `.obsidian-library` marker. Copy [`server/.env.example`](../server/.env.example) to `/etc/obsidian-library.env` and set the PDF folder and HTTPS address. Install the [systemd unit](../server/obsidian-library.service) in `/etc/systemd/system/`. It creates the default writable state directory under `/var/lib/`.

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now obsidian-library
sudo journalctl -u obsidian-library
```

Use the same HTTPS routing and health check as in the Compose setup. See [advanced configuration](configuration.md) for scan intervals, covers, and CORS.
