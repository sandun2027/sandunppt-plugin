. (Join-Path $PSScriptRoot "dev-env.ps1")
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $root "taskpane")
try {
    npm ci --prefer-offline --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm ci 失败" }
    node scripts/generate-tools.mjs
    if ($LASTEXITCODE -ne 0) { throw "工具目录生成失败" }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "任务窗格构建失败" }
} finally {
    Pop-Location
}

# Copy the self-contained WPS entry point and its content-addressed SVG icons.
$wpsStatic = Join-Path $root "src\ppagent_local\static\wps"
New-Item -ItemType Directory -Path $wpsStatic -Force | Out-Null
Copy-Item -Path (Join-Path $root "manifests\wps\*") -Destination $wpsStatic -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root 'taskpane\public\icon.svg') -Destination (Join-Path $wpsStatic 'icon.svg') -Force

Copy-Item -Path (Join-Path $root 'taskpane\public\icon-*.svg') -Destination $wpsStatic -Force
Copy-Item -LiteralPath (Join-Path $root 'taskpane\public\tools') -Destination $wpsStatic -Recurse -Force

$python = Join-Path $root ".venv\Scripts\python.exe"
& $python (Join-Path $PSScriptRoot "build-icons.py")
if ($LASTEXITCODE -ne 0) { throw "Office PNG 图标生成失败" }
Copy-Item -LiteralPath (Join-Path $root 'taskpane\public\icon.svg') -Destination (Join-Path $root 'src\ppagent_local\static\icon.svg') -Force
