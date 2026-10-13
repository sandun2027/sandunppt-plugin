. (Join-Path $PSScriptRoot "dev-env.ps1")
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot "build-ui.ps1")
& (Join-Path $PSScriptRoot "build-native-bootstrap.ps1")
& (Join-Path $PSScriptRoot "build-bridge.ps1")

$candidates = @(
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
)
$iscc = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $iscc) { throw "未找到 Inno Setup 6，请安装后重新运行 scripts\build-installer.ps1" }
& $iscc (Join-Path $root "installer\windows\PPTagentPPTPlugin.iss")
if ($LASTEXITCODE -ne 0) { throw "Inno Setup 编译失败" }
& (Join-Path $PSScriptRoot 'build-installer-shell.ps1')

$setup = Get-ChildItem -LiteralPath (Join-Path $root "release") -Filter "*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { throw "安装包文件未生成" }
$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $setup.FullName
"$($hash.Hash)  $($setup.Name)" | Set-Content -Encoding ascii -LiteralPath (Join-Path $setup.DirectoryName "SHA256SUMS.txt")
Write-Host "安装包: $($setup.FullName)"
Write-Host "SHA-256: $($hash.Hash)"
