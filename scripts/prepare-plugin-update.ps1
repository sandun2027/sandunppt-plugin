param(
    [string]$InstallDir,
    [string]$ReportPath,
    [switch]$StopOnly
)

$ErrorActionPreference = 'Stop'

function Get-PluginInstallRoots {
    param([string]$Destination)
    $roots = @($Destination, (Join-Path $env:LOCALAPPDATA 'Programs\SANDUNPPTOpenSource'))
    foreach ($hive in @('HKCU:', 'HKLM:')) {
        $key = "$hive\Software\Microsoft\Windows\CurrentVersion\Uninstall\{DFB0641B-FA91-4437-9134-BB59480C8C8E}_is1"
        $entry = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
        if ($entry.InstallLocation) { $roots += $entry.InstallLocation }
    }
    @($roots | Where-Object { $_ } | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') } | Select-Object -Unique)
}

function Test-PluginCoreProcess {
    param($Process, [string[]]$Roots)
    if (-not $Process.ExecutablePath) { return $false }
    $executable = [IO.Path]::GetFullPath($Process.ExecutablePath)
    foreach ($root in $Roots) {
        if ($executable -ieq (Join-Path $root 'local\sandun-open-local.exe')) { return $true }
    }
    # Development modules can belong to another checkout or the commercial edition.
    # Only the installed executable at an open-source installation root is ours.
    return $false
}

function Stop-PluginCoreProcesses {
    param([string[]]$Roots)
    $candidates = @(Get-CimInstance Win32_Process | Where-Object { Test-PluginCoreProcess $_ $Roots })
    foreach ($candidate in $candidates) {
        $processId = [int]$candidate.ProcessId
        # Revalidate identity and creation time immediately before stopping to avoid PID reuse.
        $current = Get-CimInstance Win32_Process -Filter "ProcessId=$processId"
        if ($current -and $current.CreationDate -eq $candidate.CreationDate -and (Test-PluginCoreProcess $current $Roots)) {
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
    }
}

function Invoke-PluginUpdatePreparation {
    param([string]$Destination, [string]$Report, [bool]$OnlyStop = $false)
    try {
        if (-not $OnlyStop -and (Get-Process POWERPNT,wpp -ErrorAction SilentlyContinue)) { return 2 }
        $roots = @(Get-PluginInstallRoots $Destination)
        Stop-ScheduledTask -TaskName 'SANDUNPPTOpenSourceLocalService' -ErrorAction SilentlyContinue
        Stop-PluginCoreProcesses $roots
        $deadline = [DateTime]::UtcNow.AddSeconds(10)
        do {
            $remaining = @(Get-CimInstance Win32_Process | Where-Object { Test-PluginCoreProcess $_ $roots })
            if ($remaining.Count -eq 0) { break }
            Stop-PluginCoreProcesses $roots
            Start-Sleep -Milliseconds 200
        } while ([DateTime]::UtcNow -lt $deadline)
        if ($remaining.Count -gt 0) { return 4 }
        if ($OnlyStop) { return 0 }
        # Query all listeners: suppress only the expected "no matching instances" case.
        $listeners = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -eq 17667 })
        if ($listeners.Count -gt 0) {
            $details = foreach ($ownerId in @($listeners.OwningProcess | Select-Object -Unique)) {
                $ownerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerId"
                'PID ' + $ownerId + ' (' + $ownerProcess.Name + ')'
            }
            if ($Report) { [IO.File]::WriteAllText($Report, ($details -join ', '), [Text.Encoding]::UTF8) }
            return 3
        }
        return 0
    }
    catch {
        if ($Report) { [IO.File]::WriteAllText($Report, $_.Exception.Message, [Text.Encoding]::UTF8) }
        return 1
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    exit (Invoke-PluginUpdatePreparation $InstallDir $ReportPath ([bool]$StopOnly))
}
