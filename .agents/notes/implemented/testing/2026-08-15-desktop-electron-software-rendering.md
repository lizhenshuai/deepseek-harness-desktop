# Agent Note: Desktop Electron smoke uses software rendering

Status: implemented

English | [中文](2026-08-15-desktop-electron-software-rendering.zh.md)

## Problem

The real desktop smoke launches a headed Electron application and compares a committed screenshot. GitHub's hosted Windows runner exposed the Electron main-process inspector but did not provide a stable GPU-backed desktop composition; Playwright remained in `electron.launch()` until its three-minute timeout. Interactive developer machines reached the window but produced machine-dependent pixel output.

## Decision

The staged and packaged Electron smoke processes receive Chromium's `--disable-gpu` switch. This is a test-process launch argument, not an application default. The product still enables its renderer sandbox and exercises the real bundled backend, navigation policy, single-instance behavior, restart path, and packaging composition.

Both launch modes share the same argument list so their rendering substrate does not diverge before their behavior snapshots are compared.

The GitHub-hosted Release workflow treats both headed Electron smokes as advisory. Installer creation, package and installer inspection, and artifact upload remain blocking; a hosted graphics or pixel-comparison failure cannot suppress an otherwise installable artifact. Real installed-application acceptance remains the release criterion for launch and core desktop behavior.

## Alternatives considered

**Disable the Electron smoke on hosted Windows.** Rejected because unit tests and the checkout-free backend smoke do not exercise the native window, single-instance lock, menu restart, or packaged Electron composition.

**Disable Chromium's sandbox.** Rejected because sandboxing is a product security requirement and unrelated to GPU availability.

**Accept environment-specific screenshots.** Rejected because multiple golden images would turn renderer selection into an unreviewed platform branch and would not address launch hangs.

**Make hosted Electron rendering a prerequisite for installer creation.** Rejected because hosted graphics availability is not an installer property. The workflow retains the diagnostic result without making it the authority for installed-application behavior.

## Consequences

- Hosted and local desktop smokes use Chromium's software rendering path.
- Production launches retain normal GPU selection.
- Screenshot comparisons have one deliberate rendering substrate while native window and backend lifecycle behavior remain real.
- Hosted rendering failures remain visible but do not block installer creation or upload.
