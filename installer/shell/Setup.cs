using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Microsoft.Win32;

namespace Sandun.Setup
{
    internal sealed class ExistingInstall
    {
        internal string Directory, Version;
    }

    internal static class InstallLocation
    {
        internal const string ProductKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\{DFB0641B-FA91-4437-9134-BB59480C8C8E}_is1";
        internal static string DefaultDirectory { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "SANDUNPPTOpenSource"); } }
        internal static ExistingInstall Find(string key = ProductKey)
        {
            foreach (var hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
            foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
            {
                using (var root = RegistryKey.OpenBaseKey(hive, view)) using (var record = root.OpenSubKey(key))
                {
                    if (record == null) continue;
                    string path = Convert.ToString(record.GetValue("InstallLocation"));
                    if (IsValid(path) && System.IO.Directory.Exists(path)) return new ExistingInstall { Directory = Path.GetFullPath(path).TrimEnd('\\'), Version = Convert.ToString(record.GetValue("DisplayVersion")) };
                }
            }
            if (key != ProductKey) return null;
            // Older installations may retain COM registration after losing their uninstall record.
            foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
            using (var root = RegistryKey.OpenBaseKey(RegistryHive.ClassesRoot, view))
            using (var record = root.OpenSubKey(@"CLSID\{2A836EBE-8B8E-4757-BBB6-EC6204AB97F1}\InprocServer32"))
            {
                Uri uri;
                if (record == null || !Uri.TryCreate(Convert.ToString(record.GetValue("CodeBase")), UriKind.Absolute, out uri) || !uri.IsFile) continue;
                if (!Path.GetFileName(uri.LocalPath).Equals("SANDUN.OpenPresentationBootstrap.dll", StringComparison.OrdinalIgnoreCase) || !File.Exists(uri.LocalPath)) continue;
                string path = Path.GetDirectoryName(Path.GetDirectoryName(uri.LocalPath));
                if (File.Exists(Path.Combine(path, "local", "sandun-open-local.exe"))) return new ExistingInstall { Directory = path, Version = FileVersionInfo.GetVersionInfo(uri.LocalPath).FileVersion };
            }
            if (File.Exists(Path.Combine(DefaultDirectory, "local", "sandun-open-local.exe"))) return new ExistingInstall { Directory = DefaultDirectory, Version = "" };
            return null;
        }
        internal static bool IsValid(string path)
        {
            try { return !string.IsNullOrWhiteSpace(path) && Path.IsPathRooted(path) && Path.GetPathRoot(path).Length >= 3 && path.IndexOf('"') < 0 && path.IndexOfAny(new[] { '*', '?', '<', '>', '|' }) < 0 && path.IndexOfAny(Path.GetInvalidPathChars()) < 0 && Path.GetFullPath(path).TrimEnd('\\').Length > Path.GetPathRoot(Path.GetFullPath(path)).TrimEnd('\\').Length; }
            catch { return false; }
        }
    }

    internal sealed class InstallResult
    {
        internal int ExitCode;
        internal string Error, LogPath;
    }

    internal static class InstallerEngine
    {
        internal static string HostBlocker()
        {
            var names = new List<string>();
            foreach (string name in new[] { "POWERPNT", "wpp" })
            {
                var processes = Process.GetProcessesByName(name);
                if (processes.Length > 0) names.Add(name == "POWERPNT" ? "PowerPoint" : "WPS 演示");
                foreach (var process in processes) process.Dispose();
            }
            return string.Join("、", names);
        }
        internal static string Arguments(string directory, string log)
        {
            if (!InstallLocation.IsValid(directory)) throw new ArgumentException("请选择有效的安装目录。");
            return "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /DIR=\"" + directory.TrimEnd('\\') + "\" /LOG=\"" + log + "\"";
        }
        internal static async Task<InstallResult> Run(string directory, Action<int, string> progress, string fixture = null)
        {
            string work = Path.Combine(Path.GetTempPath(), "Sandun.Setup-" + Guid.NewGuid().ToString("N"));
            string logDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SANDUNPPTOpenSource", "InstallerLogs");
            Directory.CreateDirectory(logDirectory); Directory.CreateDirectory(work);
            string payload = Path.Combine(work, "Sandun.Engine.exe"), log = Path.Combine(logDirectory, "install-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".log");
            var result = new InstallResult { LogPath = log };
            try
            {
                progress(2, "正在准备安装文件");
                await Task.Run(delegate {
                    if (fixture != null) File.Copy(fixture, payload);
                    else using (var input = Assembly.GetExecutingAssembly().GetManifestResourceStream("Sandun.Setup.Engine"))
                    using (var output = File.Create(payload)) { if (input == null) throw new InvalidOperationException("安装文件不完整，请重新下载安装包。"); input.CopyTo(output); }
                });
                var start = new ProcessStartInfo(payload, Arguments(directory, log)) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = work };
                using (var process = Process.Start(start))
                {
                    var completion = Task.Run(delegate { process.WaitForExit(); return process.ExitCode; });
                    while (!completion.IsCompleted) { ReadProgress(log, progress); await Task.Delay(200); }
                    result.ExitCode = await completion; ReadProgress(log, progress);
                }
                if (result.ExitCode != 0 && result.ExitCode != 3010) result.Error = ReadFailure(log);
                return result;
            }
            finally
            {
                // Delete only the file and empty temporary folder this invocation created.
                try { File.Delete(payload); Directory.Delete(work, false); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            }
        }
        internal static string ReadLog(string path)
        {
            if (!File.Exists(path)) return "";
            try { using (var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) using (var reader = new StreamReader(file, Encoding.UTF8, true)) return reader.ReadToEnd(); }
            catch (IOException) { return ""; }
        }
        internal static void ReadProgress(string path, Action<int, string> progress)
        {
            string line = ReadLog(path).Split('\n').LastOrDefault(s => s.Contains("SANDUN_PROGRESS|"));
            if (line == null) return;
            var fields = line.Substring(line.IndexOf("SANDUN_PROGRESS|", StringComparison.Ordinal)).Trim().Split('|');
            int value;
            if (fields.Length >= 3 && int.TryParse(fields[1], out value))
            {
                string label = value >= 100 ? "安装完成" : value >= 93 ? "正在连接 PowerPoint 与 WPS" : value >= 86 ? "正在验证安装环境" : value >= 77 ? "正在建立安全连接" : fields[2];
                progress(Math.Max(0, Math.Min(100, value)), label);
            }
        }
        internal static string ReadFailure(string log)
        {
            string text = ReadLog(log);
            if (text.Contains("SANDUN_BLOCK|HOST")) return "请先保存文稿并关闭 PowerPoint 和 WPS 演示，然后重试。";
            if (text.Contains("SANDUN_BLOCK|PORT")) return "本地端口被其他程序占用，请关闭占用程序后重试。详细信息可在安装日志中查看。";
            if (text.Contains("SANDUN_BLOCK|CORE")) return "旧版本服务尚未退出，请稍后重试。";
            return "安装未能完成。可以重试，或打开安装日志查看具体原因。";
        }
    }

    internal sealed class SetupController
    {
        internal readonly Window Window;
        private ExistingInstall existing;
        private string state = "ready", logPath;
        private bool installing, preview = false;
        private int percent;
        private readonly Func<string> hostProbe;
        private readonly Func<string, Action<int, string>, Task<InstallResult>> install;
        internal static string Version { get { return Assembly.GetExecutingAssembly().GetName().Version.ToString(3); } }
        internal SetupController(string scenario = null, Func<string> hostProbe = null, Func<string, Action<int, string>, Task<InstallResult>> install = null)
        {
            this.hostProbe = hostProbe ?? InstallerEngine.HostBlocker;
            this.install = install ?? ((directory, progress) => InstallerEngine.Run(directory, progress));
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Sandun.Setup.Window")) Window = (Window)XamlReader.Load(stream);
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Sandun.Setup.Icon")) if (stream != null) Window.Icon = BitmapFrame.Create(stream, BitmapCreateOptions.None, BitmapCacheOption.OnLoad);
            Window.Width = Math.Min(752, SystemParameters.WorkArea.Width - 12); Window.Height = Math.Min(624, SystemParameters.WorkArea.Height - 12);
            existing = InstallLocation.Find();
            Text("VersionLabel", "SANDUN  /  v" + Version);
            Find<Button>("PrimaryButton").Click += async delegate { await Primary(); };
            Find<Button>("SecondaryButton").Click += delegate { if (state == "error" && File.Exists(logPath)) Process.Start(new ProcessStartInfo(logPath) { UseShellExecute = true }); else Ready(); };
            Find<Button>("CloseButton").Click += delegate { Window.Close(); };
            Find<Button>("ChangeDirectoryButton").Click += delegate {
                var edit = Find<TextBox>("DirectoryEdit"); edit.Visibility = edit.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible;
                edit.Focus(); edit.SelectAll();
            };
            Find<TextBox>("DirectoryEdit").TextChanged += delegate { Text("DirectoryLabel", Find<TextBox>("DirectoryEdit").Text); };
            Find<Grid>("TitleBar").MouseLeftButtonDown += delegate(object sender, MouseButtonEventArgs e) { if (e.OriginalSource is TextBlock || e.OriginalSource is Grid || e.OriginalSource is StackPanel) Window.DragMove(); };
            Window.Closing += delegate(object sender, System.ComponentModel.CancelEventArgs e) { if (installing) { e.Cancel = true; Text("FooterNote", "安装正在进行，请稍候。"); } };
            Ready();
#if DEBUG
            if (!string.IsNullOrEmpty(scenario)) { preview = true; Preview(scenario); }
#endif
        }
        internal T Find<T>(string name) where T : FrameworkElement { return (T)Window.FindName(name); }
        private void Text(string name, string value) { Find<TextBlock>(name).Text = value; }
        private void Panels(string panel)
        {
            foreach (string name in new[] { "ReadyPanel", "ProgressPanel", "MessagePanel" }) Find<FrameworkElement>(name).Visibility = name == panel ? Visibility.Visible : Visibility.Collapsed;
            Find<Button>("SecondaryButton").Visibility = Visibility.Collapsed;
            Find<Button>("PrimaryButton").IsEnabled = true;
            Text("FooterNote", "用 SANDUN，少点加班熬夜。");
        }
        private void Ready()
        {
            bool editing = state == "invalid";
            state = "ready"; Panels("ReadyPanel");
            Text("Headline", "用 SANDUN，少点加班熬夜。"); Text("Subtitle", "用 SANDUN，少点加班熬夜。");
            string directory = existing == null ? InstallLocation.DefaultDirectory : existing.Directory;
            if (existing == null && !string.IsNullOrWhiteSpace(Find<TextBox>("DirectoryEdit").Text)) directory = Find<TextBox>("DirectoryEdit").Text;
            Find<TextBox>("DirectoryEdit").Text = directory; Find<TextBox>("DirectoryEdit").Visibility = editing ? Visibility.Visible : Visibility.Collapsed;
            Text("DirectoryLabel", directory);
            Find<Button>("ChangeDirectoryButton").Visibility = existing == null ? Visibility.Visible : Visibility.Collapsed;
            Text("ExistingLabel", existing == null ? "支持 PowerPoint 与 WPS 演示" : "已发现" + (string.IsNullOrEmpty(existing.Version) ? "旧版本" : " v" + existing.Version) + "，将在原目录覆盖更新。");
            Find<Button>("PrimaryButton").Content = existing == null ? "安装 SANDUN  →" : "覆盖更新  →";
        }
        private void Message(string title, string subtitle, string heading, string detail, string button)
        {
            Panels("MessagePanel"); Text("Headline", title); Text("Subtitle", subtitle); Text("MessageTitle", heading); Text("MessageDetail", detail); Find<Button>("PrimaryButton").Content = button;
        }
        private async Task Primary()
        {
            if (preview) return;
            if (state == "done") { Window.Close(); return; }
            if (installing) return;
            if (state == "invalid") { Ready(); return; }
            string directory = existing == null ? Find<TextBox>("DirectoryEdit").Text.Trim() : existing.Directory;
            if (!InstallLocation.IsValid(directory)) { state = "invalid"; Message("选择一个安装位置", "为 SANDUN 留一个专属空间。", "安装目录无效", "请输入完整的文件夹路径，例如 D:\\Apps\\SANDUN；不能直接使用磁盘根目录。", "返回修改"); Find<Button>("PrimaryButton").Content = "返回修改"; return; }
            string blocker = hostProbe();
            if (blocker.Length > 0) { state = "blocked"; Message("先保存，再继续。", "你的文稿值得被妥善保留。", blocker + " 正在运行", "请保存并关闭演示软件。关闭后点击继续，安装器会自动处理旧版本服务。", "已关闭，继续安装"); Find<Button>("SecondaryButton").Visibility = Visibility.Visible; Find<Button>("SecondaryButton").Content = "返回"; return; }
            installing = true; state = "installing"; percent = 0; logPath = null; Panels("ProgressPanel");
            Find<Button>("PrimaryButton").IsEnabled = false; Find<Button>("PrimaryButton").Content = "正在安装…";
            Text("Headline", "用 SANDUN，少点加班熬夜。"); Text("Subtitle", existing == null ? "正在安装 SANDUN" : "正在更新 SANDUN v" + Version);
            try
            {
                var result = await install(directory, Progress); logPath = result.LogPath;
                if (result.ExitCode == 0 || result.ExitCode == 3010) { state = "done"; Message("准备就绪。", "下一次精彩表达，从这里开始。", "SANDUN v" + Version + " 已就位", result.ExitCode == 3010 ? "请重启电脑后打开 PowerPoint 或 WPS，在工具栏找到 SANDUN。" : "打开 PowerPoint 或 WPS，在工具栏找到 SANDUN，即可开始使用。", "完成"); }
                else { state = "error"; ShowError(result.Error); }
            }
            catch (Exception error) { state = "error"; ShowError(error.Message); }
            finally { installing = false; }
        }
        private void Progress(int value, string text)
        {
            percent = Math.Max(percent, value); Text("ProgressLabel", text); Text("PercentLabel", percent + "%"); Find<Border>("ProgressFill").Width = 632 * percent / 100;
        }
        private void ShowError(string error)
        {
            Message("还差最后一步。", "处理后可以直接重试。", "安装未完成", error, "重试安装");
            if (File.Exists(logPath)) { Find<Button>("SecondaryButton").Content = "查看日志"; Find<Button>("SecondaryButton").Visibility = Visibility.Visible; }
        }
#if DEBUG
        internal void Preview(string scenario)
        {
            if (scenario == "update") { existing = new ExistingInstall { Directory = @"D:\Apps\SANDUN", Version = "1.0.13" }; Ready(); }
            if (scenario == "ready") { existing = null; Ready(); }
            if (scenario == "installing") { Panels("ProgressPanel"); Text("Headline", "用 SANDUN，少点加班熬夜。"); Text("Subtitle", "正在安装 SANDUN"); Progress(64, "正在安装插件文件"); Find<Button>("PrimaryButton").Content = "正在安装…"; Find<Button>("PrimaryButton").IsEnabled = false; }
            if (scenario == "blocked") Message("先保存，再继续。", "你的文稿值得被妥善保留。", "PowerPoint 正在运行", "请保存并关闭演示软件。关闭后点击继续，安装器会自动处理旧版本服务。", "已关闭，继续安装");
            if (scenario == "error") ShowError("本地端口被其他程序占用，请关闭占用程序后重试。详细信息可在安装日志中查看。");
            if (scenario == "done") Message("准备就绪。", "下一次精彩表达，从这里开始。", "SANDUN v" + Version + " 已就位", "打开 PowerPoint 或 WPS，在工具栏找到 SANDUN，即可开始使用。", "完成");
        }
#endif
    }

    internal static class Program
    {
        [STAThread] private static int Main(string[] args)
        {
            bool created;
            using (var mutex = new Mutex(true, @"Local\SANDUN.Setup.Shell", out created))
            {
                if (!created) return 1;
                if (args.Any(s => s.Equals("/VERYSILENT", StringComparison.OrdinalIgnoreCase) || s.Equals("/SILENT", StringComparison.OrdinalIgnoreCase)))
                {
                    var existing = InstallLocation.Find();
                    string dir = args.FirstOrDefault(s => s.StartsWith("/DIR=", StringComparison.OrdinalIgnoreCase));
                    dir = existing != null ? existing.Directory : dir != null ? dir.Substring(5).Trim('"') : InstallLocation.DefaultDirectory;
                    try { return InstallerEngine.Run(dir, delegate { }).GetAwaiter().GetResult().ExitCode; }
                    catch { return 1; }
                }
                var app = new Application();
                var controller = new SetupController();
                app.Run(controller.Window); return 0;
            }
        }
    }
}
