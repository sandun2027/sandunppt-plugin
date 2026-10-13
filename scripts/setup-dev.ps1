$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'dev-env.ps1')
$pluginRoot = Split-Path -Parent $PSScriptRoot
Push-Location $pluginRoot
try {
    if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
        py -3.12 -m venv .venv
        if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 is required' }
    }
    & '.\.venv\Scripts\python.exe' -m pip install -e '.[dev]'
    if ($LASTEXITCODE -ne 0) { throw 'Python dependencies could not be installed' }
    Push-Location taskpane
    try { npm ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'Node dependencies could not be installed' } }
    finally { Pop-Location }
} finally { Pop-Location }
