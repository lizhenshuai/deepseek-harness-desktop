[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Setup,
  [Parameter(Mandatory)][string]$EvidencePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Find-InstalledExecutable {
  $root = Join-Path $env:LOCALAPPDATA 'DeepSeekHarness'
  $matches = @(Get-ChildItem -LiteralPath $root -Directory -Filter 'app-*' | Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName 'DeepSeek Harness.exe' } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
  if ($matches.Count -ne 1) { throw "expected one installed executable, found $($matches.Count)" }
  return $matches[0]
}

function Wait-ForBackend([string]$InstallRoot) {
  $deadline = [DateTime]::UtcNow.AddSeconds(120)
  do {
    $process = @(Get-CimInstance Win32_Process | Where-Object {
      $_.Name -eq 'node.exe' -and $_.ExecutablePath -and
      $_.ExecutablePath.StartsWith($InstallRoot, [StringComparison]::OrdinalIgnoreCase)
    }) | Select-Object -First 1
    if ($null -ne $process) { return $process }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'desktop backend did not start'
}

$install = Start-Process -FilePath $Setup -ArgumentList '--silent' -PassThru -Wait
if ($install.ExitCode -ne 0) { throw "Setup.exe exited $($install.ExitCode)" }
$exe = Find-InstalledExecutable
$installRoot = Join-Path $env:LOCALAPPDATA 'DeepSeekHarness'
$first = Start-Process -FilePath $exe -PassThru
$backend = Wait-ForBackend $installRoot
Stop-Process -Id $backend.ProcessId -Force
Start-Sleep -Seconds 2
Stop-Process -Id $first.Id -Force -ErrorAction SilentlyContinue
$second = Start-Process -FilePath $exe -PassThru
$replacement = Wait-ForBackend $installRoot
$crashRecovered = $replacement.ProcessId -ne $backend.ProcessId -and -not $second.HasExited
@{
  assertions = @(@{
    id = 'lifecycle.crash-recovery'
    status = $(if ($crashRecovered) { 'passed' } else { 'failed' })
    observed = "backend $($backend.ProcessId) replaced by $($replacement.ProcessId) after application relaunch"
  })
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $EvidencePath
shutdown.exe /l
