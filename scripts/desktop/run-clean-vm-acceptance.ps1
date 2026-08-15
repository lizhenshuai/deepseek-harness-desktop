[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('windows-10', 'windows-11')][string]$OsFamily,
  [Parameter(Mandatory)][string]$ImageId,
  [Parameter(Mandatory)][ValidateSet('unsigned', 'signed', 'provider')][string]$Lane,
  [Parameter(Mandatory)][string]$ArtifactDirectory,
  [Parameter(Mandatory)][string]$ExpectedSetupSha256,
  [Parameter(Mandatory)][string]$OutputDirectory,
  [string]$ExpectedPublisher = '',
  [string]$PredecessorArtifactDirectory = '',
  [string]$ProviderEvidence = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

foreach ($name in @('DSH_ACCEPTANCE_VM_NAME', 'DSH_ACCEPTANCE_VM_SNAPSHOT', 'DSH_ACCEPTANCE_CREDENTIAL_FILE')) {
  if (-not [Environment]::GetEnvironmentVariable($name)) { throw "$name must be configured on the acceptance controller" }
}
$vmName = $env:DSH_ACCEPTANCE_VM_NAME
$snapshotName = $env:DSH_ACCEPTANCE_VM_SNAPSHOT
$credentialPath = [IO.Path]::GetFullPath($env:DSH_ACCEPTANCE_CREDENTIAL_FILE)
if (-not (Test-Path -LiteralPath $credentialPath -PathType Leaf)) { throw "acceptance credential file is missing: $credentialPath" }
$credential = Import-Clixml -LiteralPath $credentialPath
$vm = Get-VM -Name $vmName -ErrorAction Stop
$snapshot = @(Get-VMSnapshot -VM $vm | Where-Object Name -EQ $snapshotName)
if ($snapshot.Count -ne 1) { throw "expected one sealed snapshot named $snapshotName for $vmName" }
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

function Restore-SealedGuest {
  Stop-VM -VM $vm -TurnOff -Force -ErrorAction SilentlyContinue
  Restore-VMSnapshot -VMSnapshot $snapshot[0] -Confirm:$false
  Start-VM -VM $vm | Out-Null
  $deadline = [DateTime]::UtcNow.AddMinutes(5)
  do {
    try { return New-PSSession -VMName $vmName -Credential $credential -ErrorAction Stop } catch { Start-Sleep -Seconds 2 }
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "PowerShell Direct did not become available for $vmName"
}

function Initialize-RunRoot([System.Management.Automation.Runspaces.PSSession]$Session) {
  Invoke-Command -Session $Session -ScriptBlock {
    $root = 'C:\dsh-acceptance'
    if ([IO.Path]::GetFullPath($root) -ne 'C:\dsh-acceptance') { throw 'unexpected guest acceptance root' }
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    Get-ChildItem -LiteralPath $root -Force | Remove-Item -Recurse -Force
    New-Item -ItemType Directory -Force -Path "$root\artifacts", "$root\output" | Out-Null
  }
}

function Copy-GuestInputs([System.Management.Automation.Runspaces.PSSession]$Session) {
  Copy-Item -ToSession $Session -Recurse -LiteralPath $ArtifactDirectory -Destination 'C:\dsh-acceptance\artifacts\candidate'
  if ($PredecessorArtifactDirectory) {
    Copy-Item -ToSession $Session -Recurse -LiteralPath $PredecessorArtifactDirectory -Destination 'C:\dsh-acceptance\artifacts\predecessor'
  }
  Copy-Item -ToSession $Session -LiteralPath 'apps\desktop\acceptance\probe-installed-app.mjs' -Destination 'C:\dsh-acceptance\probe-installed-app.mjs'
  Copy-Item -ToSession $Session -LiteralPath 'apps\desktop\acceptance\run-clean-machine.ps1' -Destination 'C:\dsh-acceptance\run-clean-machine.ps1'
  Copy-Item -ToSession $Session -LiteralPath 'apps\desktop\acceptance\run-session-exit.ps1' -Destination 'C:\dsh-acceptance\run-session-exit.ps1'
  if ($ProviderEvidence) {
    Copy-Item -ToSession $Session -LiteralPath $ProviderEvidence -Destination 'C:\dsh-acceptance\provider-evidence.json'
  }
}

function Start-InteractiveRequest([System.Management.Automation.Runspaces.PSSession]$Session, [string]$Request) {
  Invoke-Command -Session $Session -ScriptBlock {
    param($Content)
    Set-Content -LiteralPath 'C:\dsh-acceptance\request.ps1' -Value $Content
    $task = Get-ScheduledTask -TaskName 'DeepSeekHarnessAcceptance' -ErrorAction Stop
    if ($task.Principal.LogonType -ne 'Interactive') { throw 'DeepSeekHarnessAcceptance must use an interactive logon token' }
    $action = @($task.Actions)
    if ($action.Count -ne 1 -or $action[0].Arguments -notlike '*C:\dsh-acceptance\request.ps1*') {
      throw 'DeepSeekHarnessAcceptance must execute C:\dsh-acceptance\request.ps1'
    }
    Start-ScheduledTask -InputObject $task
  } -ArgumentList $Request
}

function Wait-GuestFile([System.Management.Automation.Runspaces.PSSession]$Session, [string]$Path, [TimeSpan]$Timeout) {
  $deadline = [DateTime]::UtcNow.Add($Timeout)
  do {
    if (Invoke-Command -Session $Session -ScriptBlock { param($Value) Test-Path -LiteralPath $Value -PathType Leaf } -ArgumentList $Path) { return }
    Start-Sleep -Seconds 2
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "guest did not produce $Path"
}

$session = Restore-SealedGuest
try {
  Initialize-RunRoot $session
  Copy-GuestInputs $session
  $setup = Invoke-Command -Session $session -ScriptBlock {
    $matches = @(Get-ChildItem -LiteralPath 'C:\dsh-acceptance\artifacts\candidate' -Recurse -File -Filter 'DeepSeek-Harness-Setup-x64.exe')
    if ($matches.Count -ne 1) { throw "expected one candidate Setup.exe, found $($matches.Count)" }
    $matches[0].FullName
  }
  $sessionRequest = "& 'C:\dsh-acceptance\run-session-exit.ps1' -Setup '$setup' -EvidencePath 'C:\dsh-acceptance\session-evidence.json'"
  Start-InteractiveRequest $session $sessionRequest
  Wait-GuestFile $session 'C:\dsh-acceptance\session-evidence.json' ([TimeSpan]::FromMinutes(10))
  Remove-PSSession $session
  Start-Sleep -Seconds 5
  $session = New-PSSession -VMName $vmName -Credential $credential
  $sessionEvidence = Invoke-Command -Session $session -ScriptBlock {
    $value = Get-Content -Raw -LiteralPath 'C:\dsh-acceptance\session-evidence.json' | ConvertFrom-Json
    $owned = @(Get-CimInstance Win32_Process | Where-Object {
      $_.ExecutablePath -and $_.ExecutablePath -like '*\AppData\Local\Programs\DeepSeek Harness Acceptance\*'
    })
    $assertions = @($value.assertions) + @(@{
      id = 'lifecycle.sign-out'
      status = $(if ($owned.Count -eq 0) { 'passed' } else { 'failed' })
      observed = "installed process count after sign-out: $($owned.Count)"
    })
    @{ assertions = $assertions } | ConvertTo-Json -Depth 5
  }
  Set-Content -LiteralPath (Join-Path $outputRoot 'session-evidence.json') -Value $sessionEvidence
} finally {
  if ($null -ne $session) { Remove-PSSession $session -ErrorAction SilentlyContinue }
}

$session = Restore-SealedGuest
try {
  Initialize-RunRoot $session
  Copy-GuestInputs $session
  Copy-Item -ToSession $session -LiteralPath (Join-Path $outputRoot 'session-evidence.json') -Destination 'C:\dsh-acceptance\session-evidence.json'
  $predecessor = if ($PredecessorArtifactDirectory) { "-PredecessorArtifactDirectory 'C:\dsh-acceptance\artifacts\predecessor'" } else { '' }
  $provider = if ($ProviderEvidence) { "-ProviderEvidence 'C:\dsh-acceptance\provider-evidence.json'" } else { '' }
  $request = "& 'C:\dsh-acceptance\run-clean-machine.ps1' -OsFamily '$OsFamily' -ImageId '$ImageId' -Lane '$Lane' " +
    "-ArtifactDirectory 'C:\dsh-acceptance\artifacts\candidate' -ExpectedSetupSha256 '$ExpectedSetupSha256' " +
    "-ProbeScript 'C:\dsh-acceptance\probe-installed-app.mjs' -OutputDirectory 'C:\dsh-acceptance\output' " +
    "-ExpectedPublisher '$ExpectedPublisher' -SignOutEvidence 'C:\dsh-acceptance\session-evidence.json' $predecessor $provider"
  Start-InteractiveRequest $session $request
  Wait-GuestFile $session 'C:\dsh-acceptance\output\desktop-acceptance-report.json' ([TimeSpan]::FromMinutes(30))
  Copy-Item -FromSession $session -Recurse -Path 'C:\dsh-acceptance\output\*' -Destination $outputRoot
} finally {
  if ($null -ne $session) { Remove-PSSession $session -ErrorAction SilentlyContinue }
  Stop-VM -VM $vm -TurnOff -Force -ErrorAction SilentlyContinue
}
