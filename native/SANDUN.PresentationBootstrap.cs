using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Extensibility;
using Microsoft.Office.Core;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("SANDUN Presentation Bootstrap")]
[assembly: AssemblyCompany("SANDUN")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("2.0.2.0")]
[assembly: ComVisible(false)]

namespace Sandun.PresentationBootstrap
{
    // WPS builds its JavaScript COM wrapper from IDispatch type information.
    // An explicit interface keeps the callable surface stable across WPS versions.
    [ComVisible(true)]
    [Guid("74BD17D3-5C2C-56E2-9AEB-A8A251DE926F")]
    [InterfaceType(ComInterfaceType.InterfaceIsDual)]
    public interface IPresentationBootstrap
    {
        [DispId(1)] void ExecuteTool(string command);
        [DispId(2)] void OpenTool(string tool);
    }

    [ComVisible(true)]
    [Guid("2A836EBE-8B8E-4757-BBB6-EC6204AB97F1")]
    [ProgId("SANDUN.OpenPresentationBootstrap")]
    // Keep the COM class interface explicit; WPS uses its type information when
    // creating the JavaScript wrapper exposed by addin.Object.
    [ClassInterface(ClassInterfaceType.AutoDual)]
    public sealed class PresentationBootstrap : IDTExtensibility2, IRibbonExtensibility, IPresentationBootstrap
    {
        internal const string Origin = "https://127.0.0.1:17667";
        private IRibbonUI ribbon;
        private Control dispatcher;
        private System.Threading.Timer coreTimer;
        private bool disconnected;
        internal static object CurrentApplication { get; private set; }
        internal static PresentationBootstrap Current { get; private set; }

        public void OnConnection(object application, ext_ConnectMode mode, object addIn, ref Array custom)
        {
            CurrentApplication = application;
            Current = this;
            try { ((dynamic)addIn).Object = this; } catch { }
            disconnected = false;
            WriteLog("Connected to " + Process.GetCurrentProcess().ProcessName);
            // Never block Office startup on a process, network request, or WebView.
            coreTimer = new System.Threading.Timer(EnsureCore, null, 0, 5000);
        }
        public void OnStartupComplete(ref Array custom) { }
        public void OnAddInsUpdate(ref Array custom) { }
        public void OnBeginShutdown(ref Array custom) { Disconnect(); }
        public void OnDisconnection(ext_DisconnectMode mode, ref Array custom) { Disconnect(); }
        private void Disconnect()
        {
            if (disconnected) return;
            disconnected = true;
            if (coreTimer != null) { coreTimer.Dispose(); coreTimer = null; }
            if (dispatcher != null) { dispatcher.Dispose(); dispatcher = null; }
            ToolPanel.CloseAll();
            ribbon = null; CurrentApplication = null; Current = null;
        }
        public string GetCustomUI(string ribbonId)
        {
            if (!string.Equals(Process.GetCurrentProcess().ProcessName, "POWERPNT", StringComparison.OrdinalIgnoreCase)) return "";
            return @"<customUI xmlns=""http://schemas.microsoft.com/office/2009/07/customui"" onLoad=""OnRibbonLoad"">
  <ribbon><tabs><tab id=""SANDUN.NativeTab"" label=""SANDUN"">
    <group id=""SANDUN.ConfigGroup"" label=""配置"">
      <button id=""SANDUN.Config"" label=""配置"" size=""large"" getImage=""GetConfigImage"" onAction=""OnConfigClick""/>
    </group>
    <group id=""SANDUN.AIGroup"" label=""AI 工具"">
      <button id=""SANDUN.Cover"" label=""AI 封面"" size=""large"" getImage=""GetImageImage"" onAction=""OnCoverClick""/>
      <button id=""SANDUN.Image"" label=""AI 生图"" getImage=""GetImageImage"" onAction=""OnImageClick""/>
      <button id=""SANDUN.Chart"" label=""AI 图表"" getImage=""GetChartImage"" onAction=""OnChartClick""/>
      <button id=""SANDUN.Diagram"" label=""AI 图示"" getImage=""GetDiagramImage"" onAction=""OnDiagramClick""/>
    </group>
" + ToolCatalog.Ribbon() + @"
  </tab></tabs></ribbon>
</customUI>";
        }
        public void OnRibbonLoad(IRibbonUI value)
        {
            ribbon = value;
            // Install a WinForms synchronization context on the Office UI thread
            // so await continuations never invoke ribbon callbacks on a worker.
            dispatcher = new Control();
            dispatcher.CreateControl();

        }
        public object GetConfigImage(IRibbonControl control) { return RibbonImages.Create("settings"); }
        public void OnConfigClick(IRibbonControl control) { OpenWindow("settings"); }
        public object GetImageImage(IRibbonControl control) { return RibbonImages.Create("image"); }
        public object GetChartImage(IRibbonControl control) { return RibbonImages.Create("chart"); }
        public object GetDiagramImage(IRibbonControl control) { return RibbonImages.Create("diagram"); }
        public void OnImageClick(IRibbonControl control) { OpenWindow("image"); }
        public void OnCoverClick(IRibbonControl control) { OpenWindow("cover"); }
        public void OnChartClick(IRibbonControl control) { OpenWindow("chart"); }
        public void OnDiagramClick(IRibbonControl control) { OpenWindow("diagram"); }
        public void OnViewClick(IRibbonControl control) { OpenWindow("view"); }
        public void OnObjectClick(IRibbonControl control) { OpenWindow("object"); }
        public void OnExportToolsClick(IRibbonControl control) { OpenWindow("export"); }
        public object GetToolImage(IRibbonControl control) { return RibbonImages.Create(control.Tag); }
        public void OnNativeToolClick(IRibbonControl control) { if (control != null) ExecuteTool(control.Tag); }
        public void ExecuteTool(string command)
        {
            try
            {
                var tool = ToolCatalog.Find(command);
                if (tool.Panel)
                {
                    // Panel windows own their dedicated STA dispatcher. Queue
                    // directly so WPS's ribbon callback returns immediately.
                    ToolPanel.Open(command);
                }
                else
                {
                    string result = NativeTools.Execute(command, "{}");
                    if (command.StartsWith("export-") || command == "save-version") ToolPanel.Notify(tool.Label, result, false);
                }
            }
            catch (Exception exception) { ToolPanel.Notify("操作未完成", exception.Message, true); WriteLog("Native tool failed: " + exception); }
        }
        public void OpenTool(string tool)
        {
            WriteLog("OpenTool requested: " + tool);
            foreach (var definition in ToolCatalog.All)
                if (definition.Id == tool) { ExecuteTool(tool); return; }
            OpenWindow(tool);
        }
        internal void OpenWindow(string tool) { PluginWindows.Open(tool); }
        internal static void OpenExternal(string url)
        {
            Uri uri;
            if (!Uri.TryCreate(url, UriKind.Absolute, out uri) || (uri.Scheme != "https" && uri.Scheme != "http")) return;
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
            catch (Exception exception) { WriteLog("Open link failed: " + exception.Message); }
        }
        private static void EnsureCore(object state)
        {
            try
            {
                if (IsCoreHealthy()) return;
                using (var mutex = new Mutex(false, @"Local\SANDUNPPTOpenSourceCoreStart"))
                {
                    if (!mutex.WaitOne(0)) return;
                    try
                    {
                        if (IsCoreHealthy()) return;
                        string directory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                        string path = Path.GetFullPath(Path.Combine(directory, "..", "local", "sandun-open-local.exe"));
                        // The source-tree smoke build keeps the PyInstaller folder as
                        // dist\ppagent-local; installed builds use app\local.
                        if (!File.Exists(path))
                            path = Path.GetFullPath(Path.Combine(directory, "..", "sandun-open-local", "sandun-open-local.exe"));
                        if (!File.Exists(path)) { WriteLog("Core missing: " + path); return; }
                        // The open edition uses its own executable name and loopback port.
                        Process.Start(new ProcessStartInfo(path, "--keep-alive") {
                            WorkingDirectory = Path.GetDirectoryName(path), UseShellExecute = false,
                            CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden
                        });
                        WriteLog("Started local core");
                    }
                    finally { mutex.ReleaseMutex(); }
                }
            }
            catch (Exception exception) { WriteLog(exception.Message); }
        }
        private static bool IsCoreHealthy()
        {
            try
            {
                ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                var request = (HttpWebRequest)WebRequest.Create(Origin + "/healthz");
                request.Proxy = null;
                request.Timeout = 500; request.ReadWriteTimeout = 500;
                using (var response = request.GetResponse()) return true;
            }
            catch { return false; }
        }
        internal static bool WaitForCore()
        {
            EnsureCore(null);
            var watch = Stopwatch.StartNew();
            while (watch.ElapsedMilliseconds < 20000)
            {
                if (IsCoreHealthy()) return true;
                Thread.Sleep(200);
            }
            return false;
        }
        internal static void WriteLog(string message)
        {
            try
            {
                string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SANDUNPPTOpenSource");
                Directory.CreateDirectory(directory);
                File.AppendAllText(Path.Combine(directory, "native-bootstrap.log"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message + Environment.NewLine);
            }
            catch { }
        }
    }
    internal sealed class OfficeWindow : IWin32Window
    {
        public IntPtr Handle { get; private set; }
        public OfficeWindow(IntPtr handle) { Handle = handle; }
    }
    [ComVisible(true)]
    [Guid("4B696479-002F-59CA-9723-C0B31FC605CE")]
    [ProgId("SANDUN.OpenPresentationTaskPane")]
    [ClassInterface(ClassInterfaceType.AutoDual)]
    public sealed class PresentationTaskPane : UserControl
    {
        [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr LoadLibrary(string path);
        private static IntPtr loader;
        private readonly WebView2 webView;
        private readonly Button status;
        private bool initializing;
        private string tool = "settings";
        public PresentationTaskPane()
        {
            BackColor = Color.White;
            status = new Button { Dock = DockStyle.Fill, Text = "正在准备创作空间…", FlatStyle = FlatStyle.Flat, ForeColor = Color.DimGray };
            status.FlatAppearance.BorderSize = 0;
            status.Click += delegate { InitializeBrowser(); };
            Controls.Add(status);
            webView = new WebView2 { Dock = DockStyle.Fill, Visible = false, DefaultBackgroundColor = Color.White };
            Controls.Add(webView); Load += delegate { InitializeBrowser(); };
        }
        internal void Navigate(string value)
        {
            tool = value;
            if (webView.CoreWebView2 != null && webView.Visible)
            {
                webView.CoreWebView2.PostWebMessageAsJson(new JavaScriptSerializer().Serialize(new { type = "sandun:navigate", tool = value }));
            }
        }
        internal void PostWindowState(string mode)
        {
            if (webView.CoreWebView2 != null)
                webView.CoreWebView2.PostWebMessageAsJson(new JavaScriptSerializer().Serialize(new { type = "sandun:window-state", mode = mode }));
        }
        private async void InitializeBrowser()
        {
            if (initializing || IsDisposed) return;
            initializing = true; status.Text = "正在准备创作空间…";
            try
            {
                if (!await Task.Run(() => PresentationBootstrap.WaitForCore())) throw new InvalidOperationException("本地服务未能启动，请重新安装或运行修复。");
                if (IsDisposed) return;
                // Separate host browser processes (and their runtime options).
                // Account state remains shared through the local companion.
                string folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SANDUNPPTOpenSource", "WebView2", Process.GetCurrentProcess().ProcessName);
                if (loader == IntPtr.Zero)
                {
                    string architecture = IntPtr.Size == 8 ? "win-x64" : "win-x86";
                    string loaderPath = Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location), "runtimes", architecture, "native", "WebView2Loader.dll");
                    loader = LoadLibrary(loaderPath);
                    if (loader == IntPtr.Zero) throw new InvalidOperationException("WebView2 加载器缺失，请重新安装插件。");
                }
                var environment = await CoreWebView2Environment.CreateAsync(null, folder);
                if (IsDisposed) return;
                await webView.EnsureCoreWebView2Async(environment);
                if (IsDisposed) return;
                webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
                webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                webView.CoreWebView2.AddHostObjectToScript("sandunOffice", new NativeOfficeBridge());
                webView.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e)
                {
                    Uri uri;
                    if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out uri) || uri.GetLeftPart(UriPartial.Authority) != PresentationBootstrap.Origin)
                    { e.Cancel = true; PresentationBootstrap.OpenExternal(e.Uri); }
                };
                webView.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e)
                { e.Handled = true; PresentationBootstrap.OpenExternal(e.Uri); };
                webView.CoreWebView2.WebMessageReceived += OnMessage;
                string officeHost = "office";
                try { if (NativeTools.IsWps) officeHost = "wps"; } catch { }
                webView.Source = new Uri(PresentationBootstrap.Origin + "/?host=native&officeHost=" + officeHost + "&tool=" + Uri.EscapeDataString(tool));
                webView.Visible = true; status.Visible = false;
                PresentationBootstrap.WriteLog("WebView2 window ready: " + tool);
            }
            catch (Exception exception)
            {
                if (!IsDisposed) status.Text = "暂时无法打开 SANDUN\r\n\r\n" + exception.Message + "\r\n\r\n点击重试";
                PresentationBootstrap.WriteLog("WebView2 failed: " + exception);
            }
            finally { initializing = false; }
        }
        private void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            Uri uri;
            if (!Uri.TryCreate(e.Source, UriKind.Absolute, out uri) || uri.GetLeftPart(UriPartial.Authority) != PresentationBootstrap.Origin) return;
            try
            {
                var message = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
                string type = Convert.ToString(message["type"]);

                if (type == "sandun:route")
                {
                    var frame = FindForm() as PluginWindow;
                    if (frame != null) frame.Navigate(Convert.ToString(message["tool"]));
                }
                if (type == "sandun:window" || type == "sandun:window-ready")
                {
                    var frame = FindForm() as PluginWindow;
                    if (frame != null) frame.WindowCommand(type == "sandun:window-ready" ? "ready" : Convert.ToString(message["action"]));
                }
                if (type == "sandun:close") { var form = FindForm(); if (form != null) form.Close(); }
            }
            catch (Exception exception) { PresentationBootstrap.WriteLog("Window message: " + exception.Message); }
        }
    }
    internal sealed class RibbonImages : AxHost
    {
        private RibbonImages() : base("") { }
        internal static object Create(string kind)
        {
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("SANDUN.Icons." + kind + ".png"))
            {
                if (stream == null) throw new ArgumentException("Missing tool icon: " + kind);
                using (var bitmap = new Bitmap(stream))
                using (var sized = new Bitmap(32, 32, System.Drawing.Imaging.PixelFormat.Format32bppArgb))
                {
                    using (var graphics = Graphics.FromImage(sized))
                    {
                        graphics.Clear(Color.Transparent);
                        graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        graphics.DrawImage(bitmap, new Rectangle(0, 0, 32, 32));
                    }
                    return GetIPictureDispFromPicture(sized);
                }
            }
        }
    }
    [ComVisible(true)]
    [Guid("BA8F6DFD-1319-5C85-B827-C66CAA4D381B")]
    [InterfaceType(ComInterfaceType.InterfaceIsDual)]
    public interface INativeOfficeBridge
    {
        [DispId(1)] string CaptureSvgTarget();
        [DispId(2)] string InsertSvg(string svg, string target, string label);
        [DispId(3)] bool CanInsertNativeChart(string chartData);
        [DispId(4)] string InsertNativeChart(string chartData, string target);
        [DispId(5)] string ExecuteTool(string command, string options);
        [DispId(6)] string GetToolState(string command);
        [DispId(7)] void OpenTool(string command);
        [DispId(9)] string SaveGeneratedImage(string dataUrl, string name);
        [DispId(10)] string InsertCover(string backgroundSvg, string titleSvg, string target);
    }

    [ComVisible(true)]
    [ClassInterface(ClassInterfaceType.AutoDual)]
    [Guid("33EDBE4F-E03C-596D-8A49-59E79F2AE6D2")]
    public sealed class NativeOfficeBridge
    {
        public string CaptureSvgTarget() { return SvgInsertion.CaptureTarget(); }
        public string InsertSvg(string svg, string target, string label) { return SvgInsertion.Insert(svg, target, label); }
        public string SaveGeneratedImage(string dataUrl, string name) { return GeneratedImageFile.Save(dataUrl, name); }
        public string InsertCover(string backgroundSvg, string titleSvg, string target) { return SvgInsertion.InsertCover(backgroundSvg, titleSvg, target); }
        public bool CanInsertNativeChart(string chartData) { return NativeChartInsertion.CanInsert(chartData); }
        public string InsertNativeChart(string chartData, string target) { return NativeChartInsertion.Insert(chartData, target); }
        public string ExecuteTool(string command, string options) { return NativeTools.Execute(command, options); }
        public string GetToolState(string command) { return ToolPanel.GetState(command); }
        public void OpenTool(string command) { PresentationBootstrap.Current.ExecuteTool(command); }
    }
}
