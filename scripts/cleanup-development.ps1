# Optional manual cleanup after verifying release/ and closing test/build processes.
# The release is already created from a whitelist. This script removes only
# copied history, build output, caches and local test credentials inside this folder.
param([switch]$RemoveDependencies, [switch]$LegacyOnly)
$ErrorActionPreference = 'Stop'
$pluginRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
if (-not (Test-Path -LiteralPath (Join-Path $pluginRoot 'release\SANDUN-PPT-OpenSource-2.0.2-source.zip'))) {
    throw 'Create and verify the source release before cleaning the development checkout.'
}
$legacyPaths = @(
    'native\SANDUN.PresentationBootstrap.snk',
    'native\tests\AdvancedToolsSmoke.cs','native\tests\PreviewWindow.cs','native\tests\ShapeGeometrySmoke.cs',
    'installer\tests','taskpane\tests-ui','taskpane\playwright.config.ts',
    'scripts\open-preview.ps1','scripts\test-advanced-tools.ps1','scripts\test-cover-image.ps1',
    'scripts\test-image-insertion.ps1','scripts\test-installer-shell.ps1','scripts\test-native-tools.ps1',
    'scripts\test-native-window.ps1','scripts\test-plugin-update-live.ps1','scripts\test-shape-geometry.ps1',
    'scripts\test-tool-windows.ps1','scripts\test-window-dispatch.ps1','scripts\test-wps-window.ps1',
    'manifests\wps\icons\account-0506d745ce02d41a.svg','manifests\wps\icons\create-329f2332694721b8.svg',
    'manifests\wps\icons\export-8ecbb39e1c250979.svg','manifests\wps\icons\website-3898c1b630e82fd9.svg'
)
foreach ($icon in @('account','create','export','website')) {
    $legacyPaths += "taskpane\public\tools\$icon.svg", "taskpane\public\tools\ribbon-$icon.svg"
}
$relativePaths = $legacyPaths
if (-not $LegacyOnly) {
    $relativePaths += '.git','.tmp','.work','$pkg','.pytest_cache','.ruff_cache','build','dist','src\ppagent_ppt_plugin.egg-info','src\ppagent_local\static','src\ppagent_local\__pycache__','tests\__pycache__','taskpane\tsconfig.app.tsbuildinfo','taskpane\test-results','taskpane\playwright-report'
    foreach ($artifact in @('advanced-tools','ai-experience','ai-insertion','cover-image','installer','native-tool-windows','native-tools','p0','shape-geometry','tool-ui','ui-layout','window-dispatch','wps-advanced-tools','wps-native-tools','wps-shape-geometry','wps-tools','xiaowan-inspect')) {
        $relativePaths += "artifacts\$artifact"
    }
}
if ($RemoveDependencies) { $relativePaths += '.venv','taskpane\node_modules' }
foreach ($relative in $relativePaths) {
    $target = [IO.Path]::GetFullPath((Join-Path $pluginRoot $relative))
    if (-not $target.StartsWith($pluginRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Path escaped the plugin directory.' }
    if (Test-Path -LiteralPath $target) {
        $entry = Get-Item -Force -LiteralPath $target
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing reparse point: $relative" }
        Remove-Item -LiteralPath $target -Recurse -Force
    }
}
