# Windows desktop release acceptance

English | [中文](desktop-release-acceptance.zh.md)

This runbook prepares the dedicated controllers and dispatches the Windows 10/11 acceptance workflow for a signed DeepSeek Harness desktop candidate. The workflow consumes existing installer artifacts; it never builds or signs inside an acceptance guest.

## Prepare each controller and guest

Provide two dedicated x64 Hyper-V controllers with the labels `dsh-desktop-acceptance` plus `dsh-desktop-windows-10` or `dsh-desktop-windows-11`. Each controller owns one guest and one sealed snapshot. Do not share these guests with development or ordinary CI.

The sealed guest has an interactive, non-administrator acceptance account whose profile path contains a space and non-ASCII characters. Keep that account logged in when sealing the snapshot. Node, pnpm, Git, DeepSeek Harness, `DSH_*` variables, model credentials, and Harness data must be absent. Windows and the guest integration services remain current for the image build recorded by the acceptance report.

Create a scheduled task named `DeepSeekHarnessAcceptance` under the acceptance account. It uses `Interactive` logon and executes this fixed action:

```powershell
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File C:\dsh-acceptance\request.ps1
```

The controller restores the sealed snapshot before the destructive session-exit phase and again before the install-to-uninstall phase. It writes only beneath `C:\dsh-acceptance` in the guest. The snapshot is the cleanup mechanism; the product uninstaller intentionally preserves user data.

Configure these environment variables for the self-hosted runner service on each controller:

| Variable | Value |
|---|---|
| `DSH_ACCEPTANCE_VM_NAME` | Exact Hyper-V guest name |
| `DSH_ACCEPTANCE_VM_SNAPSHOT` | Exact sealed snapshot name |
| `DSH_ACCEPTANCE_CREDENTIAL_FILE` | Absolute controller path to a DPAPI-protected PowerShell credential |

Create the credential file while running as the same Windows identity that owns the GitHub runner service:

```powershell
Get-Credential | Export-Clixml D:\dsh-secrets\desktop-acceptance-vm.xml
```

The credential opens PowerShell Direct and is never copied into the guest or uploaded. Restrict the file ACL to the runner-service identity. A missing VM, ambiguous snapshot, incompatible scheduled task, unavailable credential, or guest that stops reporting fails the workflow.

## Configure signing and provider protection

The `desktop-release-acceptance` GitHub environment protects the two operating-system jobs. The `desktop-release-provider` environment adds required reviewers and the short-lived DeepSeek credential used by the organization-owned real-UI provider driver. That driver writes the file named by `DSH_ACCEPTANCE_PROVIDER_EVIDENCE` on the Windows 11 controller. Its JSON contains exactly one passing observation for each of these ids and contains no credential value:

```text
provider.conversation
provider.session-restored
tools.filesystem
tools.powershell
tools.worker-thread
```

The provider driver must configure the credential through the installed Web UI, run one conversation with unique transcript and tool-result canaries, restart the application, re-open the session, scan every retained evidence file for the credential canary, and remove its local credential file. Do not author this JSON manually: it is evidence from the protected installed-product run.

The release workflow reads `DSH_WINDOWS_CERTIFICATE_PFX_BASE64` and `DSH_WINDOWS_CERTIFICATE_PASSWORD` only when `desktop_sign` is selected. Store both as repository or environment secrets. The workflow writes the PFX under the hosted runner's temporary directory, requires signing, verifies the application and installer, uploads the signed artifact, and removes the temporary PFX.

## Run a release candidate

1. Dispatch `Release (dsh)` from the intended release ref with `desktop_sign` enabled. Record the run id, the `dsh-desktop-installer-windows-x64-signed` artifact name, and the lowercase Setup digest from its `SHA256SUMS.txt`.
2. Select an accepted lower-version signed artifact as the predecessor. Before the first tagged release, use a deliberately lower package version of the same runtime only to prove NSIS in-place replacement and opaque data preservation; it does not establish pre-release data-format compatibility.
3. Dispatch `Desktop release acceptance` with both run ids and artifact names, the candidate Setup digest, and the expected publisher-subject substring. Leave `provider` enabled for a release verdict.
4. Require both operating-system jobs, the Windows 11 protected provider job, and `Verify release acceptance evidence` to pass. The verifier rejects missing assertions, failed observations, a different candidate digest, unsigned release evidence, credential matches, an absent operating system, or an absent provider result.
5. Publish only the signed artifact from the recorded candidate run. Never rebuild after acceptance.

Every job uploads its bounded JSON, JUnit-compatible result inputs, screenshot, and redacted diagnostics even when the guest reports failure. Treat runner or provider unavailability as a blocked release, not as a skipped success.
