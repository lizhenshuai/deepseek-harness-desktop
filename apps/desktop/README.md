# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

This private workspace package owns the Electron main process and Windows x64 Squirrel installer for the staged desktop runtime. It starts one bundled `dsh web` backend and creates one sandboxed window over its loopback endpoint. Automatic updates remain outside the desktop package.

## Build and test

`pnpm run desktop:build` emits the ESM main entry, and `pnpm run desktop:test` exercises backend lifecycle, bounded diagnostics, window state, origin, navigation, permissions, runtime paths, and single-instance policy. `pnpm run desktop:test:electron -- <absolute-runtime-root>` launches the built shell against the Task 2 staged runtime and replays the committed semantic and screenshot snapshots in real Electron. Development requires the explicit absolute `DSH_DESKTOP_RUNTIME_ROOT`; packaged applications always use `resources/runtime`.

`pnpm run desktop:package` stores the Electron main code in ASAR and copies `dist/desktop-runtime/windows-x64/runtime`, `LICENSE`, and `THIRD_PARTY_NOTICES.md` as external resources. `pnpm run desktop:make` produces the Windows x64 Squirrel `Setup.exe`, full NuGet package, `RELEASES`, and SHA-256 inventory; `desktop:verify-package` and `desktop:verify-installer` inspect those artifact layers. `pnpm run desktop:test:packaged -- <absolute-executable>` connects to a test-only loopback Chromium debugging endpoint and verifies the hardened package's real Web composition, sandboxed renderer, visual snapshot, and single-instance behavior; the development Electron smoke owns main-process restart coverage because the packaged fuse disables Node inspection. The shell has no renderer source, preload script, IPC API, or update client.

`pnpm run desktop:verify-acceptance -- ...` validates the machine-readable reports produced by the dedicated Windows 10/11 Hyper-V controllers. It fails on a missing lifecycle assertion, a different installer digest, unsigned release evidence, a credential match, an incomplete operating-system matrix, or a missing protected Provider result. The controller prerequisites, signed-candidate sequence, and release verdict are in the [desktop release acceptance runbook](../../docs/cookbook/desktop-release-acceptance.md).

## Security and limitations

The desktop controller runs the bundled Node and CLI with `web --supervised-stdin --host 127.0.0.1 --port 0`, stores Harness data under `<userData>/harness`, validates the exact ready origin, and probes the served index before creating a window. Normal exit sends `shutdown\n` and awaits quiescence; timeout, Windows session end, and host exit use the shared process-tree termination fallback. Current and previous backend logs are redacted and capped under `<userData>/logs`. The native menu and failure dialog provide restart, log, and exit actions without preload or IPC privileges.

Squirrel install, update, uninstall, and obsolete invocations exit before runtime resolution or backend startup. Developer and pull-request builds are unsigned by default. A release supplies an absolute regular PFX through `DSH_WINDOWS_CERTIFICATE_FILE` and its secret through `DSH_WINDOWS_CERTIFICATE_PASSWORD`; `DSH_WINDOWS_SIGN_REQUIRED=1` rejects an unsigned build. Signing inputs are never copied into the application.

The backend endpoint must be an exact `http://127.0.0.1:<port>` origin. The renderer has Node integration disabled, context isolation and sandboxing enabled, WebView disabled, no preload, no permissions, and no packaged developer tools. Frame navigation and redirects remain on the managed origin; child windows are denied, and only validated credential-free HTTP or HTTPS targets may open in the system browser. Release acceptance consumes the installer from an upstream workflow without rebuilding it and restores a sealed guest snapshot before each destructive phase.
