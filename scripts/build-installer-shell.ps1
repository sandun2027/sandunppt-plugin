param([switch]$Preview)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = (& (Join-Path $root '.venv\Scripts\python.exe') -c 'from ppagent_local import __version__; print(__version__)').Trim()
$buildDir = Join-Path $root 'build\installer-shell'
New-Item -ItemType Directory -Path $buildDir -Force | Out-Null
$assemblyInfo = Join-Path $buildDir 'AssemblyInfo.cs'
@"
using System.Reflection;
[assembly: AssemblyTitle("SANDUN Setup")]
[assembly: AssemblyProduct("SANDUN PPT Plugin")]
[assembly: AssemblyCompany("SANDUN")]
[assembly: AssemblyVersion("$version.0")]
[assembly: AssemblyFileVersion("$version.0")]
"@ | Set-Content -LiteralPath $assemblyInfo -Encoding utf8BOM
& (Join-Path $root '.venv\Scripts\python.exe') (Join-Path $root 'installer\shell\create-icon.py') $buildDir
if ($LASTEXITCODE -ne 0) { throw 'Could not create installer icon' }
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$outputDir = if ($Preview) { Join-Path $root '.tmp\installer-preview' } else { Join-Path $root 'release' }
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$output = Join-Path $outputDir "SANDUN-PPT-OpenSource-Setup-$version.exe"
$options = @('/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', "/out:$output", "/win32icon:$buildDir\Setup.ico", "/resource:$root\installer\shell\SetupWindow.xaml,Sandun.Setup.Window", "/resource:$buildDir\Setup.ico,Sandun.Setup.Icon", "/reference:$framework\WPF\WindowsBase.dll", "/reference:$framework\WPF\PresentationCore.dll", "/reference:$framework\WPF\PresentationFramework.dll", '/reference:System.Xaml.dll', '/reference:System.Core.dll')
if ($Preview) { $options += '/define:DEBUG'; $options += '/debug+' }
else {
    $payload = Join-Path $root "build\installer-engine\SANDUN-Install-Engine-$version.exe"
    if (-not (Test-Path -LiteralPath $payload -PathType Leaf)) { throw "Installer engine missing: $payload" }
    $options += "/resource:$payload,Sandun.Setup.Engine"
    $options += "/win32manifest:$root\installer\shell\app.manifest"
}
& (Join-Path $framework 'csc.exe') $options (Join-Path $root 'installer\shell\Setup.cs') $assemblyInfo
if ($LASTEXITCODE -ne 0) { throw 'Installer shell compilation failed' }
Write-Host "SANDUN installer shell: $output"
