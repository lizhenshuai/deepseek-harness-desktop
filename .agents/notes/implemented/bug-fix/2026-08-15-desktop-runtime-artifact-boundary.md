# Agent Note: Desktop runtime artifacts preserve the staged tree

Status: implemented

English | [中文](2026-08-15-desktop-runtime-artifact-boundary.zh.md)

## Problem

The staged Windows runtime passed its manifest check before upload, but `actions/upload-artifact` omitted hidden files by default. Dependency packages contain legitimate dotfiles sealed by `runtime-manifest.json`, so the separately downloaded artifact failed the checkout-free manifest check. The Electron smoke command also placed `--` before its path while forwarding through a nested `pnpm run`; pnpm preserved that separator as a positional argument and the test rejected the resulting two-argument invocation.

## Decision

The desktop runtime artifact explicitly enables `include-hidden-files`. Staging already rejects credential-bearing names and secret material before the directory reaches the artifact boundary, so the uploaded tree can remain byte-for-byte consistent with the manifest without broadening credential exposure.

Desktop Electron and packaged smoke commands pass their target paths directly to the root scripts. The root scripts already delegate to the desktop workspace, and pnpm forwards the path without requiring an additional separator.

The workflow test pins both requirements: the runtime upload includes hidden files, and nested desktop smoke commands contain no literal separator argument.

## Alternatives considered

**Exclude dotfiles from the runtime manifest.** Rejected because dependency dotfiles are part of the installed package payload. Ignoring them would make post-upload verification weaker than staging verification.

**Delete dependency dotfiles before inventory.** Rejected because package payload pruning needs an explicit product policy and compatibility proof; transport must not silently mutate a verified runtime.

**Teach the Electron test to ignore a leading `--`.** Rejected because the extra value is a workflow forwarding defect. Accepting it would hide malformed invocations and complicate the test contract.

## Consequences

- The downloaded runtime artifact contains every file recorded by its manifest.
- Credential scanning remains the gate before hidden files are uploaded.
- Desktop smoke tests receive exactly one target path in staged and packaged modes.
