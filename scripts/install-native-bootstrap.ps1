param(
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [switch]$Uninstall,
    [switch]$RepairOnly
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot 'prepare-plugin-update.ps1') -InstallDir $InstallDir
$progId = "SANDUN.OpenPresentationBootstrap"
$officeWebAddinId = "E5868626-D647-54A2-B69A-5C546BA40288"
$officeDeveloperKey = "HKCU:\Software\Microsoft\Office\16.0\WEF\Developer"
$assemblyPath = Join-Path $InstallDir "native\SANDUN.OpenPresentationBootstrap.dll"
$taskName = "SANDUNPPTOpenSourceLocalService"
$wpsAllowList = "HKCU:\Software\Kingsoft\Office\WPP\AddinsWL"
$addinKeys = @(
    "HKCU:\Software\Microsoft\Office\PowerPoint\Addins\$progId",
    "HKCU:\Software\Kingsoft\Office\6.0\WPP\AddIns\$progId"
)
$regAsmPaths = @(
    (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\RegAsm.exe"),
    (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\RegAsm.exe")
)

Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
# Cold-start lifeline: the WPS ribbon itself is served by the local core over
# HTTPS, so if the core is not running the next WPS start loads no ribbon at
# all and nothing would ever call the COM add-in that starts the core. A per-user
# Run key breaks that cycle. --keep-alive disables the 15s idle self-exit because
# security software on typical machines blocks Office hosts from spawning the
# core process, so the core must already be up when WPS starts.
Remove-ItemProperty `
        -Path $officeDeveloperKey `
        -Name $officeWebAddinId `
        -ErrorAction SilentlyContinue

if ($Uninstall) {
    Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "SANDUNPPTOpenSource" -ErrorAction SilentlyContinue
    Remove-ItemProperty -LiteralPath $wpsAllowList -Name $progId -ErrorAction SilentlyContinue
    foreach ($key in $addinKeys) { Remove-Item -LiteralPath $key -Recurse -Force -ErrorAction SilentlyContinue }
    foreach ($regAsm in $regAsmPaths) {
        if (Test-Path -LiteralPath $regAsm) { & $regAsm /nologo /unregister $assemblyPath | Out-Null }
    }
    Stop-PluginCoreProcesses @(Get-PluginInstallRoots $InstallDir)
    exit 0
}

New-ItemProperty `
        -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" `
        -Name "SANDUNPPTOpenSource" `
        -Value ("`"$(Join-Path $InstallDir 'local\sandun-open-local.exe')`" --keep-alive") `
        -PropertyType String -Force | Out-Null

if (-not (Test-Path -LiteralPath $assemblyPath -PathType Leaf)) {
    throw "SANDUN native bootstrap was not found: $assemblyPath"
}

if (-not $RepairOnly) {
    foreach ($regAsm in $regAsmPaths) {
        if (-not (Test-Path -LiteralPath $regAsm)) { throw "COM registration tool was not found: $regAsm" }
        # /tlb exports the type library WPS and other out-of-apartment callers need
        # to marshal IDispatch; without it ExecuteTool fails as "not a function".
        # Do NOT redirect stderr here: under powershell.exe -File with
        # $ErrorActionPreference='Stop', RegAsm's unsigned-assembly warning (RA0000,
        # always on stderr) would turn into a terminating NativeCommandError and
        # abort the script with exit code 1 before the add-in keys are written.
        & $regAsm /nologo /codebase /tlb $assemblyPath
        if ($LASTEXITCODE -ne 0) {
            # A running Office host can lock the .tlb export; retry once after a beat.
            Start-Sleep -Seconds 2
            & $regAsm /nologo /codebase /tlb $assemblyPath
        }
        if ($LASTEXITCODE -ne 0) { throw "COM registration failed: $regAsm" }
    }
    # RegAsm can report success while a locked .tlb leaves the CLSID half-registered,
    # which makes WPS load nothing at all. Verify in both 32/64-bit registry views.
    # The installer runs this script under 32-bit PowerShell, where the registry
    # provider applies WOW64 redirection, so read through explicit .NET views.
    $clsid = "{2A836EBE-8B8E-4757-BBB6-EC6204AB97F1}"
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, $view)
        $server = $base.OpenSubKey("SOFTWARE\Classes\CLSID\$clsid\InprocServer32")
        $codeBase = if ($server) { $server.GetValue("CodeBase") } else { $null }
        if ($server) { $server.Dispose() }
        $base.Dispose()
        if (-not $codeBase) { throw "COM registration verification failed ($view)" }
    }
}

foreach ($key in $addinKeys) {
    New-Item -Path $key -Force | Out-Null
    New-ItemProperty -Path $key -Name "FriendlyName" -Value "SANDUN" -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $key -Name "Description" -Value "SANDUN native presentation ribbon and local conversion host" -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $key -Name "LoadBehavior" -Value 3 -PropertyType DWord -Force | Out-Null
    New-ItemProperty -Path $key -Name "CommandLineSafe" -Value 1 -PropertyType DWord -Force | Out-Null
}

# WPS discovers Office COM add-ins only when their ProgID is explicitly listed.
New-Item -Path $wpsAllowList -Force | Out-Null
New-ItemProperty -LiteralPath $wpsAllowList -Name $progId -Value "" -PropertyType String -Force | Out-Null

$resiliencyRoots = @(
    "HKCU:\Software\Microsoft\Office\16.0\PowerPoint\Resiliency\DisabledItems",
    "HKCU:\Software\Microsoft\Office\16.0\PowerPoint\Resiliency\StartupItems"
)
foreach ($root in $resiliencyRoots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $properties = Get-ItemProperty -LiteralPath $root
    foreach ($property in $properties.PSObject.Properties) {
        if ($property.Value -isnot [byte[]]) { continue }
        $decoded = [System.Text.Encoding]::Unicode.GetString($property.Value)
        if ($decoded -like "*$progId*" -or $decoded -like "*SANDUN.OpenPresentationBootstrap*") {
            Remove-ItemProperty -LiteralPath $root -Name $property.Name -ErrorAction SilentlyContinue
        }
    }
}

# Repair is explicit from the Start menu. A logon task would repeatedly undo
# an intentional user decision to disable the add-in.
foreach ($key in $addinKeys) {
    if ((Get-ItemProperty -LiteralPath $key -Name LoadBehavior).LoadBehavior -ne 3) {
        throw "Add-in registration verification failed: $key"
    }
}

if (-not $RepairOnly) {
    Stop-PluginCoreProcesses @(Get-PluginInstallRoots $InstallDir)
}
