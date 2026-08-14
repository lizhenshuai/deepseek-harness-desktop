# Agent Note: Self-contained Windows Desktop Distribution

Status: proposed

English | [中文](2026-08-14-windows-desktop-distribution.zh.md)

## Problem

The shipped Web application requires a compatible Node.js runtime, an installed npm dependency graph, built Host and Client packages, the Vite frontend dist, Cordis patch files, and a command that starts the `web` profile. A Windows user who only wants the desktop product should not need to install Node or pnpm, clone this monorepo, build packages, understand profiles, or keep a terminal open.

The Web application is not a standalone static site. `apps/web` supplies a Vite/React shell, but `apps/cli` initializes and composes the profile, `packages/bundle/web-app` inserts the Web Host and Client roster, `packages/host/webserver` and `packages/host/frontend-static` serve the boot-manifest-injected frontend, `packages/host/apiproxy` connects the API, and `packages/client/*` contribute browser plugins. Cordis resolves plugins by npm package name at runtime, so copying one bundled entry file cannot produce a complete application.

The runtime also starts Worker Threads, PowerShell, directory-picker workers, sandbox runners, and other subprocesses. Electron's `process.execPath` identifies the desktop executable rather than a normal `node.exe`; using Electron as the Harness interpreter would change assumptions held by Node child-process paths. The distribution therefore needs an explicit process, filesystem, security, persistence, and release design.

## Proposal

### Product scope

The first desktop release targets Windows 10 and 11 on x64. The user installs one `Setup.exe`, starts the application without a console window, configures model credentials in the existing UI, selects a workspace, and uses the existing Web product. The installed application requires neither Node, pnpm, repository files, nor workspace links. External tools invoked by agent work, such as Git, Python, compilers, or language servers, remain user-provided and are not implied by the self-contained Harness runtime.

Windows ARM64, a system tray, automatic updates, Microsoft Store packaging, and bundling general developer toolchains are deferred until the x64 installer and lifecycle pass clean-machine acceptance.

### Runtime topology and package ownership

Electron owns only the desktop window, single-instance behavior, navigation policy, backend process supervision, and application lifecycle. Its renderer loads the existing Web application and receives no Node integration. A checksum-pinned official Node.js 24 x64 runtime starts the built `apps/cli` entry with the `web` profile on a system-assigned `127.0.0.1` port.

The existing packages keep their roles: `apps/web` builds the browser shell; `apps/cli` owns profile boot; `packages/bundle/web-app` composes the browser application; `packages/host/{webserver,frontend-static,apiproxy}` own local HTTP, static assets, and API transport; `packages/client/web` assembles the shell; and `packages/client/*` provide the runtime Client plugin roster. A new `apps/desktop` owns Electron-specific code. A build-time staging script owns the production dependency closure and emits a manifest-checked desktop runtime; it does not introduce desktop behavior into `packages/core` or `agent-loop`.

The staged runtime contains compiled package exports, production dependencies, Cordis patch files, Client bundles, the Vite dist, licenses, the pinned `node.exe`, and a content manifest. It contains no TypeScript source, tests, caches, `.env`, credentials, repository-absolute paths, or workspace symlinks. Executable and dynamically resolved resources remain outside ASAR; Electron main-process code may use ASAR.

Electron sets `DSH_HOME` beneath its stable `userData` directory. Profiles, settings, credentials, sessions, attachments, and plugin state therefore survive application upgrades and uninstall by default. The install directory is immutable application content and is never a workspace or persistence root.

The BrowserWindow uses `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`. It loads only the exact loopback origin allocated for its managed backend, rejects other in-window navigation and window creation, and delegates allowed external HTTP or HTTPS links to the system browser. The server never binds to `0.0.0.0` for the desktop product.

### Ordered delivery tasks

1. **Architecture and closure proof.** Prove that built `dsh web` runs from a temporary directory outside the workspace with an independent Node executable. Record every dynamically resolved package and resource, fail on repository-path or workspace-link dependence, and settle the runtime, data, security, and release decisions before product implementation.
2. **Deterministic runtime staging.** Build a script that gathers the verified production closure, downloads or accepts the pinned Node runtime with SHA-256 verification, excludes development and sensitive content, writes `runtime-manifest.json`, and runs a built smoke from the staged directory after repository access is removed.
3. **Electron shell.** Add `apps/desktop` with Electron Forge configuration, a single-instance main process, a sandboxed BrowserWindow, strict origin and external-link handling, and unit tests for window and path policy. The shell consumes the staged runtime rather than workspace source.
4. **Backend lifecycle and desktop experience.** Implement explicit starting, ready, stopping, stopped, and failed states; bounded readiness detection; hidden child startup; log access; restart and exit actions; window-state persistence; crash handling; and complete process-tree teardown during ordinary exit, startup cancellation, failure, and Windows logoff.
5. **Windows installer.** Use Electron Forge and Squirrel.Windows to produce a Windows x64 installer, place the staged runtime outside ASAR, configure product metadata and shortcuts, preserve `userData` across upgrade and uninstall, verify paths containing spaces and non-ASCII characters, emit third-party notices, and expose a CI-safe code-signing configuration without requiring developer certificates.
6. **Clean-machine release acceptance.** Test install, first boot, missing credentials, offline boot, occupied default port, real model interaction, session persistence, file and PowerShell tools, Worker Threads, directory picking, crash recovery, upgrade, uninstall, and absence of orphaned processes on clean Windows 10 and 11 machines with no Node, pnpm, or Git. Convert this Note to implemented only after the shipped installer satisfies those checks.

Each task lands as a separate dependent PR. The introducing PR owns defects found before propagation. Every task plans and runs the smallest applicable unit, built-composition, browser snapshot, documentation, and Windows checks; CI retains the exhaustive platform matrix.

### Task 1 proof protocol

The packed-install verifier is the closure authority for Task 1. It installs the formal dsh, vendored Cordis, and Landlock entry tarballs into a temporary consumer outside the checkout, uses the selected Node distribution's own npm and `node` executable, assigns isolated npm and `DSH_HOME` directories, and rejects unsupported Node versions. Windows installs retain platform optional dependencies so native Koffi implementations come from their published platform package instead of requiring a compiler; non-Windows verification continues to omit the separately released Landlock platform artifacts.

With `--web`, the verifier starts the installed `dsh web` entry on a system-assigned loopback port and waits for its authoritative ready line. It fetches the served index, every local Vite or public resource referenced by that index, and every dynamic Client bundle in `window.__DSH_BOOT__`; validates boot fields and bundle URLs; records seed and dynamic injection references; hashes each response; and rejects profile module links whose resolved target leaves the consumer. The schema-versioned JSON report binds every supplied package name and version to its tarball SHA-256 and contains the Web profile bundles, Client rows, and resource hashes, but no timestamp, secret, checkout path, temporary path, or port.

The dsh release workflow runs the proof for the ordinary packed release and then replays the same tarballs on Windows x64 under Node 24. A Windows reference run with official Node 24.17.0, verified against its published SHA-256 list, installed 231 tarballs and fetched 44 browser resources, including 38 dynamic Client bundles. `pnpm run desktop:prove-runtime -- --node <node.exe> --from <directory>... --report <file>` provides the equivalent local entry for Task 2 and release diagnosis.

### Task 2 staging protocol

`pnpm run desktop:stage-runtime` accepts the formal tarball directories and Task 1 proof, then downloads or accepts the Node archive pinned by `scripts/desktop/runtime-targets.json`. It verifies the archive SHA-256, target version, platform, and architecture before using that distribution's npm. `scripts/desktop/runtime-lock.json` records every production package location, name, version, and either registry integrity or formal tarball SHA-256; normal staging rejects drift, while `desktop:update-runtime-lock` is the explicit review path for an intentional dependency change.

The projector follows required dependencies, installed optional dependencies, and peer dependencies from `@deepseek-ai/dsh`. It retains compiled exports, licenses, runtime assets, and only Windows x64 native prebuilds. It rejects links, tests, fixtures, coverage, TypeScript and build inputs, repository or temporary absolute paths, credential-bearing filenames, npm authentication, and private-key material. The stable `runtime-manifest.json` records the target, package inventory, and SHA-256 of every staged file; the standalone verifier rejects missing, changed, or additional files before process startup.

The Windows staging workflow consumes only release artifacts, and its downstream verification job checks out no repository and installs no package manager. The staged `node.exe` runs the copied verifier, starts packaged `dsh web`, checks that generated profile links remain inside the runtime, and compares all Client modules and frontend assets byte-for-byte with the Task 1 proof. The reference result contains 528 production package locations and 13,753 files totaling 230,187,447 bytes; 16 executable or native files remain, all required Windows x64 payloads. Two independent runs produced the same manifest SHA-256, `8c0f83702dd805cf92b547cca2d63279fa51005a71413b4e271b1f136de4651e`, and the smoke matched 38 Client modules and 44 frontend assets.

### Task 3 Electron shell design

#### Delivery boundary

Task 3 adds the private workspace package `apps/desktop` as the Electron main-process shell. It owns single-instance coordination, the one `BrowserWindow`, validation of the managed backend origin, navigation and external-link policy, Electron session permissions, packaged runtime path resolution, and Forge packaging configuration. It does not own backend process creation, readiness, restart, logs, failure presentation, process-tree teardown, window-state persistence, installer production, or updates; Tasks 4 and 5 own those concerns.

The shell consumes a `DesktopBackendEndpointProvider` that resolves once to an HTTP origin after the backend is ready. The accepted value is exactly `http://127.0.0.1:<port>` with a decimal port from 1 through 65535 and no credentials, path beyond `/`, query, or fragment. Task 3 tests supply this provider from an external test host that starts the Task 2 staged runtime. Task 4 supplies the product provider and owns its lifecycle. This prevents Task 3 from adding a temporary child-process implementation that would be replaced by the lifecycle state machine.

The Task 3 branch is a buildable and testable shell layer in the dependent delivery stack, not a release candidate by itself. Its Electron entry exports the composition function used by the integration harness; the product entry becomes complete when Task 4 connects the backend provider. A failure or invalid origin rejects before any window is created.

#### Package and build layout

`apps/desktop` contains `src/main.ts` for Electron event composition, `src/window.ts` for creating and disposing the single window, `src/origin-policy.ts` for pure URL decisions, `src/runtime-paths.ts` for packaged and test layout resolution, and `src/types.ts` for the backend endpoint provider. Tests mirror these owners. The package has no renderer source and no preload script because the existing Web application needs no Electron API.

The repository's existing TypeScript and tsdown pipeline emits ESM main-process code; Forge packages that code in ASAR and copies the Task 2 `runtime/` directory as an external resource. Packaged runtime lookup uses `process.resourcesPath/runtime`; test lookup receives an explicit absolute staged-runtime root and never guesses from the current working directory. Forge has no maker, signing, Squirrel startup, or update configuration until Task 5, and it does not use Forge's Vite plugin because there is no Electron-owned renderer to build.

Forge applies Electron fuses that disable RunAsNode, `NODE_OPTIONS`, and Node CLI inspect arguments, and enable cookie encryption, embedded ASAR integrity validation, and loading application code only from ASAR. The runtime remains outside ASAR because its `node.exe`, native modules, dynamic Client packages, profile files, and frontend resources require ordinary filesystem paths. The implementation pins Electron and Forge dependency versions in the lockfile and keeps Electron current through the release dependency process.

#### Main-process and window behavior

The main process calls `app.enableSandbox()` and requests the single-instance lock before `app.whenReady()`. A process that does not acquire the lock exits without resolving the backend provider or creating a window. The primary process treats `second-instance` only as an activation request: it restores a minimized window and focuses it, or records a pending activation until the first window exists; it does not interpret the second process's arguments or working directory.

After Electron is ready and the provider returns a valid origin, the shell installs the session permission policy, creates one hidden window, installs navigation policy before `loadURL()`, and shows the window only after `ready-to-show`. The initial window uses `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webviewTag: false`, packaged `devTools: false`, and no preload. The application menu is removed so packaged builds do not expose reload or developer-tool commands. Task 4 owns what happens when readiness fails, the window closes, or the application quits.

The default Electron session denies every permission request and permission check. `will-frame-navigate` and `will-redirect` allow only URLs whose origin exactly equals the managed loopback origin; every other main-frame or child-frame navigation is canceled. Same-document history and fragment changes remain available. `setWindowOpenHandler` always returns `deny`; an absolute external `https:` or `http:` URL with no username or password may be delegated to the system browser after the pure policy accepts it, while `file:`, `javascript:`, `data:`, custom schemes, malformed URLs, and credential-bearing URLs are rejected. No renderer-controlled input reaches `shell.openExternal` without this validation.

#### Verification plan

Cross-platform Vitest tests cover every accepted and rejected origin, same-origin paths and fragments, redirect and frame decisions, external-link schemes and credentials, packaged versus test runtime roots, secure `BrowserWindow` options, permission denial, and both single-instance branches. Electron API doubles implement only the methods each owner consumes; policy tests remain pure and do not launch external applications.

A Windows Electron integration suite consumes the `dsh-desktop-runtime-windows-x64` artifact from Task 2, starts its backend from outside the workspace, and launches the built shell against the resulting origin. It proves that exactly one window loads the staged Web application, `require` and Node globals are unavailable in the renderer, the window cannot navigate to another origin or create a child window, a second process activates the first instance and exits, and packaged runtime paths contain no checkout location. The suite records a keyless screenshot snapshot of the real Web composition inside Electron; the implementation PR also carries the required GUI demonstration GIF from the real staged server flow.

The Windows CI job depends on runtime staging, installs the Electron development dependencies from the lockfile, builds `apps/desktop`, and runs the integration suite. Package inspection verifies ASAR placement, external runtime placement, and configured fuses. Clean-machine installation, signing, upgrade, uninstall, backend crash recovery, and orphan-process checks remain acceptance work for Tasks 4 through 6.

The Task 3 reference implementation pins Electron 43.4.0 and Forge 7.11.2, emits a 6.74 kB ESM main bundle, and passes 22 policy and composition tests. Its real Electron replay loads 38 Client entries in one sandboxed window and proves that a secondary process exits with code zero without creating another window. Forge packages the complete 230 MB staged runtime outside ASAR; the package inspection confirms the runtime manifest and executables plus the six configured security fuses. The pnpm workspace publicly hoists only Forge tooling, while the packaged application excludes all npm dependencies because its main bundle imports only Electron. The private desktop assembly stays outside npm release discovery; the published CLI and Web apps remain in the dsh release family.

### Task 4 backend lifecycle design

#### Delivery boundary and ownership

Task 4 turns the Task 3 shell into a runnable packaged application by connecting its `DesktopBackendEndpointProvider` to one `DesktopBackendController`. The controller owns the staged backend process, readiness, restarts, diagnostics, and teardown; the shell continues to own single-instance activation and the managed window. Task 4 does not add an installer maker, signing, updates, a tray, remote access, or a second Web application. Task 5 remains the installer owner.

`apps/desktop` adds lifecycle, diagnostics, menu, and window-state modules. The existing local-subprocess implementation publishes a compiled `managed-process` subpath containing its detached-tree spawn primitive and local handle without requiring a Cordis context or importing its terminal provider. The desktop bundle consumes that subpath instead of implementing a second Windows process-tree algorithm. The local spawn options gain the explicit `windowsHide` choice required for `node.exe`; existing Consumers retain their current default.

`apps/cli` adds a generic supervised-stdin launch mode. In that mode the exact command `shutdown\n` and supervisor-pipe EOF both request the same quiescent shutdown used by SIGTERM; the first request wins, further input is ignored, and malformed or over-limit input disposes the mounted root before exiting nonzero. This small process protocol belongs to the CLI launcher, not `packages/core`, the Web Host, or a renderer-accessible HTTP route. A closed pipe therefore stops the backend when Electron crashes or is force-terminated, while ordinary desktop exit can still allow Cordis plugins to dispose before process-tree escalation.

#### Runtime paths, environment, and launch

Packaged startup verifies `process.resourcesPath/runtime` through the Task 2 manifest before spawning `runtime/node/node.exe` with `runtime/app/node_modules/@deepseek-ai/dsh/lib/bin.js web --supervised-stdin --host 127.0.0.1 --port 0`. The launcher-owned supervision flag precedes the Web app arguments under the CLI's pass-through parsing rules. Development and tests pass an explicit absolute staged-runtime root; neither mode searches the checkout or `PATH`. The child working directory and `DSH_HOME` are the stable `<userData>/harness` directory, which is created before launch and is never placed under the install directory.

The backend receives the subprocess primitive's credential-scrubbed parent environment plus explicit desktop-owned entries. The desktop product does not forward secret-shaped ambient variables; model credentials are configured through the existing UI and stored by the Harness under `DSH_HOME`. Environment values are never written to diagnostics. The executable, arguments, working directory, environment keys, and runtime manifest are resolved before spawn, so a self-contained misconfiguration fails before any child exists.

#### State machine and concurrency

The controller exposes a discriminated `DesktopBackendState` with `stopped`, `starting`, `ready`, `stopping`, and `failed` variants. Every start receives a monotonic generation number. Child output, readiness probes, exit callbacks, timers, dialogs, and restart completions carry that generation and cannot mutate a later run. `starting` and `ready` own exactly one process handle; `stopping` owns the same handle and one shared stop promise. `failed` records whether cleanup is complete and retains the handle only when a bounded force-stop could not prove tree exit.

`start()`, `stop(cause)`, and `restart()` serialize through one controller operation queue. Concurrent starts share one readiness promise; concurrent stops share one quiescence promise; restart is exactly stop followed by a fresh generation. A start requested while stopping waits for cleanup. A failed state may start again only after it owns no live process. Expected exit while stopping records exit facts without becoming a crash, while an exit from starting or ready becomes a startup or runtime failure for that generation.

The endpoint provider calls `start()` and resolves only from `ready`. Any spawn, manifest, output, readiness, or early-exit failure rejects before `createDesktopWindow`. A controller failure records timeout classification, exit code, signal, forced-termination use, stage, redacted diagnostic tail, and log path as independent facts; an exit code of zero never erases a simultaneous timeout or cancellation.

#### Readiness and recovery

The production lifecycle limits are supplied as one validated composition value so tests can use deterministic shorter bounds. Startup has one overall 60-second budget. The controller accepts only the CLI's authoritative `dsh web: http://127.0.0.1:<port>` stdout line, validates it with the Task 3 exact-origin parser, and performs a redirect-free loopback fetch of the served index before publishing the endpoint. Stderr text, partial lines, repeated ready lines, another host, or a ready line received after cancellation cannot make the run ready.

Stdout and stderr are decoded incrementally with a byte limit per unfinished line. The controller retains a redacted 64 KiB tail for immediate diagnostics and writes a redacted, size-capped generation log beneath `<userData>/logs`; it keeps only the current and previous backend logs. Redaction removes credential-shaped assignments, bearer values, URL user information, and secret query values before either sink sees them. The native Open Logs action reveals the internally constructed log file and never accepts a renderer path.

Startup failure and a post-ready backend crash hide or destroy the stale Web window and enter one native recovery loop with Retry, Open Logs, and Exit actions. Retry waits for complete cleanup and creates a new generation; because the loopback origin changes, it creates a new secured Web window instead of reusing navigation listeners bound to the old origin. A minimal native application menu exposes Restart Backend, Open Logs, and Exit during healthy operation and contains no reload or developer-tools command. No renderer preload or IPC API is added.

#### Shutdown and Windows session end

Normal stop closes diagnostic listeners first, writes `shutdown\n`, closes supervisor stdin, and awaits both the direct outcome and whole-tree quiescence. If the graceful period expires, it invokes the shared Windows tree termination and awaits confirmed exit. A bounded force-stop failure is reported without clearing ownership or claiming `stopped`; Retry and Exit first retry that cleanup. This ordering prevents late output or exit callbacks from reopening dialogs after teardown.

The first Electron `before-quit` event prevents default exit, persists window state, and awaits controller stop; a guarded second `app.quit()` proceeds only after quiescence. `window-all-closed`, the menu Exit action, startup cancellation, controller failure, and restart all delegate to the same coordinator rather than killing independently. The synchronous process-exit fallback force-terminates any still-owned tree, while supervised-stdin EOF gives the backend an independent graceful path when Electron disappears before asynchronous cleanup runs.

Windows does not emit Electron `before-quit` or `will-quit` during shutdown, restart, or logoff. The managed window therefore handles `query-session-end` by delaying session end only for the bounded stop, then exits the application; `session-end` and the process-exit hook perform the synchronous final tree termination if Windows advances before the wait completes. Repeated session-end notifications are idempotent and never start a backend generation.

#### Window state and durable files

Window geometry is stored separately from Harness data in `<userData>/window-state.json` with a schema version, normal bounds, and maximized state. Writes use a random sibling temporary file followed by atomic rename. Reads validate integer dimensions and minimum sizes, then require the restored rectangle to intersect a current display work area; invalid, off-screen, linked, or malformed state falls back to centered defaults. Move, resize, and maximize changes share one debounced writer, and final quit flushes it before backend teardown.

Task 4 never deletes `DSH_HOME`, logs, or window state during restart or exit. A runtime restart reuses the same home, so settings, credentials, sessions, and attachments remain available. Installer upgrade and uninstall preservation remain Task 5 acceptance work.

#### Implementation order and verification

Task 4 first publishes and tests the managed-process subpath and supervised-stdin protocol, then implements the pure controller state machine over injected process, clock, fetch, log, dialog, screen, and application adapters. It next connects packaged `main.ts`, the native actions, window recreation, and persistence. The final step replaces Task 3's development endpoint in the packaged composition and extends the Windows artifact job; each step keeps the product entry buildable.

Fake-clock tests cover every allowed transition, coalesced operations, stale-generation fencing, partial and oversized output, malformed origins, readiness timeout, cancellation at each startup point, early and post-ready exit, graceful and forced stop, cleanup failure, repeated quit, and callback exceptions. Durable-file tests cover atomic replacement, corruption, links, display changes, log rotation, byte bounds, and credential canaries. CLI built tests prove `shutdown\n`, EOF, malformed input, and a TERM-trapping descendant all reach the specified outcome.

The real Windows Electron lane starts the packaged Task 2 runtime with no external endpoint variable, verifies that `DSH_HOME` is outside the install tree, restarts onto a new origin, closes during startup and after ready, kills the Electron parent to exercise supervisor EOF, crashes the backend, and polls the complete process tree after every case. It records keyless healthy and recovery snapshots and the required real-flow GUI GIF. Windows session-event adapters receive focused tests in Task 4; destructive logoff acceptance on clean Windows 10 and 11 remains in Task 6.

Task 4 is complete when the packaged application reaches the existing Web UI without `DSH_DESKTOP_BACKEND_ORIGIN`; startup always becomes ready or a useful failure within its budget; Retry, Open Logs, Restart Backend, and Exit operate without renderer privileges; window state and `DSH_HOME` survive restart; and every tested close, cancellation, crash, parent death, forced stop, and simulated session-end path proves that no owned process remains. The branch remains unsigned and has no installer until Task 5.

#### Task 4 implementation record

The implementation publishes the self-contained `managed-process` entry, adds the bounded CLI stdin supervisor, and connects the packaged Electron main process to the staged runtime. The desktop controller owns generation-fenced startup, exact stdout readiness plus HTTP probing, graceful and forced stop, redacted two-generation logs, native startup/runtime recovery, backend restart with a new secured window, Windows session-end cleanup, and validated window bounds under `userData`. The renderer still has no preload or IPC surface.

Focused verification covers 32 desktop unit tests, two built-CLI supervised shutdown cases over a real Loader tree, workspace constraints, export JSDoc, and targeted lint. A fresh 231-tarball packed install served 38 Client bundles and 44 browser resources; its staged Windows runtime verified 528 package locations. Real Electron replay twice proved one sandboxed window, one-instance activation, backend-owned startup, restart onto a new origin, 38 Client entries, and stable semantic and pixel snapshots. This checkout has no `.git` metadata, so the required clean-worktree GUI GIF and git-backed translation-pairing command cannot run here; the bilingual blob records were calculated from the same Git blob format. Task 5 owns the completed ASAR, external-resource, fuse, and installer inspection.

### Task 5 Windows installer design

Task 5 adds the Squirrel.Windows maker to the existing Forge package and emits only Windows x64 artifacts: `DeepSeek-Harness-Setup-x64.exe`, one full NuGet package, `RELEASES`, and a SHA-256 inventory. The product-facing name remains `DeepSeek Harness`, while the NuGet identity and AppUserModelID use the space-free `DeepSeekHarness` identity required by Squirrel. MSI, delta packages, automatic updates, and publication to a public release remain outside this task.

Squirrel maintenance arguments are handled before runtime resolution, backend-controller construction, single-instance acquisition, or window creation. The maintained `electron-squirrel-startup` adapter creates and removes shortcuts for install, update, and uninstall events; handled invocations quit without touching `DSH_HOME`. Application code remains in ASAR, while the sealed runtime, root license, and generated third-party notices are external resources. Electron `userData` stays outside the per-user Squirrel install directory and no uninstall path deletes it.

Signing is optional for developer, pull-request, and master verification builds. A signing build supplies one absolute regular PFX file and its password through separate environment variables; partial configuration fails, and `DSH_WINDOWS_SIGN_REQUIRED=1` fails when no certificate is present. The same `windowsSign` object reaches Packager and Squirrel, so the application and installer share one Authenticode policy without copying the certificate or password into any artifact.

Windows CI makes the installer from the Task 2 artifact, verifies ASAR and fuse state, checks the external runtime and legal files, validates the exact Squirrel artifact set and checksum inventory, and requires the expected signed or unsigned Authenticode status. It then copies the packaged application beneath a path containing spaces and non-ASCII characters and replays the real Electron composition there. The unsigned installer is retained as a seven-day workflow artifact; Task 6 owns clean-machine installation, upgrade, uninstall, signed-release, and Windows 10/11 acceptance.

#### Task 5 implementation record

The desktop package uses Forge 7.11.2's Squirrel maker, a small maintenance-only entry before the product application module, fixed Windows product metadata, and all-or-nothing signing configuration. The official Electron Packager creates the fused directory package before Forge runs the maker with `--skip-package`, avoiding Forge's package-coordination deadlock while retaining its Squirrel integration. The maker output carries checksums generated from the final bytes, and the package inspector requires both legal documents beside the external runtime. The workspace permits the reviewed `electron-winstaller` install script and patches its `os.arch()` call so it installs the actual x64 7-Zip binary used by Squirrel instead of the package's broken generic alias.

Verification covers 35 desktop unit tests and a fresh 231-tarball Web composition with 528 staged package locations, 38 Client bundles, and 44 browser resources. Package inspection verifies ASAR, hardened fuses, the manifest-checked external runtime, and legal files; installer inspection verifies the exact Squirrel artifact set, SHA-256 inventory, absence of MSI, and the expected unsigned Authenticode state. The hardened packaged smoke uses a test-only loopback Chromium debugging endpoint because the Node-inspection fuse remains disabled, while the development Electron smoke covers backend restart through the native menu. The final package passes its semantic and visual snapshot from both its output directory and a copied path containing spaces and non-ASCII characters; a final `--squirrel-obsolete` executable probe exits successfully without creating the Harness home. Clean-machine install, upgrade, uninstall, and signed-release acceptance remain Task 6 work.

### Task 6 clean Windows release acceptance design

#### Boundary and artifact identity

Task 6 adds release-acceptance infrastructure and evidence; it does not introduce another desktop runtime, installer format, updater, or data migration layer. Each run consumes the exact Task 5 Squirrel artifact set produced by an upstream workflow, verifies `SHA256SUMS.txt` before copying any file into a guest, and records the candidate installer digest in every result. A guest never checks out the repository, installs build dependencies, or rebuilds the candidate. The accepted signed installer bytes are therefore the bytes eligible for publication.

The acceptance controller runs outside the guest so it can reset images, observe destructive sign-out and restart cases, recover results, and reject a guest that stops reporting. The guest runner and its versioned report schema ship in the repository, but the controller transfers only the runner, the locked artifact set, and non-secret scenario inputs. Product defects found by this task are fixed in the owning Task 1–5 surface; the acceptance harness must not normalize a failure or add a desktop-only compatibility shim.

#### Acceptance environments

The mandatory matrix uses disposable Windows 10 and Windows 11 x64 images restored from a sealed clean snapshot for every candidate. Each image has current product prerequisites and Windows updates for its declared build, but no Node, pnpm, Git, repository checkout, `DSH_*` variable, model credential, prior DeepSeek Harness installation, or Harness data. The interactive test account is a non-administrator whose profile path contains both a space and non-ASCII characters. The controller records the Windows edition and build, image identity, account privilege state, installed developer-tool probes, locale, architecture, and pre-run process and filesystem baselines.

The ordinary lifecycle lane is keyless and can run against an explicitly unsigned development candidate. The release lane requires a signed candidate, a clean trusted image, and protected workflow approval. Absence of either OS image, an unavailable controller, a dirty snapshot, an unexpected preinstalled tool, or a skipped mandatory scenario is a blocked or failed release gate, never a successful result. Windows 2025 GitHub-hosted jobs remain responsible for building and structurally inspecting the package; dedicated disposable images own Windows 10/11 product acceptance.

#### Required lifecycle sequence

One serial scenario owns the full state transition on each image: verify artifact identity and expected signature policy; install as the ordinary user without elevation; discover the active Squirrel installation through registered product state and shortcuts instead of a versioned path guess; launch from the installed shortcut; and wait for the existing Web UI. It proves the server uses a random loopback port even while port 3080 is occupied, rejects non-loopback listeners, and keeps `DSH_HOME`, logs, and window state outside the install tree.

Before credentials exist, the lane checks useful missing-credential behavior, offline startup, renderer isolation, all 38 packaged Client entries, directory selection under a path containing spaces and non-ASCII characters, and a keyless real-composition replay. It creates application-visible session and settings canaries, restarts the backend, exits and relaunches the application, and requires the same canaries to remain readable. Focused scenarios then exercise a filesystem operation, PowerShell/subprocess execution, a Worker Thread workflow, backend failure and recovery, forced Electron termination, and Windows sign-out. The external controller waits after every exit boundary until no process descended from or attributed to the application remains.

The upgrade step installs a lower-version accepted predecessor, creates an opaque data canary, applies the candidate through the supported Squirrel path, and proves the candidate executable replaced the predecessor while the install tree contains no durable data and `DSH_HOME` remains byte-preserved. Before the first tagged release, a controlled lower-version package of the same runtime may prove Squirrel replacement mechanics; it does not claim compatibility with an older pre-release session schema. Once an accepted release exists, its published artifact becomes the predecessor. Rejection of an obsolete pre-release data format remains valid product behavior and is reported separately from preservation of the files.

Uninstall runs through the registered Windows uninstall entry, not by deleting directories. It must remove shortcuts, registration, the versioned application tree, installer-owned executables, and running processes while preserving `DSH_HOME`, desktop logs, and window state. Reinstalling the same accepted candidate must rediscover the preserved canary. The controller then removes the disposable image rather than teaching the product uninstaller to delete user data.

#### Provider, signing, and secret handling

The signed release lane first requires Authenticode validity, the configured publisher identity, and a trusted timestamp on both `Setup.exe` and the installed application executable. Signing happens upstream; neither the PFX nor its password enters an acceptance guest or its artifact bundle. Signature verification is repeated after transfer and after installation so a trusted outer installer cannot conceal an unsigned or altered application executable.

One protected Windows 11 run completes a real DeepSeek provider conversation through the installed Web UI, verifies a stable transcript marker after application restart, and exercises the packaged filesystem, PowerShell, and Worker Thread paths in the same user session. The credential is injected only for that run through the supported product credential path, uses the smallest practical scope and lifetime, and is removed before the snapshot is discarded. A unique credential canary must be absent from desktop logs, acceptance JSON, screenshots, process command lines, environment captures, crash diagnostics, `DSH_HOME` exports, and uploaded artifacts. Provider unavailability is reported as a failed or explicitly rerunnable protected check; the keyless operating-system matrix remains independently diagnosable.

#### Evidence contract and CI topology

Each guest emits a bounded machine-readable report plus JUnit projection. The report includes schema and runner versions, installer and NuGet digests, signature results, OS and account attestations, discovered install and data roots, scenario timestamps, observed loopback endpoint, canary hashes, process-tree identities, pre/post filesystem deltas, and the result of every mandatory assertion. Screenshots cover installed first launch, missing credentials, recovered session, and post-upgrade launch. Redacted application logs, Windows event excerpts, and process and listener snapshots are attached on both success and failure; raw registry exports, full environment dumps, credentials, and unrestricted user data are forbidden.

A dedicated release-acceptance workflow downloads the Task 5 artifact by workflow identity, verifies its digest, and dispatches one serialized job per disposable image. Pull requests may run the unsigned Windows 11 lifecycle lane for fast feedback; master candidates run the full unsigned Windows 10/11 matrix, while a protected release-candidate dispatch runs the signed Windows 10/11 matrix and real-provider check. The release job depends on the exact signed acceptance reports and publishes no rebuilt substitute. Reports for a release candidate are retained with the release evidence, while routine unsigned diagnostics keep the existing short retention.

Task 6 implementation proceeds in four reviewable slices within its PR: define the report schema and pure result validator; implement the guest lifecycle runner with deterministic cleanup; connect the out-of-guest image controller and Windows 10/11 matrix; then add the protected signed/provider lane and bilingual release runbook. Completion requires two clean-image reports for the same candidate digest, a passing signed Windows 10/11 matrix, the protected real conversation, successful install-to-uninstall evidence, preserved user data, zero orphaned processes, and no skipped mandatory assertion. Only then does this proposal move to `implemented` with the actual image identities, workflow names, and retained evidence recorded.

#### Task 6 infrastructure implementation record

The repository contains a versioned acceptance-report parser and fail-closed set validator, a CDP-only installed-application probe that runs with the candidate's bundled Node, an interactive guest lifecycle runner, and a Hyper-V controller that restores the configured sealed snapshot before the session-exit and install-to-uninstall phases. The controller requires an exact VM and snapshot, a DPAPI-protected PowerShell Direct credential, and a preconfigured interactive scheduled task. The guest verifies artifact hashes, clean-account properties, Authenticode state, installation, shortcut, loopback and renderer isolation, Client inventory, restart persistence, upgrade, uninstall, reinstall, data preservation, secret absence, and process quiescence. A separate destructive phase kills the packaged backend, relaunches the application, signs the user out, and lets the controller verify process absence from outside the user session.

The release workflow can produce an all-or-nothing signed desktop artifact without exposing the PFX outside runner temporary storage. The dedicated acceptance workflow consumes exact candidate and predecessor run artifacts, dispatches Windows 10 and Windows 11 controller jobs, retains failure evidence, and validates the combined signed matrix plus an optional protected Windows 11 Provider report. The bilingual release runbook owns controller provisioning, environment protection, dispatch, and publication procedure.

The infrastructure does not itself constitute release evidence. This proposal remains `proposed` until configured Windows 10/11 controller images, a release certificate, an accepted predecessor artifact, and the protected real-UI Provider driver produce passing reports for one signed candidate digest. A hand-authored Provider JSON is not acceptable evidence.

### Completion criteria

- A normal user can install and start the signed release without administrator-only setup, Node, pnpm, a repository checkout, or a terminal.
- The packaged app completes a real model conversation through the existing Web UI and restores its session after restart.
- The runtime resolves every shipped profile row and Client plugin from packaged files without repository paths, workspace links, or network installation.
- Closing, restarting, crashing, or logging off leaves no managed Node, PowerShell, Worker, terminal, or sandbox process behind.
- Install, upgrade, and uninstall never write durable data into the install directory and do not delete `DSH_HOME` by default.
- The package contains no credentials, `.env`, source tree, test fixture, cache, or unmanifested executable.
- Browser code has no Node access, cannot navigate the application window away from its managed loopback origin, and cannot expose the server beyond loopback.
- Windows 10 and 11 x64 clean-machine acceptance passes for paths containing spaces and non-ASCII user names.
- Package READMEs, user documentation, maintenance instructions, licenses, the Agent Note, and relevant snapshots describe the shipped behavior in both languages where required.

## Alternatives considered

**Keep `dsh web` as a CLI-only installation.** This preserves the current architecture but still requires users to provision Node and npm packages and manage a terminal, so it does not meet the desktop distribution objective.

**Use Electron's embedded Node runtime for the Harness.** This reduces one runtime copy, but Electron changes `process.execPath` and follows Electron's Node/ABI lifecycle. The Harness and its child-process paths expect an ordinary Node executable. A pinned independent Node runtime preserves those assumptions and decouples Harness engine support from the desktop shell.

**Use Tauri with a Node sidecar.** Tauri reduces the browser-shell footprint, but this application still needs the complete Node Host and dynamic npm package graph. Managing a Node sidecar remains necessary and adds a Rust/WebView2 packaging surface without removing the dominant runtime work.

**Load static files directly in Electron.** The Vite shell requires `window.__DSH_BOOT__`, dynamically served Client plugin bundles, and the local API transport. A `file:` page bypasses the existing Web composition and would create a second boot and transport design.

**Bundle the entire monorepo.** This is simple to prototype but ships source, tests, development dependencies, caches, and workspace links, produces a large non-deterministic installer, and obscures missing production declarations. A manifest-checked production closure makes omissions and accidental additions explicit.

**Bundle Git, Python, compilers, and language servers.** These tools vary by user and workspace and would turn the desktop installer into a general development environment. The proposal guarantees the Harness runtime only and reports unavailable external tools through existing capability diagnostics.

**Use only `taskkill /T /F` for every desktop stop.** This can force a Windows process tree down, but it skips the CLI's Cordis disposal and can interrupt session persistence or other cleanup. Supervisor stdin provides an orderly request and retains taskkill as the bounded fallback.

**Add a loopback administration endpoint for shutdown and restart.** This would require authentication and a second externally reachable control protocol beside the product API. The inherited stdin pipe already proves parent ownership, closes automatically with the parent, and exposes no renderer or network surface.

**Implement another process-tree supervisor inside `apps/desktop`.** The repository already owns Windows taskkill, exit observation, output bounds, environment scrubbing, and quiescent waits in the local-subprocess implementation. Publishing its managed-process primitive prevents two subtly different cleanup algorithms.

**Build a recovery renderer with preload and IPC actions.** A local failure page could provide richer presentation, but it would add another renderer, navigation class, preload, IPC authorization policy, and snapshot surface for three fixed actions. Native dialog and menu actions keep restart, logs, and exit in the main process.

## Acceptance criteria

- Task 1 produces a repeatable out-of-workspace boot and a reviewed closure inventory before `apps/desktop` product code lands.
- Task 2 produces a staged runtime whose manifest and smoke fail when a required resource is removed or a forbidden sensitive/development file appears.
- Task 3 proves single-instance behavior, BrowserWindow isolation, exact-origin navigation policy, external-link delegation, and loading of the staged Web application.
- Task 4 proves bounded startup, useful failure diagnostics, restart, durable `DSH_HOME`, and complete teardown across every owned lifecycle exit.
- Task 5 produces an installable Windows x64 `Setup.exe` whose installed app runs as an ordinary user without global Node or pnpm and preserves user data across upgrade and uninstall.
- Task 6 records clean Windows 10/11 evidence for install-to-uninstall behavior, one real provider conversation, packaged tools and workers, data persistence, path variants, and absence of orphaned processes.
- Every non-trivial visible change has the keyless real-composition or browser snapshot required by [the testing policy](../../../../docs/testing.md), and every PR runs the focused checks selected by [dsh-pre-push-checks](../../../../.agents/skills/dsh-pre-push-checks/SKILL.md).

## Risks

- **Dynamic dependency omission.** Cordis resolves package names and client assets at runtime; a dependency can compile successfully yet be absent from the installer. The closure manifest and staged smoke must exercise the shipped profile rather than infer completeness from TypeScript imports.
- **Process-tree leakage.** PowerShell, workers, terminals, sandboxes, subagents, and user commands can outlive their immediate parent. Desktop shutdown must use the repository's process-tree ownership mechanisms and prove quiescence on Windows.
- **Node version drift.** The repository engine range and the pinned desktop runtime can diverge. Release checks must reject an unsupported Node version and verify its checksum and license.
- **ASAR and path behavior.** Executables and dynamically resolved packages cannot be assumed to run inside ASAR; spaces, non-ASCII characters, relocation, and read-only install directories can reveal hidden path assumptions.
- **Unsigned distribution warnings.** Internal builds may remain unsigned, but public Windows distribution can trigger SmartScreen until the installer is signed. Signing credentials must stay outside the repository and logs.
- **Credential exposure.** Environment construction, child output, crash diagnostics, manifests, and installer inputs can accidentally capture model credentials. Tests must prove secrets are absent from packaged files and sanitized from desktop logs.
- **Ambiguous self-contained claim.** Users may expect every developer tool to be bundled. Product documentation must distinguish the self-contained Harness runtime from optional external commands required by particular tasks.
- **Pre-release format changes.** Profile, storage, or session formats can change before the first tag. Desktop upgrade tests must follow the repository's current rejection and versioning stance instead of adding compatibility shims in the shell.
