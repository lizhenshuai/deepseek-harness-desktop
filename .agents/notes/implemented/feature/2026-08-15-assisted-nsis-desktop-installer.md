# Agent Note: Assisted NSIS desktop installer

Status: implemented

English | [中文](2026-08-15-assisted-nsis-desktop-installer.zh.md)

## Problem

The Windows desktop installer used Squirrel's immediate per-user installation. It did not present the familiar directory and confirmation steps expected from a Windows setup wizard, and its NuGet and `RELEASES` artifacts were unnecessary because this desktop client does not provide automatic updates.

## Decision

Build one assisted NSIS installer from the existing hardened Electron package. The wizard permits an installation-directory choice, defaults to a per-user installation, and creates desktop and Start Menu shortcuts. The runtime remains outside ASAR, application data remains under Electron `userData`, and uninstall preserves that data. CI and release uploads carry the setup executable, block map, and checksum inventory.

The package, runtime composition, desktop lifecycle, and Web application are unchanged. Windows signing continues to use the existing all-or-nothing PFX configuration. This decision supersedes the Squirrel installer portions of the [Windows desktop distribution proposal](../../proposed/architecture/2026-08-14-windows-desktop-distribution.md).

## Alternatives considered

**Keep Squirrel.** Rejected because its immediate installation cannot provide the requested directory-selection wizard.

**Add a second installer format.** Rejected because maintaining and publishing both Squirrel and NSIS would add release paths without adding a required capability.

## Consequences

Interactive installation now follows a conventional wizard and accepts a custom directory. Silent acceptance uses the same installer with `/S` and an explicit `/D` directory, then launches the installed executable and runs the existing Web UI probe. Squirrel maintenance handling and Squirrel-only artifacts are removed; automatic updates remain out of scope.
