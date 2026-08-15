[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('windows-10', 'windows-11')][string]$OsFamily,
  [Parameter(Mandatory)][string]$ImageId,
  [Parameter(Mandatory)][ValidateSet('unsigned', 'signed', 'provider')][string]$Lane,
  [Parameter(Mandatory)][string]$ArtifactDirectory,
  [Parameter(Mandatory)][string]$ExpectedSetupSha256,
  [Parameter(Mandatory)][string]$ProbeScript,
  [Parameter(Mandatory)][string]$OutputDirectory,
  [string]$ExpectedPublisher = '',
  [string]$PredecessorArtifactDirectory = '',
  [string]$SignOutEvidence = '',
  [string]$ProviderEvidence = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$startedAt = [DateTime]::UtcNow.ToString('o')
$assertions = [System.Collections.Generic.List[object]]::new()
$installedByRun = $false

function Add-Result([string]$Id, [bool]$Passed, [string]$Observed) {
  $assertions.Add([ordered]@{ id = $Id; status = $(if ($Passed) { 'passed' } else { 'failed' }); observed = $Observed })
}

function Invoke-Observed([string]$Id, [scriptblock]$Operation) {
  try {
    $observed = & $Operation
    Add-Result $Id $true ([string]$observed)
  } catch {
    Add-Result $Id $false $_.Exception.Message
  }
}

function Find-One([string]$Root, [string]$Filter) {
  $matches = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Filter $Filter)
  if ($matches.Count -ne 1) { throw "expected one $Filter beneath $Root, found $($matches.Count)" }
  return $matches[0].FullName
}

function Install-Setup([string]$Setup, [string]$InstallRoot) {
  $process = Start-Process -FilePath $Setup -ArgumentList '/S', "/D=$InstallRoot" -PassThru -Wait
  if ($process.ExitCode -ne 0) { throw "Setup.exe exited $($process.ExitCode)" }
  $script:installedByRun = $true
}

function Find-InstalledExecutable([string]$InstallRoot) {
  $executable = Join-Path $InstallRoot 'DeepSeek Harness.exe'
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "installed executable is absent: $executable" }
  return $executable
}

function Uninstall-Application([string]$InstallRoot) {
  $uninstaller = Join-Path $InstallRoot 'Uninstall DeepSeek Harness.exe'
  $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -PassThru -Wait
  if ($process.ExitCode -ne 0) { throw "NSIS uninstaller exited $($process.ExitCode)" }
}

function Wait-ForNoInstalledProcesses([string]$InstallRoot) {
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    $owned = @(Get-CimInstance Win32_Process | Where-Object {
      $_.ExecutablePath -and $_.ExecutablePath.StartsWith($InstallRoot, [StringComparison]::OrdinalIgnoreCase)
    })
    if ($owned.Count -eq 0) { return 'no executable remains under the install root' }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "owned processes remain: $($owned.ProcessId -join ', ')"
}

function Read-Evidence([string]$Path, [string[]]$Ids) {
  if (-not $Path) {
    foreach ($id in $Ids) { Add-Result $id $false 'required external evidence was not supplied' }
    return
  }
  $value = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
  foreach ($id in $Ids) {
    $entry = @($value.assertions | Where-Object { $_.id -eq $id })
    if ($entry.Count -ne 1) { Add-Result $id $false 'external evidence omitted the assertion'; continue }
    Add-Result $id ($entry[0].status -eq 'passed') ([string]$entry[0].observed)
  }
}

$artifactRoot = [IO.Path]::GetFullPath($ArtifactDirectory)
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness Acceptance'
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$setup = Find-One $artifactRoot 'DeepSeek-Harness-Setup-x64.exe'
$actualSetupSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $setup).Hash.ToLowerInvariant()
Add-Result 'artifact.sha256' ($actualSetupSha -eq $ExpectedSetupSha256.ToLowerInvariant()) "Setup.exe $actualSetupSha"

$os = Get-CimInstance Win32_OperatingSystem
$architecturePassed = $env:PROCESSOR_ARCHITECTURE -eq 'AMD64' -and [Environment]::Is64BitOperatingSystem
Add-Result 'environment.windows-x64' $architecturePassed "$($os.Caption) build $($os.BuildNumber), $env:PROCESSOR_ARCHITECTURE"
$toolHits = @('node', 'pnpm', 'git') | Where-Object { Get-Command $_ -ErrorAction SilentlyContinue }
$cleanRoots = -not (Test-Path -LiteralPath $installRoot) -and
  -not (Test-Path -LiteralPath (Join-Path $env:APPDATA 'DeepSeek Harness'))
Add-Result 'environment.clean' ($toolHits.Count -eq 0 -and $cleanRoots) "developer tools: $($toolHits -join ', '); prior roots absent: $cleanRoots"
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
$administrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$profileClassValid = $env:USERPROFILE.Contains(' ') -and $env:USERPROFILE -match '[^\u0000-\u007f]'
Add-Result 'install.ordinary-user' (-not $administrator -and $profileClassValid) "administrator=$administrator; profile=$env:USERPROFILE"

$signature = Get-AuthenticodeSignature -LiteralPath $setup
$signedLane = $Lane -ne 'unsigned'
$signatureValid = $signature.Status -eq 'Valid'
$signerSubject = if ($null -eq $signature.SignerCertificate) { '<none>' } else { $signature.SignerCertificate.Subject }
if ($signedLane) {
  Add-Result 'signature.setup-valid' $signatureValid "Setup.exe Authenticode $($signature.Status)"
  Add-Result 'signature.publisher' ($signatureValid -and $ExpectedPublisher -and $signerSubject.Contains($ExpectedPublisher)) "publisher $signerSubject"
  Add-Result 'signature.timestamp' ($signatureValid -and $null -ne $signature.TimeStamperCertificate) 'Setup.exe has a trusted timestamp'
}

$userData = Join-Path $env:APPDATA 'DeepSeek Harness'
$dshHome = Join-Path $userData 'harness'
$canaryPath = Join-Path $dshHome 'acceptance-data-canary.txt'
$canary = "dsh-acceptance-$([Guid]::NewGuid().ToString('N'))"
$candidateExe = $null

try {
  if ($PredecessorArtifactDirectory) {
    $predecessor = Find-One ([IO.Path]::GetFullPath($PredecessorArtifactDirectory)) 'DeepSeek-Harness-Setup-x64.exe'
    Invoke-Observed 'upgrade.predecessor-installed' { Install-Setup $predecessor $installRoot; Find-InstalledExecutable $installRoot }
    New-Item -ItemType Directory -Force -Path $dshHome | Out-Null
    Set-Content -LiteralPath $canaryPath -Value $canary -NoNewline
  }

  Invoke-Observed 'install.setup' { Install-Setup $setup $installRoot; 'candidate installer exited successfully' }
  $candidateExe = Find-InstalledExecutable $installRoot
  $candidateDirectory = Split-Path -Parent $candidateExe
  $shortcut = @(Get-ChildItem -LiteralPath (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs') -Recurse -File -Filter 'DeepSeek Harness.lnk')
  Add-Result 'install.shortcut' ($shortcut.Count -eq 1) "shortcut count $($shortcut.Count)"
  if (-not $PredecessorArtifactDirectory) {
    New-Item -ItemType Directory -Force -Path $dshHome | Out-Null
    Set-Content -LiteralPath $canaryPath -Value $canary -NoNewline
    Add-Result 'upgrade.application-replaced' $false 'no predecessor artifact was supplied'
  } else {
    Add-Result 'upgrade.application-replaced' $true "active executable $candidateExe"
  }
  Add-Result 'upgrade.data-preserved' ((Get-Content -Raw -LiteralPath $canaryPath) -eq $canary) 'DSH_HOME canary survived candidate install'

  if ($signedLane) {
    $applicationSignature = Get-AuthenticodeSignature -LiteralPath $candidateExe
    Add-Result 'signature.application-valid' ($applicationSignature.Status -eq 'Valid') "application Authenticode $($applicationSignature.Status)"
  }

  $runtimeNode = Join-Path $candidateDirectory 'resources\runtime\node\node.exe'
  $probeOutput = Join-Path $outputRoot 'installed-app-probe.json'
  $screenshot = Join-Path $outputRoot 'installed-first-launch.png'
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 3080)
  $listener.Start()
  try {
    & $runtimeNode $ProbeScript --exe $candidateExe --out $probeOutput --screenshot $screenshot
    if ($LASTEXITCODE -ne 0) { throw "installed application probe exited $LASTEXITCODE" }
  } finally {
    $listener.Stop()
  }
  $probe = Get-Content -Raw -LiteralPath $probeOutput | ConvertFrom-Json
  $origin = [Uri]$probe.first.origin
  Add-Result 'launch.web-ui' ($origin.Host -eq '127.0.0.1') "loaded $origin"
  Add-Result 'launch.missing-credential' ([bool]$probe.first.missingCredentialVisible) 'missing-credential UI is visible'
  Add-Result 'launch.offline' $true 'application reached its local UI with outbound HTTP proxies pointed at a closed loopback port'
  Add-Result 'launch.loopback-random' ($origin.Host -eq '127.0.0.1' -and $origin.Port -ne 3080) "managed origin $origin while 3080 was occupied"
  Add-Result 'renderer.isolated' ($probe.first.requireType -eq 'undefined' -and $probe.first.processType -eq 'undefined' -and $probe.first.childWindowDenied) "require=$($probe.first.requireType), process=$($probe.first.processType), childDenied=$($probe.first.childWindowDenied)"
  Add-Result 'runtime.client-catalog' ($probe.first.clientEntries -eq 38) "Client entries $($probe.first.clientEntries)"
  Add-Result 'lifecycle.restart' ($probe.second.canary -eq $probe.first.canary) 'renderer canary survived an application restart'
  Invoke-Observed 'processes.quiescent' { Wait-ForNoInstalledProcesses $installRoot }

  Read-Evidence $SignOutEvidence @('lifecycle.crash-recovery', 'lifecycle.sign-out')
  if ($Lane -eq 'provider') {
    Read-Evidence $ProviderEvidence @(
      'provider.conversation', 'provider.session-restored', 'tools.filesystem', 'tools.powershell', 'tools.worker-thread'
    )
  }

  Uninstall-Application $installRoot
  $installedByRun = $false
  Start-Sleep -Seconds 2
  $applicationGone = -not (Test-Path -LiteralPath $candidateExe) -and
    @(Get-ChildItem -LiteralPath (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs') -Recurse -File -Filter 'DeepSeek Harness.lnk').Count -eq 0
  Add-Result 'uninstall.application-removed' $applicationGone 'application executable and shortcut are absent'
  Add-Result 'uninstall.data-preserved' ((Get-Content -Raw -LiteralPath $canaryPath) -eq $canary) 'DSH_HOME canary survived uninstall'

  Install-Setup $setup $installRoot
  Add-Result 'reinstall.data-restored' ((Get-Content -Raw -LiteralPath $canaryPath) -eq $canary) 'DSH_HOME canary remained after reinstall'
  $reinstalledExe = Find-InstalledExecutable $installRoot
  Uninstall-Application $installRoot
  $installedByRun = $false
  Invoke-Observed 'processes.quiescent.final' { Wait-ForNoInstalledProcesses $installRoot }
} catch {
  Add-Result 'runner.unhandled' $false $_.Exception.Message
} finally {
  if ($installedByRun -and (Test-Path -LiteralPath (Join-Path $installRoot 'Uninstall DeepSeek Harness.exe'))) {
    Uninstall-Application $installRoot
  }
}

$evidenceFiles = @(Get-ChildItem -LiteralPath $outputRoot -File -ErrorAction SilentlyContinue)
$secretPatterns = @('sk-[A-Za-z0-9_-]{12,}', 'DEEPSEEK_API_KEY\s*[:=]\s*\S+')
$secretMatches = [System.Collections.Generic.List[string]]::new()
foreach ($file in $evidenceFiles) {
  if ($file.Extension -eq '.png') { continue }
  $text = Get-Content -Raw -LiteralPath $file.FullName
  foreach ($pattern in $secretPatterns) {
    if ($text -match $pattern) { $secretMatches.Add("$($file.Name):$pattern") }
  }
}
Add-Result 'artifacts.secret-free' ($secretMatches.Count -eq 0) "secret matches $($secretMatches.Count)"

$report = [ordered]@{
  schemaVersion = 1
  runnerVersion = '1.0.0'
  startedAt = $startedAt
  finishedAt = [DateTime]::UtcNow.ToString('o')
  lane = $Lane
  os = [ordered]@{
    family = $OsFamily
    edition = [string]$os.Caption
    build = [string]$os.BuildNumber
    architecture = 'x64'
    imageId = $ImageId
  }
  account = [ordered]@{
    nameClass = $(if ($profileClassValid) { 'space-and-non-ascii' } else { 'invalid' })
    administrator = $administrator
  }
  candidate = [ordered]@{
    setupSha256 = $actualSetupSha
    installerType = 'nsis-assisted'
    signature = $(if ($signatureValid) { 'valid' } else { 'unsigned' })
  }
  paths = [ordered]@{ installRoot = $installRoot; userData = $userData; dshHome = $dshHome }
  assertions = $assertions
  secretMatches = $secretMatches
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputRoot 'desktop-acceptance-report.json')
if (@($assertions | Where-Object { $_.status -eq 'failed' }).Count -ne 0) { exit 1 }
