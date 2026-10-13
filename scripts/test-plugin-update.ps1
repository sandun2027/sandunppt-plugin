$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'prepare-plugin-update.ps1')
$installRoot = Join-Path $root '.tmp\update-fixture'
$report = Join-Path $root '.tmp\update-status.txt'
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
function ProcessFixture($Path, $Command) { [pscustomobject]@{ ExecutablePath = $Path; CommandLine = $Command } }
$python = 'C:\Tools\python.exe'
Assert (Test-PluginCoreProcess (ProcessFixture "$installRoot\local\sandun-open-local.exe" '') @($installRoot)) 'installed core not recognized'
Assert (-not (Test-PluginCoreProcess (ProcessFixture 'C:\Other\sandun-open-local.exe' '') @($installRoot))) 'unrelated same-name executable accepted'
Assert (-not (Test-PluginCoreProcess (ProcessFixture $python ('"' + $python + '" -m ppagent_local.main --keep-alive')) @($installRoot))) 'another checkout development core accepted'
foreach ($command in @(' -m http.server', ' -c "print(''ppagent_local.main'')"', ' -m ppagent_local.main_other', ' -m some.module ppagent_local.main')) {
    Assert (-not (Test-PluginCoreProcess (ProcessFixture $python ('"' + $python + '"' + $command)) @($installRoot))) 'unrelated Python invocation accepted'
}
Assert (-not (Test-PluginCoreProcess (ProcessFixture '' '') @($installRoot))) 'unknown owner accepted'
Write-Output 'PASS exact executable/module identity and unrelated process protection'

# Isolate environment operations to exercise retry and failure paths without touching Office.
function Get-PluginInstallRoots { param($Destination) @($Destination) }
function Stop-ScheduledTask { param($TaskName, $ErrorAction) }
function Stop-PluginCoreProcesses { param($Roots) $script:stops++ }
function Get-Process { param($Name, $ErrorAction) if ($script:officeOpen) { [pscustomobject]@{ Name = 'POWERPNT' } } }
function Get-CimInstance { param($ClassName, $Filter) if ($Filter) { [pscustomobject]@{ Name = 'unrelated.exe' } } }
function Get-NetTCPConnection {
    param($State)
    if ($script:queryFails) { throw 'TCP query failed' }
    if ($script:occupied) { [pscustomobject]@{ LocalPort = 17667; OwningProcess = 12345 } }
}
$script:stops = 0; $script:officeOpen = $true; $script:occupied = $false; $script:queryFails = $false
Assert ((Invoke-PluginUpdatePreparation $installRoot $report) -eq 2) 'Office must block copying without being closed'
Assert ($script:stops -eq 0) 'core stopped while Office still open'
$script:officeOpen = $false; $script:occupied = $true
Assert ((Invoke-PluginUpdatePreparation $installRoot $report) -eq 3) 'unrelated listener not reported'
Assert ((Get-Content $report -Raw) -match '12345.*unrelated.exe') 'port owner details missing'
$script:occupied = $false
Assert ((Invoke-PluginUpdatePreparation $installRoot $report) -eq 0) 'retry after releasing port failed'
$script:queryFails = $true
Assert ((Invoke-PluginUpdatePreparation $installRoot $report) -eq 1) 'failed inspection must not silently allow install'
Write-Output 'PASS Office preservation, busy-port details, retry and failed-query handling'
