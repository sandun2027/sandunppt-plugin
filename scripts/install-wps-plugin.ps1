param(
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [switch]$Uninstall
)
$ErrorActionPreference = "Stop"
$pluginName = "SANDUNPPTOpenSource"
$configDir = Join-Path $env:APPDATA "kingsoft\wps\jsaddons"
$pluginUrl = "https://127.0.0.1:17667/wps/"

New-Item -ItemType Directory -Path $configDir -Force | Out-Null

function Update-PluginList {
    param(
        [Parameter(Mandatory = $true)][string]$Path
    )

    if (Test-Path -LiteralPath $Path) {
        if (-not (Test-Path -LiteralPath "$Path.ppagent-backup")) {
            Copy-Item -LiteralPath $Path -Destination "$Path.ppagent-backup"
        }
        [xml]$document = Get-Content -Raw -LiteralPath $Path
    } else {
        if ($Uninstall) { return }
        [xml]$document = "<?xml version='1.0' encoding='UTF-8'?><jsplugins></jsplugins>"
    }

    $root = $document.DocumentElement
    $existing = @($root.ChildNodes) | Where-Object {
        ($_ -is [System.Xml.XmlElement]) -and ($_.GetAttribute("name") -eq $pluginName)
    }
    foreach ($node in $existing) { [void]$root.RemoveChild($node) }

    if (-not $Uninstall) {
        $node = $document.CreateElement("jspluginonline")
        $node.SetAttribute("name", $pluginName)
        $node.SetAttribute("type", "wpp")
        $node.SetAttribute("url", $pluginUrl)
        # WPS only loads dev-mode online plugins carrying enable="enable_dev";
        # keep the flags the running WPS may have written onto the previous node.
        if ($existing.Count -gt 0) {
            foreach ($attribute in @("enable", "debug", "install")) {
                $value = $existing[0].GetAttribute($attribute)
                if ($value) { $node.SetAttribute($attribute, $value) }
            }
        }
        if (-not $node.GetAttribute("enable")) { $node.SetAttribute("enable", "enable_dev") }
        [void]$root.AppendChild($node)
    }

    $settings = New-Object System.Xml.XmlWriterSettings
    $settings.Encoding = New-Object System.Text.UTF8Encoding($false)
    $settings.Indent = $true
    $writer = [System.Xml.XmlWriter]::Create($Path, $settings)
    try { $document.Save($writer) } finally { $writer.Dispose() }
}

# WPS personal editions since 12.1.0.16910 use publish.xml; older editions use jsplugins.xml.
Update-PluginList -Path (Join-Path $configDir "publish.xml")
Update-PluginList -Path (Join-Path $configDir "jsplugins.xml")
