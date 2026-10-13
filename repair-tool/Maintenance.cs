using Microsoft.Win32;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;

namespace Sandun.PptRepairTool;

internal enum ActionKind { None, Registration, Wps, Core, Disabled }
internal enum ResultState { Passed, Info, Attention, Error }
internal record Edition(string Name, string Guid, string Folder, string Exe, string ProgId, int Port, string Setup)
{
    public static readonly Edition Commercial = new("商业版", "{D7E76628-B724-4F9E-A165-61376DD2A384}_is1", "PPTagentPPTPlugin", "ppagent-local.exe", "SANDUN.PresentationBootstrap", 17666, "SANDUN-PPT-Plugin-Commercial-Setup-1.0.31.exe");
    public static readonly Edition Open = new("开源版", "{DFB0641B-FA91-4437-9134-BB59480C8C8E}_is1", "SANDUNPPTOpenSource", "sandun-open-local.exe", "SANDUN.OpenPresentationBootstrap", 17667, "SANDUN-PPT-OpenSource-Setup-2.0.0.exe");
    public static Edition[] All => [Commercial, Open];
}
internal record Installation(Edition Edition, string Path, string Version)
{
    public string Core => System.IO.Path.Combine(Path, "local", Edition.Exe);
}
internal record CheckItem(string Id, string Title, ResultState State, string Detail, Installation? Install = null, ActionKind Action = ActionKind.None)
{
    public bool Issue => State is ResultState.Attention or ResultState.Error;
    public bool Repairable => Issue && Action != ActionKind.None && Install != null;
}
internal record CommandResult(int Code, string Output)
{
    public void Ensure(bool installer = false)
    { if (Code != 0 && !(installer && Code == 3010)) throw new IOException($"执行失败（退出码 {Code}）。\n{Output.Trim()}"); }
}
internal static class Commands
{
    internal static string PowerShell => System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    internal static ProcessStartInfo Build(string exe, IEnumerable<string> args, bool visible = false)
    {
        var info = new ProcessStartInfo(exe) { UseShellExecute = false, CreateNoWindow = !visible,
            RedirectStandardOutput = !visible, RedirectStandardError = !visible, WorkingDirectory = System.IO.Path.GetDirectoryName(exe) ?? AppContext.BaseDirectory };
        foreach (var arg in args) info.ArgumentList.Add(arg);
        return info;
    }
    internal static async Task<CommandResult> Run(string exe, IEnumerable<string> args, TimeSpan timeout, bool visible = false)
    {
        using var process = Process.Start(Build(exe, args, visible)) ?? throw new IOException("无法启动：" + exe);
        var stdout = visible ? Task.FromResult("") : process.StandardOutput.ReadToEndAsync();
        var stderr = visible ? Task.FromResult("") : process.StandardError.ReadToEndAsync();
        using var timer = new CancellationTokenSource(timeout);
        try { await process.WaitForExitAsync(timer.Token); }
        catch (OperationCanceledException)
        { if (!process.HasExited) process.Kill(true); await process.WaitForExitAsync(); throw new TimeoutException("操作超时，已停止本次命令。请重新检测后重试。"); }
        return new(process.ExitCode, (await stdout) + "\n" + (await stderr));
    }
    internal static string[] ScriptArgs(string script, string directory, bool repairOnly) =>
        new[] { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-InstallDir", directory }.Concat(repairOnly ? new[] { "-RepairOnly" } : Array.Empty<string>()).ToArray();
}

internal class Maintenance
{
    // Tests redirect only these I/O boundaries to isolated fixtures; they run the same diagnostics/actions.
    internal Func<RegistryHive, RegistryView, string, string, object?> ReadRegistry = Read;
    internal Func<string> HostBlocker = FindRunningHosts;
    internal Func<string, IEnumerable<string>, TimeSpan, bool, Task<CommandResult>> Execute = Commands.Run;
    internal Func<int, Task<(bool Ok, string Detail)>> ProbeCore = Health;
    internal Func<string, Task<(bool Ok, string Detail)>> ProbeServer = Server;
    internal Action<string, string?>? ClearDisabledOverride;
    internal string WpsDirectory = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "kingsoft", "wps", "jsaddons");
    internal string ReportDirectory = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SANDUN", "RepairReports");
    internal static RegistryView[] Views => Environment.Is64BitOperatingSystem ? [RegistryView.Registry64, RegistryView.Registry32] : [RegistryView.Registry32];
    internal static object? Read(RegistryHive hive, RegistryView view, string path, string name)
    { using var root = RegistryKey.OpenBaseKey(hive, view); using var key = root.OpenSubKey(path); return key?.GetValue(name); }
    internal static string Normalize(string path)
    {
        if (!System.IO.Path.IsPathFullyQualified(path)) throw new ArgumentException("安装目录必须是完整路径。");
        var full = System.IO.Path.GetFullPath(path).TrimEnd('\\', '/');
        if (full.Length <= 3) throw new ArgumentException("安装目录不能是磁盘根目录。");
        return full;
    }
    internal Installation? Find(Edition edition)
    {
        var candidates = new List<Installation>();
        foreach (var hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine }) foreach (var view in Views)
        {
            var key = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + edition.Guid;
            if (ReadRegistry(hive, view, key, "InstallLocation") is string path && Directory.Exists(path))
                candidates.Add(new(edition, Normalize(path), Convert.ToString(ReadRegistry(hive, view, key, "DisplayVersion")) ?? "未知"));
        }
        // Old HKCU uninstall records can survive a later machine-wide upgrade.
        var latest = candidates.OrderByDescending(i => Version.TryParse(i.Version, out var v) ? v : new Version()).FirstOrDefault();
        if (latest != null) return latest;
        foreach (var folder in new[] { System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs"), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) })
        { var path = System.IO.Path.Combine(folder, edition.Folder); if (File.Exists(System.IO.Path.Combine(path, "local", edition.Exe))) return new(edition, Normalize(path), "未知"); }
        return null;
    }
    internal (bool Ok, string Detail) Addin(Installation install, bool wps)
    {
        var root = wps ? @"Software\Kingsoft\Office\6.0\WPP\AddIns\" : @"Software\Microsoft\Office\PowerPoint\Addins\";
        foreach (var view in Views)
        {
            // Per-user values take precedence over machine-wide defaults in the same view.
            var value = ReadRegistry(RegistryHive.CurrentUser, view, root + install.Edition.ProgId, "LoadBehavior") ?? ReadRegistry(RegistryHive.LocalMachine, view, root + install.Edition.ProgId, "LoadBehavior");
            if (value is int behavior && behavior == 3)
            {
                var allowed = !wps || ReadRegistry(RegistryHive.CurrentUser, view, @"Software\Kingsoft\Office\WPP\AddinsWL", install.Edition.ProgId) != null || ReadRegistry(RegistryHive.LocalMachine, view, @"Software\Kingsoft\Office\WPP\AddinsWL", install.Edition.ProgId) != null;
                if (allowed) return (true, $"{install.Edition.ProgId} · LoadBehavior=3 · {view}");
            }
        }
        return (false, "未找到启用的" + (wps ? " WPS 专用 COM 注册项或白名单" : " PowerPoint 注册项") + "：" + install.Edition.ProgId);
    }
    internal (bool Ok, string Detail) Wps(Installation install)
    {
        var notes = new List<string>(); var valid = false;
        foreach (var name in new[] { "publish.xml", "jsplugins.xml" })
        {
            var file = System.IO.Path.Combine(WpsDirectory, name);
            if (!File.Exists(file)) { notes.Add(name + " 缺失"); continue; }
            try
            {
                var xml = XDocument.Load(file);
                var node = xml.Root?.Elements("jspluginonline").FirstOrDefault(n => (string?)n.Attribute("name") == install.Edition.Folder);
                var ok = node != null && (string?)node.Attribute("type") == "wpp" && (string?)node.Attribute("enable") == "enable_dev" &&
                    Uri.TryCreate((string?)node.Attribute("url"), UriKind.Absolute, out var uri) && uri.Scheme == "https" && uri.Host == "127.0.0.1" && uri.Port == install.Edition.Port && uri.AbsolutePath.TrimEnd('/') == "/wps";
                valid |= ok;
                notes.Add(name + (ok ? " 已启用" : " 未配置、已停用或地址不匹配"));
            }
            catch (Exception ex) { notes.Add(name + " 读取失败：" + ex.Message); }
        }
        // WPS versions use different files. A working entry is evidence, not proof of host rendering.
        return (valid, string.Join("；", notes));
    }
    internal async Task<List<CheckItem>> Scan(IReadOnlyList<Installation> installs)
    {
        var rows = new List<CheckItem>();
        if (installs.Count == 0) rows.Add(new("install", "尚未发现插件", ResultState.Info, "可前往安装 / 卸载页面选择版本。"));
        foreach (var install in installs)
        {
            var prefix = install.Edition.Name; var id = install.Edition.Folder;
            void Add(string key, string title, bool ok, string detail, ActionKind action = ActionKind.None) => rows.Add(new(id + "." + key, prefix + " · " + title, ok ? ResultState.Passed : ResultState.Attention, detail, install, action));
            Add("files", "插件文件", File.Exists(install.Core) && File.Exists(System.IO.Path.Combine(install.Path, "native", install.Edition.ProgId + ".dll")), install.Path + " · v" + install.Version);
            try { var office = Addin(install, false); Add("office", "Office 加载项", office.Ok, office.Detail, ActionKind.Registration); }
            catch(Exception ex) { rows.Add(new(id + ".office", prefix + " · Office 加载项", ResultState.Error, "无法读取注册表：" + ex.Message)); }
            var wps = Wps(install);
            Add("wps", "WPS 在线插件", wps.Ok, wps.Detail, ActionKind.Wps);
            try
            {
                var bridge = Addin(install, true);
                rows.Add(new(id + ".bridge", prefix + " · WPS COM 配置", bridge.Ok ? ResultState.Passed : wps.Ok ? ResultState.Info : ResultState.Attention,
                    bridge.Ok ? bridge.Detail : wps.Ok ? "在线插件入口已启用；未配置 WPS 专用 COM 加载项，不能据此判断 WPS 无法使用。若原生工具按钮异常，可在组件维护中修复注册。" : bridge.Detail, install, ActionKind.Registration));
            }
            catch(Exception ex) { rows.Add(new(id + ".bridge", prefix + " · WPS COM 配置", ResultState.Error, "无法读取注册表：" + ex.Message)); }
            var health = await ProbeCore(install.Edition.Port); Add("core", "本地服务连接", health.Ok, health.Detail, ActionKind.Core);
            if (install.Edition == Edition.Commercial)
            {
                try { var endpoint = Endpoint(install); var server = await ProbeServer(endpoint); Add("server", "服务器连接", server.Ok, server.Ok ? server.Detail : "暂时无法连接服务器，请检查网络后重新检测。"); }
                catch(Exception) { rows.Add(new(id + ".server", "商业版 · 服务器连接", ResultState.Error, "服务器配置或连接检查失败，请检查插件配置后重试。")); }
            }
        }
        var hosts = HostBlocker();
        rows.Add(new("hosts", "演示软件状态", ResultState.Info, hosts.Length == 0 ? "未发现运行中的 PowerPoint / WPS 演示。" : hosts + " 正在运行，这是正常状态；执行注册和配置修复前请保存文稿并退出。"));
        rows.Add(new("system", "系统环境", ResultState.Info, Environment.OSVersion.VersionString + " · " + (Environment.Is64BitOperatingSystem ? "64 位" : "32 位") + " · 工具自带 .NET 运行时"));
        return rows;
    }
    internal static string Endpoint(Installation install)
    {
        var file = System.IO.Path.Combine(install.Path, "plugin-config.json");
        if (!File.Exists(file)) return "https://agentadmin.sandun.cc";
        using var json = JsonDocument.Parse(File.ReadAllText(file));
        var value = json.RootElement.TryGetProperty("apiBaseUrl", out var prop) ? prop.GetString() : null;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != "https" || !string.IsNullOrEmpty(uri.UserInfo)) throw new IOException("apiBaseUrl 不是有效的 HTTPS 地址。");
        return uri.GetLeftPart(UriPartial.Path);
    }
    internal static async Task<(bool Ok, string Detail)> Server(string endpoint)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };
        try { using var result = await client.GetAsync(endpoint, HttpCompletionOption.ResponseHeadersRead); var status = (int)result.StatusCode; return (status < 500, $"HTTP {status}，" + (status < 500 ? "已连接到服务器；未验证账号登录或业务接口。" : "服务器返回错误。")); }
        catch(TaskCanceledException) { return (false, "连接超时，请稍后重试。"); }
        catch(HttpRequestException) { return (false, "暂时无法连接服务器，请检查网络后重试。"); }
    }
    internal static async Task<(bool Ok, string Detail)> Health(int port)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
        try { using var response = await client.GetAsync($"https://127.0.0.1:{port}/healthz"); response.EnsureSuccessStatusCode(); using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var ok = json.RootElement.TryGetProperty("status", out var status) && status.GetString() == "ok";
            return (ok, ok ? $"本机 HTTPS 服务 {port} 已响应健康检查。" : $"端口 {port} 的响应不是预期的健康检查结果。"); }
        catch(Exception ex) { return (false, $"本机服务 {port} 请求失败：{ex.Message}"); }
    }
    internal static string FindRunningHosts()
    {
        var names = new List<string>();
        foreach (var name in new[] { "POWERPNT", "wpp" }) { var processes = Process.GetProcessesByName(name); if(processes.Length > 0) names.Add(name == "wpp" ? "WPS 演示" : "PowerPoint"); foreach(var process in processes) process.Dispose(); }
        return string.Join("、", names);
    }
    internal void RequireHostsClosed()
    { var hosts = HostBlocker(); if (hosts.Length > 0) throw new IOException("请先保存文稿并关闭 " + hosts + "，再点击重试。本次未执行修复。"); }
    internal async Task Repair(Installation install, ActionKind action)
    {
        if (action == ActionKind.None) throw new ArgumentException("该项目不支持自动修复，请查看检测详情。");
        if (action != ActionKind.Core) RequireHostsClosed();
        if (action == ActionKind.Core)
        {
            if (!File.Exists(install.Core)) throw new FileNotFoundException("本地核心程序缺失，请通过安装 / 更新补齐文件。", install.Core);
            if ((await ProbeCore(install.Edition.Port)).Ok) return;
            if (IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(p => p.Port == install.Edition.Port)) throw new IOException("端口已被占用但健康检查失败，请先检查端口占用或本机 HTTPS 证书。");
            var info = Commands.Build(install.Core, ["--keep-alive"]); info.RedirectStandardOutput = false; info.RedirectStandardError = false;
            using var process = Process.Start(info) ?? throw new IOException("无法启动本地核心服务。");
            for (var attempt = 0; attempt < 12; attempt++) { await Task.Delay(500); if ((await ProbeCore(install.Edition.Port)).Ok) return; }
            throw new IOException("已启动核心程序，但 HTTPS 健康检查尚未通过；请检查证书、端口和程序日志。");
        }
        if (action == ActionKind.Disabled) { if(ClearDisabledOverride!=null) ClearDisabledOverride(install.Edition.ProgId,null); else ClearDisabled(install.Edition.ProgId); return; }
        var script = System.IO.Path.Combine(install.Path, "scripts", action == ActionKind.Wps ? "install-wps-plugin.ps1" : "install-native-bootstrap.ps1");
        if (!File.Exists(script)) throw new FileNotFoundException("修复脚本缺失，请通过安装 / 更新补齐文件。", script);
        var originals = new Dictionary<string,byte[]?>();
        if(action == ActionKind.Wps)
        {
            Directory.CreateDirectory(WpsDirectory);
            foreach(var name in new[]{"publish.xml","jsplugins.xml"})
            {
                var file=System.IO.Path.Combine(WpsDirectory,name); originals[file]=File.Exists(file)?File.ReadAllBytes(file):null;
                if(originals[file]!=null)
                {
                    var backup=System.IO.Path.Combine(ReportDirectory,"wps-backup-"+DateTime.Now.ToString("yyyyMMdd-HHmmss-fffffff")); Directory.CreateDirectory(backup); File.WriteAllBytes(System.IO.Path.Combine(backup,name),originals[file]!);
                    XDocument xml;
                    try { xml=XDocument.Load(file); if(xml.Root?.Name!="jsplugins") throw new System.Xml.XmlException("无效的 WPS 配置根节点。"); }
                    catch(System.Xml.XmlException) { xml=new XDocument(new XElement("jsplugins")); }
                    // The bundled script preserves disable flags; explicitly re-enable only this edition.
                    foreach(var node in xml.Root!.Elements("jspluginonline").Where(n=>(string?)n.Attribute("name")==install.Edition.Folder)) node.SetAttributeValue("enable","enable_dev");
                    xml.Save(file);
                }
            }
        }
        try
        {
            var result = await Execute(Commands.PowerShell, Commands.ScriptArgs(script, Normalize(install.Path), action == ActionKind.Registration), TimeSpan.FromMinutes(2), false);
            result.Ensure();
        }
        catch
        {
            foreach(var original in originals) { if(original.Value==null) File.Delete(original.Key); else File.WriteAllBytes(original.Key,original.Value); }
            throw;
        }
        var state = action == ActionKind.Wps ? Wps(install) : Addin(install, false);
        if (!state.Ok) throw new IOException("命令已结束，但复检尚未通过：" + state.Detail);
        if (action == ActionKind.Registration && !Addin(install, true).Ok) throw new IOException("命令已结束，但 WPS COM 注册复检尚未通过。");
    }
    internal static bool MatchesDisabled(object value, string progId)
    {
        if (value is not byte[] bytes) return false;
        var unicode = Encoding.Unicode.GetString(bytes); var ascii = Encoding.UTF8.GetString(bytes);
        return unicode.Contains(progId, StringComparison.OrdinalIgnoreCase) || ascii.Contains(progId, StringComparison.OrdinalIgnoreCase);
    }
    internal void ClearDisabled(string progId, string? fixtureRoot = null)
    {
        var backup = new List<object>();
        var backupFile=System.IO.Path.Combine(ReportDirectory,"disabled-backup-"+DateTime.Now.ToString("yyyyMMdd-HHmmss-fffffff")+".json");
        foreach (var view in Views) foreach (var version in new[] { "14.0", "15.0", "16.0" }) foreach (var subkey in new[] { "DisabledItems", "StartupItems" })
        {
            var path = (fixtureRoot ?? @"Software\Microsoft\Office") + $"\\{version}\\PowerPoint\\Resiliency\\{subkey}";
            using var root = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, view); using var key = root.OpenSubKey(path, true);
            if (key == null) continue;
            foreach (var name in key.GetValueNames()) if (key.GetValue(name) is byte[] value && MatchesDisabled(value, progId))
            {
                backup.Add(new { view = view.ToString(), path, name, value = Convert.ToBase64String(value) });
                Directory.CreateDirectory(ReportDirectory);
                File.WriteAllText(backupFile, JsonSerializer.Serialize(backup), Encoding.UTF8);
                key.DeleteValue(name, false);
            }
        }
    }
    internal static string? FindSetup(string directory, string name)
    { return new[] { System.IO.Path.Combine(directory, name), System.IO.Path.Combine(System.IO.Path.GetFullPath(System.IO.Path.Combine(directory, "..")), name) }.FirstOrDefault(File.Exists); }
    internal async Task<CommandResult> Install(string file)
    { RequireHostsClosed(); if (!File.Exists(file)) throw new FileNotFoundException("安装包不存在。", file); var result = await Execute(file, Array.Empty<string>(), TimeSpan.FromMinutes(30), true); result.Ensure(true); return result; }
    internal async Task<CommandResult> Uninstall(Installation install)
    {
        RequireHostsClosed(); var file = Directory.GetFiles(install.Path, "unins*.exe").OrderBy(p => p).FirstOrDefault() ?? throw new FileNotFoundException("未发现该版本的卸载程序。");
        var result = await Execute(file, Array.Empty<string>(), TimeSpan.FromMinutes(30), true); result.Ensure(true); return result;
    }
    internal string Report(IEnumerable<CheckItem> rows, string action)
    {
        Directory.CreateDirectory(ReportDirectory); var file = System.IO.Path.Combine(ReportDirectory, "diagnostic-" + DateTime.Now.ToString("yyyyMMdd-HHmmss-fff") + ".txt");
        File.WriteAllText(file, "SANDUN 插件维护中心 v1.0.2\n" + DateTime.Now.ToString("O") + "\n" + string.Join("\n", rows.Select(r => $"[{r.State}] {r.Title}\n{r.Detail}")) + "\n最近操作：" + action, Encoding.UTF8); return file;
    }
}

