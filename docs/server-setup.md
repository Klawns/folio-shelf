# Server setup

On Obsidian desktop, choose **Local folder** to read directly from a path like `C:\Books` or `\\files.home\shares\books`. Obsidian may ask you to allow access to the network host when PDF++ first opens a book from a share. To use **Remote server** on desktop or mobile, run the Obsidian Library server on a Linux host that can read your PDFs. The server indexes PDFs recursively and serves the catalog, covers, and PDF files.

## Guided setup with Docker Compose

1. Install Docker Engine with the Docker Compose plugin and start Docker. Have Python 3.10 or later available. The installer uses `sudo` for Docker commands when run as a regular user.
2. Set up private HTTPS. With Tailscale, connect the Linux server and each Obsidian device to your tailnet. Enable HTTPS certificates if prompted, then run the following on Linux. Copy the HTTPS address printed by Serve. [Tailscale Serve documentation](https://tailscale.com/docs/reference/tailscale-cli/serve)

   ```sh
   sudo tailscale serve --bg http://127.0.0.1:8091
   tailscale serve status
   ```

   An existing private HTTPS proxy can also forward the root of its HTTPS address to `http://127.0.0.1:8091` on the server. Use a certificate trusted by each client device. Keep the listener on loopback and restrict access through the private network or proxy. The library server has no built-in authentication. Avoid public exposure through port forwarding or Tailscale Funnel.

3. From the repository root, run the installer.

   ```sh
   python3 server/scripts/instalar-biblioteca.py
   ```

   Enter an absolute Linux path or a Samba share hosted by this Linux server, such as `//linux-host/books`. Resolving a local Samba share requires Samba's `testparm` command. Mount shares hosted on another machine in Linux first and enter the absolute mount path. The installer needs permission to create the marker in the PDF folder if it is absent. Choose a state directory outside the PDF folder. The installer can create it under an existing parent directory if it has write access there.

   Enter the private HTTPS address, such as `https://library.example.ts.net`, and review the configuration. After confirmation, the installer prepares the library marker, checks Compose and container access, writes `.env`, and starts the server. Compose mounts the PDFs read-only.
4. On the device running Obsidian, open the printed `/health` URL. When `catalogReady` is `true`, choose **Remote server**, paste the printed HTTPS base address, and select **Test connection**. If the device cannot open `/health`, check its private network access and certificate trust. If the catalog stays unavailable, check the PDF mount and the service logs with `docker compose logs obsidian-library`.

For manual Compose setup, use [`.env.example`](../.env.example), create an empty `.obsidian-library` marker in the PDF folder, and give the configured container user read access to the PDFs and marker and write access to the state directory. Start with `docker compose up -d --build`, using the same private HTTPS setup and health check.

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
