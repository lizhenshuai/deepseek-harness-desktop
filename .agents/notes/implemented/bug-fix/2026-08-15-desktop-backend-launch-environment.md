# Agent Note: Desktop backend inherits the scrubbed launch environment

Status: implemented

English | [中文](2026-08-15-desktop-backend-launch-environment.zh.md)

## Problem

The desktop backend controller spawned bundled Node with only `DSH_HOME` and `DSH_TELEMETRY_DISABLED`. Windows system variables, locale, proxy settings, and ordinary user configuration were absent. The staged CLI could pass its direct smoke test yet fail to reach readiness under Electron because its supervised process ran in an environment unlike a normal product launch.

## Decision

The controller starts from `@deepseek-ai/dsh-subprocess`'s canonical `scrubbedParentEnv()`, then applies an optional trusted test/host overlay and finally its desktop-owned `DSH_HOME` and telemetry values. Credential-shaped names and inherited `DSH_*` names are therefore absent by default, while ordinary platform variables remain available.

The controller test proves that an ordinary inherited marker survives, a token-shaped marker and inherited DSH marker do not, and the desktop-owned home replaces every ambient value.

## Alternatives considered

**Maintain a Windows environment allowlist in the desktop package.** Rejected because system and locale requirements vary across Windows versions and dependencies. The subprocess seam already owns the repository-wide credential scrub.

**Forward `process.env` unchanged.** Rejected because the Electron host may carry provider credentials and Harness identity that the supervised backend must not inherit implicitly.

**Keep an empty base and add variables when failures appear.** Rejected because it creates an incomplete second definition of a viable child environment and makes ordinary user settings disappear silently.

## Consequences

- The bundled backend receives a normal Windows execution environment without ambient credential-shaped or Harness-owned variables.
- Explicit desktop-owned values remain authoritative after the scrub.
- Desktop process launch shares the same security heuristic as every other in-repository subprocess owner.
