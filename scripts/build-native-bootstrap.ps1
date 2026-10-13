$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$sources = Get-ChildItem -LiteralPath (Join-Path $root "native") -Filter "*.cs" | Select-Object -ExpandProperty FullName
$extensibility = Join-Path $root "native\lib\Extensibility.dll"
$webViewDir = Join-Path $root "native\lib\webview2"
$webViewCore = Join-Path $webViewDir "Microsoft.Web.WebView2.Core.dll"
$webViewWinForms = Join-Path $webViewDir "Microsoft.Web.WebView2.WinForms.dll"
$webViewLoader = Join-Path $webViewDir "WebView2Loader.dll"
$office = Get-ChildItem `
    (Join-Path $env:WINDIR "assembly\GAC_MSIL\office") `
    -Recurse `
    -Filter "office.dll" `
    -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
$outputDir = Join-Path $root "dist\native"
$output = Join-Path $outputDir "SANDUN.OpenPresentationBootstrap.dll"

if (-not (Test-Path -LiteralPath $compiler)) { throw ".NET Framework 4.8 C# 编译器不可用" }
if (-not $office) { throw "Microsoft Office PIA 未安装，无法编译原生功能区" }
foreach ($dependency in @($extensibility, $webViewCore, $webViewWinForms, $webViewLoader)) {
    if (-not (Test-Path -LiteralPath $dependency -PathType Leaf)) { throw "原生依赖缺失: $dependency" }
}
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
& node (Join-Path $root "taskpane\scripts\generate-tools.mjs")
if ($LASTEXITCODE -ne 0) { throw "Native tool catalog generation failed" }
& (Join-Path $root ".venv\Scripts\python.exe") (Join-Path $root "scripts\build-icons.py")
if ($LASTEXITCODE -ne 0) { throw "Native tool icon generation failed" }
$iconResources = Get-ChildItem -LiteralPath (Join-Path $root "build\tool-icons") -Filter "*.png" | ForEach-Object { "/resource:$($_.FullName),SANDUN.Icons.$($_.Name)" }
& $compiler `
    /nologo `
    /target:library `
    /platform:anycpu `
    /optimize+ `
    "/reference:$extensibility" `
    "/reference:$office" `
    "/reference:$webViewCore" `
    "/reference:$webViewWinForms" `
    "/reference:$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\WPF\WindowsBase.dll" "/reference:$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\WPF\PresentationCore.dll" /reference:System.Xml.Linq.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /reference:System.Drawing.dll `
    /reference:System.Windows.Forms.dll `
    /reference:System.Web.Extensions.dll `
    /reference:Microsoft.CSharp.dll `
    "/out:$output" `
    $sources $iconResources
if ($LASTEXITCODE -ne 0) { throw "SANDUN 原生宿主启动器编译失败" }
Copy-Item -LiteralPath $webViewCore -Destination $outputDir -Force
Copy-Item -LiteralPath $webViewWinForms -Destination $outputDir -Force
Copy-Item -LiteralPath $webViewLoader -Destination $outputDir -Force
Copy-Item -LiteralPath (Join-Path $webViewDir "runtimes") -Destination $outputDir -Recurse -Force
Write-Host "原生宿主启动器: $output"
