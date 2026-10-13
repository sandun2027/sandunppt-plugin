param([ValidateSet('office','wps')][string]$HostKind = 'office')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'dev-env.ps1')
$pluginRoot = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$testExe = Join-Path $pluginRoot '.work\OpenSourceSmoke.exe'
& $compiler /nologo /target:exe /platform:anycpu /reference:System.Windows.Forms.dll /reference:Microsoft.CSharp.dll "/out:$testExe" (Join-Path $pluginRoot 'native\tests\OpenSourceSmoke.cs')
if ($LASTEXITCODE -ne 0) { throw 'Native test compilation failed' }
& $testExe $pluginRoot $HostKind
if ($LASTEXITCODE -ne 0) { throw 'Native AI insertion test failed' }
