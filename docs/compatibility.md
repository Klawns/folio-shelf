# Compatibility

The [plugin manifest](../manifest.json) declares Obsidian **1.8.0** as the minimum version.

| Mode | Desktop | Mobile |
| --- | --- | --- |
| **Local folder** | Local and shared folders | Disabled with a **Desktop only** label |
| **Remote server** | Private HTTPS | Private HTTPS |

PDF++ with external PDFs enabled is required to open books. Fast Note Sync is optional and syncs vault files. It does not provide access to the original PDFs.

The server's ARMv7 Docker build and basic HTTPS and byte-range requests from a Windows client were validated on a Raspberry Pi. Those checks covered the server and HTTP client. End-to-end testing of Obsidian's mobile viewer, cross-device links, and sync remains pending. See the [validation record](VALIDACAO.md) for the original test results and device test procedures.

## Settings and sync

Local folder selection and the device identifier stay on each device. The server address remains in Obsidian plugin data. The remote catalog, progress, preferences per book and study notes remain in the vault for synchronization. Local PDF references require access to the original desktop path.

## Test coverage

| Platform | Automated plugin checks | Obsidian with PDF++ |
| --- | --- | --- |
| Windows | Build and 28 tests passed locally. | Pending |
| Linux | CI build and tests configured. | Pending |
| macOS | CI build and tests configured. | Pending |
| iOS | Bundle startup and remote catalog and PDF checks passed with mocked Obsidian APIs and Node.js access blocked. | Pending |
| Android | Same automated checks with the Android platform flag. | Pending |

For each real application test, use a test vault and record the OS, Obsidian and PDF++ versions and the result. On desktop, scan an absolute path, reopen a PDF with a saved page and verify its ID after refreshing. On Windows, also exercise a mapped drive and UNC path. On mobile, confirm that **Local folder** is disabled and connect over private HTTPS. On all five platforms, open and resume a remote PDF through PDF++, follow page and selection links, and verify catalog, progress and notes across devices. Record connectivity and PDF++ errors using the [validation procedure](VALIDACAO.md).

## Community directory submission

Both manifests declare `isDesktopOnly: false`. The official checklist describes conditional loading behind `Platform.isDesktopApp` for mobile-capable plugins. The submission requirements say plugins using Node.js or Electron APIs must declare `isDesktopOnly: true`. The mobile guide explains that these APIs are absent on mobile. The bundle tests verify runtime compatibility for the exercised paths. Directory acceptance of the desktop-only provider is pending confirmation from the Obsidian team. [Submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins) / [Self-critique checklist](https://docs.obsidian.md/oo/plugin) / [Mobile development](https://docs.obsidian.md/Plugins/Getting%20started/Mobile%20development)

If the directory rejects conditional Node.js use, evaluate a desktop companion based on the existing Go server. It would scan local and shared folders outside Obsidian and expose a loopback HTTPS endpoint. The same plugin could keep both source options and use `requestUrl` for each. Before adopting it, validate certificate trust and PDF++ byte ranges and links on the three desktop systems, including UNC on Windows. The companion would need to reproduce existing local IDs from the device ID and canonical file URL and preserve vault reference paths and existing links when their target URLs change. A Web file picker by itself does not establish persistent access to arbitrary paths or provide the stable URLs required by the existing PDF++ flow.
