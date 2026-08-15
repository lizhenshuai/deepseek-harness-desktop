# Agent Note: Windows runtime publication retries transient directory locks

Status: implemented

English | [中文](2026-08-15-windows-staged-runtime-publish-retry.zh.md)

## Problem

Desktop staging builds and verifies the complete runtime in a random sibling directory, then atomically renames that directory to its final path. On a hosted Windows runner, the fixed-Node Web verification completed successfully, but the final rename received `EPERM` while Windows was still releasing a process or scanner handle. The validated runtime was discarded even though neither its content nor its destination was invalid.

## Decision

The sibling-directory publication retries only Windows-style transient rename failures: `EBUSY`, `ENOTEMPTY`, and `EPERM`. Delays are bounded exponential steps totaling less than 32 seconds. Every retry confirms that the destination remains absent; a competing destination fails immediately instead of being replaced.

The operation remains one directory rename. It does not copy files, publish a partial tree, delete a destination, or weaken any manifest, policy, or runtime proof.

## Alternatives considered

**Copy the validated directory to the destination.** Rejected because readers could observe a partial runtime and the destination would no longer represent one atomic publication.

**Retry every rename error indefinitely.** Rejected because invalid paths, permissions, and persistent locks require diagnosis. A closed error set and finite delay preserve actionable failure.

**Sleep unconditionally after Web verification.** Rejected because hosts that have already released their handles should publish immediately, while one fixed delay cannot distinguish a transient lock from another failure.

## Consequences

- Hosted Windows runners tolerate short-lived handle retention after the real Web smoke exits.
- Persistent locks still fail after a bounded interval with the original filesystem error.
- Successful publication retains the absent-destination and atomic-sibling-rename guarantees.
