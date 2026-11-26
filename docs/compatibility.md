# Compatibility

The [plugin manifest](../manifest.json) declares Obsidian **1.8.0** as the minimum version.

| Mode | Desktop | Mobile |
| --- | --- | --- |
| Local folder | Available through desktop filesystem APIs | Unavailable |
| Remote server | Available over HTTPS | Available over HTTPS |

PDF++ with external PDFs enabled is required to open books. Fast Note Sync is optional and syncs vault files. It does not provide access to the original PDFs.

The server's ARMv7 Docker build and basic HTTPS and byte-range requests from a Windows client were validated on a Raspberry Pi. Those checks covered the server and HTTP client. End-to-end testing of Obsidian's mobile viewer, cross-device links, and sync remains pending. See the [validation record](VALIDACAO.md) for the original test results and device test procedures.
