# Agent Note: CSS Module hashes use repository-relative identities

Status: implemented

English | [中文](2026-08-15-repository-relative-css-module-hashes.zh.md)

## Problem

The client bundle plugin passed each stylesheet's absolute filesystem path to Lightning CSS. Lightning CSS includes that filename when deriving CSS Module class hashes, so the same source produced different bundle bytes under a developer checkout and a GitHub runner. The Windows desktop runtime lock seals the packed client bundles and therefore could not be generated locally and verified in CI.

## Decision

`dsh-css-modules-inline` keeps two stylesheet identities. The absolute path remains the read target and watch dependency. Lightning CSS receives the repository-relative identity already encoded in the virtual module id; sources outside the repository use their basename. The plugin sorts Lightning CSS's unordered export map before serialization. Equal source and stable identity therefore produce equal class maps regardless of checkout root, path separator, or transform map iteration order.

The CSS text, exported class map, and style ownership tag retain their existing runtime behavior. Build tests load the same module name and contents from two physical roots, require byte-identical virtual module output, and verify lexical export ordering.

## Alternatives considered

**Exclude client bundle checksums from the desktop lock.** Rejected because client JavaScript and injected CSS are executable product inputs. Omitting them would weaken the installer's integrity boundary to accommodate a build defect.

**Normalize generated class names after Lightning CSS.** Rejected because rewriting selectors and export maps after compilation duplicates CSS Module semantics and can miss references introduced by future Lightning CSS output changes.

**Require every build to use the same absolute checkout root.** Rejected because developer machines, GitHub runners, and downstream release infrastructure necessarily use different roots. Filesystem placement is not part of a package's identity.

## Consequences

- Client bundle bytes no longer depend on the checkout's absolute path or the transform's export iteration order.
- Renaming or moving a stylesheet inside the repository intentionally changes its CSS Module hash.
- External test fixtures with the same basename share a stable identity; production stylesheets are repository-contained and use their full repository-relative path.
