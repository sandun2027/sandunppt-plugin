using Sandun.PptRepairTool;
using Microsoft.Win32;
using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;

internal static class Program
{
    static readonly List<string> Results=new();
    static string root="", source="", registry="";
    static int failed;
    [STAThread] static int Main(string[] args)
    {
        source=args[0]; root=Path.Combine(source,"test-output",DateTime.Now.ToString("yyyyMMdd-HHmmss")); Directory.CreateDirectory(root);
        registry=@"Software\SANDUNRepairToolTests\"+Guid.NewGuid().ToString("N");
        var app=new Application { ShutdownMode=ShutdownMode.OnExplicitShutdown };
        app.Startup+=async(_,_)=>{ try { await Run(); } catch(Exception ex) { Results.Add("FATAL "+ex); failed++; } finally {
            using(var current=RegistryKey.OpenBaseKey(RegistryHive.CurrentUser,RegistryView.Registry64)) current.DeleteSubKeyTree(registry,false);
            File.WriteAllLines(Path.Combine(root,"results.txt"),Results); foreach(var line in Results) Console.WriteLine(line); Console.WriteLine("OUTPUT="+root); app.Shutdown(failed==0?0:1);
        }};
        return app.Run();
    }
    static void Assert(bool ok,string message) { if(!ok) throw new Exception(message); }
    static async Task Test(string name,Func<Task> action) { try { await action(); Results.Add("PASS "+name); } catch(Exception ex) { failed++; Results.Add("FAIL "+name+" "+ex); } }
    static async Task Throws(Func<Task> action,string contains) { try { await action(); } catch(Exception ex) { Assert(ex.Message.Contains(contains),"Unexpected error: "+ex.Message); return; } throw new Exception("Expected failure containing: "+contains); }
    static string RegistryPath(RegistryHive hive,RegistryView view,string key)=>registry+"\\"+hive+"\\"+view+"\\"+key;
    static object? Read(RegistryHive hive,RegistryView view,string path,string name) { using var k=Registry.CurrentUser.OpenSubKey(RegistryPath(hive,view,path)); return k?.GetValue(name); }
    static void Set(RegistryHive hive,RegistryView view,string path,string name,object value) { using var k=Registry.CurrentUser.CreateSubKey(RegistryPath(hive,view,path)); k.SetValue(name,value); }
    static Maintenance Engine()=>new() { ReadRegistry=Read,HostBlocker=()=>"",WpsDirectory=Path.Combine(root,"appdata","kingsoft","wps","jsaddons"),ReportDirectory=Path.Combine(root,"reports"),ProbeCore=_=>Task.FromResult((true,"fixture health")),ProbeServer=_=>Task.FromResult((true,"fixture server")) };
    static void GoodRegistration(Installation i)
    {
        foreach(var v in Maintenance.Views) { Set(RegistryHive.CurrentUser,v,@"Software\Microsoft\Office\PowerPoint\Addins\"+i.Edition.ProgId,"LoadBehavior",3); Set(RegistryHive.CurrentUser,v,@"Software\Kingsoft\Office\6.0\WPP\AddIns\"+i.Edition.ProgId,"LoadBehavior",3); Set(RegistryHive.CurrentUser,v,@"Software\Kingsoft\Office\WPP\AddinsWL",i.Edition.ProgId,""); }
    }
    static string Scripts(Edition e)=>Path.Combine(source,"..",e==Edition.Commercial ? "SANDUN-PPT-Plugin-Commercial-1.0.31-source\\SANDUN-PPT-Plugin-Commercial" : "SANDUN-PPT-OpenSource-2.0.0-source\\SANDUN-PPT-OpenSource","scripts");
    static Installation Fixture(Edition e)
    {
        var dir=Path.Combine(root,e.Name+" 空格 安装"); Directory.CreateDirectory(Path.Combine(dir,"local")); Directory.CreateDirectory(Path.Combine(dir,"native")); Directory.CreateDirectory(Path.Combine(dir,"scripts"));
        File.WriteAllText(Path.Combine(dir,"native",e.ProgId+".dll"),"fixture only");
        foreach(var f in Directory.GetFiles(Path.Combine(source,"tests","Fixture","bin","Release","net8.0"))) { File.Copy(f,Path.Combine(dir,Path.GetFileName(f)),true); File.Copy(f,Path.Combine(dir,"local",Path.GetFileName(f)),true); }
        File.Copy(Path.Combine(dir,"Fixture.exe"),Path.Combine(dir,"local",e.Exe),true);
        File.Copy(Path.Combine(dir,"Fixture.exe"),Path.Combine(dir,e.Setup),true); File.Copy(Path.Combine(dir,"Fixture.exe"),Path.Combine(dir,"unins000.exe"),true);
        File.Copy(Path.Combine(Scripts(e),"install-wps-plugin.ps1"),Path.Combine(dir,"scripts","actual-wps.ps1"),true);
        var appdata=Path.Combine(root,"appdata").Replace("'","''");
        File.WriteAllText(Path.Combine(dir,"scripts","install-wps-plugin.ps1"),"param([string]$InstallDir)\n$env:APPDATA='"+appdata+"'\n& (Join-Path $PSScriptRoot 'actual-wps.ps1') -InstallDir $InstallDir\n",new UTF8Encoding(true));
        var regScript=File.ReadAllText(Path.Combine(Scripts(e),"install-native-bootstrap.ps1"));
        var prefix="HKCU:\\"+RegistryPath(RegistryHive.CurrentUser,RegistryView.Registry64,"");
        regScript=regScript.Replace("HKCU:\\",prefix);
        regScript=string.Join("\n",regScript.Split('\n').Where(l=>!l.TrimStart().StartsWith("Stop-ScheduledTask ")&&!l.TrimStart().StartsWith("Unregister-ScheduledTask ")));
        File.WriteAllText(Path.Combine(dir,"scripts","install-native-bootstrap.ps1"),regScript,new UTF8Encoding(true));
        File.Copy(Path.Combine(Scripts(e),"prepare-plugin-update.ps1"),Path.Combine(dir,"scripts","prepare-plugin-update.ps1"),true);
        using var run=Registry.CurrentUser.CreateSubKey(RegistryPath(RegistryHive.CurrentUser,RegistryView.Registry64,@"Software\Microsoft\Windows\CurrentVersion\Run"));
        return new(e,dir+"\\","2.0.0");
    }
    static async Task Run()
    {
        var commercial=Fixture(Edition.Commercial); var open=Fixture(Edition.Open); var engine=Engine();
        await Test("真实子进程：中文、空格、末尾反斜杠和 RepairOnly 参数",async()=>{
            var script=Path.Combine(root,"参数检查.ps1"); File.WriteAllText(script,"param([string]$InstallDir,[switch]$RepairOnly)\n[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'args.txt'), $InstallDir+'|'+$RepairOnly)\n",new UTF8Encoding(true));
            var r=await Commands.Run(Commands.PowerShell,Commands.ScriptArgs(script,open.Path,true),TimeSpan.FromSeconds(10)); r.Ensure(); Assert(File.ReadAllText(Path.Combine(root,"args.txt"))==open.Path+"|True","Arguments corrupted");
        });
        await Test("真实子进程：非零退出码、错误内容及超时",async()=>{
            var script=Path.Combine(root,"fail.ps1"); File.WriteAllText(script,"[Console]::Error.WriteLine('SIMULATED_ERROR_17'); exit 17");
            var r=await Commands.Run(Commands.PowerShell,Commands.ScriptArgs(script,open.Path,true),TimeSpan.FromSeconds(10)); Assert(r.Code==17&&r.Output.Contains("SIMULATED_ERROR_17"),"Lost error output");
            File.WriteAllText(script,"Start-Sleep -Seconds 20"); await Throws(()=>Commands.Run(Commands.PowerShell,Commands.ScriptArgs(script,open.Path,true),TimeSpan.FromMilliseconds(500)),"超时");
        });
        foreach(var install in new[]{commercial,open})
        {
            await Test(install.Edition.Name+"：缺失 WPS XML → 执行原版脚本 → 复检",async()=>{ await engine.Repair(install,ActionKind.Wps); Assert(engine.Wps(install).Ok,"WPS not recovered"); });
            await Test(install.Edition.Name+"：丢失注册 → 执行隔离映射的原版 RepairOnly → 复检",async()=>{ await engine.Repair(install,ActionKind.Registration); Assert(engine.Addin(install,true).Ok,"Registry not restored"); });
        }
        await Test("双版本配置不相互覆盖，XML 保留第三方插件",async()=>{
            var file=Path.Combine(engine.WpsDirectory,"publish.xml"); var xml=System.Xml.Linq.XDocument.Load(file); xml.Root!.Add(new System.Xml.Linq.XElement("jspluginonline",new System.Xml.Linq.XAttribute("name","OtherVendor"))); xml.Save(file);
            await engine.Repair(commercial,ActionKind.Wps); Assert(engine.Wps(open).Ok&&File.ReadAllText(file).Contains("OtherVendor"),"Another plugin was overwritten");
        });
        await Test("WPS 在线入口正常、缺专用 COM 项：提示信息而非错误",async()=>{
            var e=Engine(); e.ReadRegistry=(h,v,p,n)=>p.Contains(@"Kingsoft\Office\6.0") ? null : Read(h,v,p,n);
            var rows=await e.Scan(new[]{commercial}); var bridge=rows.Single(r=>r.Id.EndsWith(".bridge")); Assert(bridge.State==ResultState.Info&&!bridge.Repairable,"Working WPS falsely flagged");
        });
        await Test("开源版 ProgID / 32 位注册视图 / 禁用值不会被当作正常",()=>{
            var e=Engine(); e.ReadRegistry=(h,v,p,n)=>v==RegistryView.Registry32 && p.EndsWith(Edition.Open.ProgId) && n=="LoadBehavior" ? 3 : p.EndsWith("AddinsWL") && n==Edition.Open.ProgId ? "" : null;
            Assert(e.Addin(open,true).Ok&&!e.Addin(commercial,true).Ok,"Edition or registry view mixed"); e.ReadRegistry=(_,_,_,_)=>0; Assert(!e.Addin(open,false).Ok,"Disabled accepted"); return Task.CompletedTask;
        });
        await Test("XML 损坏 / 错地址 / 停用：准确检测并保留错误原因",async()=>{
            var files=new[]{"publish.xml","jsplugins.xml"}.Select(f=>Path.Combine(engine.WpsDirectory,f)).ToArray(); var backup=files.Select(File.ReadAllBytes).ToArray();
            try { foreach(var f in files) File.WriteAllText(f,"<broken>"); Assert(!engine.Wps(commercial).Ok,"Malformed XML accepted"); await engine.Repair(commercial,ActionKind.Wps); Assert(engine.Wps(commercial).Ok,"Malformed XML not recovered"); }
            finally { for(int n=0;n<files.Length;n++) File.WriteAllBytes(files[n],backup[n]); }
            foreach(var bad in new[]{"disable","https://127.0.0.1:9999/wps/"}) { try { foreach(var f in files) File.WriteAllText(f,File.ReadAllText(f).Replace(bad=="disable"?"enable_dev":"https://127.0.0.1:17666/wps/",bad)); Assert(!engine.Wps(commercial).Ok,"Bad entry accepted"); } finally { for(int n=0;n<files.Length;n++) File.WriteAllBytes(files[n],backup[n]); } }
        });
        await Test("运行中的演示软件只提示，维护前阻止写入",async()=>{
            var e=Engine(); e.HostBlocker=()=>"WPS 演示"; var rows=await e.Scan(new[]{commercial}); Assert(rows.Single(r=>r.Id=="hosts").State==ResultState.Info,"Host falsely failed"); await Throws(()=>e.Repair(commercial,ActionKind.Registration),"关闭");
        });
        await Test("脚本缺失 / 空成功后复检失败 / 无修复动作保护",async()=>{
            await Throws(()=>engine.Repair(commercial with{Path=Path.Combine(root,"missing")},ActionKind.Wps),"脚本缺失");
            var e=Engine(); e.Execute=(_,_,_,_)=>Task.FromResult(new CommandResult(0,"")); e.ReadRegistry=(_,_,_,_)=>null;
            await Throws(()=>e.Repair(open,ActionKind.Registration),"复检"); await Throws(()=>e.Repair(open,ActionKind.None),"不支持");
        });
        await Test("核心启动：真实 EXE 收到 keep-alive 后等待健康检查",async()=>{
            var e=Engine(); var marker=Path.Combine(open.Path,"local","started.marker"); e.ProbeCore=_=>Task.FromResult((File.Exists(marker),"fixture status")); await e.Repair(open,ActionKind.Core); Assert(File.ReadAllText(Path.Combine(open.Path,"local","invocations.txt")).Contains("--keep-alive"),"Core not started");
            await Throws(()=>e.Repair(open with{Path=Path.Combine(root,"missing")},ActionKind.Core),"程序缺失");
        });
        await Test("Office 禁用记录：仅清理目标版本并先备份",()=>{
            var fixture=registry+"\\DisabledFixture"; var path=fixture+@"\16.0\PowerPoint\Resiliency\DisabledItems";
            using(var k=Registry.CurrentUser.CreateSubKey(path)) { k.SetValue("ours",Encoding.Unicode.GetBytes(open.Edition.ProgId),RegistryValueKind.Binary); k.SetValue("commercial",Encoding.Unicode.GetBytes(commercial.Edition.ProgId),RegistryValueKind.Binary); k.SetValue("other",Encoding.Unicode.GetBytes("OtherVendor.Plugin"),RegistryValueKind.Binary); }
            engine.ClearDisabled(open.Edition.ProgId,fixture); using var read=Registry.CurrentUser.OpenSubKey(path); Assert(read!.GetValue("ours")==null&&read.GetValue("other")!=null&&read.GetValue("commercial")!=null,"Removed unrelated item"); Assert(Directory.GetFiles(engine.ReportDirectory,"disabled-backup-*.json").Length>0,"Backup missing"); return Task.CompletedTask;
        });
        foreach(var i in new[]{commercial,open}) await Test(i.Edition.Name+"：真实安装/卸载测试进程、失败码、重启码",async()=>{
            var file=Maintenance.FindSetup(i.Path,i.Edition.Setup); Assert(file!=null,"Sibling installer not found"); await engine.Install(file!); Assert(File.Exists(Path.Combine(i.Path,"installed.marker")),"Install fixture didn't run"); await engine.Uninstall(i); Assert(!File.Exists(Path.Combine(i.Path,"installed.marker")),"Uninstall fixture didn't run");
            File.WriteAllText(Path.Combine(i.Path,"exitcode.txt"),"17"); await Throws(()=>engine.Install(file!),"17"); File.WriteAllText(Path.Combine(i.Path,"exitcode.txt"),"3010"); Assert((await engine.Install(file!)).Code==3010,"Reboot code lost"); File.Delete(Path.Combine(i.Path,"exitcode.txt"));
        });
        await Test("商业版地址来自配置 / 非 HTTPS 拒绝 / 开源版不请求商业服务器",async()=>{
            File.WriteAllText(Path.Combine(commercial.Path,"plugin-config.json"),"{\"apiBaseUrl\":\"https://example.com/custom\"}"); Assert(Maintenance.Endpoint(commercial)=="https://example.com/custom","Config ignored");
            var e=Engine(); var count=0; e.ProbeServer=u=>{count++;return Task.FromResult((false,"simulated DNS failure"));}; await e.Scan(new[]{open}); Assert(count==0,"Open contacted commercial server"); var rows=await e.Scan(new[]{commercial}); Assert(count==1&&!rows.Single(r=>r.Id.EndsWith(".server")).Repairable,"Server failure tried registration repair"); File.Delete(Path.Combine(commercial.Path,"plugin-config.json"));
        });
        await Test("诊断报告实际写入包含各项结果和错误",async()=>{
            var file=engine.Report(await engine.Scan(new[]{commercial,open}),"fixture error 17"); Assert(File.ReadAllText(file).Contains("fixture error 17"),"Report lost failure");
        });
        await Test("服务器地址不显示：成功、连接失败、配置异常",async()=>{
            var e=Engine();
            e.ProbeServer=_=>Task.FromResult((true,"HTTP 200，已连接到服务器。"));
            var row=(await e.Scan(new[]{commercial})).Single(r=>r.Id.EndsWith(".server"));
            Assert(!row.Detail.Contains("https://")&&!row.Detail.Contains("sandun.cc"),"Server address visible on success");
            e.ProbeServer=_=>Task.FromResult((false,"Failed https://private.example:443"));
            row=(await e.Scan(new[]{commercial})).Single(r=>r.Id.EndsWith(".server"));
            Assert(!row.Detail.Contains("private.example"),"Server address visible in error");
            e.ProbeServer=_=>throw new IOException("https://private.example");
            row=(await e.Scan(new[]{commercial})).Single(r=>r.Id.EndsWith(".server"));
            Assert(!row.Detail.Contains("private.example"),"Server address visible in exception");
        });
        await Test("真实服务器 HTTPS 请求",async()=>{ var result=await Maintenance.Server("https://agentadmin.sandun.cc"); Assert(result.Ok,result.Detail); Results.Add("EVIDENCE "+result.Detail); });
        await Test("UI：真实按钮失败就地反馈、成功复检、阻止重复操作、截图",async()=>{ await Ui(engine,open); });
        await Test("本机只读检测与界面截图",async()=>{
            var window=new MainWindow(new Maintenance(),false); window.Show(); await window.RefreshAsync(); Screenshot(window,"live-diagnostics.png");
            var scroller=Descendants((DependencyObject)window.FindName("Tabs")).OfType<ScrollViewer>().First(); scroller.ScrollToEnd(); window.UpdateLayout(); Screenshot(window,"server-status.png"); window.Close();
        });
    }
    static async Task Ui(Maintenance engine,Installation install)
    {
        var row=new CheckItem("ui", "开源版 · WPS 在线插件",ResultState.Attention,"模拟配置缺失",install,ActionKind.Wps);
        var e=Engine(); var gate=new TaskCompletionSource<CommandResult>(); e.Execute=(_,_,_,_)=>gate.Task;
        var window=new MainWindow(e,false) { DiscoverOverride=()=>Task.FromResult(new List<Installation>{install}),ScanOverride=()=>Task.FromResult(new List<CheckItem>{row}) }; window.Show(); await window.RefreshAsync();
        Assert(window.WindowStyle==WindowStyle.None && window.AllowsTransparency,"Native title bar still enabled");
        ((Button)window.FindName("MinimizeButton")).RaiseEvent(new RoutedEventArgs(Button.ClickEvent)); Assert(window.WindowState==WindowState.Minimized,"Minimize failed"); window.WindowState=WindowState.Normal;
        var button=Descendants(window).OfType<Button>().Single(b=>Equals(b.Tag,"ui")); button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
        await Task.Delay(100); Assert(!button.IsEnabled,"Double click allowed"); Assert(((TextBlock)window.FindName("OperationText")).Text.Contains("正在"),"No progress visible");
        gate.SetResult(new CommandResult(17,"SIMULATED_VISIBLE_ERROR")); await window.CurrentOperation!;
        Assert(((TextBlock)window.FindName("OperationText")).Text.Contains("SIMULATED_VISIBLE_ERROR"),"Error hidden"); Screenshot(window,"repair-error.png");
        e.Execute=Commands.Run; window.ScanOverride=()=>Task.FromResult(new List<CheckItem>{row with{State=ResultState.Passed}});
        button=Descendants(window).OfType<Button>().Single(b=>Equals(b.Tag,"ui")); button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent)); await window.CurrentOperation!;
        Assert(((TextBlock)window.FindName("OperationText")).Text.Contains("复检已通过"),"Success not displayed"); Screenshot(window,"repair-success.png");
        var tabs=(TabControl)window.FindName("Tabs"); tabs.SelectedIndex=1; window.UpdateLayout(); Screenshot(window,"install-panel.png"); tabs.SelectedIndex=2; window.UpdateLayout(); Screenshot(window,"components-panel.png"); window.Close();
    }
    static IEnumerable<DependencyObject> Descendants(DependencyObject parent) { for(int n=0;n<VisualTreeHelper.GetChildrenCount(parent);n++){var c=VisualTreeHelper.GetChild(parent,n);yield return c;foreach(var d in Descendants(c))yield return d;} }
    static void Screenshot(Window window,string name)
    {
        window.UpdateLayout(); var content=(FrameworkElement)window; var bitmap=new RenderTargetBitmap((int)content.ActualWidth,(int)content.ActualHeight,96,96,PixelFormats.Pbgra32); bitmap.Render(content);
        var encoder=new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap)); using var file=File.Create(Path.Combine(root,name)); encoder.Save(file);
    }
}

