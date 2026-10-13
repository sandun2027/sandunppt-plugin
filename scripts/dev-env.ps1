# Keep build/test caches and runtime data inside this checkout.
$pluginRoot = Split-Path -Parent $PSScriptRoot
$work = Join-Path $pluginRoot '.work'
foreach ($name in @('tmp','cache','runtime')) { New-Item -ItemType Directory -Force -Path (Join-Path $work $name) | Out-Null }
$env:TEMP = Join-Path $work 'tmp'
$env:TMP = $env:TEMP
$env:PYTHONPATH = Join-Path $pluginRoot 'src'
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:PPAGENT_LOCAL_DATA_DIR = Join-Path $work 'runtime'
$env:PIP_CACHE_DIR = Join-Path $work 'cache\pip'
$env:npm_config_cache = Join-Path $work 'cache\npm'
$env:PYINSTALLER_CONFIG_DIR = Join-Path $work 'cache\pyinstaller'
