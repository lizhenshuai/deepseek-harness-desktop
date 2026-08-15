[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Setup,
  [Parameter(Mandatory)][string]$EvidencePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Find-InstalledExecutable([string]$InstallRoot) {
  $executable = Join-Path $InstallRoot 'DeepSeek Harness.exe'
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "installed executable is absent: $executable" }
  return $executable
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

$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness Acceptance'
$install = Start-Process -FilePath $Setup -ArgumentList '/S', "/D=$installRoot" -PassThru -Wait
if ($install.ExitCode -ne 0) { throw "Setup.exe exited $($install.ExitCode)" }
$exe = Find-InstalledExecutable $installRoot
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
