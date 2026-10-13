$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) { throw "请先在 .venv 中安装项目依赖" }
& $python -m PyInstaller --noconfirm --clean (Join-Path $root "packaging\ppagent-local.spec") --distpath (Join-Path $root "dist") --workpath (Join-Path $root "build\pyinstaller")
if ($LASTEXITCODE -ne 0) { throw "本地伴随程序打包失败" }
