# Agent Note: Client bundle region comments hide pnpm store identities

Status: implemented

English | [中文](2026-08-15-pnpm-region-comment-paths.zh.md)

## Problem

Rolldown emits `//#region` comments containing source module paths. Inlined dependencies include pnpm's virtual-store directory name, whose peer suffix can be shortened on Windows according to the physical store path. Equal dependency code therefore produced different client bundle bytes across checkouts even though the comment has no runtime meaning. The desktop runtime lock detected the byte difference and rejected the CI-built packages.

## Decision

The shared client bundle preset rewrites only generated `//#region` lines that cross a pnpm virtual-store segment. The environment-specific directory component becomes the fixed `<virtual-store>` marker; the dependency's path below its package directory remains visible. Runtime code, first-party region labels, and source-map sources are unchanged.

A build test supplies both expanded and shortened pnpm store identities and requires identical normalized comments.

## Alternatives considered

**Ignore client bundle checksums.** Rejected because the bundles are executable installer inputs and remain part of the runtime integrity boundary.

**Require a fixed pnpm virtual-store path length.** Rejected because pnpm intentionally adapts store directory names to platform path limits, and repository builds should not depend on the install location.

**Remove every region comment.** Rejected because stable first-party and dependency paths remain useful when inspecting an unminified bundle. Only the environment-specific store identity needs normalization.

## Consequences

- Client bundle bytes do not depend on pnpm's virtual-store directory shortening.
- Dependency region labels retain the package-relative source path but omit peer-resolution details.
- The rewrite is confined to line comments and does not alter executable JavaScript or source maps.
