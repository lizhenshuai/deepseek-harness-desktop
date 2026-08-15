# DeepSeek Harness Desktop Client

English | [中文](README.zh.md)

The **Windows desktop client** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`). It wraps the DeepSeek Harness Web runtime in an Electron shell: on launch it runs the bundled `dsh web` backend and opens the Web UI in a sandboxed window — no Node.js, pnpm, or repository files required.

This repository is derived from upstream [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), an open-source agent harness where **everything is a plugin**, powered by [Cordis](https://github.com/cordiverse/cordis). The desktop client itself lives in [`apps/desktop`](apps/desktop); the rest of the tree is the upstream harness it packages. See [architecture](docs/architecture.md) for the plugin model.

## Features

- **Zero setup**: bundles the Node runtime and the `dsh web` backend, so users need no Node.js, pnpm, or checkout
- **Sandboxed**: the Electron renderer runs with `sandbox` and `contextIsolation`, with Node integration, preload, and WebView disabled
- **Single instance**: only one application instance runs at a time
- **Resilient lifecycle**: backend readiness probing, graceful and forced shutdown, crash recovery, and manual restart
- **Persistent data**: application data lives under Electron `userData` and survives uninstall
- **Redacted logs**: backend logs are redacted and capped, keeping the last two generations

## Download & install

Requires **Windows 10 / 11 (x64)**.

Download the latest `Setup.exe` from [Releases](https://github.com/lizhenshuai/deepseek-harness-desktop/releases) and run it:

- installs per user by default (no administrator rights required), with a selectable installation directory
- creates desktop and Start Menu shortcuts, then launches the application

> The current installer is unsigned, so Windows SmartScreen may warn. Choose "More info → Run anyway" to continue.

## Build from source

Prerequisites: Node.js `^22.19 || >=24` and pnpm.

```sh
pnpm install
pnpm run desktop:build     # compile the Electron main process
pnpm run desktop:package   # build the hardened package (ASAR + external runtime resources)
pnpm run desktop:make      # produce the Windows x64 NSIS installer (out/make/DeepSeek-Harness-Setup-x64.exe)
```

## Development

```sh
pnpm run desktop:test            # unit tests
pnpm run desktop:test:electron   # replay semantic/screenshot snapshots in real Electron
pnpm run desktop:test:packaged   # verify the packaged build (requires desktop:package first)
```

See [`apps/desktop/README.md`](apps/desktop/README.md) for the full desktop development and release notes.

## Community

Interested in joining the group chat? Scan the QR code:

<img width="280" alt="DeepSeek Harness community group chat QR code" src="https://github.com/user-attachments/assets/56148239-5d99-414c-8893-8c091e7941da" />

> The QR code is valid for 7 days and is refreshed by the group owner.

## Security & limitations

- The backend endpoint is restricted to the loopback `http://127.0.0.1:<port>` origin
- The renderer has no Node integration, preload, or IPC surface; it reaches the backend only through the managed page
- Uninstall preserves `userData`; remove it manually afterwards for a full cleanup

## License

[MIT](LICENSE)

Third-party dependencies and licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
