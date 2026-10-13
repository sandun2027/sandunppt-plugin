Microsoft WebView2 SDK runtime files

Version: 1.0.2365.46
Package: Microsoft.Web.WebView2
Files used by the native PowerPoint task pane:

- Microsoft.Web.WebView2.Core.dll
- Microsoft.Web.WebView2.WinForms.dll
- WebView2Loader.dll (legacy x64 fallback)
- runtimes/win-x64/native/WebView2Loader.dll
- runtimes/win-x86/native/WebView2Loader.dll

Both loaders are from the official 1.0.2365.46 NuGet package. The native host
loads the matching architecture explicitly before initializing WebView2.

The target machine must also have the Microsoft Edge WebView2 Runtime, which
is included with supported Microsoft Office installations.
